pub mod characters;
pub mod config;
pub mod diagnostics;
pub mod fixer;
pub mod fs_ops;
pub mod importer;
pub mod ini_engine;
pub mod launcher;
pub mod models;
pub mod mods;
pub mod overlay;
pub mod persist_bridge;
pub mod presets;
pub mod organizer;
pub mod undo;
pub mod updater;
pub mod win_input;

use crate::models::{
    AppConfig, AppearanceSection, AppearanceSectionConfig, ApplyPresetResult, AutoDetectedPaths,
    CharacterItem, CharacterModsCatalog, DiagnosticsReport, FixBackupEntry, FixerRunReport,
    GameRuntimeStatus, ImportAnalysisResponse, ImportExecutionSummary, ImportPlanItem, ModDetails,
    ModListResponse, ModPreset, OrganizeApplyResult, OrganizeScanReport, OverlayStateSnapshot,
    PackageUpdateResult, PersistBridgeStatus, PresetImportResult, PresetListResponse,
    PresetModEntry, RabbitFxStatus, TagsPoolStore, ToggleModResult, UndoEntrySummary, UndoResult,
    UpdateCheckResult, XxmiConsistency,
};
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use tauri::utils::config::{AppDirectoriesOverride, AppDirectoryOverrides};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};

pub struct AppState {
    pub config: Mutex<AppConfig>,
    pub undo_stack: Mutex<undo::UndoStack>,
    pub overlay: Mutex<overlay::OverlayRuntimeState>,
    pub overlay_window_build: Mutex<()>,
    pub import_sessions: importer::ImportSessionStore,
    pub is_quitting: AtomicBool,
}

#[tauri::command]
fn get_config(state: State<'_, AppState>) -> Result<AppConfig, String> {
    let guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
    Ok(guard.clone())
}

#[tauri::command]
fn update_config(
    app: AppHandle,
    state: State<'_, AppState>,
    patch: Value,
) -> Result<AppConfig, String> {
    let mut guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
    let mut current_val =
        serde_json::to_value(&*guard).map_err(|e| format!("序列化配置失败：{e}"))?;
    if let (Some(base_obj), Some(patch_obj)) = (current_val.as_object_mut(), patch.as_object()) {
        for (k, v) in patch_obj {
            base_obj.insert(k.clone(), v.clone());
        }
    }
    let next_cfg: AppConfig =
        serde_json::from_value(current_val).map_err(|e| format!("配置字段格式错误：{e}"))?;
    config::save_config(&next_cfg)?;
    *guard = next_cfg.clone();
    drop(guard);
    let _ = app.emit("settings-changed", &next_cfg);
    Ok(next_cfg)
}

#[tauri::command]
fn get_preset_count() -> Result<usize, String> {
    let store = config::load_presets()?;
    Ok(store.presets.len())
}

#[tauri::command]
fn get_tags_pool() -> Result<TagsPoolStore, String> {
    config::load_tags_pool()
}

#[tauri::command]
fn save_tags_pool(store: TagsPoolStore) -> Result<(), String> {
    config::save_tags_pool(&store)
}

#[tauri::command]
fn auto_detect_paths(state: State<'_, AppState>) -> Result<AutoDetectedPaths, String> {
    let guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
    Ok(launcher::auto_detect_paths(&guard))
}

#[tauri::command]
fn check_xxmi_consistency(
    state: State<'_, AppState>,
    mods_path: Option<String>,
    xxmi_path: Option<String>,
) -> Result<XxmiConsistency, String> {
    let mut cfg = state.config.lock().map_err(|_| "配置锁异常".to_string())?.clone();
    if let Some(path) = mods_path {
        let path = path.trim();
        if path.is_empty() || !Path::new(path).is_dir() {
            return Err("请选择已存在的 EFMI Mods 文件夹".to_string());
        }
        cfg.mods_path = path.to_string();
    }
    if let Some(path) = xxmi_path {
        cfg.xxmi_path = path.trim().to_string();
    }
    Ok(launcher::check_xxmi_consistency(&cfg))
}

#[tauri::command]
fn launch_game(state: State<'_, AppState>, mode: Option<String>) -> Result<(), String> {
    let guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
    launcher::launch_game(&guard, mode.as_deref())
}

#[tauri::command]
fn open_path_in_explorer(path: String) -> Result<(), String> {
    fs_ops::open_in_explorer(Path::new(&path))
}

#[tauri::command]
fn list_characters(
    state: State<'_, AppState>,
    include_all: Option<bool>,
) -> Result<Vec<CharacterItem>, String> {
    let guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
    characters::list_characters(&guard, include_all)
}

#[tauri::command]
fn add_character(
    app: AppHandle,
    state: State<'_, AppState>,
    name: String,
    cover_data_url: Option<String>,
) -> Result<CharacterItem, String> {
    let mut guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
    let item = characters::add_character(&mut guard, &name, cover_data_url.as_deref())?;
    drop(guard);
    let _ = app.emit("characters-changed", ());
    Ok(item)
}

#[tauri::command]
fn rename_character(
    app: AppHandle,
    state: State<'_, AppState>,
    old_name: String,
    new_name: String,
) -> Result<(), String> {
    let mut guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
    characters::rename_character(&mut guard, &old_name, &new_name)?;
    drop(guard);
    let _ = app.emit("characters-changed", ());
    Ok(())
}

#[tauri::command]
fn delete_character(
    app: AppHandle,
    state: State<'_, AppState>,
    character_name: String,
) -> Result<(), String> {
    let mut guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
    characters::delete_character(&mut guard, &character_name)?;
    drop(guard);
    let _ = app.emit("characters-changed", ());
    Ok(())
}

#[tauri::command]
fn set_character_cover_data(
    app: AppHandle,
    state: State<'_, AppState>,
    character_name: String,
    data_url: String,
) -> Result<(String, u64), String> {
    let guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
    let res = characters::set_character_cover_data_url(&guard, &character_name, &data_url)?;
    drop(guard);
    let _ = app.emit("characters-changed", ());
    Ok(res)
}

#[tauri::command]
fn set_character_cover_file(
    app: AppHandle,
    state: State<'_, AppState>,
    character_name: String,
    file_path: String,
) -> Result<(String, u64), String> {
    let guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
    let res =
        characters::set_character_cover_file(&guard, &character_name, Path::new(&file_path))?;
    drop(guard);
    let _ = app.emit("characters-changed", ());
    Ok(res)
}

#[tauri::command]
fn save_character_order(
    app: AppHandle,
    state: State<'_, AppState>,
    order: Vec<String>,
) -> Result<(), String> {
    let mut guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
    guard.character_order = order;
    config::save_config(&guard)?;
    drop(guard);
    let _ = app.emit("characters-changed", ());
    Ok(())
}

#[tauri::command]
fn toggle_pin_character(
    app: AppHandle,
    state: State<'_, AppState>,
    character_name: String,
    pinned: bool,
) -> Result<(), String> {
    let mut guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
    guard.pinned_characters.retain(|x| x != &character_name);
    if pinned {
        guard.pinned_characters.push(character_name);
    }
    config::save_config(&guard)?;
    drop(guard);
    let _ = app.emit("characters-changed", ());
    Ok(())
}

#[tauri::command]
fn list_appearance_sections(
    state: State<'_, AppState>,
    character_name: String,
) -> Result<Vec<AppearanceSection>, String> {
    let guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
    characters::list_appearance_sections(&guard, &character_name)
}

#[tauri::command]
fn create_appearance_section(
    app: AppHandle,
    state: State<'_, AppState>,
    character_name: String,
    name: String,
    name_en: String,
    cover_data_url: Option<String>,
) -> Result<AppearanceSectionConfig, String> {
    let mut guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
    let sec = characters::create_appearance_section(
        &mut guard,
        &character_name,
        &name,
        &name_en,
        cover_data_url.as_deref(),
    )?;
    drop(guard);
    let _ = app.emit("mods-changed", &character_name);
    Ok(sec)
}

#[tauri::command]
fn update_appearance_section(
    app: AppHandle,
    state: State<'_, AppState>,
    character_name: String,
    section_id: String,
    name: String,
    name_en: String,
    cover_data_url: Option<String>,
    clear_cover: bool,
) -> Result<(), String> {
    let mut guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
    characters::update_appearance_section(
        &mut guard,
        &character_name,
        &section_id,
        &name,
        &name_en,
        cover_data_url.as_deref(),
        clear_cover,
    )?;
    drop(guard);
    let _ = app.emit("mods-changed", &character_name);
    Ok(())
}

#[tauri::command]
fn delete_appearance_section(
    app: AppHandle,
    state: State<'_, AppState>,
    character_name: String,
    section_id: String,
) -> Result<usize, String> {
    let mut guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
    let count = characters::delete_appearance_section(&mut guard, &character_name, &section_id)?;
    drop(guard);
    let _ = app.emit("mods-changed", &character_name);
    Ok(count)
}

#[tauri::command]
fn list_mods(
    state: State<'_, AppState>,
    character_name: String,
) -> Result<ModListResponse, String> {
    let guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
    mods::list_mods(&guard, &character_name)
}

#[tauri::command]
fn toggle_mod(
    app: AppHandle,
    state: State<'_, AppState>,
    character_name: String,
    mod_name: String,
    enable: bool,
    exclusive: bool,
    force_replace_rabbit_fx: bool,
) -> Result<ToggleModResult, String> {
    let mut guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
    let res = mods::toggle_mod(
        &mut guard,
        &state.undo_stack,
        &character_name,
        &mod_name,
        enable,
        exclusive,
        force_replace_rabbit_fx,
    )?;
    drop(guard);
    if res.success {
        let _ = app.emit("mods-changed", &character_name);
        let _ = app.emit("characters-changed", ());
        let _ = app.emit("undo-changed", ());
    }
    Ok(res)
}

#[tauri::command]
fn get_mod_details(
    state: State<'_, AppState>,
    character_name: String,
    mod_name: String,
) -> Result<ModDetails, String> {
    let guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
    mods::get_mod_details(&guard, &character_name, &mod_name)
}

#[tauri::command]
fn rename_mod(
    app: AppHandle,
    state: State<'_, AppState>,
    character_name: String,
    old_name: String,
    new_name: String,
) -> Result<(), String> {
    let mut guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
    mods::rename_mod(&mut guard, &character_name, &old_name, &new_name)?;
    drop(guard);
    let _ = app.emit("mods-changed", &character_name);
    Ok(())
}

#[tauri::command]
fn delete_mod(
    app: AppHandle,
    state: State<'_, AppState>,
    character_name: String,
    mod_name: String,
) -> Result<(), String> {
    let mut guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
    mods::delete_mod(&mut guard, &character_name, &mod_name)?;
    drop(guard);
    let _ = app.emit("mods-changed", &character_name);
    let _ = app.emit("characters-changed", ());
    Ok(())
}

#[tauri::command]
fn move_mod_to_character(
    app: AppHandle,
    state: State<'_, AppState>,
    source_character: String,
    mod_name: String,
    target_character: String,
) -> Result<(), String> {
    let mut guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
    mods::move_mod_to_character(&mut guard, &source_character, &mod_name, &target_character)?;
    drop(guard);
    let _ = app.emit("mods-changed", &source_character);
    let _ = app.emit("characters-changed", ());
    Ok(())
}

#[tauri::command]
fn assign_mod_section(
    app: AppHandle,
    state: State<'_, AppState>,
    character_name: String,
    mod_name: String,
    section_id: String,
) -> Result<(), String> {
    let guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
    mods::assign_mod_section(&guard, &character_name, &mod_name, &section_id)?;
    drop(guard);
    let _ = app.emit("mods-changed", &character_name);
    Ok(())
}

#[tauri::command]
fn pin_mod(
    app: AppHandle,
    state: State<'_, AppState>,
    character_name: String,
    mod_name: String,
    pinned: bool,
) -> Result<(), String> {
    let mut guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
    mods::pin_mod(&mut guard, &character_name, &mod_name, pinned)?;
    drop(guard);
    let _ = app.emit("mods-changed", &character_name);
    Ok(())
}

#[tauri::command]
fn set_mod_marked(
    app: AppHandle,
    state: State<'_, AppState>,
    character_name: String,
    mod_name: String,
    marked: bool,
) -> Result<(), String> {
    let guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
    mods::set_mod_marked(&guard, &character_name, &mod_name, marked)?;
    drop(guard);
    let _ = app.emit("mods-changed", &character_name);
    Ok(())
}

#[tauri::command]
fn save_mod_order(
    app: AppHandle,
    state: State<'_, AppState>,
    character_name: String,
    order: Vec<String>,
) -> Result<(), String> {
    let mut guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
    guard.mod_orders.insert(character_name.clone(), order);
    config::save_config(&guard)?;
    drop(guard);
    let _ = app.emit("mods-changed", &character_name);
    Ok(())
}

#[tauri::command]
fn set_mod_preview_file(
    app: AppHandle,
    state: State<'_, AppState>,
    character_name: String,
    mod_name: String,
    file_path: String,
) -> Result<(String, u64), String> {
    let guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
    let res =
        mods::set_mod_preview_file(&guard, &character_name, &mod_name, Path::new(&file_path))?;
    drop(guard);
    let _ = app.emit("mods-changed", &character_name);
    Ok(res)
}

#[tauri::command]
fn set_mod_preview_data(
    app: AppHandle,
    state: State<'_, AppState>,
    character_name: String,
    mod_name: String,
    data_url: String,
) -> Result<(String, u64), String> {
    let guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
    let res = mods::set_mod_preview_data_url(&guard, &character_name, &mod_name, &data_url)?;
    drop(guard);
    let _ = app.emit("mods-changed", &character_name);
    Ok(res)
}

#[tauri::command]
fn update_mod_meta(
    app: AppHandle,
    state: State<'_, AppState>,
    character_name: String,
    mod_name: String,
    notes: Option<String>,
    tags: Option<Vec<String>>,
    hotkey_aliases: Option<HashMap<String, String>>,
) -> Result<(), String> {
    let guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
    mods::update_mod_meta(
        &guard,
        &character_name,
        &mod_name,
        notes,
        tags,
        hotkey_aliases,
    )?;
    drop(guard);
    let _ = app.emit("mods-changed", &character_name);
    Ok(())
}

#[tauri::command]
fn get_rabbitfx_status(state: State<'_, AppState>) -> Result<RabbitFxStatus, String> {
    let guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
    Ok(ini_engine::get_rabbitfx_status(Path::new(&guard.mods_path)))
}

#[tauri::command]
fn update_mod_hotkey(
    app: AppHandle,
    state: State<'_, AppState>,
    character_name: String,
    mod_name: String,
    ini_rel_path: String,
    section: String,
    new_key_expr: String,
) -> Result<(), String> {
    let guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
    mods::update_mod_hotkey(
        &guard,
        &character_name,
        &mod_name,
        &ini_rel_path,
        &section,
        &new_key_expr,
    )?;
    drop(guard);
    let _ = app.emit("mods-changed", &character_name);
    Ok(())
}

#[tauri::command]
fn get_persist_bridge_status(state: State<'_, AppState>) -> Result<PersistBridgeStatus, String> {
    let guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
    Ok(persist_bridge::get_status(&guard))
}

#[tauri::command]
fn set_persist_bridge_enabled(
    app: AppHandle,
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<PersistBridgeStatus, String> {
    let mut guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
    let mut next_cfg = guard.clone();
    let status = if enabled {
        persist_bridge::sync_all_enabled_mods(&mut next_cfg)?
    } else {
        persist_bridge::disable_and_restore_all(&mut next_cfg)?
    };
    *guard = next_cfg.clone();
    drop(guard);
    let _ = app.emit("settings-changed", &next_cfg);
    let _ = app.emit("mods-changed", "");
    Ok(status)
}

#[tauri::command]
fn set_persist_bridge_cache_size(
    app: AppHandle,
    state: State<'_, AppState>,
    cache_size: u32,
) -> Result<PersistBridgeStatus, String> {
    let mut guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
    let mut next_cfg = guard.clone();
    next_cfg.persist_bridge_cache_size = cache_size.min(30);
    let max_recent = next_cfg.persist_bridge_cache_size as usize;
    next_cfg.persist_bridge_recent.truncate(max_recent);
    let status = if next_cfg.persist_bridge_enabled {
        persist_bridge::sync_all_enabled_mods(&mut next_cfg)?
    } else {
        config::save_config(&next_cfg)?;
        persist_bridge::get_status(&next_cfg)
    };
    *guard = next_cfg.clone();
    drop(guard);
    let _ = app.emit("settings-changed", &next_cfg);
    Ok(status)
}

#[tauri::command]
fn clear_persist_bridge_cache(state: State<'_, AppState>) -> Result<usize, String> {
    let mut guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
    persist_bridge::clear_cache(&mut guard)
}

#[tauri::command]
fn reset_mod_ini(
    app: AppHandle,
    state: State<'_, AppState>,
    character_name: String,
    mod_name: String,
) -> Result<usize, String> {
    let mut guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
    let count = persist_bridge::reset_mod_ini(&mut guard, &character_name, &mod_name)?;
    drop(guard);
    let _ = app.emit("mods-changed", &character_name);
    Ok(count)
}

#[tauri::command]
fn reset_character_ini(
    app: AppHandle,
    state: State<'_, AppState>,
    character_name: String,
) -> Result<usize, String> {
    let mut guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
    let count = persist_bridge::reset_character_ini(&mut guard, &character_name)?;
    drop(guard);
    let _ = app.emit("mods-changed", &character_name);
    Ok(count)
}

#[tauri::command]
fn list_all_mods_catalog(state: State<'_, AppState>) -> Result<Vec<CharacterModsCatalog>, String> {
    let guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
    presets::list_all_mods_catalog(&guard)
}

#[tauri::command]
fn list_presets(state: State<'_, AppState>) -> Result<PresetListResponse, String> {
    let guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
    presets::list_presets(&guard)
}

#[tauri::command]
fn create_preset(
    app: AppHandle,
    state: State<'_, AppState>,
    name: String,
    description: String,
    mods: Option<Vec<PresetModEntry>>,
    snapshot_current: bool,
) -> Result<ModPreset, String> {
    let guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
    let created = presets::create_preset(&guard, &name, &description, mods, snapshot_current)?;
    drop(guard);
    let _ = app.emit("presets-changed", ());
    Ok(created)
}

#[tauri::command]
fn update_preset(
    app: AppHandle,
    id: String,
    name: String,
    description: String,
    mods: Option<Vec<PresetModEntry>>,
) -> Result<ModPreset, String> {
    let updated = presets::update_preset(&id, &name, &description, mods)?;
    let _ = app.emit("presets-changed", ());
    Ok(updated)
}

#[tauri::command]
fn snapshot_update_preset(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<ModPreset, String> {
    let guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
    let updated = presets::snapshot_update_preset(&guard, &id)?;
    drop(guard);
    let _ = app.emit("presets-changed", ());
    Ok(updated)
}

#[tauri::command]
fn delete_preset(app: AppHandle, id: String) -> Result<(), String> {
    presets::delete_preset(&id)?;
    let _ = app.emit("presets-changed", ());
    Ok(())
}

#[tauri::command]
fn apply_preset(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    force_allow_multiple_rabbit_fx: bool,
) -> Result<ApplyPresetResult, String> {
    let mut guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
    let res = presets::apply_preset(
        &mut guard,
        &state.undo_stack,
        &id,
        force_allow_multiple_rabbit_fx,
    )?;
    drop(guard);
    if res.success {
        let _ = app.emit("presets-changed", ());
        let _ = app.emit("characters-changed", ());
        let _ = app.emit("mods-changed", "");
        let _ = app.emit("undo-changed", ());
    }
    Ok(res)
}

#[tauri::command]
fn export_presets_file(file_path: String) -> Result<usize, String> {
    presets::export_presets_file(Path::new(&file_path))
}

#[tauri::command]
fn import_presets_file(app: AppHandle, file_path: String) -> Result<PresetImportResult, String> {
    let res = presets::import_presets_file(Path::new(&file_path))?;
    if res.imported_count > 0 {
        let _ = app.emit("presets-changed", ());
    }
    Ok(res)
}

#[tauri::command]
fn get_undo_stack(state: State<'_, AppState>) -> Result<Vec<UndoEntrySummary>, String> {
    let guard = state.undo_stack.lock().map_err(|_| "撤销栈锁异常".to_string())?;
    Ok(guard.summaries())
}

#[tauri::command]
fn undo_last_action(app: AppHandle, state: State<'_, AppState>) -> Result<UndoResult, String> {
    let mut cfg_guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
    let mut undo_guard = state.undo_stack.lock().map_err(|_| "撤销栈锁异常".to_string())?;
    let res = undo_guard.undo_last(&mut cfg_guard)?;
    drop(undo_guard);
    drop(cfg_guard);
    if res.undone {
        let _ = app.emit("characters-changed", ());
        let _ = app.emit("mods-changed", "");
        let _ = app.emit("presets-changed", ());
        let _ = app.emit("undo-changed", ());
    }
    Ok(res)
}

#[tauri::command]
fn get_game_runtime_status() -> GameRuntimeStatus {
    win_input::get_game_runtime_status()
}

#[tauri::command]
fn relaunch_as_admin(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    win_input::relaunch_as_admin()?;
    state.is_quitting.store(true, Ordering::SeqCst);
    let _ = overlay::hide_overlay(&app);
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn send_f10_reload() -> Result<(), String> {
    win_input::send_f10_reload()
}

#[tauri::command]
fn send_mod_hotkey(expr: String) -> Result<(), String> {
    win_input::send_hotkey_expression(&expr)
}

#[tauri::command]
fn get_overlay_state(app: AppHandle) -> OverlayStateSnapshot {
    overlay::snapshot_from_app(&app)
}

#[tauri::command]
async fn show_overlay(app: AppHandle) -> Result<(), String> {
    overlay::show_overlay(&app)
}

#[tauri::command]
fn hide_overlay(app: AppHandle) -> Result<(), String> {
    overlay::hide_overlay(&app)
}

#[tauri::command]
async fn toggle_overlay(app: AppHandle) -> Result<bool, String> {
    overlay::toggle_overlay(&app)
}

#[tauri::command]
fn set_overlay_pinned(app: AppHandle, pinned: bool) -> OverlayStateSnapshot {
    overlay::set_overlay_pinned(&app, pinned)
}

#[tauri::command]
fn set_overlay_scale(app: AppHandle, scale: f64) -> Result<AppConfig, String> {
    overlay::set_overlay_scale(&app, scale)
}

#[tauri::command]
async fn set_overlay_hotkey(app: AppHandle, hotkey: String) -> Result<AppConfig, String> {
    overlay::set_overlay_hotkey(&app, &hotkey)
}

#[tauri::command]
fn get_overlay_hotkey_registered(app: AppHandle) -> bool {
    overlay::configured_hotkey_is_registered(&app)
}

#[tauri::command]
async fn open_overlay_side_panel(
    app: AppHandle,
    mode: String,
    character_name: Option<String>,
    mod_name: Option<String>,
) -> Result<OverlayStateSnapshot, String> {
    overlay::open_side_panel(&app, &mode, character_name, mod_name)
}

#[tauri::command]
fn adjust_overlay_side_width(app: AppHandle, delta: f64) -> OverlayStateSnapshot {
    overlay::adjust_side_detail_width(&app, delta)
}

#[tauri::command]
fn select_overlay_character(
    app: AppHandle,
    character_name: String,
) -> Result<OverlayStateSnapshot, String> {
    overlay::select_overlay_character(&app, character_name)
}

#[tauri::command]
fn focus_main_window_on_mod(
    app: AppHandle,
    character_name: String,
    mod_name: String,
) -> Result<(), String> {
    overlay::focus_main_window_on_mod(&app, character_name, mod_name)
}

#[tauri::command]
async fn analyze_import_sources(
    state: State<'_, AppState>,
    source_paths: Vec<String>,
    locked_character: Option<String>,
) -> Result<ImportAnalysisResponse, String> {
    let cfg = {
        let guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
        guard.clone()
    };
    importer::analyze_import_sources(&cfg, &state.import_sessions, source_paths, locked_character)
}

#[tauri::command]
async fn execute_import_plan(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    plans: Vec<ImportPlanItem>,
) -> Result<ImportExecutionSummary, String> {
    let mut import_cfg = {
        let guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
        guard.clone()
    };
    // This map is an output of installation used to merge only the new entries.
    import_cfg.mod_added_at.clear();
    let initial_recent = import_cfg.persist_bridge_recent.clone();
    let mut summary =
        importer::execute_import_plan(&mut import_cfg, &state.import_sessions, &session_id, plans)?;
    if summary.installed_count == 0 {
        return Ok(summary);
    }

    let warning = {
        let mut latest = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
        if latest.mods_path == import_cfg.mods_path {
            merge_import_config_changes(&mut latest, import_cfg, &initial_recent);
            config::save_config(&latest)
                .err()
                .map(|error| format!("已安装，保存管理器配置失败：{error}"))
        } else {
            Some(format!("已安装到导入开始时的 Mods 目录：{}", import_cfg.mods_path))
        }
    };

    if let Some(warning) = warning {
        for result in &mut summary.results {
            if result.message == importer::INSTALLED_MESSAGE {
                result.message.clone_from(&warning);
            }
        }
    }
    let _ = app.emit("characters-changed", ());
    let _ = app.emit("mods-changed", "");
    Ok(summary)
}

fn merge_import_config_changes(
    latest: &mut AppConfig,
    imported: AppConfig,
    initial_recent: &[String],
) {
    for (name, added_at) in imported.mod_added_at {
        latest.mod_added_at.entry(name)
            .and_modify(|existing| *existing = (*existing).max(added_at))
            .or_insert(added_at);
    }
    if latest.persist_bridge_enabled && imported.persist_bridge_enabled {
        let reactivated: Vec<_> = initial_recent
            .iter()
            .filter(|entry| {
                !imported.persist_bridge_recent.iter().any(|left| left.eq_ignore_ascii_case(entry))
            })
            .collect();
        latest.persist_bridge_recent.retain(|entry| {
            !reactivated.iter().any(|used| used.eq_ignore_ascii_case(entry))
        });
    }
}

#[tauri::command]
fn cleanup_import_session(state: State<'_, AppState>, session_id: String) {
    state.import_sessions.cleanup_session(&session_id);
}

#[tauri::command]
async fn scan_mods_health_and_organize(
    state: State<'_, AppState>,
) -> Result<OrganizeScanReport, String> {
    let cfg = {
        let guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
        guard.clone()
    };
    organizer::scan_mods_health_and_organize(&cfg)
}

#[tauri::command]
fn create_missing_default_characters(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    let guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
    let cnt = organizer::create_missing_default_characters(&guard)?;
    drop(guard);
    if cnt > 0 {
        let _ = app.emit("characters-changed", ());
    }
    Ok(cnt)
}

#[tauri::command]
fn execute_legacy_migrations(
    app: AppHandle,
    state: State<'_, AppState>,
    legacy_names: Vec<String>,
) -> Result<OrganizeApplyResult, String> {
    let guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
    let res = organizer::execute_legacy_migrations(&guard, legacy_names)?;
    drop(guard);
    let _ = app.emit("characters-changed", ());
    let _ = app.emit("mods-changed", "");
    Ok(res)
}

#[tauri::command]
fn execute_organize_actions(
    app: AppHandle,
    state: State<'_, AppState>,
    moves: Vec<(String, String, String)>,
    quarantine_paths: Vec<String>,
) -> Result<OrganizeApplyResult, String> {
    let guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
    let res = organizer::execute_organize_actions(&guard, moves, quarantine_paths)?;
    drop(guard);
    let _ = app.emit("characters-changed", ());
    let _ = app.emit("mods-changed", "");
    Ok(res)
}

#[tauri::command]
fn list_mod_fix_backups(
    state: State<'_, AppState>,
    character_name: String,
    mod_name: String,
) -> Result<Vec<FixBackupEntry>, String> {
    let guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
    fixer::list_mod_fix_backups(&guard, &character_name, &mod_name)
}

#[tauri::command]
fn rollback_mod_fix_backup(
    app: AppHandle,
    state: State<'_, AppState>,
    character_name: String,
    mod_name: String,
    backup_id: String,
) -> Result<usize, String> {
    let mut guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
    let count =
        fixer::rollback_mod_fix_backup(&mut guard, &character_name, &mod_name, &backup_id)?;
    drop(guard);
    let _ = app.emit("mods-changed", &character_name);
    Ok(count)
}

#[tauri::command]
async fn run_mod_fixer(
    app: AppHandle,
    state: State<'_, AppState>,
    scope_kind: String,
    character_name: Option<String>,
    mod_name: Option<String>,
    fixer_exe_path: Option<String>,
) -> Result<FixerRunReport, String> {
    let cfg = {
        let guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
        guard.clone()
    };
    let report = fixer::run_mod_fixer(
        &cfg,
        &scope_kind,
        character_name.as_deref(),
        mod_name.as_deref(),
        fixer_exe_path.as_deref(),
    )?;
    if let Some(exe) = fixer_exe_path.as_deref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
        if exe != cfg.custom_fixer_path {
            let mut guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
            guard.custom_fixer_path = exe.to_string();
            let _ = config::save_config(&guard);
            let cloned = guard.clone();
            drop(guard);
            let _ = app.emit("settings-changed", &cloned);
        }
    }
    let _ = app.emit("mods-changed", character_name.unwrap_or_default());
    Ok(report)
}

#[tauri::command]
async fn run_offline_diagnostics(state: State<'_, AppState>) -> Result<DiagnosticsReport, String> {
    let cfg = {
        let guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
        guard.clone()
    };
    Ok(diagnostics::run_offline_diagnostics(&cfg))
}

#[tauri::command]
fn fix_diagnostic_item(
    app: AppHandle,
    state: State<'_, AppState>,
    check_id: String,
) -> Result<String, String> {
    let mut guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
    let msg = diagnostics::fix_diagnostic_item(&mut guard, &check_id)?;
    drop(guard);
    let _ = app.emit("characters-changed", ());
    let _ = app.emit("mods-changed", "");
    Ok(msg)
}

#[tauri::command]
async fn update_xxmi_or_efmi_package(
    state: State<'_, AppState>,
    target_kind: String,
    source_path: String,
    custom_dest_dir: Option<String>,
) -> Result<PackageUpdateResult, String> {
    let cfg = {
        let guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
        guard.clone()
    };
    diagnostics::update_xxmi_or_efmi_package(
        &cfg,
        &target_kind,
        &source_path,
        custom_dest_dir.as_deref(),
    )
}

#[tauri::command]
fn get_autostart_enabled() -> bool {
    launcher::get_autostart_enabled()
}

#[tauri::command]
fn set_autostart_enabled(enabled: bool) -> Result<(), String> {
    launcher::set_autostart_enabled(enabled)
}

#[tauri::command]
fn export_config_file(state: State<'_, AppState>, file_path: String) -> Result<(), String> {
    let guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
    config::export_config_file(&guard, Path::new(&file_path))
}

#[tauri::command]
fn import_config_file(
    app: AppHandle,
    state: State<'_, AppState>,
    file_path: String,
) -> Result<AppConfig, String> {
    let next = config::import_config_file(Path::new(&file_path))?;
    {
        let mut guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
        *guard = next.clone();
    }
    let _ = app.emit("settings-changed", &next);
    let _ = app.emit("characters-changed", ());
    Ok(next)
}

#[tauri::command]
fn minimize_to_tray(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        win.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn get_app_version() -> String {
    updater::CURRENT_VERSION.to_string()
}

#[tauri::command]
async fn check_for_updates(state: State<'_, AppState>) -> Result<UpdateCheckResult, String> {
    let cfg = {
        let guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
        guard.clone()
    };
    tauri::async_runtime::spawn_blocking(move || updater::check_for_updates(&cfg))
        .await
        .map_err(|e| format!("检查更新任务异常：{e}"))?
}

#[tauri::command]
async fn download_and_apply_update(
    app: AppHandle,
    state: State<'_, AppState>,
    download_url: String,
    expected_sha256: Option<String>,
) -> Result<(), String> {
    let cfg = {
        let guard = state.config.lock().map_err(|_| "配置锁异常".to_string())?;
        guard.clone()
    };
    tauri::async_runtime::spawn_blocking(move || {
        updater::download_and_apply_update(&app, &cfg, &download_url, expected_sha256.as_deref())
    })
    .await
    .map_err(|e| format!("更新安装任务异常：{e}"))?
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    updater::open_external_url(&url)
}

#[tauri::command]
fn quit_app(app: AppHandle, state: State<'_, AppState>) {
    state.is_quitting.store(true, Ordering::SeqCst);
    let _ = overlay::hide_overlay(&app);
    app.exit(0);
}

fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
    let overlay_item = MenuItem::with_id(
        app,
        "toggle_overlay",
        "显示/隐藏局内浮窗 (Alt+F)",
        true,
        None::<&str>,
    )?;
    let quit_item = MenuItem::with_id(app, "quit", "彻底退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &overlay_item, &quit_item])?;

    let mut builder = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("Endfield Mod Manager")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.unminimize();
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
            "toggle_overlay" => {
                overlay::toggle_overlay_in_background(app.clone());
            }
            "quit" => {
                let state = app.state::<AppState>();
                state.is_quitting.store(true, Ordering::SeqCst);
                let _ = overlay::hide_overlay(app);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.unminimize();
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    updater::cleanup_stale_old_exe();
    let initial_config = config::load_config().unwrap_or_default();
    let initial_hotkey = initial_config.overlay_hotkey.clone();
    let mut context = tauri::generate_context!();
    if let Some(data_dir) = config::custom_app_data_dir() {
        let profile = data_dir.join("webview");
        let profile = std::path::absolute(&profile)
            .unwrap_or_else(|err| panic!("无法解析 WebView 数据目录 {}：{err}", profile.display()));
        std::fs::create_dir_all(&profile)
            .unwrap_or_else(|err| panic!("无法创建 WebView 数据目录 {}：{err}", profile.display()));
        context.config_mut().app.app_directories_override = Some(
            AppDirectoriesOverride::Directories(AppDirectoryOverrides {
                local_data: Some(profile),
                ..Default::default()
            }),
        );
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .manage(AppState {
            config: Mutex::new(initial_config),
            undo_stack: Mutex::new(undo::UndoStack::default()),
            overlay: Mutex::new(overlay::OverlayRuntimeState::default()),
            overlay_window_build: Mutex::new(()),
            import_sessions: importer::ImportSessionStore::default(),
            is_quitting: AtomicBool::new(false),
        })
        .register_uri_scheme_protocol("efmm-media", |_ctx, request| {
            fs_ops::handle_media_protocol(&request)
        })
        .setup(move |app| {
            setup_tray(app.handle())?;
            let handle = app.handle().clone();
            let hk = initial_hotkey.clone();
            std::thread::spawn(move || {
                if let Err(err) = overlay::register_overlay_hotkey(&handle, &hk) {
                    eprintln!("{err}");
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            let label = window.label();
            if label == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    let app = window.app_handle();
                    let state = app.state::<AppState>();
                    if state.is_quitting.load(Ordering::SeqCst) {
                        return;
                    }
                    let behavior = state
                        .config
                        .lock()
                        .map(|g| g.close_behavior.clone())
                        .unwrap_or_else(|_| "ask".to_string());
                    match behavior.as_str() {
                        "minimize" => {
                            api.prevent_close();
                            let _ = window.hide();
                        }
                        "quit" => {
                            api.prevent_close();
                            state.is_quitting.store(true, Ordering::SeqCst);
                            let _ = overlay::hide_overlay(app);
                            app.exit(0);
                        }
                        _ => {
                            api.prevent_close();
                            let _ = window.emit("close-requested", ());
                        }
                    }
                }
            } else if label == overlay::OVERLAY_LABEL || label == overlay::SIDE_PANEL_LABEL {
                match event {
                    WindowEvent::Moved(_) if label == overlay::OVERLAY_LABEL => {
                        overlay::sync_side_panel_position(window.app_handle());
                    }
                    WindowEvent::Focused(false) => {
                        overlay::schedule_blur_hide_check(window.app_handle().clone());
                    }
                    WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        let _ = overlay::hide_overlay(window.app_handle());
                    }
                    _ => {}
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            update_config,
            get_preset_count,
            get_tags_pool,
            save_tags_pool,
            auto_detect_paths,
            check_xxmi_consistency,
            launch_game,
            open_path_in_explorer,
            list_characters,
            add_character,
            rename_character,
            delete_character,
            set_character_cover_data,
            set_character_cover_file,
            save_character_order,
            toggle_pin_character,
            list_appearance_sections,
            create_appearance_section,
            update_appearance_section,
            delete_appearance_section,
            list_mods,
            toggle_mod,
            get_mod_details,
            rename_mod,
            delete_mod,
            move_mod_to_character,
            assign_mod_section,
            pin_mod,
            set_mod_marked,
            save_mod_order,
            set_mod_preview_file,
            set_mod_preview_data,
            update_mod_meta,
            get_rabbitfx_status,
            update_mod_hotkey,
            get_persist_bridge_status,
            set_persist_bridge_enabled,
            set_persist_bridge_cache_size,
            clear_persist_bridge_cache,
            reset_mod_ini,
            reset_character_ini,
            list_all_mods_catalog,
            list_presets,
            create_preset,
            update_preset,
            snapshot_update_preset,
            delete_preset,
            apply_preset,
            export_presets_file,
            import_presets_file,
            get_undo_stack,
            undo_last_action,
            get_game_runtime_status,
            relaunch_as_admin,
            send_f10_reload,
            send_mod_hotkey,
            get_overlay_state,
            show_overlay,
            hide_overlay,
            toggle_overlay,
            set_overlay_pinned,
            set_overlay_scale,
            set_overlay_hotkey,
            get_overlay_hotkey_registered,
            open_overlay_side_panel,
            adjust_overlay_side_width,
            select_overlay_character,
            focus_main_window_on_mod,
            analyze_import_sources,
            execute_import_plan,
            cleanup_import_session,
            scan_mods_health_and_organize,
            create_missing_default_characters,
            execute_legacy_migrations,
            execute_organize_actions,
            list_mod_fix_backups,
            rollback_mod_fix_backup,
            run_mod_fixer,
            run_offline_diagnostics,
            fix_diagnostic_item,
            update_xxmi_or_efmi_package,
            get_autostart_enabled,
            set_autostart_enabled,
            export_config_file,
            import_config_file,
            get_app_version,
            check_for_updates,
            download_and_apply_update,
            open_external_url,
            minimize_to_tray,
            quit_app,
        ])
        .run(context)
        .expect("error while running EndfieldModManager");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn make_temp_dir(label: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("efmm_test_{label}_{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn test_import_config_merge_preserves_newer_settings_and_cache_entries() {
        let mut latest = AppConfig {
            custom_accent: "#123456".to_string(),
            persist_bridge_enabled: true,
            mod_added_at: HashMap::from([
                ("佩丽卡/Other Skin".to_string(), 40),
                ("伊冯/Reinstalled Skin".to_string(), 50),
            ]),
            persist_bridge_recent: vec!["new.ini".to_string(), "old.ini".to_string()],
            ..AppConfig::default()
        };
        let imported = AppConfig {
            persist_bridge_enabled: true,
            mod_added_at: HashMap::from([
                ("佩丽卡/Imported Skin".to_string(), 30),
                ("伊冯/Reinstalled Skin".to_string(), 30),
            ]),
            ..AppConfig::default()
        };

        merge_import_config_changes(&mut latest, imported, &["OLD.INI".to_string()]);

        assert_eq!(latest.custom_accent, "#123456");
        assert_eq!(latest.mod_added_at["佩丽卡/Other Skin"], 40);
        assert_eq!(latest.mod_added_at["伊冯/Reinstalled Skin"], 50);
        assert_eq!(latest.mod_added_at["佩丽卡/Imported Skin"], 30);
        assert_eq!(latest.persist_bridge_recent, ["new.ini"]);
    }

    #[test]
    fn test_atomic_config_write_and_backup_recovery() {
        let dir = make_temp_dir("cfg");
        let path = config::config_path_in(&dir);

        let mut cfg = AppConfig::default();
        cfg.mods_path = "D:\\Test\\Mods".to_string();
        config::atomic_write_json(&path, &cfg).unwrap();

        cfg.theme = "endfield-dark".to_string();
        config::atomic_write_json(&path, &cfg).unwrap();

        // Corrupt primary json; loader should recover from .bak
        fs::write(&path, "{corrupt json").unwrap();
        let recovered: AppConfig = config::load_json_with_backup(&path);
        assert_eq!(recovered.mods_path, "D:\\Test\\Mods");

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn test_tags_json_preserves_qaqm_metadata() {
        let dir = make_temp_dir("tags");
        let original = serde_json::json!({
            "qaqm": {
                "appearanceSectionId": "custom:abc",
                "classificationSource": "manual",
                "appearanceAssignedAt": "2026-10-01T00:00:00.000Z"
            },
            "customVendorField": 42
        });
        fs::write(
            dir.join("tags.json"),
            serde_json::to_string_pretty(&original).unwrap(),
        )
        .unwrap();

        let mut tf = mods::read_mod_tags_file(&dir);
        tf.tags.push("泳装".to_string());
        tf.notes = "测试备注".to_string();
        tf.marked = true;
        mods::write_mod_tags_file(&dir, &mut tf).unwrap();

        let re_read: Value =
            serde_json::from_str(&fs::read_to_string(dir.join("tags.json")).unwrap()).unwrap();
        assert_eq!(
            re_read["qaqm"]["appearanceSectionId"].as_str(),
            Some("custom:abc")
        );
        assert_eq!(re_read["customVendorField"].as_i64(), Some(42));
        assert_eq!(re_read["marked"].as_bool(), Some(true));
        assert_eq!(re_read["notes"].as_str(), Some("测试备注"));

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn test_toggle_exclusive_and_rabbitfx_guard() {
        let root = make_temp_dir("toggle");
        let func_dir = root.join("功能");
        let char_dir = root.join("祀");
        fs::create_dir_all(func_dir.join("RabbitFX_v28").join("inner")).unwrap();
        fs::write(
            func_dir.join("RabbitFX_v28").join("inner").join("RabbitFX.ini"),
            "[Constants]",
        )
        .unwrap();
        fs::create_dir_all(func_dir.join("DISABLED_RabbitFX_v29").join("inner")).unwrap();
        fs::write(
            func_dir
                .join("DISABLED_RabbitFX_v29")
                .join("inner")
                .join("RabbitFX.ini"),
            "[Constants]",
        )
        .unwrap();

        fs::create_dir_all(char_dir.join("ModA")).unwrap();
        fs::create_dir_all(char_dir.join("DISABLED_ModB")).unwrap();

        let mut cfg = AppConfig::default();
        cfg.mods_path = root.to_string_lossy().to_string();
        let undo_stack = Mutex::new(undo::UndoStack::default());

        // Exclusive toggle on character disables ModA and enables ModB
        let res = mods::toggle_mod(&mut cfg, &undo_stack, "祀", "ModB", true, true, false).unwrap();
        assert!(res.success);
        assert!(!char_dir.join("ModA").exists());
        assert!(char_dir.join("DISABLED_ModA").is_dir());
        assert!(char_dir.join("ModB").is_dir());

        // Enabling 2nd RabbitFX without force prompts confirmation
        let rfx_prompt =
            mods::toggle_mod(&mut cfg, &undo_stack, "功能", "RabbitFX_v29", true, false, false)
                .unwrap();
        assert!(!rfx_prompt.success);
        assert!(rfx_prompt.requires_rabbit_fx_confirm);
        assert_eq!(rfx_prompt.active_rabbit_fx.len(), 1);

        // With force=true, replaces v28 cleanly
        let rfx_ok =
            mods::toggle_mod(&mut cfg, &undo_stack, "功能", "RabbitFX_v29", true, false, true)
                .unwrap();
        assert!(rfx_ok.success);
        assert!(func_dir.join("DISABLED_RabbitFX_v28").is_dir());
        assert!(func_dir.join("RabbitFX_v29").is_dir());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn test_hotkey_disambiguation_and_hash_conflict() {
        let root = make_temp_dir("ini");
        let mod_a = root.join("ModA");
        let mod_b = root.join("ModB");
        fs::create_dir_all(&mod_a).unwrap();
        fs::create_dir_all(&mod_b).unwrap();

        let ini_a = r#"
[KeyDown]
key = down
$gui_active = 1
[KeyUp]
key = up
$gui_active = 0
[TextureOverrideBody]
hash = 1234abcd
"#;
        let ini_b = r#"
[TextureOverrideAlt]
hash = 1234ABCD
"#;
        let path_a = mod_a.join("mod.ini");
        let path_b = mod_b.join("mod.ini");
        fs::write(&path_a, ini_a).unwrap();
        fs::write(&path_b, ini_b).unwrap();

        let hotkeys = ini_engine::parse_hotkeys_for_mod(&mod_a, &[path_a.clone()], &HashMap::new());
        assert_eq!(hotkeys.len(), 2);
        assert!(hotkeys[0].description.contains("KeyDown"));
        assert!(hotkeys[1].description.contains("KeyUp"));

        let conflicts = ini_engine::detect_conflicts_for_mods(&[
            ("ModA".to_string(), vec![path_a]),
            ("ModB".to_string(), vec![path_b]),
        ]);
        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].hash, "1234abcd");
        assert_eq!(conflicts[0].mods, vec!["ModA", "ModB"]);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn test_readonly_scan_real_efmi_mods_if_present() {
        let real_mods = Path::new(r"D:\MOD\XXMI\EFMI\Mods");
        if !real_mods.is_dir() {
            return;
        }
        let mut cfg = AppConfig::default();
        cfg.mods_path = real_mods.to_string_lossy().to_string();
        cfg.show_all_characters = false;

        let t0 = std::time::Instant::now();
        let chars = characters::list_characters(&cfg, None).unwrap();
        assert!(!chars.is_empty());

        let rfx = ini_engine::get_rabbitfx_status(real_mods);
        assert!(!rfx.all_mods.is_empty());

        if let Some(sample) = chars.iter().find(|c| c.mod_count > 0) {
            let mod_list = mods::list_mods(&cfg, &sample.name).unwrap();
            assert!(!mod_list.mods.is_empty());
        }
        let elapsed_ms = t0.elapsed().as_millis();
        println!("Read-only scan of {} chars completed in {}ms", chars.len(), elapsed_ms);
    }

    #[test]
    fn test_hotkey_ini_writeback_and_backup_sync() {
        let mod_dir = make_temp_dir("hotkey_wb");
        let ini_path = mod_dir.join("mod.ini");
        let bak_path = persist_bridge::backup_path(&ini_path);
        let legacy_bak_path = mod_dir.join("mod.ini.qaqm-persistbak");
        let orig = "[Constants]\r\nglobal $mode = 0\r\n[KeySwitch]\r\nkey = alt k ; comment kept\r\n$mode = 0, 1\r\n";
        fs::write(&ini_path, orig).unwrap();
        fs::write(&bak_path, orig).unwrap();
        fs::write(&legacy_bak_path, orig).unwrap();

        ini_engine::update_hotkey_in_ini(&mod_dir, "mod.ini", "KeySwitch", "Ctrl Shift VK_J").unwrap();

        let new_ini = fs::read_to_string(&ini_path).unwrap();
        let new_bak = fs::read_to_string(&bak_path).unwrap();
        assert!(new_ini.contains("key = Ctrl Shift VK_J ; comment kept"));
        assert!(new_bak.contains("key = Ctrl Shift VK_J ; comment kept"));
        assert!(new_ini.contains("\r\n"));
        assert_eq!(fs::read_to_string(&legacy_bak_path).unwrap(), orig);

        let parsed = ini_engine::parse_hotkeys_for_mod(&mod_dir, &[ini_path], &HashMap::new());
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].keys, vec!["Ctrl", "Shift", "J"]);

        let _ = fs::remove_dir_all(mod_dir);
    }

    #[test]
    fn test_persist_bridge_ten_cycles_lossless() {
        let efmi_root = make_temp_dir("pb_root");
        let mods_root = efmi_root.join("Mods");
        let mod_dir = mods_root.join("祀").join("TestSkin");
        fs::create_dir_all(&mod_dir).unwrap();

        fs::write(
            efmi_root.join("d3dx.ini"),
            "[Include]\r\ninclude_recursive = Mods\r\n",
        )
        .unwrap();

        let original_ini = concat!(
            "namespace = TestSkin\\Master\r\n",
            "[Constants]\r\n",
            "global persist $swap = 0\r\n",
            "global persist $swap_extra = 2\r\n",
            "[KeySwap]\r\n",
            "key = k\r\n",
            "$swap = 0, 1\r\n",
            "$swap_extra = 1, 2\r\n",
            "[Present]\r\n",
            "if $\\TestSkin\\Master\\swap == 1\r\n",
            "endif\r\n"
        );
        let mod_ini = mod_dir.join("mod.ini");
        fs::write(&mod_ini, original_ini).unwrap();

        let sibling_ini = mod_dir.join("sub.ini");
        let original_sub = "[ShaderOverride]\r\nif $\\TestSkin\\Master\\swap == 1\r\nendif\r\n";
        fs::write(&sibling_ini, original_sub).unwrap();

        let mut cfg = AppConfig::default();
        cfg.mods_path = mods_root.to_string_lossy().to_string();

        let hash12 = persist_bridge::compute_ini_hash12(&mods_root, &mod_ini);

        for cycle in 0..10 {
            persist_bridge::ensure_d3dx_include(&efmi_root).unwrap();
            let user_vals = persist_bridge::parse_d3dx_user_values(&efmi_root);
            let state_file = persist_bridge::bridge_ini_file(
                &mods_root,
                &efmi_root,
                &mod_dir,
                &mod_ini,
                &[mod_ini.clone(), sibling_ini.clone()],
                &user_vals,
            )
            .unwrap()
            .unwrap();
            assert_eq!(state_file, format!("efmm_state_{hash12}.ini"));

            persist_bridge::write_bridge_includers(&efmi_root, &[state_file.clone()]).unwrap();

            let rewritten = fs::read_to_string(&mod_ini).unwrap();
            assert!(rewritten.contains(&format!("$\\EFMM\\Persist\\Bridge_{hash12}\\swap")));
            assert!(rewritten.contains(&format!("$\\EFMM\\Persist\\Bridge_{hash12}\\swap_extra")));
            assert!(persist_bridge::backup_path(&mod_ini).is_file());

            // Simulate user toggling in game -> d3dx_user.ini updated
            fs::write(
                efmi_root.join("d3dx_user.ini"),
                format!("[Constants]\r\n$\\efmm\\persist\\bridge_{hash12}\\swap = 1\r\n"),
            )
            .unwrap();

            cfg.persist_bridge_enabled = true;
            persist_bridge::on_mod_disabled(&mut cfg, &mod_dir);
            let cached_state =
                fs::read_to_string(efmi_root.join(persist_bridge::BRIDGE_DIR).join("cache").join(&state_file)).unwrap();
            assert!(cached_state.contains("global persist $swap = 1"));

            persist_bridge::disable_and_restore_all(&mut cfg).unwrap();

            assert_eq!(fs::read(&mod_ini).unwrap(), original_ini.as_bytes(), "cycle {cycle}");
            assert_eq!(
                fs::read(&sibling_ini).unwrap(),
                original_sub.as_bytes(),
                "sibling cycle {cycle}"
            );
        }

        // Verify d3dx.ini only contains single mount even after 10 calls
        let d3dx = fs::read_to_string(efmi_root.join("d3dx.ini")).unwrap();
        assert_eq!(d3dx.matches(persist_bridge::BRIDGE_INCLUDE).count(), 1);

        let _ = fs::remove_dir_all(efmi_root);
    }

    #[test]
    fn test_independent_persist_bridge_preserves_legacy_files_and_user_variables() {
        let efmi_root = make_temp_dir("pb_independent");
        let mods_root = efmi_root.join("Mods");
        let mod_dir = mods_root.join("佩丽卡").join("试装");
        let legacy_dir = efmi_root.join("qaqm");
        fs::create_dir_all(&mod_dir).unwrap();
        fs::create_dir_all(legacy_dir.join("cache")).unwrap();
        let ini = mod_dir.join("mod.ini");
        let external_backup = ini.with_file_name("mod.ini.qaqm-persistbak");
        let original_ini = "namespace = Example\\Native\r\n[Constants]\r\nglobal persist $state = 2\r\n";
        fs::write(&ini, original_ini).unwrap();
        let d3dx = efmi_root.join("d3dx.ini");
        fs::write(&d3dx, b"\xef\xbb\xbf[Include] ; options\r\ninclude = qaqm\\qaqm_includer.ini\r\n; stock \xa1\xaa\r\n").unwrap();
        let old_includer = legacy_dir.join("qaqm_includer.ini");
        let keypress_only = "[IncludeKeypress]\r\ninclude = qaqm_keypress.ini\r\n";
        fs::write(&old_includer, keypress_only).unwrap();
        let old_active = legacy_dir.join("qaqm_persist_active.ini");
        fs::write(&old_active, "[IncludePersistState]\r\ninclude = cache\\qaqm_state_123456abcdef.ini\r\n").unwrap();
        let old_cache = legacy_dir.join("cache").join("qaqm_state_123456abcdef.ini");
        fs::write(&old_cache, b"old state").unwrap();
        let mut cfg = AppConfig {
            mods_path: mods_root.to_string_lossy().into_owned(),
            ..AppConfig::default()
        };

        // An active legacy state manifest stops enabling before any EFMM write.
        let mounted = format!("{keypress_only}\r\n[IncludePersist]\r\ninclude = qaqm_persist_active.ini\r\n");
        fs::write(&old_includer, &mounted).unwrap();
        let d3dx_orig = fs::read(&d3dx).unwrap();
        assert!(persist_bridge::sync_all_enabled_mods(&mut cfg).is_err());
        assert!(!efmi_root.join(persist_bridge::BRIDGE_DIR).exists());
        assert_eq!(fs::read(&d3dx).unwrap(), d3dx_orig);
        assert!(!cfg.persist_bridge_enabled);
        assert!(persist_bridge::get_status(&cfg).legacy_conflict);

        // The persisted enabled flag from a previous version must not activate EFMM implicitly.
        cfg.persist_bridge_enabled = true;
        persist_bridge::on_mod_enabled(&mut cfg, &mod_dir);
        persist_bridge::on_mod_disabled(&mut cfg, &mod_dir);
        assert!(!efmi_root.join(persist_bridge::BRIDGE_DIR).exists());
        assert_eq!(fs::read_to_string(&ini).unwrap(), original_ini);
        cfg.persist_bridge_enabled = false;

        // Keypress-only legacy files are allowed. A legacy INI backup, however, still indicates
        // an unfinished restoration.
        fs::write(&old_includer, keypress_only).unwrap();
        fs::write(&external_backup, b"old backup").unwrap();
        assert!(persist_bridge::sync_all_enabled_mods(&mut cfg).is_err());
        assert_eq!(fs::read(&external_backup).unwrap(), b"old backup");
        fs::remove_file(&external_backup).unwrap();

        let legacy_ini = "[Constants]\r\n$\\QAQM\\Persist\\Bridge_123456abcdef\\state = 6\r\n";
        let disabled_mod = mod_dir.with_file_name("DISABLED_旧状态皮肤");
        fs::create_dir_all(&disabled_mod).unwrap();
        fs::write(disabled_mod.join("old.ini"), legacy_ini).unwrap();
        fs::write(disabled_mod.join("old.ini.qaqm-persistbak"), b"unrestored backup").unwrap();
        let mut snapshots = Vec::new();
        for name in ["_ps_t_draw_fix_backup_20261001_035827", ".efmm-backups"] {
            let snapshot_dir = mod_dir.join(name);
            fs::create_dir_all(&snapshot_dir).unwrap();
            fs::write(snapshot_dir.join("legacy.ini"), legacy_ini).unwrap();
            fs::write(snapshot_dir.join("original.ini"), original_ini).unwrap();
            snapshots.push(snapshot_dir);
        }

        let hash = persist_bridge::compute_ini_hash12(&mods_root, &ini);
        let user_ini = efmi_root.join("d3dx_user.ini");
        let external_entries = format!(
            "[Constants]\r\n$\\qaqm\\persist\\bridge_{hash}\\state = 99\r\n$\\Example\\Native\\state = 7\r\n"
        );
        fs::write(&user_ini, &external_entries).unwrap();
        let status = persist_bridge::sync_all_enabled_mods(&mut cfg).unwrap();
        assert!(status.enabled && status.d3dx_mounted);
        assert!(!status.legacy_conflict);
        assert_eq!(status.active_state_count, 1);
        let cache = efmi_root.join("efmm").join("cache").join(format!("efmm_state_{hash}.ini"));
        assert!(fs::read_to_string(&cache).unwrap().contains("global persist $state = 2"));
        for snapshot in snapshots {
            let original = snapshot.join("original.ini");
            assert_eq!(fs::read_to_string(&original).unwrap(), original_ini);
            assert!(!persist_bridge::backup_path(&original).exists());
            assert_eq!(fs::read_to_string(snapshot.join("legacy.ini")).unwrap(), legacy_ini);
        }

        // Reset cleans only EFMM-owned state, leaving unrelated raw bytes and values intact.
        let file_bytes = format!("{external_entries}$\\efmm\\persist\\bridge_{hash}\\state = 4\r\n");
        fs::write(&user_ini, file_bytes).unwrap();
        assert!(persist_bridge::reset_mod_ini(&mut cfg, "佩丽卡", "试装").unwrap() > 0);
        assert_eq!(fs::read_to_string(&user_ini).unwrap(), external_entries);
        assert!(fs::read_to_string(&cache).unwrap().contains("global persist $state = 2"));
        let status = persist_bridge::disable_and_restore_all(&mut cfg).unwrap();
        assert!(!status.enabled);
        assert_eq!(status.active_state_count, 0);
        assert_eq!(fs::read_to_string(&ini).unwrap(), original_ini);
        assert_eq!(fs::read_to_string(&old_includer).unwrap(), keypress_only);
        assert_eq!(fs::read(&old_cache).unwrap(), b"old state");
        assert_eq!(fs::read_to_string(disabled_mod.join("old.ini")).unwrap(), legacy_ini);
        assert_eq!(fs::read(disabled_mod.join("old.ini.qaqm-persistbak")).unwrap(), b"unrestored backup");
        assert!(fs::read(&d3dx).unwrap().ends_with(b"; stock \xa1\xaa\r\n"));
        let _ = fs::remove_dir_all(efmi_root);
    }

    #[test]
    fn test_presets_apply_rabbitfx_guard_and_undo_rollback() {
        let root = make_temp_dir("presets_undo");
        let char_dir = root.join("伊冯");
        let func_dir = root.join("功能");
        fs::create_dir_all(char_dir.join("SkinA")).unwrap();
        fs::create_dir_all(char_dir.join("DISABLED_SkinB")).unwrap();
        fs::create_dir_all(func_dir.join("DISABLED_RFX1").join("sub")).unwrap();
        fs::create_dir_all(func_dir.join("DISABLED_RFX2").join("sub")).unwrap();
        fs::write(func_dir.join("DISABLED_RFX1").join("sub").join("RabbitFX.ini"), "[Constants]")
            .unwrap();
        fs::write(func_dir.join("DISABLED_RFX2").join("sub").join("RabbitFX.ini"), "[Constants]")
            .unwrap();

        let mut cfg = AppConfig::default();
        cfg.mods_path = root.to_string_lossy().to_string();
        let undo_stack = Mutex::new(undo::UndoStack::default());
        let mut store = models::PresetStore::default();

        // Preset enabling SkinB and BOTH RFX1+RFX2 -> must prompt confirm without mutating disk
        let conflict_preset = presets::create_preset_in(
            &mut store,
            &cfg,
            "DoubleRFX",
            "",
            Some(vec![
                models::PresetModEntry {
                    character_name: "功能".to_string(),
                    mod_name: "RFX1".to_string(),
                    enabled: true,
                },
                models::PresetModEntry {
                    character_name: "功能".to_string(),
                    mod_name: "RFX2".to_string(),
                    enabled: true,
                },
            ]),
            false,
        )
        .unwrap();

        let blocked = presets::apply_preset_with_store(
            &mut store,
            &mut cfg,
            &undo_stack,
            &conflict_preset.id,
            false,
        )
        .unwrap();
        assert!(!blocked.success);
        assert!(blocked.requires_rabbit_fx_confirm);
        assert_eq!(blocked.conflict_rabbit_fx.len(), 2);

        // Safe preset: SkinB + RFX1 (plus a missing mod to verify missing tracking)
        let safe_preset = presets::create_preset_in(
            &mut store,
            &cfg,
            "SafePreset",
            "",
            Some(vec![
                models::PresetModEntry {
                    character_name: "伊冯".to_string(),
                    mod_name: "SkinB".to_string(),
                    enabled: true,
                },
                models::PresetModEntry {
                    character_name: "功能".to_string(),
                    mod_name: "RFX1".to_string(),
                    enabled: true,
                },
                models::PresetModEntry {
                    character_name: "伊冯".to_string(),
                    mod_name: "DeletedMod".to_string(),
                    enabled: true,
                },
            ]),
            false,
        )
        .unwrap();

        let listed = presets::list_presets_in(&store, &cfg);
        let safe_view = listed.presets.iter().find(|p| p.id == safe_preset.id).unwrap();
        assert_eq!(safe_view.missing_count, 1);

        let applied = presets::apply_preset_with_store(
            &mut store,
            &mut cfg,
            &undo_stack,
            &safe_preset.id,
            false,
        )
        .unwrap();
        assert!(applied.success);
        assert!(char_dir.join("DISABLED_SkinA").is_dir());
        assert!(char_dir.join("SkinB").is_dir());
        assert!(func_dir.join("RFX1").is_dir());
        assert_eq!(applied.missing_mods, vec!["伊冯/DeletedMod"]);

        // Builtin __builtin_no_mod__ disables everything
        let nomod = presets::apply_preset_with_store(
            &mut store,
            &mut cfg,
            &undo_stack,
            presets::BUILTIN_NO_MOD_ID,
            false,
        )
        .unwrap();
        assert!(nomod.success);
        assert!(char_dir.join("DISABLED_SkinB").is_dir());
        assert!(func_dir.join("DISABLED_RFX1").is_dir());

        // Undo 1: back to SafePreset
        let u1 = undo_stack.lock().unwrap().undo_last(&mut cfg).unwrap();
        assert!(u1.undone);
        assert!(char_dir.join("SkinB").is_dir());
        assert!(func_dir.join("RFX1").is_dir());

        // Undo 2: back to original state (SkinA only)
        let u2 = undo_stack.lock().unwrap().undo_last(&mut cfg).unwrap();
        assert!(u2.undone);
        assert!(char_dir.join("SkinA").is_dir());
        assert!(char_dir.join("DISABLED_SkinB").is_dir());
        assert!(func_dir.join("DISABLED_RFX1").is_dir());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn test_win_input_hotkey_parser() {
        let combo1 = win_input::parse_3dmigoto_hotkey("NO_SHIFT ALT NO_CTRL VK_UP").unwrap();
        assert_eq!(combo1.modifiers, vec![0x12]);
        assert_eq!(combo1.keys, vec![0x26]);

        let combo2 = win_input::parse_3dmigoto_hotkey("CTRL SHIFT VK_NUMPAD3").unwrap();
        assert_eq!(combo2.modifiers, vec![0x11, 0x10]);
        assert_eq!(combo2.keys, vec![0x63]);

        let combo3 = win_input::parse_3dmigoto_hotkey("NO_MODIFIERS !k").unwrap();
        assert!(combo3.modifiers.is_empty());
        assert_eq!(combo3.keys, vec![b'K' as u16]);

        assert!(win_input::parse_3dmigoto_hotkey("VK_LBUTTON").is_err());
        assert!(win_input::parse_3dmigoto_hotkey("XB_A").is_err());
    }

    #[test]
    fn test_overlay_smart_dock_flip() {
        // Plenty of room on left -> dock left
        let x_left = overlay::compute_side_panel_x(700, 420, 300, 8, 0, 1920);
        assert_eq!(x_left, 392);

        // Near left screen edge -> automatically flip to right side of overlay
        let x_flipped = overlay::compute_side_panel_x(20, 420, 300, 8, 0, 1920);
        assert_eq!(x_flipped, 448);

        // Multi-monitor negative work_left
        let x_sec_flip = overlay::compute_side_panel_x(-1900, 420, 260, 8, -1920, 0);
        assert_eq!(x_sec_flip, -1472);
    }

    #[test]
    fn test_zip_gbk_extract_and_disguised_mp4_roundtrip() {
        use std::io::Write;
        let tmp = make_temp_dir("imp_roundtrip");

        // 1) ZIP with GBK encoded Chinese filenames
        let gbk_zip = tmp.join("gbk_mod.zip");
        {
            let file = fs::File::create(&gbk_zip).unwrap();
            let mut zw = zip::ZipWriter::new(file);
            let opts = zip::write::SimpleFileOptions::default();
            let (gbk_bytes, _, _) = encoding_rs::GB18030.encode("佩丽卡测试/mod.ini");
            let entry_name = unsafe { String::from_utf8_unchecked(gbk_bytes.into_owned()) };
            zw.start_file(entry_name, opts).unwrap();
            zw.write_all(b"[Constants]\r\n").unwrap();
            zw.finish().unwrap();
        }
        let gbk_out = tmp.join("gbk_out");
        importer::extract_zip_safe(&gbk_zip, &gbk_out).unwrap();
        assert!(gbk_out.join("佩丽卡测试").join("mod.ini").is_file());

        // 2) QAQManager v2 Disguised MP4 (dummy mp4 header + MAGIC + XOR'd ZIP)
        let inner_zip_bytes = fs::read(&gbk_zip).unwrap();
        let mp4_path = tmp.join("disguised.mp4");
        {
            let mut mf = fs::File::create(&mp4_path).unwrap();
            mf.write_all(b"\x00\x00\x00\x18ftypmp42FAKEVIDEO").unwrap();
            mf.write_all(importer::DISGUISE_MAGIC).unwrap();
            let xored: Vec<u8> = inner_zip_bytes
                .iter()
                .enumerate()
                .map(|(i, b)| b ^ importer::DISGUISE_XOR_KEY[i & 15])
                .collect();
            mf.write_all(&xored).unwrap();
        }
        assert!(importer::is_disguised_mp4(&mp4_path));

        let mods_root = tmp.join("EFMI").join("Mods");
        fs::create_dir_all(&mods_root).unwrap();
        let mut cfg = AppConfig::default();
        cfg.mods_path = mods_root.to_string_lossy().to_string();
        let store = importer::ImportSessionStore::default();

        let analysis = importer::analyze_import_sources(
            &cfg,
            &store,
            vec![mp4_path.to_string_lossy().to_string()],
            None,
        )
        .unwrap();
        assert_eq!(analysis.items.len(), 1);
        assert!(analysis.items[0].is_disguised_mp4);
        assert_eq!(analysis.items[0].suggested_character.as_deref(), Some("佩丽卡"));

        let summary = importer::execute_import_plan(
            &mut cfg,
            &store,
            &analysis.session_id,
            vec![models::ImportPlanItem {
                item_id: analysis.items[0].item_id.clone(),
                target_character: "佩丽卡".to_string(),
                target_mod_name: "佩丽卡测试".to_string(),
                target_section_id: "base".to_string(),
                import_kind: "single".to_string(),
                skip: false,
            }],
        )
        .unwrap();
        assert_eq!(summary.installed_count, 1);
        assert!(mods_root.join("佩丽卡").join("佩丽卡测试").join("mod.ini").is_file());

        let _ = fs::remove_dir_all(tmp);
    }

    #[test]
    fn test_organizer_legacy_migration_and_dirty_scan() {
        let root = make_temp_dir("organizer");
        let mods_root = root.join("Mods");
        fs::create_dir_all(mods_root.join("Laevatain").join("FlameOutfit")).unwrap();
        fs::create_dir_all(mods_root.join("伊冯").join("Chen_Misplaced")).unwrap();
        fs::create_dir_all(mods_root.join("伊冯").join("Textures")).unwrap();
        fs::write(mods_root.join("stray.zip"), b"junk").unwrap();

        let mut cfg = AppConfig::default();
        cfg.mods_path = mods_root.to_string_lossy().to_string();

        let report = organizer::scan_mods_health_and_organize(&cfg).unwrap();
        assert_eq!(report.legacy_migrations.len(), 1);
        assert_eq!(report.legacy_migrations[0].target_name, "莱万汀");
        assert!(report
            .misplaced_mods
            .iter()
            .any(|m| m.mod_name == "Chen_Misplaced" && m.suggested_character == "陈千语"));
        assert!(report.dirty_items.iter().any(|d| d.kind == "root_file"));
        assert!(report.dirty_items.iter().any(|d| d.kind == "loose_resource_dir"));

        let mig_res =
            organizer::execute_legacy_migrations(&cfg, vec!["Laevatain".to_string()]).unwrap();
        assert_eq!(mig_res.moved_count, 1);
        assert!(mods_root.join("莱万汀").join("FlameOutfit").is_dir());
        assert!(!mods_root.join("Laevatain").exists());

        let dirty_paths: Vec<String> = report.dirty_items.iter().map(|d| d.path.clone()).collect();
        let org_res = organizer::execute_organize_actions(
            &cfg,
            vec![(
                "伊冯".to_string(),
                "Chen_Misplaced".to_string(),
                "陈千语".to_string(),
            )],
            dirty_paths,
        )
        .unwrap();
        assert_eq!(org_res.moved_count, 1);
        assert_eq!(org_res.quarantined_count, 2);
        assert!(mods_root.join("陈千语").join("Chen_Misplaced").is_dir());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn test_fixer_timestamp_backup_rollback_and_diagnostics() {
        let efmi_root = make_temp_dir("fix_diag");
        let mods_root = efmi_root.join("Mods");
        let mod_dir = mods_root.join("伊冯").join("SkinOne");
        let func_rfx1 = mods_root.join("功能").join("RFX1");
        let func_rfx2 = mods_root.join("功能").join("RFX2");
        fs::create_dir_all(&mod_dir).unwrap();
        fs::create_dir_all(&func_rfx1).unwrap();
        fs::create_dir_all(&func_rfx2).unwrap();

        fs::write(efmi_root.join("d3dx.ini"), "[Include]\r\n").unwrap();
        let orig_ini = "\u{FEFF}[Constants]   \r\n\r\n\r\n\r\nglobal $x = 1   \r\n";
        fs::write(mod_dir.join("mod.ini"), orig_ini).unwrap();
        fs::write(func_rfx1.join("RabbitFX.ini"), "[Constants]\r\n").unwrap();
        fs::write(func_rfx2.join("RabbitFX.ini"), "[Constants]\r\n").unwrap();
        fs::write(mod_dir.join("compiled.bin"), b"EFF").unwrap();

        let mut cfg = AppConfig::default();
        cfg.mods_path = mods_root.to_string_lossy().to_string();

        // Diagnostics catches missing d3dx rules, double RabbitFX, and EFF mod
        let diag = diagnostics::run_offline_diagnostics(&cfg);
        assert!(diag.checks.iter().any(|c| c.id == "d3dx_include" && c.status == "error"));
        assert!(diag
            .checks
            .iter()
            .any(|c| c.id == "rabbitfx_singleton" && c.status == "error"));
        assert!(diag.checks.iter().any(|c| c.id == "eff_misplaced" && c.status == "warn"));

        // Auto-fix d3dx_include and keypress
        diagnostics::fix_diagnostic_item(&mut cfg, "d3dx_include").unwrap();
        diagnostics::fix_diagnostic_item(&mut cfg, "persist_bridge_health").unwrap();
        let diag_after = diagnostics::run_offline_diagnostics(&cfg);
        assert!(diag_after
            .checks
            .iter()
            .any(|c| c.id == "d3dx_include" && c.status == "ok"));

        // Builtin fixer creates timestamp backup, cleans BOM & blank lines, and rolls back cleanly
        let fix_rep = fixer::run_mod_fixer(
            &cfg,
            "mod",
            Some("伊冯"),
            Some("SkinOne"),
            None,
        )
        .unwrap();
        assert_eq!(fix_rep.backup_count, 1);
        assert_eq!(fix_rep.modified_files, 1);

        let baks = fixer::list_mod_fix_backups(&cfg, "伊冯", "SkinOne").unwrap();
        assert_eq!(baks.len(), 1);
        let restored = fixer::rollback_mod_fix_backup(&mut cfg, "伊冯", "SkinOne", &baks[0].id).unwrap();
        assert_eq!(restored, 1);
        assert_eq!(fs::read_to_string(mod_dir.join("mod.ini")).unwrap(), orig_ini);

        let _ = fs::remove_dir_all(efmi_root);
    }

    #[test]
    fn test_case_only_rename_assign_preserve_and_organizer_self_skip() {
        let root = make_temp_dir("bugfixes");
        let mods_root = root.join("Mods");
        let src_mod = mods_root.join("伊冯").join("SkinLower");
        fs::create_dir_all(&src_mod).unwrap();
        fs::create_dir_all(mods_root.join("佩丽卡")).unwrap();
        fs::write(
            src_mod.join("tags.json"),
            r#"{"qaqm":{"appearanceSectionId":"base","customField":"keep-me"},"tags":["测试"]}"#,
        )
        .unwrap();

        let mut cfg = AppConfig::default();
        cfg.mods_path = mods_root.to_string_lossy().to_string();

        // 1. Case-only rename works on case-insensitive NTFS
        mods::rename_mod(&mut cfg, "伊冯", "SkinLower", "skinlower").unwrap();
        let renamed_dir = mods_root.join("伊冯").join("skinlower");
        assert!(renamed_dir.is_dir());

        // 2. assign_mod_section preserves existing qaqm keys
        mods::assign_mod_section(&cfg, "伊冯", "skinlower", "sec_custom").unwrap();
        let raw_tags = fs::read_to_string(renamed_dir.join("tags.json")).unwrap();
        let val: Value = serde_json::from_str(&raw_tags).unwrap();
        assert_eq!(val["qaqm"]["appearanceSectionId"].as_str(), Some("sec_custom"));
        assert_eq!(val["qaqm"]["customField"].as_str(), Some("keep-me"));

        // 3. Organizer self-move (source == target) does not rename to "skinlower (2)"
        let org_res = organizer::execute_organize_actions(
            &cfg,
            vec![("伊冯".to_string(), "skinlower".to_string(), "伊冯".to_string())],
            vec![],
        )
        .unwrap();
        assert_eq!(org_res.moved_count, 0);
        assert!(renamed_dir.is_dir());
        assert!(!mods_root.join("伊冯").join("skinlower (2)").exists());

        // 4. Moving mod across characters migrates modAddedAt and presets
        cfg.mod_added_at.insert("伊冯/skinlower".to_string(), 123456);
        let mut store = config::load_presets().unwrap();
        let unique_name = format!(
            "移动联动测试_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        presets::create_preset_in(
            &mut store,
            &cfg,
            &unique_name,
            "",
            Some(vec![PresetModEntry {
                character_name: "伊冯".to_string(),
                mod_name: "skinlower".to_string(),
                enabled: true,
            }]),
            false,
        )
        .unwrap();
        config::save_presets(&store).unwrap();
        mods::move_mod_to_character(&mut cfg, "伊冯", "skinlower", "佩丽卡").unwrap();
        assert!(cfg.mod_added_at.contains_key("佩丽卡/skinlower"));
        assert!(!cfg.mod_added_at.contains_key("伊冯/skinlower"));
        let store = config::load_presets().unwrap();
        let moved_preset = store.presets.iter().find(|p| p.name == unique_name).unwrap();
        assert_eq!(moved_preset.mods[0].character_name, "佩丽卡");

        let _ = fs::remove_dir_all(root);
    }
}
