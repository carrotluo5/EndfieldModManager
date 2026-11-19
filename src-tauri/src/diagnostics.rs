use crate::characters::now_iso_utc;
use crate::importer::{copy_dir_contents, extract_archive_to_dir};
use crate::ini_engine::{collect_ini_files, detect_conflicts_for_mods, get_rabbitfx_status, scan_mod_flags};
use crate::launcher::check_xxmi_consistency;
use crate::models::{AppConfig, DiagnosticCheckItem, DiagnosticsReport, PackageUpdateResult};
use crate::organizer::scan_mods_health_and_organize;
use crate::persist_bridge;
use crate::win_input::get_game_runtime_status;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use walkdir::WalkDir;

fn make_check(
    id: &str,
    title: &str,
    status: &str,
    summary: String,
    detail: String,
    fixable: bool,
    action_hint: &str,
) -> DiagnosticCheckItem {
    DiagnosticCheckItem {
        id: id.to_string(),
        title: title.to_string(),
        status: status.to_string(),
        summary,
        detail,
        fixable,
        action_hint: action_hint.to_string(),
    }
}

fn check_d3dx_ini(efmi_root: &Path, persist_enabled: bool) -> (String, String, String, bool) {
    let d3dx = efmi_root.join("d3dx.ini");
    if !d3dx.is_file() {
        return (
            "error".to_string(),
            "未找到 EFMI/d3dx.ini".to_string(),
            format!("请检查 Mods 上级目录是否为完整的 EFMI 游戏包目录：{}", efmi_root.display()),
            false,
        );
    }
    let Ok(raw) = fs::read_to_string(&d3dx) else {
        return (
            "error".to_string(),
            "读取 d3dx.ini 失败".to_string(),
            d3dx.to_string_lossy().to_string(),
            false,
        );
    };
    let lower = raw.to_ascii_lowercase();
    let has_mods = lower.contains("include_recursive = mods") || lower.contains("include_recursive=mods");
    let has_excl = lower.contains("exclude_recursive = disabled") || lower.contains("exclude_recursive=disabled");
    let has_qaqm = persist_bridge::is_d3dx_mounted(efmi_root);

    if !has_mods || !has_excl {
        return (
            "error".to_string(),
            "d3dx.ini [Include] 缺少标准 Mods 或 DISABLED* 挂载规则".to_string(),
            "标准 EFMI 需要 include_recursive = Mods 与 exclude_recursive = DISABLED* 才能控制启停。".to_string(),
            true,
        );
    }
    if persist_enabled && !has_qaqm {
        return (
            "warn".to_string(),
            "Persist Bridge 已开启但 d3dx.ini 尚未挂载 qaqm_includer.ini".to_string(),
            "点击一键修复即可自动写入 include = qaqm\\qaqm_includer.ini。".to_string(),
            true,
        );
    }
    (
        "ok".to_string(),
        "d3dx.ini 挂载配置正常".to_string(),
        if has_qaqm {
            "Mods 递归加载、DISABLED* 屏蔽及 qaqm_includer.ini 均已就位。".to_string()
        } else {
            "Mods 递归加载与 DISABLED* 屏蔽规则完整有效。".to_string()
        },
        false,
    )
}

pub fn run_offline_diagnostics(cfg: &AppConfig) -> DiagnosticsReport {
    let mut checks = Vec::new();
    let mods_root = Path::new(&cfg.mods_path);
    let has_mods_root = !cfg.mods_path.trim().is_empty() && mods_root.is_dir();

    // 1. XXMI consistency
    let consistency = check_xxmi_consistency(cfg);
    checks.push(make_check(
        "xxmi_consistency",
        "1. XXMI / EFMI 路径对齐",
        if consistency.consistent {
            "ok"
        } else if consistency.xxmi_config_found {
            "error"
        } else {
            "warn"
        },
        consistency.message,
        format!(
            "Mods 父目录：{} | XXMI 配置 EFMI：{}",
            consistency.mods_parent_path,
            if consistency.xxmi_efmi_path.is_empty() {
                "未读取".to_string()
            } else {
                consistency.xxmi_efmi_path
            }
        ),
        false,
        if consistency.consistent { "" } else { "settings" },
    ));

    // 2. d3dx.ini include check
    if has_mods_root {
        if let Some(efmi_root) = mods_root.parent() {
            let (st, sum, det, fixable) = check_d3dx_ini(efmi_root, cfg.persist_bridge_enabled);
            checks.push(make_check(
                "d3dx_include",
                "2. d3dx.ini [Include] 挂载规则",
                &st,
                sum,
                det,
                fixable,
                if fixable { "fix" } else { "" },
            ));
        }
    } else {
        checks.push(make_check(
            "d3dx_include",
            "2. d3dx.ini [Include] 挂载规则",
            "error",
            "Mods 路径无效，无法定位 d3dx.ini".to_string(),
            String::new(),
            false,
            "settings",
        ));
    }

    // Scan enabled mods once for checks 3, 4, 5
    let mut enabled_ini_pairs: Vec<(String, Vec<PathBuf>)> = Vec::new();
    let mut eff_mods: Vec<String> = Vec::new();
    let mut any_requires_rfx = false;

    if has_mods_root {
        for c_entry in fs::read_dir(mods_root).into_iter().flatten().flatten() {
            if !c_entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            let cname = c_entry.file_name().to_string_lossy().to_string();
            if cname.starts_with('.') {
                continue;
            }
            for m_entry in fs::read_dir(c_entry.path()).into_iter().flatten().flatten() {
                if !m_entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    continue;
                }
                let dname = m_entry.file_name().to_string_lossy().to_string();
                if dname.starts_with('.') {
                    continue;
                }
                let enabled = !dname.to_ascii_uppercase().starts_with("DISABLED_");
                let clean_name = if enabled { &dname } else { &dname[9..] };
                let inis = collect_ini_files(&m_entry.path());
                let (_, req_rfx, is_eff) = scan_mod_flags(&m_entry.path(), &inis);
                if is_eff {
                    eff_mods.push(format!("{cname}/{clean_name}"));
                }
                if enabled {
                    if req_rfx {
                        any_requires_rfx = true;
                    }
                    enabled_ini_pairs.push((format!("{cname}/{clean_name}"), inis));
                }
            }
        }
    }

    // 3. RabbitFX singleton check
    let rfx = get_rabbitfx_status(mods_root);
    if rfx.enabled_count > 1 {
        let list = rfx
            .enabled_mods
            .iter()
            .map(|m| format!("{}/{}", m.character_name, m.mod_name))
            .collect::<Vec<_>>()
            .join("、");
        checks.push(make_check(
            "rabbitfx_singleton",
            "3. RabbitFX 单实例防崩溃检测",
            "error",
            format!("检测到 {} 个 RabbitFX 同时启用（会导致游戏启动崩溃）", rfx.enabled_count),
            format!("当前启用的实例：{list}"),
            false,
            "rabbitfx",
        ));
    } else if rfx.enabled_count == 0 && any_requires_rfx {
        checks.push(make_check(
            "rabbitfx_singleton",
            "3. RabbitFX 单实例防崩溃检测",
            "warn",
            "已启用的 Mod 依赖 RabbitFX，但目前未启用任何 RabbitFX".to_string(),
            "建议在「功能」分类下启用 1 份最新版本 RabbitFX。".to_string(),
            false,
            "rabbitfx",
        ));
    } else {
        checks.push(make_check(
            "rabbitfx_singleton",
            "3. RabbitFX 单实例防崩溃检测",
            "ok",
            if rfx.enabled_count == 1 {
                "RabbitFX 单实例状态正常".to_string()
            } else {
                "RabbitFX 未多开冲突".to_string()
            },
            String::new(),
            false,
            "",
        ));
    }

    // 4. Hash conflicts
    let conflicts = detect_conflicts_for_mods(&enabled_ini_pairs);
    if !conflicts.is_empty() {
        let preview = conflicts
            .iter()
            .take(3)
            .map(|c| format!("Hash {}：{}", c.hash, c.mods.join(" vs ")))
            .collect::<Vec<_>>()
            .join("；");
        checks.push(make_check(
            "hash_conflicts",
            "4. 已启用 Mod 资源 Hash 冲突",
            "warn",
            format!("检测到 {} 组共享同一模型/贴图 Hash 的已启用 Mod", conflicts.len()),
            preview,
            false,
            "",
        ));
    } else {
        checks.push(make_check(
            "hash_conflicts",
            "4. 已启用 Mod 资源 Hash 冲突",
            "ok",
            "当前已启用的 Mod 之间无 Hash 冲突".to_string(),
            String::new(),
            false,
            "",
        ));
    }

    // 5. EFF framework check
    if !eff_mods.is_empty() {
        checks.push(make_check(
            "eff_misplaced",
            "5. EFF 框架格式误放检测",
            "warn",
            format!("发现 {} 个 EFF 格式 Mod 被放入了 EFMI\\Mods", eff_mods.len()),
            format!("受影响目录：{}（包含 compiled.bin 或 EFF format 2 声明，应安装至 EFF 加载器目录）", eff_mods.join("、")),
            false,
            "",
        ));
    } else {
        checks.push(make_check(
            "eff_misplaced",
            "5. EFF 框架格式误放检测",
            "ok",
            "未发现误入 Mods 目录的 EFF 框架文件".to_string(),
            String::new(),
            false,
            "",
        ));
    }

    // 6. Dirty / loose files check
    match scan_mods_health_and_organize(cfg) {
        Ok(org) if !org.dirty_items.is_empty() || !org.misplaced_mods.is_empty() => {
            checks.push(make_check(
                "dirty_root_files",
                "6. 根目录脏文件与错放 Mod 检查",
                "warn",
                format!(
                    "发现 {} 个散落脏文件/资源目录、{} 个疑似错放 Mod",
                    org.dirty_items.len(),
                    org.misplaced_mods.len()
                ),
                "可使用首页「整理 / 体检」一键审查并安全隔离或归位。".to_string(),
                false,
                "organize",
            ));
        }
        Ok(_) => {
            checks.push(make_check(
                "dirty_root_files",
                "6. 根目录脏文件与错放 Mod 检查",
                "ok",
                "Mods 目录结构整洁，无散落资源或错放项".to_string(),
                String::new(),
                false,
                "",
            ));
        }
        Err(_) => {
            checks.push(make_check(
                "dirty_root_files",
                "6. 根目录脏文件与错放 Mod 检查",
                "error",
                "Mods 目录未配置，无法体检".to_string(),
                String::new(),
                false,
                "settings",
            ));
        }
    }

    // 7. UIPI privilege check
    let rt = get_game_runtime_status();
    checks.push(make_check(
        "uipi_privilege",
        "7. 游戏进程与 UAC 权限匹配（UIPI）",
        if rt.uipi_blocked { "error" } else { "ok" },
        rt.message,
        if rt.uipi_blocked {
            "游戏以管理员权限启动时，普通权限的管理器无法向游戏发送 F10 或快捷键。".to_string()
        } else {
            String::new()
        },
        false,
        if rt.uipi_blocked { "admin" } else { "" },
    ));

    // 8. Persist Bridge & Keypress check
    if has_mods_root {
        let pb_status = persist_bridge::get_status(cfg);
        let efmi_root = mods_root.parent().unwrap_or(mods_root);
        let keypress_ini = efmi_root.join("qaqm").join("qaqm_keypress.ini");
        let keypress_ok = fs::read_to_string(&keypress_ini)
            .map(|s| s.to_ascii_lowercase().contains("check_foreground_window = 0"))
            .unwrap_or(false);

        if !keypress_ok {
            checks.push(make_check(
                "persist_bridge_health",
                "8. 后台热键与 Persist Bridge 健康状态",
                "warn",
                "qaqm_keypress.ini 尚未配置后台按键允许规则".to_string(),
                "点击一键修复可写入 check_foreground_window = 0，保障浮窗发送 F10 稳定生效。".to_string(),
                true,
                "fix",
            ));
        } else if !cfg.persist_bridge_enabled && pb_status.backup_file_count > 0 {
            checks.push(make_check(
                "persist_bridge_health",
                "8. 后台热键与 Persist Bridge 健康状态",
                "warn",
                format!(
                    "Persist Bridge 已关闭，但仍残留 {} 份 .qaqm-persistbak 备份",
                    pb_status.backup_file_count
                ),
                "点击一键修复可安全还原残留备份并清理状态文件。".to_string(),
                true,
                "fix",
            ));
        } else {
            checks.push(make_check(
                "persist_bridge_health",
                "8. 后台热键与 Persist Bridge 健康状态",
                "ok",
                format!(
                    "后台热键已就绪（Persist Bridge：{}，缓存 {} 份）",
                    if cfg.persist_bridge_enabled { "开启" } else { "关闭" },
                    pb_status.cache_file_count
                ),
                String::new(),
                false,
                "",
            ));
        }
    } else {
        checks.push(make_check(
            "persist_bridge_health",
            "8. 后台热键与 Persist Bridge 健康状态",
            "warn",
            "未配置 Mods 路径".to_string(),
            String::new(),
            false,
            "",
        ));
    }

    let ok_count = checks.iter().filter(|c| c.status == "ok").count();
    let warn_count = checks.iter().filter(|c| c.status == "warn").count();
    let error_count = checks.iter().filter(|c| c.status == "error").count();

    DiagnosticsReport {
        checked_at: now_iso_utc(),
        ok_count,
        warn_count,
        error_count,
        checks,
    }
}

pub fn fix_diagnostic_item(cfg: &mut AppConfig, check_id: &str) -> Result<String, String> {
    let mods_root = Path::new(&cfg.mods_path);
    if cfg.mods_path.trim().is_empty() || !mods_root.is_dir() {
        return Err("Mods 目录未配置或不存在".to_string());
    }
    let efmi_root = mods_root
        .parent()
        .ok_or_else(|| "无法定位 EFMI 目录".to_string())?;

    match check_id {
        "d3dx_include" => {
            let d3dx = efmi_root.join("d3dx.ini");
            if !d3dx.is_file() {
                return Err("找不到 d3dx.ini".to_string());
            }
            let bytes = fs::read(&d3dx).map_err(|e| format!("读取 d3dx.ini 失败：{e}"))?;
            let raw = String::from_utf8_lossy(&bytes).into_owned();
            let eol = if raw.contains("\r\n") { "\r\n" } else { "\n" };
            let mut lines: Vec<String> = raw
                .split('\n')
                .map(|l| l.strip_suffix('\r').unwrap_or(l).to_string())
                .collect();
            let lower = raw.to_ascii_lowercase();
            let need_mods = !lower.contains("include_recursive = mods")
                && !lower.contains("include_recursive=mods");
            let need_excl = !lower.contains("exclude_recursive = disabled")
                && !lower.contains("exclude_recursive=disabled");

            if let Some(inc_pos) = lines.iter().position(|l| l.trim().eq_ignore_ascii_case("[Include]"))
            {
                let mut insert_at = inc_pos + 1;
                if need_mods {
                    lines.insert(insert_at, "include_recursive = Mods".to_string());
                    insert_at += 1;
                }
                if need_excl {
                    lines.insert(insert_at, "exclude_recursive = DISABLED*".to_string());
                }
            } else {
                lines.push("[Include]".to_string());
                if need_mods {
                    lines.push("include_recursive = Mods".to_string());
                }
                if need_excl {
                    lines.push("exclude_recursive = DISABLED*".to_string());
                }
            }
            fs::write(&d3dx, lines.join(eol).as_bytes())
                .map_err(|e| format!("写回 d3dx.ini 失败：{e}"))?;
            if cfg.persist_bridge_enabled {
                let _ = persist_bridge::ensure_d3dx_include(efmi_root);
            }
            Ok("已补全 d3dx.ini [Include] 挂载与屏蔽规则".to_string())
        }
        "persist_bridge_health" => {
            crate::launcher::ensure_keypress_bridge(cfg);
            let _ = persist_bridge::ensure_d3dx_include(efmi_root);
            if !cfg.persist_bridge_enabled {
                let _ = persist_bridge::disable_and_restore_all(cfg)?;
                return Ok("已修复 qaqm_keypress.ini 并清理全部残留 .qaqm-persistbak 备份".to_string());
            }
            Ok("已写入后台热键允许规则 qaqm_keypress.ini".to_string())
        }
        _ => Err("该诊断项不支持自动修复".to_string()),
    }
}

fn is_protected_package_top_name(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "mods" | "qaqm" | "d3dx_user.ini" | "xxmi launcher config.json" | "backup" | "backups"
    )
}

pub fn update_xxmi_or_efmi_package(
    cfg: &AppConfig,
    target_kind: &str,
    source_path_str: &str,
    custom_dest_dir: Option<&str>,
) -> Result<PackageUpdateResult, String> {
    let src = PathBuf::from(source_path_str.trim());
    if !src.exists() {
        return Err("所选更新包或目录不存在".to_string());
    }

    let target_root = if let Some(custom) = custom_dest_dir.map(|s| s.trim()).filter(|s| !s.is_empty()) {
        let p = PathBuf::from(custom);
        fs::create_dir_all(&p).map_err(|e| format!("创建目标目录失败：{e}"))?;
        p
    } else if target_kind == "efmi" {
        let mods = Path::new(&cfg.mods_path);
        mods.parent()
            .filter(|p| p.is_dir())
            .ok_or_else(|| "请先配置有效的 EFMI Mods 路径".to_string())?
            .to_path_buf()
    } else if target_kind == "xxmi" {
        let xxmi_exe = Path::new(&cfg.xxmi_path);
        if cfg.xxmi_path.trim().is_empty() || !xxmi_exe.exists() {
            return Err("请先配置 XXMI Launcher.exe 路径或指定安装目录".to_string());
        }
        let parent = xxmi_exe.parent().ok_or_else(|| "无效 XXMI 路径".to_string())?;
        if parent.file_name().and_then(|s| s.to_str()) == Some("Bin") {
            parent
                .parent()
                .and_then(|p| p.parent())
                .unwrap_or(parent)
                .to_path_buf()
        } else {
            parent.to_path_buf()
        }
    } else {
        return Err("不支持的更新类型".to_string());
    };

    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let temp_root = std::env::temp_dir().join(format!("efmm_pkg_{nanos}"));

    let payload_root = if src.is_file() {
        let extract_dir = temp_root.join("extracted");
        let work_dir = temp_root.join("work");
        extract_archive_to_dir(&src, &extract_dir, &work_dir)?;

        // Unwrap single wrapper folder if present
        let top_dirs: Vec<PathBuf> = fs::read_dir(&extract_dir)
            .into_iter()
            .flatten()
            .flatten()
            .map(|e| e.path())
            .collect();
        if top_dirs.len() == 1 && top_dirs[0].is_dir() {
            top_dirs[0].clone()
        } else {
            extract_dir
        }
    } else {
        src.clone()
    };

    let mut skipped_protected_paths = Vec::new();
    let mut copied_files = 0usize;

    let copy_res: Result<(), String> = (|| {
        for entry in fs::read_dir(&payload_root)
            .map_err(|e| format!("读取更新包目录失败：{e}"))?
            .flatten()
        {
            let fname = entry.file_name().to_string_lossy().to_string();
            if is_protected_package_top_name(&fname) {
                skipped_protected_paths.push(fname);
                continue;
            }
            let src_item = entry.path();
            let dst_item = target_root.join(&fname);
            if src_item.is_dir() {
                copy_dir_contents(&src_item, &dst_item)?;
                copied_files += WalkDir::new(&src_item)
                    .into_iter()
                    .flatten()
                    .filter(|e| e.file_type().is_file())
                    .count();
            } else if src_item.is_file() {
                fs::copy(&src_item, &dst_item)
                    .map_err(|e| format!("更新文件失败（{fname}）：{e}"))?;
                copied_files += 1;
            }
        }
        Ok(())
    })();

    if temp_root.exists() {
        let _ = fs::remove_dir_all(&temp_root);
    }
    copy_res?;

    Ok(PackageUpdateResult {
        target_kind: target_kind.to_string(),
        copied_files,
        skipped_protected_paths,
        message: format!("已安全更新核心文件 {copied_files} 个，用户 Mods 与配置已完整保留"),
    })
}
