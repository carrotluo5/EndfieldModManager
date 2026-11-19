use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::thread;
use std::time::{Duration, UNIX_EPOCH};
use tauri::http::{Request, Response, StatusCode};

const RETRY_DELAYS_MS: [u64; 8] = [120, 220, 350, 500, 800, 1200, 1600, 2200];

pub fn assert_safe_segment(name: &str, label: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(format!("{label}不能为空"));
    }
    if trimmed == "." || trimmed == ".." {
        return Err(format!("{label}不能为 . 或 .."));
    }
    if trimmed.ends_with('.') || trimmed.ends_with(' ') {
        return Err(format!("{label}末尾不能包含空格或英文句点"));
    }
    const FORBIDDEN: [char; 9] = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
    if trimmed.chars().any(|c| c.is_control() || FORBIDDEN.contains(&c)) {
        return Err(format!(
            "{label}包含 Windows 不允许的字符（如 / \\ : * ? \" < > |，斜杠请使用全角 ／）"
        ));
    }
    Ok(trimmed.to_string())
}

fn is_retryable_rename_err(err: &std::io::Error) -> bool {
    if err.kind() == std::io::ErrorKind::PermissionDenied {
        return true;
    }
    matches!(err.raw_os_error(), Some(5 | 32 | 33 | 145))
}

pub fn rename_dir_with_retry(src: &Path, dst: &Path) -> Result<(), String> {
    if src == dst {
        return Ok(());
    }
    if !src.exists() && dst.exists() {
        return Ok(());
    }
    if !src.exists() {
        return Err(format!("源目录不存在：{}", src.display()));
    }
    if dst.exists() {
        return Err(format!("目标目录已存在：{}", dst.display()));
    }

    let mut last_err: Option<std::io::Error> = None;
    for attempt in 0..=RETRY_DELAYS_MS.len() {
        match fs::rename(src, dst) {
            Ok(()) => return Ok(()),
            Err(err) => {
                if !src.exists() && dst.exists() {
                    return Ok(());
                }
                if !is_retryable_rename_err(&err) {
                    return Err(format!("重命名目录失败：{}", err));
                }
                last_err = Some(err);
                if attempt < RETRY_DELAYS_MS.len() {
                    thread::sleep(Duration::from_millis(RETRY_DELAYS_MS[attempt]));
                }
            }
        }
    }

    let msg = last_err
        .map(|e| e.to_string())
        .unwrap_or_else(|| "未知占用错误".to_string());
    Err(format!(
        "文件夹可能正被资源管理器、缩略图预览或游戏占用，自动重试 8 次后仍失败，请关闭相关窗口后重试。原始错误：{msg}"
    ))
}

pub fn trash_path(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("路径不存在：{}", path.display()));
    }
    trash::delete(path).map_err(|e| format!("移入 Windows 回收站失败：{e}"))
}

pub fn open_in_explorer(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("路径不存在：{}", path.display()));
    }
    Command::new("explorer.exe")
        .arg(path)
        .spawn()
        .map_err(|e| format!("打开资源管理器失败：{e}"))?;
    Ok(())
}

pub fn file_mtime_ms(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn find_image_in_dir(dir: &Path, stem: &str) -> Option<(PathBuf, u64)> {
    const EXTS: [&str; 5] = ["png", "jpg", "jpeg", "webp", "gif"];
    for ext in EXTS {
        let candidate = dir.join(format!("{stem}.{ext}"));
        if candidate.is_file() {
            let mtime = file_mtime_ms(&candidate);
            return Some((candidate, mtime));
        }
    }
    None
}

pub fn remove_stale_images_except(dir: &Path, stem: &str, keep_ext: &str) {
    const EXTS: [&str; 6] = ["png", "jpg", "jpeg", "webp", "gif", "bmp"];
    for ext in EXTS {
        if ext.eq_ignore_ascii_case(keep_ext) {
            continue;
        }
        let candidate = dir.join(format!("{stem}.{ext}"));
        if candidate.is_file() {
            let _ = fs::remove_file(candidate);
        }
    }
}

pub fn handle_media_protocol(request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let uri_str = request.uri().to_string();
    let query = uri_str.split_once('?').map(|(_, q)| q).unwrap_or("");
    let mut raw_path = None;
    for pair in query.split('&') {
        if let Some((k, v)) = pair.split_once('=') {
            if k == "path" {
                raw_path = urlencoding::decode(v).ok().map(|cow| cow.into_owned());
                break;
            }
        }
    }

    let Some(path_str) = raw_path else {
        return Response::builder()
            .status(StatusCode::BAD_REQUEST)
            .header("Access-Control-Allow-Origin", "*")
            .body(Vec::new())
            .unwrap();
    };

    let path = PathBuf::from(&path_str);
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();

    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        _ => {
            return Response::builder()
                .status(StatusCode::FORBIDDEN)
                .header("Access-Control-Allow-Origin", "*")
                .body(Vec::new())
                .unwrap();
        }
    };

    match fs::read(&path) {
        Ok(bytes) => Response::builder()
            .status(StatusCode::OK)
            .header("Content-Type", mime)
            .header("Cache-Control", "no-store, max-age=0")
            .header("Access-Control-Allow-Origin", "*")
            .body(bytes)
            .unwrap(),
        Err(_) => Response::builder()
            .status(StatusCode::NOT_FOUND)
            .header("Access-Control-Allow-Origin", "*")
            .body(Vec::new())
            .unwrap(),
    }
}
