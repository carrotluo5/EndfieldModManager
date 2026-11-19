use crate::config::save_config;
use crate::models::{AppConfig, NavigateToModPayload, OverlayStateSnapshot};
use crate::AppState;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

pub const OVERLAY_LABEL: &str = "overlay";
pub const SIDE_PANEL_LABEL: &str = "side-panel";

pub struct OverlayRuntimeState {
    pub visible: bool,
    pub pinned: bool,
    pub last_shown_ms: u64,
    pub side_mode: String,
    pub side_detail_width: f64,
    pub selected_character: Option<String>,
    pub selected_mod_name: Option<String>,
    pub built_transparent: bool,
}

impl Default for OverlayRuntimeState {
    fn default() -> Self {
        Self {
            visible: false,
            pinned: false,
            last_shown_ms: 0,
            side_mode: "closed".to_string(),
            side_detail_width: 300.0,
            selected_character: None,
            selected_mod_name: None,
            built_transparent: true,
        }
    }
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Pure dock geometry helper: docks to left of overlay by default,
/// flipping to the right side automatically if left space overflows work_left.
pub fn compute_side_panel_x(
    overlay_x: i32,
    overlay_w: i32,
    side_w: i32,
    gap: i32,
    work_left: i32,
    work_right: i32,
) -> i32 {
    let left_x = overlay_x - side_w - gap;
    if left_x >= work_left + 4 {
        return left_x;
    }
    let right_x = overlay_x + overlay_w + gap;
    let max_x = (work_right - side_w - 4).max(work_left + 4);
    right_x.clamp(work_left + 4, max_x)
}

pub fn snapshot_from_app(app: &AppHandle) -> OverlayStateSnapshot {
    let state = app.state::<AppState>();
    let cfg_hotkey = state
        .config
        .lock()
        .map(|c| c.overlay_hotkey.clone())
        .unwrap_or_else(|_| "Alt+F".to_string());
    let ov = state.overlay.lock().ok();
    match ov {
        Some(g) => OverlayStateSnapshot {
            visible: g.visible,
            pinned: g.pinned,
            side_mode: g.side_mode.clone(),
            side_detail_width: g.side_detail_width,
            selected_character: g.selected_character.clone(),
            selected_mod_name: g.selected_mod_name.clone(),
            overlay_hotkey: cfg_hotkey,
        },
        None => OverlayStateSnapshot {
            visible: false,
            pinned: false,
            side_mode: "closed".to_string(),
            side_detail_width: 300.0,
            selected_character: None,
            selected_mod_name: None,
            overlay_hotkey: cfg_hotkey,
        },
    }
}

pub fn emit_overlay_state(app: &AppHandle) {
    let snap = snapshot_from_app(app);
    let _ = app.emit("overlay-state-changed", &snap);
}

fn read_scale_and_transparency(app: &AppHandle) -> (f64, bool, bool) {
    let state = app.state::<AppState>();
    let guard = state.config.lock();
    match guard {
        Ok(cfg) => {
            let scale = cfg.overlay_scale.clamp(0.85, 1.45);
            let want_transparent = cfg.compat_level < 3;
            let auto_min = cfg.overlay_auto_minimize_main;
            (scale, want_transparent, auto_min)
        }
        Err(_) => (1.0, true, true),
    }
}

fn logical_side_width(side_mode: &str, detail_width: f64) -> f64 {
    if side_mode == "bubbles" {
        260.0
    } else {
        detail_width.clamp(220.0, 520.0)
    }
}

pub fn ensure_overlay_windows(app: &AppHandle) -> Result<(), String> {
    let (scale, want_transparent, _) = read_scale_and_transparency(app);

    let (need_rebuild, side_mode, detail_w) = {
        let state = app.state::<AppState>();
        let ov = state.overlay.lock().map_err(|_| "浮窗状态锁异常".to_string())?;
        let exists_both = app.get_webview_window(OVERLAY_LABEL).is_some()
            && app.get_webview_window(SIDE_PANEL_LABEL).is_some();
        let rebuild = !exists_both || ov.built_transparent != want_transparent;
        (rebuild, ov.side_mode.clone(), ov.side_detail_width)
    };

    if !need_rebuild {
        return Ok(());
    }

    if let Some(old_side) = app.get_webview_window(SIDE_PANEL_LABEL) {
        let _ = old_side.destroy();
    }
    if let Some(old_ov) = app.get_webview_window(OVERLAY_LABEL) {
        let _ = old_ov.destroy();
    }

    let ov_w = 420.0 * scale;
    let ov_h = 620.0 * scale;

    let ov_win = WebviewWindowBuilder::new(
        app,
        OVERLAY_LABEL,
        WebviewUrl::App("overlay.html".into()),
    )
    .title("Endfield Mod Overlay")
    .decorations(false)
    .transparent(want_transparent)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .visible(false)
    .inner_size(ov_w, ov_h)
    .build()
    .map_err(|e| format!("创建局内主浮窗失败：{e}"))?;

    // Default initial placement: right side of primary monitor work area, vertically centered
    if let Ok(Some(mon)) = ov_win.primary_monitor().or_else(|_| ov_win.current_monitor()) {
        let wa = mon.work_area();
        let sf = mon.scale_factor();
        let phys_w = (ov_w * sf).round() as i32;
        let phys_h = (ov_h * sf).round() as i32;
        let x = wa.position.x + wa.size.width as i32 - phys_w - (24.0 * sf).round() as i32;
        let y = wa.position.y + ((wa.size.height as i32 - phys_h) / 2).max(16);
        let _ = ov_win.set_position(PhysicalPosition::new(x.max(wa.position.x + 8), y));
    }

    let side_w = logical_side_width(&side_mode, detail_w) * scale;
    let _side_win = WebviewWindowBuilder::new(
        app,
        SIDE_PANEL_LABEL,
        WebviewUrl::App("side-panel.html".into()),
    )
    .title("Endfield Mod Side Panel")
    .decorations(false)
    .transparent(want_transparent)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .visible(false)
    .inner_size(side_w, ov_h)
    .build()
    .map_err(|e| format!("创建停靠侧边窗失败：{e}"))?;

    let state = app.state::<AppState>();
    if let Ok(mut ov) = state.overlay.lock() {
        ov.built_transparent = want_transparent;
    }

    Ok(())
}

pub fn sync_side_panel_position(app: &AppHandle) {
    let Some(ov_win) = app.get_webview_window(OVERLAY_LABEL) else {
        return;
    };
    let Some(side_win) = app.get_webview_window(SIDE_PANEL_LABEL) else {
        return;
    };

    let (scale, _, _) = read_scale_and_transparency(app);
    let (side_mode, detail_w) = {
        let state = app.state::<AppState>();
        let Ok(ov) = state.overlay.lock() else {
            return;
        };
        (ov.side_mode.clone(), ov.side_detail_width)
    };

    let target_w = logical_side_width(&side_mode, detail_w) * scale;
    let target_h = 620.0 * scale;
    let _ = side_win.set_size(LogicalSize::new(target_w, target_h));

    let Ok(ov_pos) = ov_win.outer_position() else {
        return;
    };
    let Ok(ov_size) = ov_win.outer_size() else {
        return;
    };
    let mon_opt = ov_win
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| ov_win.primary_monitor().ok().flatten());

    let (work_left, work_top, work_right, work_bottom, sf) = match mon_opt {
        Some(m) => {
            let wa = m.work_area();
            (
                wa.position.x,
                wa.position.y,
                wa.position.x + wa.size.width as i32,
                wa.position.y + wa.size.height as i32,
                m.scale_factor(),
            )
        }
        None => (0, 0, 1920, 1080, 1.0),
    };

    let side_phys_w = side_win
        .outer_size()
        .map(|s| s.width as i32)
        .unwrap_or((target_w * sf).round() as i32);
    let gap = (8.0 * sf).round() as i32;
    let side_x = compute_side_panel_x(
        ov_pos.x,
        ov_size.width as i32,
        side_phys_w,
        gap,
        work_left,
        work_right,
    );
    let side_y = ov_pos
        .y
        .clamp(work_top + 4, (work_bottom - ov_size.height as i32 - 4).max(work_top + 4));

    let _ = side_win.set_position(PhysicalPosition::new(side_x, side_y));
}

pub fn show_overlay(app: &AppHandle) -> Result<(), String> {
    ensure_overlay_windows(app)?;
    let (_, _, auto_minimize_main) = read_scale_and_transparency(app);

    if auto_minimize_main {
        if let Some(main_win) = app.get_webview_window("main") {
            let _ = main_win.minimize();
        }
    }

    let side_active = {
        let state = app.state::<AppState>();
        let mut ov = state.overlay.lock().map_err(|_| "浮窗状态锁异常".to_string())?;
        ov.visible = true;
        ov.last_shown_ms = now_ms();
        ov.side_mode != "closed"
    };

    if let Some(ov_win) = app.get_webview_window(OVERLAY_LABEL) {
        let _ = ov_win.set_always_on_top(true);
        let _ = ov_win.show();
        let _ = ov_win.set_focus();
    }

    if side_active {
        sync_side_panel_position(app);
        if let Some(side_win) = app.get_webview_window(SIDE_PANEL_LABEL) {
            let _ = side_win.set_always_on_top(true);
            let _ = side_win.show();
        }
    }

    emit_overlay_state(app);
    Ok(())
}

pub fn hide_overlay(app: &AppHandle) -> Result<(), String> {
    {
        let state = app.state::<AppState>();
        if let Ok(mut ov) = state.overlay.lock() {
            ov.visible = false;
        };
    }
    if let Some(side_win) = app.get_webview_window(SIDE_PANEL_LABEL) {
        let _ = side_win.hide();
    }
    if let Some(ov_win) = app.get_webview_window(OVERLAY_LABEL) {
        let _ = ov_win.hide();
    }
    emit_overlay_state(app);
    Ok(())
}

pub fn toggle_overlay(app: &AppHandle) -> Result<bool, String> {
    let is_vis = {
        let state = app.state::<AppState>();
        let guard = state.overlay.lock().map_err(|_| "浮窗状态锁异常".to_string())?;
        let win_visible = app
            .get_webview_window(OVERLAY_LABEL)
            .and_then(|w| w.is_visible().ok())
            .unwrap_or(false);
        guard.visible && win_visible
    };

    if is_vis {
        hide_overlay(app)?;
        Ok(false)
    } else {
        show_overlay(app)?;
        Ok(true)
    }
}

pub fn set_overlay_pinned(app: &AppHandle, pinned: bool) -> OverlayStateSnapshot {
    {
        let state = app.state::<AppState>();
        if let Ok(mut ov) = state.overlay.lock() {
            ov.pinned = pinned;
        };
    }
    let snap = snapshot_from_app(app);
    let _ = app.emit("overlay-state-changed", &snap);
    snap
}

pub fn set_overlay_scale(app: &AppHandle, scale: f64) -> Result<AppConfig, String> {
    let clamped = scale.clamp(0.85, 1.45);
    let next_cfg = {
        let state = app.state::<AppState>();
        let mut cfg = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
        cfg.overlay_scale = clamped;
        save_config(&cfg)?;
        cfg.clone()
    };

    if let Some(ov_win) = app.get_webview_window(OVERLAY_LABEL) {
        let _ = ov_win.set_size(LogicalSize::new(420.0 * clamped, 620.0 * clamped));
    }
    sync_side_panel_position(app);
    let _ = app.emit("settings-changed", &next_cfg);
    Ok(next_cfg)
}

pub fn open_side_panel(
    app: &AppHandle,
    mode: &str,
    character_name: Option<String>,
    mod_name: Option<String>,
) -> Result<OverlayStateSnapshot, String> {
    ensure_overlay_windows(app)?;

    let should_close = {
        let state = app.state::<AppState>();
        let mut ov = state.overlay.lock().map_err(|_| "浮窗状态锁异常".to_string())?;

        // Clicking same bubble button again or same mod card toggles side panel off
        let same_bubbles = mode == "bubbles" && ov.side_mode == "bubbles";
        let same_detail = mode == "detail"
            && ov.side_mode == "detail"
            && ov.selected_character == character_name
            && ov.selected_mod_name == mod_name;

        if mode == "closed" || same_bubbles || same_detail {
            ov.side_mode = "closed".to_string();
            true
        } else {
            ov.side_mode = mode.to_string();
            if character_name.is_some() {
                ov.selected_character = character_name;
            }
            if mode == "detail" {
                ov.selected_mod_name = mod_name;
            }
            false
        }
    };

    if should_close {
        if let Some(side_win) = app.get_webview_window(SIDE_PANEL_LABEL) {
            let _ = side_win.hide();
        }
    } else {
        sync_side_panel_position(app);
        if let Some(side_win) = app.get_webview_window(SIDE_PANEL_LABEL) {
            let _ = side_win.set_always_on_top(true);
            let _ = side_win.show();
        }
    }

    let snap = snapshot_from_app(app);
    let _ = app.emit("overlay-state-changed", &snap);
    Ok(snap)
}

pub fn adjust_side_detail_width(app: &AppHandle, delta: f64) -> OverlayStateSnapshot {
    {
        let state = app.state::<AppState>();
        if let Ok(mut ov) = state.overlay.lock() {
            ov.side_detail_width = (ov.side_detail_width + delta).clamp(220.0, 520.0);
        };
    }
    sync_side_panel_position(app);
    let snap = snapshot_from_app(app);
    let _ = app.emit("overlay-state-changed", &snap);
    snap
}

pub fn select_overlay_character(
    app: &AppHandle,
    character_name: String,
) -> Result<OverlayStateSnapshot, String> {
    {
        let state = app.state::<AppState>();
        let mut ov = state.overlay.lock().map_err(|_| "浮窗状态锁异常".to_string())?;
        ov.selected_character = Some(character_name);
        if ov.side_mode == "bubbles" {
            ov.side_mode = "closed".to_string();
        }
    }
    if let Some(side_win) = app.get_webview_window(SIDE_PANEL_LABEL) {
        let should_hide = app
            .state::<AppState>()
            .overlay
            .lock()
            .map(|o| o.side_mode == "closed")
            .unwrap_or(true);
        if should_hide {
            let _ = side_win.hide();
        }
    }
    if let Some(ov_win) = app.get_webview_window(OVERLAY_LABEL) {
        let _ = ov_win.set_focus();
    }
    let snap = snapshot_from_app(app);
    let _ = app.emit("overlay-state-changed", &snap);
    Ok(snap)
}

pub fn focus_main_window_on_mod(
    app: &AppHandle,
    character_name: String,
    mod_name: String,
) -> Result<(), String> {
    let _ = hide_overlay(app);
    if let Some(main_win) = app.get_webview_window("main") {
        let _ = main_win.unminimize();
        let _ = main_win.show();
        let _ = main_win.set_focus();
    }
    let _ = app.emit(
        "navigate-to-mod",
        NavigateToModPayload {
            character_name,
            mod_name,
        },
    );
    Ok(())
}

/// 200ms delayed blur check with 3 exemptions:
/// 1) pinned == true
/// 2) within 350ms grace window of showing overlay
/// 3) focus moved between overlay and side-panel
pub fn schedule_blur_hide_check(app: AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(200));

        let (visible, pinned, last_shown_ms) = {
            let state = app.state::<AppState>();
            let Ok(ov) = state.overlay.lock() else {
                return;
            };
            (ov.visible, ov.pinned, ov.last_shown_ms)
        };

        if !visible || pinned {
            return;
        }
        if now_ms().saturating_sub(last_shown_ms) < 350 {
            return;
        }

        let ov_focused = app
            .get_webview_window(OVERLAY_LABEL)
            .and_then(|w| w.is_focused().ok())
            .unwrap_or(false);
        let side_focused = app
            .get_webview_window(SIDE_PANEL_LABEL)
            .and_then(|w| w.is_focused().ok())
            .unwrap_or(false);

        if ov_focused || side_focused {
            return;
        }

        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            let _ = hide_overlay(&handle);
        });
    });
}

pub fn register_overlay_hotkey(app: &AppHandle, hotkey_str: &str) -> Result<(), String> {
    let trimmed = hotkey_str.trim();
    if trimmed.is_empty() {
        return Err("局内呼出热键不能为空".to_string());
    }

    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    gs.on_shortcut(trimmed, |app_handle, _shortcut, event| {
        if event.state() == ShortcutState::Pressed {
            let h = app_handle.clone();
            let _ = app_handle.run_on_main_thread(move || {
                let _ = toggle_overlay(&h);
            });
        }
    })
    .map_err(|e| format!("注册全局快捷键「{trimmed}」失败：{e}"))
}
