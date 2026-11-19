use crate::models::GameRuntimeStatus;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedKeyCombo {
    pub modifiers: Vec<u16>,
    pub keys: Vec<u16>,
}

const VK_LBUTTON: u16 = 0x01;
const VK_BACK: u16 = 0x08;
const VK_TAB: u16 = 0x09;
const VK_RETURN: u16 = 0x0D;
const VK_SHIFT: u16 = 0x10;
const VK_CONTROL: u16 = 0x11;
const VK_MENU: u16 = 0x12;
const VK_CAPITAL: u16 = 0x14;
const VK_ESCAPE: u16 = 0x1B;
const VK_SPACE: u16 = 0x20;
const VK_PRIOR: u16 = 0x21;
const VK_NEXT: u16 = 0x22;
const VK_END: u16 = 0x23;
const VK_HOME: u16 = 0x24;
const VK_LEFT: u16 = 0x25;
const VK_UP: u16 = 0x26;
const VK_RIGHT: u16 = 0x27;
const VK_DOWN: u16 = 0x28;
const VK_INSERT: u16 = 0x2D;
const VK_DELETE: u16 = 0x2E;
const VK_MULTIPLY: u16 = 0x6A;
const VK_ADD: u16 = 0x6B;
const VK_SUBTRACT: u16 = 0x6D;
const VK_DECIMAL: u16 = 0x6E;
const VK_DIVIDE: u16 = 0x6F;
const VK_F10: u16 = 0x79;
const VK_OEM_1: u16 = 0xBA;
const VK_OEM_PLUS: u16 = 0xBB;
const VK_OEM_COMMA: u16 = 0xBC;
const VK_OEM_MINUS: u16 = 0xBD;
const VK_OEM_PERIOD: u16 = 0xBE;
const VK_OEM_2: u16 = 0xBF;
const VK_OEM_3: u16 = 0xC0;
const VK_OEM_4: u16 = 0xDB;
const VK_OEM_5: u16 = 0xDC;
const VK_OEM_6: u16 = 0xDD;
const VK_OEM_7: u16 = 0xDE;

fn is_extended_vk(vk: u16) -> bool {
    matches!(
        vk,
        VK_INSERT | VK_DELETE | VK_HOME | VK_END | VK_PRIOR | VK_NEXT | VK_LEFT | VK_UP | VK_RIGHT | VK_DOWN | VK_DIVIDE
    )
}

pub fn parse_3dmigoto_hotkey(expr: &str) -> Result<ParsedKeyCombo, String> {
    let mut modifiers = Vec::new();
    let mut keys = Vec::new();

    for raw in expr.split_whitespace() {
        let low = raw.trim().to_ascii_lowercase();
        if low.is_empty() || low.starts_with("no_") {
            continue;
        }
        let clean = low.trim_start_matches('!');
        let upper = clean.to_ascii_uppercase();

        if upper.starts_with("XB_") {
            return Err("鼠标或手柄按键不支持自动模拟发送".to_string());
        }

        match clean {
            "vk_lbutton" | "lbutton" | "vk_rbutton" | "rbutton" | "vk_mbutton" | "mbutton"
            | "vk_xbutton1" | "xbutton1" | "vk_xbutton2" | "xbutton2" => {
                return Err("鼠标或手柄按键不支持自动模拟发送".to_string());
            }
            "ctrl" | "control" | "lctrl" | "rctrl" | "vk_control" | "vk_lcontrol" | "vk_rcontrol" => {
                if !modifiers.contains(&VK_CONTROL) {
                    modifiers.push(VK_CONTROL);
                }
            }
            "alt" | "lalt" | "ralt" | "vk_menu" | "vk_lmenu" | "vk_rmenu" => {
                if !modifiers.contains(&VK_MENU) {
                    modifiers.push(VK_MENU);
                }
            }
            "shift" | "lshift" | "rshift" | "vk_shift" | "vk_lshift" | "vk_rshift" => {
                if !modifiers.contains(&VK_SHIFT) {
                    modifiers.push(VK_SHIFT);
                }
            }
            "vk_space" | "space" => keys.push(VK_SPACE),
            "vk_return" | "enter" | "return" => keys.push(VK_RETURN),
            "vk_back" | "backspace" => keys.push(VK_BACK),
            "vk_tab" | "tab" => keys.push(VK_TAB),
            "vk_escape" | "esc" | "escape" => keys.push(VK_ESCAPE),
            "vk_capital" | "capslock" => keys.push(VK_CAPITAL),
            "vk_up" | "up" => keys.push(VK_UP),
            "vk_down" | "down" => keys.push(VK_DOWN),
            "vk_left" | "left" => keys.push(VK_LEFT),
            "vk_right" | "right" => keys.push(VK_RIGHT),
            "vk_home" | "home" => keys.push(VK_HOME),
            "vk_end" | "end" => keys.push(VK_END),
            "vk_insert" | "insert" => keys.push(VK_INSERT),
            "vk_delete" | "delete" | "del" => keys.push(VK_DELETE),
            "vk_prior" | "pageup" | "pgup" => keys.push(VK_PRIOR),
            "vk_next" | "pagedown" | "pgdn" => keys.push(VK_NEXT),
            "vk_multiply" => keys.push(VK_MULTIPLY),
            "vk_add" => keys.push(VK_ADD),
            "vk_subtract" => keys.push(VK_SUBTRACT),
            "vk_decimal" => keys.push(VK_DECIMAL),
            "vk_divide" => keys.push(VK_DIVIDE),
            "vk_oem_1" | ";" => keys.push(VK_OEM_1),
            "vk_oem_plus" | "=" | "+" => keys.push(VK_OEM_PLUS),
            "vk_oem_comma" | "," => keys.push(VK_OEM_COMMA),
            "vk_oem_minus" | "-" => keys.push(VK_OEM_MINUS),
            "vk_oem_period" | "." => keys.push(VK_OEM_PERIOD),
            "vk_oem_2" | "/" => keys.push(VK_OEM_2),
            "vk_oem_3" | "`" | "~" => keys.push(VK_OEM_3),
            "vk_oem_4" | "[" => keys.push(VK_OEM_4),
            "vk_oem_5" | "\\" => keys.push(VK_OEM_5),
            "vk_oem_6" | "]" => keys.push(VK_OEM_6),
            "vk_oem_7" | "'" => keys.push(VK_OEM_7),
            _ => {
                if upper.contains("MOUSE") || upper.contains("BUTTON") {
                    return Err("鼠标或手柄按键不支持自动模拟发送".to_string());
                }
                if let Some(rest) = upper.strip_prefix("VK_NUMPAD") {
                    if let Ok(d) = rest.parse::<u16>() {
                        if d <= 9 {
                            keys.push(0x60 + d);
                            continue;
                        }
                    }
                }
                let stripped = upper.strip_prefix("VK_").unwrap_or(&upper);
                if let Some(fnum_str) = stripped.strip_prefix('F') {
                    if let Ok(fnum) = fnum_str.parse::<u16>() {
                        if (1..=24).contains(&fnum) {
                            keys.push(0x70 + (fnum - 1));
                            continue;
                        }
                    }
                }
                if stripped.len() == 1 {
                    let b = stripped.as_bytes()[0];
                    if b.is_ascii_uppercase() || b.is_ascii_digit() {
                        keys.push(b as u16);
                        continue;
                    }
                }
                return Err(format!("暂不支持自动发送该键位 token：{raw}"));
            }
        }
    }

    if keys.is_empty() && modifiers.is_empty() {
        return Err("快捷键表达式为空".to_string());
    }
    if keys.is_empty() {
        // Modifier-only chord: treat last modifier as key press
        if let Some(last) = modifiers.pop() {
            keys.push(last);
        }
    }
    let _ = VK_LBUTTON; // keep constant reference uniform

    Ok(ParsedKeyCombo { modifiers, keys })
}

#[cfg(windows)]
mod win32 {
    use super::*;
    use std::ffi::OsString;
    use std::mem::size_of;
    use std::os::windows::ffi::OsStringExt;
    use std::path::Path;
    use std::thread;
    use std::time::Duration;
    use windows::core::{BOOL, HSTRING, PWSTR};
    use windows::Win32::Foundation::{CloseHandle, ERROR_ACCESS_DENIED, HANDLE, HWND, LPARAM};
    use windows::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY};
    use windows::Win32::System::Threading::{
        GetCurrentProcess, OpenProcess, OpenProcessToken, QueryFullProcessImageNameW,
        PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        MapVirtualKeyW, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS,
        KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, MAPVK_VK_TO_VSC, VIRTUAL_KEY,
    };
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible, SW_SHOWNORMAL,
    };

    fn make_key_input(vk: u16, key_up: bool) -> INPUT {
        let scan = unsafe { MapVirtualKeyW(vk as u32, MAPVK_VK_TO_VSC) } as u16;
        let mut flags = KEYBD_EVENT_FLAGS(0);
        if is_extended_vk(vk) {
            flags |= KEYEVENTF_EXTENDEDKEY;
        }
        if key_up {
            flags |= KEYEVENTF_KEYUP;
        }
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(vk),
                    wScan: scan,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    fn dispatch_inputs(inputs: &[INPUT]) -> Result<(), String> {
        if inputs.is_empty() {
            return Ok(());
        }
        let sent = unsafe { SendInput(inputs, size_of::<INPUT>() as i32) };
        if sent == 0 {
            return Err("SendInput 发送按键失败，可能被目标进程 UIPI 权限隔离拦截".to_string());
        }
        Ok(())
    }

    pub fn send_vk_combo(combo: &ParsedKeyCombo) -> Result<(), String> {
        if !combo.modifiers.is_empty() {
            let down_mods: Vec<INPUT> = combo
                .modifiers
                .iter()
                .map(|&vk| make_key_input(vk, false))
                .collect();
            dispatch_inputs(&down_mods)?;
            thread::sleep(Duration::from_millis(12));
        }

        let down_keys: Vec<INPUT> = combo
            .keys
            .iter()
            .map(|&vk| make_key_input(vk, false))
            .collect();
        dispatch_inputs(&down_keys)?;

        thread::sleep(Duration::from_millis(45));

        let up_keys: Vec<INPUT> = combo
            .keys
            .iter()
            .rev()
            .map(|&vk| make_key_input(vk, true))
            .collect();
        dispatch_inputs(&up_keys)?;

        if !combo.modifiers.is_empty() {
            thread::sleep(Duration::from_millis(10));
            let up_mods: Vec<INPUT> = combo
                .modifiers
                .iter()
                .rev()
                .map(|&vk| make_key_input(vk, true))
                .collect();
            dispatch_inputs(&up_mods)?;
        }

        Ok(())
    }

    fn token_is_elevated(process_handle: HANDLE) -> Result<bool, u32> {
        let mut token = HANDLE::default();
        if let Err(err) = unsafe { OpenProcessToken(process_handle, TOKEN_QUERY, &mut token) } {
            return Err(err.code().0 as u32 & 0xFFFF);
        }
        let mut elevation = TOKEN_ELEVATION::default();
        let mut ret_len = 0u32;
        let ok = unsafe {
            GetTokenInformation(
                token,
                TokenElevation,
                Some((&mut elevation as *mut TOKEN_ELEVATION).cast()),
                size_of::<TOKEN_ELEVATION>() as u32,
                &mut ret_len,
            )
        };
        let _ = unsafe { CloseHandle(token) };
        if ok.is_err() {
            return Err(0);
        }
        Ok(elevation.TokenIsElevated != 0)
    }

    pub fn is_current_process_elevated() -> bool {
        let proc_handle = unsafe { GetCurrentProcess() };
        token_is_elevated(proc_handle).unwrap_or(false)
    }

    struct EnumSearchState {
        found: Option<(u32, String, bool)>,
        manager_elevated: bool,
    }

    unsafe extern "system" fn enum_windows_cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
        if !unsafe { IsWindowVisible(hwnd) }.as_bool() {
            return BOOL(1);
        }
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
        if pid == 0 {
            return BOOL(1);
        }
        let Ok(hproc) = (unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }) else {
            return BOOL(1);
        };

        let mut buf = [0u16; 520];
        let mut size = buf.len() as u32;
        let query_ok = unsafe {
            QueryFullProcessImageNameW(
                hproc,
                PROCESS_NAME_WIN32,
                PWSTR(buf.as_mut_ptr()),
                &mut size,
            )
        };

        if query_ok.is_ok() && size > 0 {
            let exe_os = OsString::from_wide(&buf[..size as usize]);
            let exe_path = Path::new(&exe_os);
            let is_endfield = exe_path
                .file_name()
                .and_then(|s| s.to_str())
                .map(|n| n.eq_ignore_ascii_case("Endfield.exe"))
                .unwrap_or(false);

            if is_endfield {
                let mut title_buf = [0u16; 256];
                let tlen = unsafe { GetWindowTextW(hwnd, &mut title_buf) };
                let title = if tlen > 0 {
                    String::from_utf16_lossy(&title_buf[..tlen as usize])
                } else {
                    "Endfield.exe".to_string()
                };

                let state_ptr = lparam.0 as *mut EnumSearchState;
                let manager_elevated = unsafe { (*state_ptr).manager_elevated };
                let game_elevated = match token_is_elevated(hproc) {
                    Ok(elev) => elev,
                    Err(code) => {
                        if code == ERROR_ACCESS_DENIED.0 && !manager_elevated {
                            true
                        } else {
                            false
                        }
                    }
                };
                unsafe {
                    (*state_ptr).found = Some((pid, title, game_elevated));
                }
                let _ = unsafe { CloseHandle(hproc) };
                return BOOL(0);
            }
        }

        let _ = unsafe { CloseHandle(hproc) };
        BOOL(1)
    }

    pub fn get_game_runtime_status() -> GameRuntimeStatus {
        let manager_elevated = is_current_process_elevated();
        let mut search = EnumSearchState {
            found: None,
            manager_elevated,
        };
        let ptr = (&mut search as *mut EnumSearchState) as isize;
        let _ = unsafe { EnumWindows(Some(enum_windows_cb), LPARAM(ptr)) };

        if let Some((pid, title, game_elevated)) = search.found {
            let uipi_blocked = game_elevated && !manager_elevated;
            let message = if uipi_blocked {
                "检测到游戏以管理员权限运行而当前管理器为普通权限，Windows UIPI 会拦截局内 F10 与快捷键发送，请点击「以管理员重启」或取消游戏的管理员运行设置。".to_string()
            } else if manager_elevated {
                "游戏运行中（管理器已具备管理员权限，局内按键发送畅通）".to_string()
            } else {
                "游戏运行中，权限匹配正常，支持直接发送 F10 与快捷键".to_string()
            };

            GameRuntimeStatus {
                game_running: true,
                game_pid: Some(pid),
                game_title: title,
                game_elevated,
                manager_elevated,
                uipi_blocked,
                message,
            }
        } else {
            GameRuntimeStatus {
                game_running: false,
                game_pid: None,
                game_title: String::new(),
                game_elevated: false,
                manager_elevated,
                uipi_blocked: false,
                message: if manager_elevated {
                    "未检测到 Endfield.exe 运行窗口（当前管理器以管理员权限运行）".to_string()
                } else {
                    "未检测到 Endfield.exe 运行窗口".to_string()
                },
            }
        }
    }

    pub fn relaunch_as_admin() -> Result<(), String> {
        let exe = std::env::current_exe().map_err(|e| format!("获取当前程序路径失败：{e}"))?;
        let verb = HSTRING::from("runas");
        let file = HSTRING::from(exe.as_os_str());
        let hinst = unsafe { ShellExecuteW(None, &verb, &file, None, None, SW_SHOWNORMAL) };
        if (hinst.0 as usize) <= 32 {
            return Err("请求管理员权限启动被取消或失败".to_string());
        }
        Ok(())
    }
}

#[cfg(not(windows))]
mod win32 {
    use super::*;

    pub fn send_vk_combo(_combo: &ParsedKeyCombo) -> Result<(), String> {
        Err("当前操作系统不支持 Win32 SendInput".to_string())
    }
    pub fn is_current_process_elevated() -> bool {
        false
    }
    pub fn get_game_runtime_status() -> GameRuntimeStatus {
        GameRuntimeStatus {
            game_running: false,
            game_pid: None,
            game_title: String::new(),
            game_elevated: false,
            manager_elevated: false,
            uipi_blocked: false,
            message: "非 Windows 环境".to_string(),
        }
    }
    pub fn relaunch_as_admin() -> Result<(), String> {
        Err("仅支持 Windows".to_string())
    }
}

pub fn send_f10_reload() -> Result<(), String> {
    win32::send_vk_combo(&ParsedKeyCombo {
        modifiers: Vec::new(),
        keys: vec![VK_F10],
    })
}

pub fn send_hotkey_expression(expr: &str) -> Result<(), String> {
    let combo = parse_3dmigoto_hotkey(expr)?;
    win32::send_vk_combo(&combo)
}

pub fn is_current_process_elevated() -> bool {
    win32::is_current_process_elevated()
}

pub fn get_game_runtime_status() -> GameRuntimeStatus {
    win32::get_game_runtime_status()
}

pub fn relaunch_as_admin() -> Result<(), String> {
    win32::relaunch_as_admin()
}
