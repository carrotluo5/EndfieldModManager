use crate::importer::extract_zip_safe;
use crate::models::{AppConfig, UpdateCheckResult, UpdateProgressEvent};
use crate::{overlay, AppState};
use reqwest::blocking::Client;
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, AUTHORIZATION, USER_AGENT};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::cmp::Ordering;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::sync::atomic::Ordering as AtomicOrdering;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use walkdir::WalkDir;

pub const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");
pub const DEFAULT_UPDATE_REPO: &str = "carrotluo5/EndfieldModManager";

pub fn cleanup_stale_old_exe() {
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let old = exe.with_extension("exe.old");
    if !old.is_file() {
        return;
    }
    if fs::remove_file(&old).is_err() {
        // After a hot-restart the exiting process may briefly hold the old EXE file lock.
        thread::spawn(move || {
            for _ in 0..8 {
                thread::sleep(Duration::from_millis(350));
                if !old.is_file() || fs::remove_file(&old).is_ok() {
                    break;
                }
            }
        });
    }
}

pub fn parse_semver(raw: &str) -> Option<(u64, u64, u64, Option<String>)> {
    let trimmed = raw.trim().trim_start_matches(['v', 'V']);
    if trimmed.is_empty() {
        return None;
    }
    let without_build = trimmed.split('+').next()?.trim();
    let (core, pre) = match without_build.split_once('-') {
        Some((c, p)) => (c, Some(p.trim().to_string()).filter(|s| !s.is_empty())),
        None => (without_build, None),
    };
    let mut parts = core.split('.');
    let major = parts.next()?.parse::<u64>().ok()?;
    let minor = parts.next().unwrap_or("0").parse::<u64>().ok()?;
    let patch = parts.next().unwrap_or("0").parse::<u64>().ok()?;
    if parts.next().is_some() {
        return None;
    }
    Some((major, minor, patch, pre))
}

fn compare_prerelease(a: &str, b: &str) -> Ordering {
    let a_parts: Vec<&str> = a.split('.').collect();
    let b_parts: Vec<&str> = b.split('.').collect();
    for (pa, pb) in a_parts.iter().zip(b_parts.iter()) {
        let ord = match (pa.parse::<u64>(), pb.parse::<u64>()) {
            (Ok(na), Ok(nb)) => na.cmp(&nb),
            (Ok(_), Err(_)) => Ordering::Less,
            (Err(_), Ok(_)) => Ordering::Greater,
            (Err(_), Err(_)) => pa.cmp(pb),
        };
        if ord != Ordering::Equal {
            return ord;
        }
    }
    a_parts.len().cmp(&b_parts.len())
}

pub fn is_newer_version(current: &str, remote: &str) -> bool {
    let Some((cmaj, cmin, cpat, cpre)) = parse_semver(current) else {
        return false;
    };
    let Some((rmaj, rmin, rpat, rpre)) = parse_semver(remote) else {
        return false;
    };
    match (rmaj, rmin, rpat).cmp(&(cmaj, cmin, cpat)) {
        Ordering::Greater => return true,
        Ordering::Less => return false,
        Ordering::Equal => {}
    }
    match (rpre, cpre) {
        (None, Some(_)) => true,
        (Some(ref r), Some(ref c)) => compare_prerelease(r, c) == Ordering::Greater,
        _ => false,
    }
}

pub fn normalize_repo(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    let candidate = if trimmed.is_empty() {
        DEFAULT_UPDATE_REPO
    } else {
        trimmed
    };
    let Some((owner, repo)) = candidate.split_once('/') else {
        return Err("GitHub 仓库格式无效，应为 owner/repo（例如 carrotluo5/EndfieldModManager）".to_string());
    };
    let valid_seg = |seg: &str| {
        !seg.is_empty()
            && seg != "."
            && seg != ".."
            && seg
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
    };
    if !valid_seg(owner) || !valid_seg(repo) {
        return Err("GitHub 仓库格式无效，应为 owner/repo".to_string());
    }
    Ok(format!("{owner}/{repo}"))
}

pub fn apply_mirror_url(url: &str, mirror_prefix: &str) -> String {
    let prefix = mirror_prefix.trim();
    if prefix.is_empty() || !url.starts_with("https://github.com/") {
        return url.to_string();
    }
    if !(prefix.starts_with("https://") || prefix.starts_with("http://")) {
        return url.to_string();
    }
    if prefix.ends_with('/') || prefix.ends_with('=') {
        format!("{prefix}{url}")
    } else {
        format!("{prefix}/{url}")
    }
}

fn build_http_client(token: Option<&str>) -> Result<Client, String> {
    let mut headers = HeaderMap::new();
    let ua = HeaderValue::from_str(&format!("EndfieldModManager/{CURRENT_VERSION}"))
        .map_err(|e| format!("构造 User-Agent 失败：{e}"))?;
    headers.insert(USER_AGENT, ua);
    if let Some(tok) = token.map(str::trim).filter(|t| !t.is_empty()) {
        let val = HeaderValue::from_str(&format!("Bearer {tok}"))
            .map_err(|_| "GitHub Token 包含非法字符".to_string())?;
        headers.insert(AUTHORIZATION, val);
    }
    Client::builder()
        .default_headers(headers)
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| format!("初始化 HTTP 客户端失败：{e}"))
}

pub fn parse_latest_manifest_json(
    raw_json: &str,
    repo: &str,
    mirror_prefix: &str,
) -> Result<UpdateCheckResult, String> {
    let cleaned = raw_json.trim_start_matches('\u{feff}');
    let val: Value =
        serde_json::from_str(cleaned).map_err(|e| format!("解析 latest.json 清单失败：{e}"))?;
    let latest_raw = val
        .get("version")
        .or_else(|| val.get("tag"))
        .and_then(|v| v.as_str())
        .map(|s| s.trim().trim_start_matches(['v', 'V']).to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "latest.json 缺少 version 字段".to_string())?;

    let pkg = val
        .get("updatePackage")
        .or_else(|| val.get("portablePackage"))
        .ok_or_else(|| "latest.json 缺少 updatePackage 或 portablePackage 节点".to_string())?;

    let raw_dl_url = pkg
        .get("url")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "latest.json 更新包缺少 url 字段".to_string())?;
    let file_name = pkg
        .get("fileName")
        .and_then(|v| v.as_str())
        .unwrap_or("EndfieldModManager-update.zip")
        .to_string();
    let file_size = pkg.get("size").and_then(|v| v.as_u64()).unwrap_or(0);
    let sha256 = pkg
        .get("sha256")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    let pub_date = val
        .get("pubDate")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let notes = val
        .get("notes")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let release_url = val
        .get("releaseUrl")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .unwrap_or_else(|| format!("https://github.com/{repo}/releases/tag/v{latest_raw}"));
    let min_supported_client_version = val
        .get("minSupportedClientVersion")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().trim_start_matches(['v', 'V']).to_string())
        .unwrap_or_default();
    let can_auto_update = min_supported_client_version.is_empty()
        || !is_newer_version(CURRENT_VERSION, &min_supported_client_version);

    Ok(UpdateCheckResult {
        current_version: CURRENT_VERSION.to_string(),
        latest_version: latest_raw.clone(),
        has_update: is_newer_version(CURRENT_VERSION, &latest_raw),
        can_auto_update,
        min_supported_client_version,
        pub_date,
        notes,
        release_url,
        download_url: apply_mirror_url(raw_dl_url, mirror_prefix),
        file_name,
        file_size,
        sha256,
        source: "latest.json".to_string(),
    })
}

pub fn parse_github_release_api_json(
    raw_json: &str,
    repo: &str,
    mirror_prefix: &str,
    use_api_asset_url: bool,
) -> Result<UpdateCheckResult, String> {
    let cleaned = raw_json.trim_start_matches('\u{feff}');
    let val: Value =
        serde_json::from_str(cleaned).map_err(|e| format!("解析 GitHub Release JSON 失败：{e}"))?;
    let tag = val
        .get("tag_name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    let latest_version = tag.trim_start_matches(['v', 'V']).to_string();
    if latest_version.is_empty() || parse_semver(&latest_version).is_none() {
        return Err("GitHub Release 的 tag_name 不是有效的版本号".to_string());
    }

    let assets = val
        .get("assets")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "GitHub Release 不包含附件列表".to_string())?;

    let pick_asset = |suffix: &str| {
        assets.iter().find(|asset| {
            asset
                .get("name")
                .and_then(|v| v.as_str())
                .map(|n| n.to_ascii_lowercase().ends_with(suffix))
                .unwrap_or(false)
        })
    };

    let chosen = pick_asset("-update.zip")
        .or_else(|| pick_asset("-portable.zip"))
        .ok_or_else(|| "当前 GitHub Release 未提供可用于热更新的 update.zip 或 portable.zip 压缩包".to_string())?;

    let file_name = chosen
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("EndfieldModManager-update.zip")
        .to_string();
    let file_size = chosen.get("size").and_then(|v| v.as_u64()).unwrap_or(0);
    let sha256 = chosen
        .get("digest")
        .and_then(|v| v.as_str())
        .and_then(|d| d.strip_prefix("sha256:"))
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();

    let raw_dl = if use_api_asset_url {
        chosen
            .get("url")
            .and_then(|v| v.as_str())
            .or_else(|| chosen.get("browser_download_url").and_then(|v| v.as_str()))
    } else {
        chosen
            .get("browser_download_url")
            .and_then(|v| v.as_str())
    }
    .ok_or_else(|| "Release 附件缺少下载地址".to_string())?;

    let download_url = if use_api_asset_url {
        raw_dl.to_string()
    } else {
        apply_mirror_url(raw_dl, mirror_prefix)
    };
    let pub_date = val
        .get("published_at")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let notes = val
        .get("body")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let release_url = val
        .get("html_url")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .unwrap_or_else(|| format!("https://github.com/{repo}/releases"));

    Ok(UpdateCheckResult {
        current_version: CURRENT_VERSION.to_string(),
        latest_version: latest_version.clone(),
        has_update: is_newer_version(CURRENT_VERSION, &latest_version),
        can_auto_update: true,
        min_supported_client_version: String::new(),
        pub_date,
        notes,
        release_url,
        download_url,
        file_name,
        file_size,
        sha256,
        source: "github-api".to_string(),
    })
}

fn find_asset_api_url_by_name(release_json: &str, file_name: &str) -> Option<String> {
    let val: Value = serde_json::from_str(release_json.trim_start_matches('\u{feff}')).ok()?;
    val.get("assets")?
        .as_array()?
        .iter()
        .find(|a| {
            a.get("name")
                .and_then(|v| v.as_str())
                .map(|n| n.eq_ignore_ascii_case(file_name))
                .unwrap_or(false)
        })
        .and_then(|a| a.get("url").and_then(|v| v.as_str()))
        .map(str::to_string)
}

pub fn check_for_updates(cfg: &AppConfig) -> Result<UpdateCheckResult, String> {
    let repo = normalize_repo(&cfg.update_repo)?;
    let token = cfg.update_github_token.trim();
    let has_token = !token.is_empty();
    let client = build_http_client(has_token.then_some(token))?;
    let mirror = if has_token {
        ""
    } else {
        cfg.update_mirror_prefix.trim()
    };

    if has_token {
        let api_url = format!("https://api.github.com/repos/{repo}/releases/latest");
        let resp = client
            .get(&api_url)
            .header(ACCEPT, "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .send()
            .map_err(|e| format!("连接 GitHub Releases API 失败：{e}"))?;
        let status = resp.status();
        if status.as_u16() == 404 {
            return Err("未在仓库中找到已发布的 Release（请确认已发布 Release，且 Token 拥有仓库读取权限）".to_string());
        }
        if !status.is_success() {
            return Err(format!("GitHub API 返回异常状态：HTTP {status}"));
        }
        let release_body = resp
            .text()
            .map_err(|e| format!("读取 Release 响应失败：{e}"))?;

        if let Some(manifest_asset_url) = find_asset_api_url_by_name(&release_body, "latest.json") {
            if let Ok(m_resp) = client
                .get(&manifest_asset_url)
                .header(ACCEPT, "application/octet-stream")
                .send()
            {
                if m_resp.status().is_success() {
                    if let Ok(manifest_text) = m_resp.text() {
                        if let Ok(mut parsed) =
                            parse_latest_manifest_json(&manifest_text, &repo, "")
                        {
                            if let Some(pkg_api_url) =
                                find_asset_api_url_by_name(&release_body, &parsed.file_name)
                            {
                                parsed.download_url = pkg_api_url;
                            }
                            return Ok(parsed);
                        }
                    }
                }
            }
        }
        return parse_github_release_api_json(&release_body, &repo, "", true);
    }

    // Public repository flow: try latest.json direct download first, then GitHub API fallback.
    let raw_manifest_url = format!("https://github.com/{repo}/releases/latest/download/latest.json");
    let manifest_url = apply_mirror_url(&raw_manifest_url, mirror);
    if let Ok(resp) = client.get(&manifest_url).send() {
        if resp.status().is_success() {
            if let Ok(body) = resp.text() {
                if let Ok(parsed) = parse_latest_manifest_json(&body, &repo, mirror) {
                    return Ok(parsed);
                }
            }
        }
    }

    let api_url = format!("https://api.github.com/repos/{repo}/releases/latest");
    let resp = client
        .get(&api_url)
        .header(ACCEPT, "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .map_err(|e| format!("连接 GitHub 检查更新失败（{e}）；国内网络可尝试填写 GitHub 镜像加速前缀"))?;
    let status = resp.status();
    if status.as_u16() == 404 {
        return Err(
            "未检测到公开的 GitHub Release（仓库可能尚未发布 Release 或仍为 Private 私有仓库；私有仓库可在「更新源设置」填入 GitHub Token）".to_string(),
        );
    }
    if !status.is_success() {
        return Err(format!("GitHub API 返回状态 HTTP {status}"));
    }
    let body = resp
        .text()
        .map_err(|e| format!("读取 GitHub Release 信息失败：{e}"))?;
    parse_github_release_api_json(&body, &repo, mirror, false)
}

pub fn verify_file_sha256(path: &Path, expected_hex: &str) -> Result<String, String> {
    let expected = expected_hex.trim().to_ascii_lowercase();
    let mut file = File::open(path).map_err(|e| format!("打开下载文件校验 SHA-256 失败：{e}"))?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = file
            .read(&mut buf)
            .map_err(|e| format!("读取文件计算 SHA-256 失败：{e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    let actual = format!("{:x}", hasher.finalize());
    if !expected.is_empty() && actual != expected {
        return Err(format!(
            "更新包 SHA-256 校验失败（期望 {expected}，实际 {actual}），已中止安装"
        ));
    }
    Ok(actual)
}

pub fn validate_pe_executable(path: &Path) -> Result<(), String> {
    let meta = fs::metadata(path).map_err(|e| format!("检查新版本程序文件失败：{e}"))?;
    if meta.len() < 65536 {
        return Err("更新包内的可执行文件体积异常偏小，已中止替换".to_string());
    }
    let mut file = File::open(path).map_err(|e| format!("读取可执行文件头失败：{e}"))?;
    let mut magic = [0u8; 2];
    file.read_exact(&mut magic)
        .map_err(|e| format!("读取可执行文件魔数失败：{e}"))?;
    if &magic != b"MZ" {
        return Err("更新包内的可执行文件不是有效的 Windows PE 程序（缺少 MZ 文件头）".to_string());
    }
    Ok(())
}

fn find_extracted_exe(extract_dir: &Path) -> Option<PathBuf> {
    let preferred = ["EndfieldModManager.exe", "endfield-mod-manager.exe"];
    for target in preferred {
        for entry in WalkDir::new(extract_dir).max_depth(2).into_iter().flatten() {
            if entry.file_type().is_file()
                && entry.file_name().to_string_lossy().eq_ignore_ascii_case(target)
            {
                return Some(entry.into_path());
            }
        }
    }
    for entry in WalkDir::new(extract_dir).max_depth(2).into_iter().flatten() {
        if !entry.file_type().is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
        if name.ends_with(".exe")
            && name != "7za.exe"
            && name != "unrar.exe"
            && !name.ends_with("setup.exe")
        {
            return Some(entry.into_path());
        }
    }
    None
}

fn is_protected_update_relative_path(rel: &Path) -> bool {
    let mut first_normal: Option<String> = None;
    for comp in rel.components() {
        match comp {
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => return true,
            Component::CurDir => {}
            Component::Normal(seg) => {
                if first_normal.is_none() {
                    first_normal = Some(seg.to_string_lossy().to_ascii_lowercase());
                }
            }
        }
    }
    let Some(first) = first_normal else {
        return true;
    };
    if matches!(
        first.as_str(),
        "data"
            | "webview"
            | "portable.flag"
            | "config.json"
            | "config.json.bak"
            | "presets.json"
            | "presets.json.bak"
            | "tags-pool.json"
    ) {
        return true;
    }
    let file_name = rel
        .file_name()
        .map(|s| s.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    file_name.ends_with(".exe.old")
        || file_name.ends_with(".tmp")
        || file_name.starts_with(".efmm_update_probe_")
        || file_name.starts_with(".efmm_new_")
        || file_name.starts_with(".efmm_sync_")
}

/// Atomically synchronizes all non-protected companion runtime files (such as helper tools,
/// DLLs, and bundled resources) from `pkg_root` into `exe_dir`, enabling multi-version jumps
/// without touching user data or portable flags.
pub fn sync_companion_update_files(
    pkg_root: &Path,
    exe_dir: &Path,
    main_exe_src: &Path,
) -> Result<usize, String> {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let main_rel = main_exe_src.strip_prefix(pkg_root).ok();
    let mut synced = 0usize;

    for (idx, entry) in WalkDir::new(pkg_root).into_iter().flatten().enumerate() {
        if !entry.file_type().is_file() {
            continue;
        }
        let src_path = entry.path();
        if src_path == main_exe_src {
            continue;
        }
        let Ok(rel) = src_path.strip_prefix(pkg_root) else {
            continue;
        };
        if let Some(m_rel) = main_rel {
            if rel == m_rel
                || rel
                    .to_string_lossy()
                    .eq_ignore_ascii_case(&m_rel.to_string_lossy())
            {
                continue;
            }
        }
        if is_protected_update_relative_path(rel) {
            continue;
        }

        let dest = exe_dir.join(rel);
        let Some(dest_parent) = dest.parent() else {
            continue;
        };
        fs::create_dir_all(dest_parent)
            .map_err(|e| format!("创建附属运行目录失败（{}）：{e}", dest_parent.display()))?;

        let tmp_path = dest_parent.join(format!(".efmm_sync_{ts}_{idx}.tmp"));
        if let Err(err) = fs::copy(src_path, &tmp_path) {
            let _ = fs::remove_file(&tmp_path);
            return Err(format!("写入更新文件失败（{}）：{err}", dest.display()));
        }

        if dest.exists() {
            let bak_path = dest_parent.join(format!(".efmm_sync_bak_{ts}_{idx}.tmp"));
            if let Err(err) = fs::rename(&dest, &bak_path) {
                let _ = fs::remove_file(&tmp_path);
                return Err(format!("备份旧附属文件失败（{}）：{err}", dest.display()));
            }
            if let Err(err) = fs::rename(&tmp_path, &dest) {
                let _ = fs::rename(&bak_path, &dest);
                let _ = fs::remove_file(&tmp_path);
                return Err(format!("替换附属文件失败（{}）：{err}", dest.display()));
            }
            let _ = fs::remove_file(&bak_path);
        } else if let Err(err) = fs::rename(&tmp_path, &dest) {
            let _ = fs::remove_file(&tmp_path);
            return Err(format!("部署新附属文件失败（{}）：{err}", dest.display()));
        }
        synced += 1;
    }

    Ok(synced)
}

fn emit_progress(app: &AppHandle, stage: &str, downloaded: u64, total: u64, message: &str) {
    let percent = if total > 0 {
        ((downloaded as f64 / total as f64) * 100.0).min(100.0)
    } else if matches!(stage, "verifying" | "extracting" | "applying" | "restarting") {
        100.0
    } else {
        0.0
    };
    let _ = app.emit(
        "update-progress",
        UpdateProgressEvent {
            stage: stage.to_string(),
            downloaded_bytes: downloaded,
            total_bytes: total,
            percent,
            message: message.to_string(),
        },
    );
}

pub fn download_and_apply_update(
    app: &AppHandle,
    cfg: &AppConfig,
    download_url: &str,
    expected_sha256: Option<&str>,
) -> Result<(), String> {
    let url = download_url.trim();
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("更新下载地址必须使用 http:// 或 https:// 协议".to_string());
    }

    let current_exe =
        std::env::current_exe().map_err(|e| format!("无法获取当前程序路径：{e}"))?;
    let exe_dir = current_exe
        .parent()
        .ok_or_else(|| "无法确定程序所在目录".to_string())?;

    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);

    // Check write permission before spending bandwidth downloading.
    let probe = exe_dir.join(format!(".efmm_update_probe_{ts}"));
    File::create(&probe).map_err(|e| {
        format!(
            "当前程序目录无写入权限（{}），无法热更新，请尝试以管理员身份运行或改用安装包：{e}",
            exe_dir.display()
        )
    })?;
    let _ = fs::remove_file(&probe);

    let token = cfg.update_github_token.trim();
    let is_api_asset = url.starts_with("https://api.github.com/");
    let client = Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| format!("初始化下载客户端失败：{e}"))?;

    emit_progress(app, "downloading", 0, 0, "正在连接下载更新包...");

    let mut req = client
        .get(url)
        .header(USER_AGENT, format!("EndfieldModManager/{CURRENT_VERSION}"));
    if is_api_asset {
        req = req.header(ACCEPT, "application/octet-stream");
        if !token.is_empty() {
            req = req.header(AUTHORIZATION, format!("Bearer {token}"));
        }
    }

    let mut resp = req.send().map_err(|e| format!("下载更新包失败：{e}"))?;
    if !resp.status().is_success() {
        return Err(format!("下载更新包返回 HTTP {}", resp.status()));
    }
    let total_bytes = resp.content_length().unwrap_or(0);

    let temp_work = std::env::temp_dir().join(format!("efmm_update_{ts}"));
    fs::create_dir_all(&temp_work).map_err(|e| format!("创建临时更新目录失败：{e}"))?;
    let zip_path = temp_work.join("update.zip");
    let extract_dir = temp_work.join("extracted");

    let mut out_file = File::create(&zip_path).map_err(|e| format!("创建临时安装包失败：{e}"))?;
    let mut downloaded = 0u64;
    let mut last_emit_bytes = 0u64;
    let mut buf = [0u8; 65536];
    loop {
        let n = resp
            .read(&mut buf)
            .map_err(|e| format!("读取更新包网络流失败：{e}"))?;
        if n == 0 {
            break;
        }
        out_file
            .write_all(&buf[..n])
            .map_err(|e| format!("写入更新包临时文件失败：{e}"))?;
        downloaded += n as u64;
        if downloaded - last_emit_bytes >= 131072 {
            last_emit_bytes = downloaded;
            emit_progress(
                app,
                "downloading",
                downloaded,
                total_bytes,
                "正在下载更新包...",
            );
        }
    }
    out_file
        .flush()
        .map_err(|e| format!("刷新更新包写入缓冲失败：{e}"))?;
    drop(out_file);
    emit_progress(app, "downloading", downloaded, total_bytes.max(downloaded), "下载完成");

    if let Some(expected) = expected_sha256.map(str::trim).filter(|s| !s.is_empty()) {
        emit_progress(app, "verifying", downloaded, total_bytes.max(downloaded), "正在校验 SHA-256 完整性...");
        verify_file_sha256(&zip_path, expected)?;
    }

    emit_progress(app, "extracting", downloaded, total_bytes.max(downloaded), "正在解压更新包...");
    extract_zip_safe(&zip_path, &extract_dir)?;

    let new_exe_src = find_extracted_exe(&extract_dir)
        .ok_or_else(|| "更新包中未找到有效的主程序 EXE".to_string())?;
    validate_pe_executable(&new_exe_src)?;

    emit_progress(app, "applying", downloaded, total_bytes.max(downloaded), "正在安全替换主程序...");
    let old_exe = current_exe.with_extension("exe.old");
    if old_exe.exists() {
        let _ = fs::remove_file(&old_exe);
    }

    let staged_exe = exe_dir.join(format!(".efmm_new_{ts}.exe.tmp"));
    fs::copy(&new_exe_src, &staged_exe).map_err(|e| format!("写入新版本程序失败：{e}"))?;

    if let Err(err) = fs::rename(&current_exe, &old_exe) {
        let _ = fs::remove_file(&staged_exe);
        return Err(format!("无法备份当前运行中的程序：{err}"));
    }
    if let Err(err) = fs::rename(&staged_exe, &current_exe) {
        let _ = fs::rename(&old_exe, &current_exe);
        let _ = fs::remove_file(&staged_exe);
        return Err(format!("替换新版本主程序失败，已自动回滚：{err}"));
    }

    let pkg_root = new_exe_src.parent().unwrap_or(&extract_dir);
    if let Err(err) = sync_companion_update_files(pkg_root, exe_dir, &new_exe_src) {
        let _ = fs::remove_file(&current_exe);
        let _ = fs::rename(&old_exe, &current_exe);
        let _ = fs::remove_dir_all(&temp_work);
        return Err(format!("{err}，已自动回滚主程序"));
    }

    let _ = fs::remove_dir_all(&temp_work);

    emit_progress(app, "restarting", 100, 100, "更新完成，正在重启新版本...");
    Command::new(&current_exe)
        .current_dir(exe_dir)
        .spawn()
        .map_err(|e| format!("新版本已就位，但自动拉起失败（{e}），请手动重新打开软件"))?;

    let state = app.state::<AppState>();
    state.is_quitting.store(true, AtomicOrdering::SeqCst);
    let _ = overlay::hide_overlay(app);
    app.exit(0);
    Ok(())
}

#[cfg(windows)]
pub fn open_external_url(url: &str) -> Result<(), String> {
    use windows::core::HSTRING;
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let clean = url.trim();
    if !(clean.starts_with("https://") || clean.starts_with("http://")) {
        return Err("仅支持打开 http:// 或 https:// 链接".to_string());
    }
    let verb = HSTRING::from("open");
    let target = HSTRING::from(clean);
    let hinst = unsafe { ShellExecuteW(None, &verb, &target, None, None, SW_SHOWNORMAL) };
    if (hinst.0 as usize) <= 32 {
        return Err("打开浏览器链接失败".to_string());
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn open_external_url(_url: &str) -> Result<(), String> {
    Err("仅支持 Windows 打开外部链接".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_semver_comparison() {
        assert!(!is_newer_version("0.1.0", "0.1.0"));
        assert!(!is_newer_version("0.1.0", "v0.1.0"));
        assert!(is_newer_version("0.1.0", "0.1.1"));
        assert!(is_newer_version("0.1.0", "v0.2.0"));
        assert!(is_newer_version("0.1.0", "1.0.0"));
        assert!(!is_newer_version("0.2.0", "0.1.9"));
        assert!(!is_newer_version("0.1.0", "0.1.0-beta.1"));
        assert!(is_newer_version("0.1.0-beta.1", "0.1.0-beta.2"));
        assert!(is_newer_version("0.1.0-beta.2", "0.1.0"));
    }

    #[test]
    fn test_parse_latest_manifest_and_api_fallback() {
        let manifest = r#"{
            "version": "9.9.0",
            "pubDate": "2026-11-23T00:00:00Z",
            "notes": "修复若干问题",
            "releaseUrl": "https://github.com/carrotluo5/EndfieldModManager/releases/tag/v9.9.0",
            "updatePackage": {
                "fileName": "EndfieldModManager-v9.9.0-windows-x64-update.zip",
                "size": 1234567,
                "sha256": "ABCDEF0123",
                "url": "https://github.com/carrotluo5/EndfieldModManager/releases/download/v9.9.0/EndfieldModManager-v9.9.0-windows-x64-update.zip"
            }
        }"#;
        let parsed = parse_latest_manifest_json(
            manifest,
            "carrotluo5/EndfieldModManager",
            "https://ghproxy.example.com/",
        )
        .unwrap();
        assert!(parsed.has_update);
        assert_eq!(parsed.latest_version, "9.9.0");
        assert_eq!(parsed.sha256, "abcdef0123");
        assert_eq!(
            parsed.download_url,
            "https://ghproxy.example.com/https://github.com/carrotluo5/EndfieldModManager/releases/download/v9.9.0/EndfieldModManager-v9.9.0-windows-x64-update.zip"
        );

        let api_json = r#"{
            "tag_name": "v9.9.1",
            "published_at": "2026-11-24T00:00:00Z",
            "body": "API Fallback Release",
            "html_url": "https://github.com/carrotluo5/EndfieldModManager/releases/tag/v9.9.1",
            "assets": [
                {
                    "name": "EndfieldModManager-v9.9.1-windows-x64-portable.zip",
                    "size": 999,
                    "url": "https://api.github.com/repos/carrotluo5/EndfieldModManager/releases/assets/1",
                    "browser_download_url": "https://github.com/carrotluo5/EndfieldModManager/releases/download/v9.9.1/portable.zip"
                },
                {
                    "name": "EndfieldModManager-v9.9.1-windows-x64-update.zip",
                    "size": 888,
                    "digest": "sha256:001122",
                    "url": "https://api.github.com/repos/carrotluo5/EndfieldModManager/releases/assets/2",
                    "browser_download_url": "https://github.com/carrotluo5/EndfieldModManager/releases/download/v9.9.1/update.zip"
                }
            ]
        }"#;
        let api_pub = parse_github_release_api_json(
            api_json,
            "carrotluo5/EndfieldModManager",
            "",
            false,
        )
        .unwrap();
        assert!(api_pub.has_update);
        assert_eq!(api_pub.latest_version, "9.9.1");
        assert_eq!(api_pub.file_name, "EndfieldModManager-v9.9.1-windows-x64-update.zip");
        assert_eq!(api_pub.sha256, "001122");
        assert_eq!(
            api_pub.download_url,
            "https://github.com/carrotluo5/EndfieldModManager/releases/download/v9.9.1/update.zip"
        );

        let api_priv = parse_github_release_api_json(
            api_json,
            "carrotluo5/EndfieldModManager",
            "https://ghproxy.example.com",
            true,
        )
        .unwrap();
        assert_eq!(
            api_priv.download_url,
            "https://api.github.com/repos/carrotluo5/EndfieldModManager/releases/assets/2"
        );
    }

    #[test]
    fn test_mirror_url_and_sha256_pe_validation() {
        assert_eq!(
            apply_mirror_url("https://github.com/a/b/releases/download/v1/x.zip", "https://m.com"),
            "https://m.com/https://github.com/a/b/releases/download/v1/x.zip"
        );
        assert_eq!(
            apply_mirror_url("https://api.github.com/repos/a/b", "https://m.com"),
            "https://api.github.com/repos/a/b"
        );

        let dir = std::env::temp_dir().join(format!(
            "efmm_updater_test_{}",
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("fake.exe");
        let mut payload = vec![b'M', b'Z'];
        payload.resize(70000, 0x90);
        fs::write(&file, &payload).unwrap();

        let digest = verify_file_sha256(&file, "").unwrap();
        assert_eq!(verify_file_sha256(&file, &digest).unwrap(), digest);
        assert!(verify_file_sha256(&file, "deadbeef").is_err());
        assert!(validate_pe_executable(&file).is_ok());

        let invalid = dir.join("bad.exe");
        fs::write(&invalid, vec![0u8; 70000]).unwrap();
        assert!(validate_pe_executable(&invalid).is_err());

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn test_multi_version_jump_and_min_client_guard() {
        let jump_ok = r#"{
            "schemaVersion": 2,
            "version": "1.3.0",
            "minSupportedClientVersion": "0.1.0",
            "futureMetadata": { "channel": "stable", "flags": [1, 2, 3] },
            "updatePackage": {
                "fileName": "EndfieldModManager-v1.3.0-windows-x64-update.zip",
                "size": 5242880,
                "sha256": "11223344",
                "url": "https://github.com/carrotluo5/EndfieldModManager/releases/download/v1.3.0/EndfieldModManager-v1.3.0-windows-x64-update.zip"
            }
        }"#;
        let parsed = parse_latest_manifest_json(jump_ok, "carrotluo5/EndfieldModManager", "").unwrap();
        assert!(parsed.has_update);
        assert!(parsed.can_auto_update);
        assert_eq!(parsed.latest_version, "1.3.0");
        assert_eq!(parsed.min_supported_client_version, "0.1.0");

        let blocked_jump = r#"{
            "schemaVersion": 3,
            "version": "2.0.0",
            "minSupportedClientVersion": "v0.2.0",
            "updatePackage": {
                "fileName": "EndfieldModManager-v2.0.0-windows-x64-update.zip",
                "size": 6000000,
                "sha256": "55667788",
                "url": "https://github.com/carrotluo5/EndfieldModManager/releases/download/v2.0.0/EndfieldModManager-v2.0.0-windows-x64-update.zip"
            }
        }"#;
        let blocked = parse_latest_manifest_json(blocked_jump, "carrotluo5/EndfieldModManager", "").unwrap();
        assert!(blocked.has_update);
        assert!(!blocked.can_auto_update);
        assert_eq!(blocked.min_supported_client_version, "0.2.0");
    }

    #[test]
    fn test_sync_companion_update_files_preserves_user_data() {
        let root = std::env::temp_dir().join(format!(
            "efmm_sync_test_{}",
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        let pkg_root = root.join("pkg");
        let exe_dir = root.join("app");
        fs::create_dir_all(pkg_root.join("bin")).unwrap();
        fs::create_dir_all(pkg_root.join("resources")).unwrap();
        fs::create_dir_all(pkg_root.join("data")).unwrap();
        fs::create_dir_all(pkg_root.join("webview")).unwrap();
        fs::create_dir_all(exe_dir.join("bin")).unwrap();
        fs::create_dir_all(exe_dir.join("data")).unwrap();

        let main_exe = pkg_root.join("EndfieldModManager.exe");
        fs::write(&main_exe, b"new-exe").unwrap();
        fs::write(pkg_root.join("bin").join("7za.exe"), b"new-7za").unwrap();
        fs::write(pkg_root.join("bin").join("new_helper.exe"), b"helper").unwrap();
        fs::write(pkg_root.join("resources").join("extra.dat"), b"extra-dat").unwrap();
        fs::write(pkg_root.join("extra.dll"), b"dll-bytes").unwrap();
        fs::write(pkg_root.join("portable.flag"), b"pkg-flag").unwrap();
        fs::write(pkg_root.join("data").join("config.json"), b"pkg-data").unwrap();
        fs::write(pkg_root.join("webview").join("state"), b"pkg-wv").unwrap();
        fs::write(pkg_root.join("config.json"), b"pkg-cfg").unwrap();

        fs::write(exe_dir.join("bin").join("7za.exe"), b"old-7za").unwrap();
        fs::write(exe_dir.join("portable.flag"), b"user-flag").unwrap();
        fs::write(exe_dir.join("data").join("config.json"), b"user-data").unwrap();
        fs::write(exe_dir.join("config.json"), b"user-cfg").unwrap();

        let synced = sync_companion_update_files(&pkg_root, &exe_dir, &main_exe).unwrap();
        assert_eq!(synced, 4);
        assert_eq!(fs::read(exe_dir.join("bin").join("7za.exe")).unwrap(), b"new-7za");
        assert_eq!(fs::read(exe_dir.join("bin").join("new_helper.exe")).unwrap(), b"helper");
        assert_eq!(fs::read(exe_dir.join("resources").join("extra.dat")).unwrap(), b"extra-dat");
        assert_eq!(fs::read(exe_dir.join("extra.dll")).unwrap(), b"dll-bytes");
        assert!(!exe_dir.join("EndfieldModManager.exe").exists());
        assert_eq!(fs::read(exe_dir.join("portable.flag")).unwrap(), b"user-flag");
        assert_eq!(fs::read(exe_dir.join("data").join("config.json")).unwrap(), b"user-data");
        assert_eq!(fs::read(exe_dir.join("config.json")).unwrap(), b"user-cfg");
        assert!(!exe_dir.join("webview").join("state").exists());

        let _ = fs::remove_dir_all(root);
    }
}
