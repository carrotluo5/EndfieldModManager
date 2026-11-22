use crate::models::{AppConfig, AutoDetectedPaths, XxmiConsistency};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
fn detect_game_from_registry() -> Option<String> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    const SUBKEYS: [&str; 2] = [
        r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
        r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
    ];
    for hive in [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER] {
        let root = RegKey::predef(hive);
        for sub in SUBKEYS {
            let Ok(uninstall) = root.open_subkey(sub) else {
                continue;
            };
            for key_name in uninstall.enum_keys().flatten() {
                let Ok(app_key) = uninstall.open_subkey(&key_name) else {
                    continue;
                };
                let disp: String = app_key.get_value("DisplayName").unwrap_or_default();
                let low = disp.to_ascii_lowercase();
                if !low.contains("endfield") && !disp.contains("终末地") {
                    continue;
                }
                if let Ok(loc) = app_key.get_value::<String, _>("InstallLocation") {
                    let cand = PathBuf::from(loc.trim()).join("Endfield.exe");
                    if cand.is_file() {
                        return Some(cand.to_string_lossy().to_string());
                    }
                    let nested = PathBuf::from(loc.trim())
                        .join("Arknights Endfield Game")
                        .join("Endfield.exe");
                    if nested.is_file() {
                        return Some(nested.to_string_lossy().to_string());
                    }
                }
            }
        }
    }
    None
}

#[cfg(not(windows))]
fn detect_game_from_registry() -> Option<String> {
    None
}

#[cfg(windows)]
pub fn get_autostart_enabled() -> bool {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let Ok(run_key) = hkcu.open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Run") else {
        return false;
    };
    run_key
        .get_value::<String, _>("EndfieldModManager")
        .map(|v| !v.trim().is_empty())
        .unwrap_or(false)
}

#[cfg(not(windows))]
pub fn get_autostart_enabled() -> bool {
    false
}

#[cfg(windows)]
pub fn set_autostart_enabled(enabled: bool) -> Result<(), String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (run_key, _) = hkcu
        .create_subkey(r"Software\Microsoft\Windows\CurrentVersion\Run")
        .map_err(|e| format!("打开注册表启动项失败：{e}"))?;

    if enabled {
        let exe = std::env::current_exe().map_err(|e| format!("获取当前程序路径失败：{e}"))?;
        let val = format!("\"{}\"", exe.to_string_lossy());
        run_key
            .set_value("EndfieldModManager", &val)
            .map_err(|e| format!("写入开机启动项失败：{e}"))?;
    } else {
        let _ = run_key.delete_value("EndfieldModManager");
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn set_autostart_enabled(_enabled: bool) -> Result<(), String> {
    Err("仅支持 Windows 开机自启设置".to_string())
}

pub fn auto_detect_paths(current: &AppConfig) -> AutoDetectedPaths {
    let mut mods_path = (!current.mods_path.trim().is_empty() && Path::new(&current.mods_path).is_dir())
        .then(|| current.mods_path.clone());
    let mut game_path = (!current.game_path.trim().is_empty() && Path::new(&current.game_path).is_file())
        .then(|| current.game_path.clone());
    let mut xxmi_path = (!current.xxmi_path.trim().is_empty() && Path::new(&current.xxmi_path).is_file())
        .then(|| current.xxmi_path.clone());

    let drives = ['C', 'D', 'E', 'F', 'G'];

    if mods_path.is_none() {
        for d in drives {
            for rel in [
                "MOD\\XXMI\\EFMI\\Mods",
                "Mod\\XXMI\\EFMI\\Mods",
                "XXMI\\EFMI\\Mods",
                "Games\\XXMI\\EFMI\\Mods",
                "EFMI\\Mods",
            ] {
                let candidate = PathBuf::from(format!("{d}:\\{rel}"));
                if candidate.is_dir() {
                    mods_path = Some(candidate.to_string_lossy().to_string());
                    break;
                }
            }
            if mods_path.is_some() {
                break;
            }
        }
    }

    if xxmi_path.is_none() {
        if let Some(mp) = &mods_path {
            // Walk up from .../XXMI/EFMI/Mods -> .../XXMI/Resources/Bin/XXMI Launcher.exe
            if let Some(xxmi_root) = Path::new(mp).parent().and_then(|p| p.parent()) {
                let cand = xxmi_root.join("Resources").join("Bin").join("XXMI Launcher.exe");
                if cand.is_file() {
                    xxmi_path = Some(cand.to_string_lossy().to_string());
                }
            }
        }
        if xxmi_path.is_none() {
            for d in drives {
                for rel in [
                    "MOD\\XXMI\\Resources\\Bin\\XXMI Launcher.exe",
                    "XXMI\\Resources\\Bin\\XXMI Launcher.exe",
                    "MOD\\XXMI\\XXMI Launcher.exe",
                ] {
                    let cand = PathBuf::from(format!("{d}:\\{rel}"));
                    if cand.is_file() {
                        xxmi_path = Some(cand.to_string_lossy().to_string());
                        break;
                    }
                }
                if xxmi_path.is_some() {
                    break;
                }
            }
        }
    }

    if game_path.is_none() {
        game_path = detect_game_from_registry();
    }
    if game_path.is_none() {
        for d in drives {
            for rel in [
                "Hypergryph Launcher\\games\\Arknights Endfield\\Endfield.exe",
                "Games\\Arknights Endfield\\Endfield.exe",
                "Arknights Endfield\\Endfield.exe",
            ] {
                let cand = PathBuf::from(format!("{d}:\\{rel}"));
                if cand.is_file() {
                    game_path = Some(cand.to_string_lossy().to_string());
                    break;
                }
            }
            if game_path.is_some() {
                break;
            }
        }
    }

    AutoDetectedPaths {
        mods_path,
        game_path,
        xxmi_path,
    }
}

fn find_xxmi_config_json(xxmi_exe: &Path) -> Option<PathBuf> {
    let dir = xxmi_exe.parent()?;
    for cand in [
        dir.join("XXMI Launcher Config.json"),
        dir.parent()?.join("XXMI Launcher Config.json"),
        dir.parent()?.parent()?.join("XXMI Launcher Config.json"),
    ] {
        if cand.is_file() {
            return Some(cand);
        }
    }
    None
}

fn normalize_win_path(p: &str) -> String {
    p.trim()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_ascii_lowercase()
}

pub fn check_xxmi_consistency(cfg: &AppConfig) -> XxmiConsistency {
    let mods_parent = Path::new(&cfg.mods_path)
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    let xxmi_exe = Path::new(&cfg.xxmi_path);
    if cfg.xxmi_path.trim().is_empty() || !xxmi_exe.is_file() {
        return XxmiConsistency {
            xxmi_config_found: false,
            xxmi_efmi_path: String::new(),
            mods_parent_path: mods_parent,
            consistent: false,
            message: "尚未配置有效的 XXMI Launcher.exe 路径".to_string(),
        };
    }

    let Some(cfg_json_path) = find_xxmi_config_json(xxmi_exe) else {
        return XxmiConsistency {
            xxmi_config_found: false,
            xxmi_efmi_path: String::new(),
            mods_parent_path: mods_parent,
            consistent: false,
            message: "未在 XXMI 目录中找到 XXMI Launcher Config.json".to_string(),
        };
    };

    let Ok(raw) = fs::read_to_string(&cfg_json_path) else {
        return XxmiConsistency {
            xxmi_config_found: false,
            xxmi_efmi_path: String::new(),
            mods_parent_path: mods_parent,
            consistent: false,
            message: "无法读取 XXMI Launcher Config.json".to_string(),
        };
    };

    let Ok(val) = serde_json::from_str::<Value>(raw.trim_start_matches('\u{feff}')) else {
        return XxmiConsistency {
            xxmi_config_found: false,
            xxmi_efmi_path: String::new(),
            mods_parent_path: mods_parent,
            consistent: false,
            message: "XXMI Launcher Config.json 格式无效".to_string(),
        };
    };

    let efmi_folder = val
        .get("Importers")
        .and_then(|i| i.get("EFMI"))
        .and_then(|e| e.get("Importer"))
        .and_then(|im| im.get("importer_folder"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();

    if efmi_folder.is_empty() {
        return XxmiConsistency {
            xxmi_config_found: true,
            xxmi_efmi_path: String::new(),
            mods_parent_path: mods_parent,
            consistent: false,
            message: "XXMI 尚未配置 EFMI 游戏包路径".to_string(),
        };
    }

    // Resolve relative importer_folder against XXMI Launcher Config.json directory
    let xxmi_base = cfg_json_path.parent().unwrap_or_else(|| Path::new(""));
    let resolved_efmi = if Path::new(&efmi_folder).is_absolute() {
        PathBuf::from(&efmi_folder)
    } else {
        xxmi_base.join(&efmi_folder)
    };
    let resolved_str = resolved_efmi.to_string_lossy().to_string();
    let consistent = !mods_parent.is_empty()
        && normalize_win_path(&resolved_str) == normalize_win_path(&mods_parent);

    let message = if consistent {
        "XXMI EFMI 路径与管理器 Mods 路径完全一致".to_string()
    } else {
        format!(
            "路径不一致：管理器 Mods 上级目录为 {}，而 XXMI 配置的 EFMI 目录为 {}",
            mods_parent, resolved_str
        )
    };

    XxmiConsistency {
        xxmi_config_found: true,
        xxmi_efmi_path: resolved_str,
        mods_parent_path: mods_parent,
        consistent,
        message,
    }
}

pub fn ensure_keypress_bridge(cfg: &AppConfig) -> Result<(), String> {
    let efmi_root = crate::persist_bridge::efmi_root_from_cfg(cfg)?;
    crate::persist_bridge::ensure_keypress_files(&efmi_root)
}

fn split_launch_args(raw: &str) -> Vec<String> {
    let mut args = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut has_token = false;

    let mut chars = raw.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '"' => {
                in_quotes = !in_quotes;
                has_token = true;
            }
            c if c.is_whitespace() && !in_quotes => {
                if has_token {
                    args.push(std::mem::take(&mut current));
                    has_token = false;
                }
            }
            '\\' if in_quotes => {
                // Only unescape `\"` inside quotes so Windows paths like C:\Mods\ keep backslashes.
                if chars.peek() == Some(&'"') {
                    current.push('"');
                    chars.next();
                } else {
                    current.push('\\');
                }
                has_token = true;
            }
            c => {
                current.push(c);
                has_token = true;
            }
        }
    }
    if has_token {
        args.push(current);
    }
    args
}

fn format_shell_execute_params(args: &[String]) -> String {
    let mut out = String::new();
    for (idx, arg) in args.iter().enumerate() {
        if idx > 0 {
            out.push(' ');
        }
        let needs_quotes =
            arg.is_empty() || arg.chars().any(|c| matches!(c, ' ' | '\t' | '"'));
        if !needs_quotes {
            out.push_str(arg);
            continue;
        }
        out.push('"');
        let mut backslashes = 0usize;
        for ch in arg.chars() {
            match ch {
                '\\' => {
                    backslashes += 1;
                    out.push('\\');
                }
                '"' => {
                    for _ in 0..backslashes {
                        out.push('\\');
                    }
                    out.push_str("\\\"");
                    backslashes = 0;
                }
                _ => {
                    backslashes = 0;
                    out.push(ch);
                }
            }
        }
        for _ in 0..backslashes {
            out.push('\\');
        }
        out.push('"');
    }
    out
}

#[cfg(windows)]
fn launch_via_shell_execute_elevated(
    exe: &Path,
    work_dir: &Path,
    args: &[String],
    label: &str,
) -> Result<(), String> {
    use windows::core::HSTRING;
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let verb = HSTRING::from("runas");
    let file = HSTRING::from(exe.as_os_str());
    let dir = HSTRING::from(work_dir.as_os_str());
    let params_str = format_shell_execute_params(args);

    let hinst = if params_str.is_empty() {
        unsafe { ShellExecuteW(None, &verb, &file, None, &dir, SW_SHOWNORMAL) }
    } else {
        let params = HSTRING::from(params_str);
        unsafe { ShellExecuteW(None, &verb, &file, &params, &dir, SW_SHOWNORMAL) }
    };

    let code = hinst.0 as usize;
    if code <= 32 {
        if code == 5 {
            return Err(format!(
                "启动 {label} 需要管理员权限，但 UAC 提权请求被取消或拒绝"
            ));
        }
        return Err(format!(
            "启动 {label} 失败（UAC 提权拉起返回错误码 {code}）"
        ));
    }
    Ok(())
}

fn spawn_executable(
    exe: &Path,
    work_dir: &Path,
    args: &[String],
    hide_console: bool,
    label: &str,
) -> Result<(), String> {
    let mut cmd = Command::new(exe);
    cmd.current_dir(work_dir).args(args);
    #[cfg(windows)]
    if hide_console {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    let _ = hide_console;

    match cmd.spawn() {
        Ok(_) => Ok(()),
        Err(err) => {
            // Standard CreateProcess returns ERROR_ELEVATION_REQUIRED (740) when target needs UAC.
            #[cfg(windows)]
            if err.raw_os_error() == Some(740) {
                return launch_via_shell_execute_elevated(exe, work_dir, args, label);
            }
            Err(format!("启动 {label} 失败：{err}"))
        }
    }
}

pub fn launch_game(cfg: &AppConfig, mode_override: Option<&str>) -> Result<(), String> {
    let mode = mode_override.unwrap_or(&cfg.launch_mode);
    let extra_args = split_launch_args(&cfg.launch_args);

    match mode {
        "EFMI" | "XXMI" => {
            let exe = Path::new(&cfg.xxmi_path);
            if cfg.xxmi_path.trim().is_empty() || !exe.is_file() {
                return Err("未找到有效的 XXMI Launcher.exe，请先在系统设置中配置路径".to_string());
            }
            let _ = ensure_keypress_bridge(cfg);
            let work_dir = exe.parent().unwrap_or_else(|| Path::new("."));
            let mut args = Vec::new();
            if mode == "EFMI" {
                args.push("--nogui".to_string());
                args.push("--xxmi".to_string());
                args.push("EFMI".to_string());
            }
            args.extend(extra_args);
            spawn_executable(exe, work_dir, &args, true, "XXMI 启动器")
        }
        "VANILLA" => {
            let exe = Path::new(&cfg.game_path);
            if cfg.game_path.trim().is_empty() || !exe.is_file() {
                return Err("未找到有效的 Endfield.exe，请先在系统设置中配置游戏路径".to_string());
            }
            let work_dir = exe.parent().unwrap_or_else(|| Path::new("."));
            spawn_executable(exe, work_dir, &extra_args, false, "游戏")
        }
        other => Err(format!("不支持的启动模式：{other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_split_launch_args_and_shell_execute_quoting() {
        let parsed = split_launch_args(r#"-popupwindow --config "C:\Program Files\EFMI\cfg.json" --note="hello world""#);
        assert_eq!(
            parsed,
            vec![
                "-popupwindow",
                "--config",
                r"C:\Program Files\EFMI\cfg.json",
                "--note=hello world",
            ]
        );

        let efmi_args = vec![
            "--nogui".to_string(),
            "--xxmi".to_string(),
            "EFMI".to_string(),
        ];
        assert_eq!(format_shell_execute_params(&efmi_args), "--nogui --xxmi EFMI");

        let special_args = vec![
            r"C:\My Mods\".to_string(),
            r#"say "hi""#.to_string(),
            "".to_string(),
        ];
        assert_eq!(
            format_shell_execute_params(&special_args),
            r#""C:\My Mods\\" "say \"hi\"" """#
        );
    }
}
