use crate::characters::{is_non_character_category, now_iso_utc};
use crate::config::{load_presets, save_presets};
use crate::fs_ops::assert_safe_segment;
use crate::ini_engine::{collect_ini_files, scan_mod_flags};
use crate::models::{
    AppConfig, ApplyPresetResult, CatalogModEntry, CharacterModsCatalog, ModPreset,
    PresetImportResult, PresetItemView, PresetListResponse, PresetModEntry, PresetStore,
    RabbitFxModEntry,
};
use crate::mods::{apply_mod_state_changes, ModStateChange};
use crate::undo::UndoStack;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

pub const BUILTIN_NO_MOD_ID: &str = "__builtin_no_mod__";

struct DiskModInfo {
    character_name: String,
    mod_name: String,
    dir_name: String,
    path: PathBuf,
    enabled: bool,
    is_rabbit_fx: bool,
}

fn scan_disk_mods(mods_root: &Path) -> Vec<DiskModInfo> {
    let mut out = Vec::new();
    if !mods_root.is_dir() {
        return out;
    }
    let Ok(chars) = fs::read_dir(mods_root) else {
        return out;
    };
    for c_entry in chars.flatten() {
        if !c_entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let cname = c_entry.file_name().to_string_lossy().to_string();
        if cname.starts_with('.') {
            continue;
        }
        let Ok(mods) = fs::read_dir(c_entry.path()) else {
            continue;
        };
        for m_entry in mods.flatten() {
            if !m_entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            let dir_name = m_entry.file_name().to_string_lossy().to_string();
            if dir_name.starts_with('.') {
                continue;
            }
            let enabled = !dir_name.to_ascii_uppercase().starts_with("DISABLED_");
            let mod_name = if enabled {
                dir_name.clone()
            } else {
                dir_name[9..].to_string()
            };
            let ini_files = collect_ini_files(&m_entry.path());
            let (is_rabbit_fx, _, _) = scan_mod_flags(&m_entry.path(), &ini_files);
            out.push(DiskModInfo {
                character_name: cname.clone(),
                mod_name,
                dir_name,
                path: m_entry.path(),
                enabled,
                is_rabbit_fx,
            });
        }
    }
    out
}

pub fn list_all_mods_catalog(cfg: &AppConfig) -> Result<Vec<CharacterModsCatalog>, String> {
    let mods_root = Path::new(&cfg.mods_path);
    if cfg.mods_path.trim().is_empty() || !mods_root.is_dir() {
        return Ok(Vec::new());
    }
    let disk_mods = scan_disk_mods(mods_root);
    let mut grouped: HashMap<String, Vec<CatalogModEntry>> = HashMap::new();
    for m in disk_mods {
        grouped
            .entry(m.character_name)
            .or_default()
            .push(CatalogModEntry {
                name: m.mod_name,
                enabled: m.enabled,
                is_rabbit_fx: m.is_rabbit_fx,
            });
    }

    let order_pos: HashMap<&str, usize> = cfg
        .character_order
        .iter()
        .enumerate()
        .map(|(i, n)| (n.as_str(), i))
        .collect();

    let mut out: Vec<CharacterModsCatalog> = grouped
        .into_iter()
        .map(|(character_name, mut mods)| {
            mods.sort_by(|a, b| a.name.cmp(&b.name));
            CharacterModsCatalog {
                is_non_character_category: is_non_character_category(&character_name),
                character_name,
                mods,
            }
        })
        .collect();

    out.sort_by(|a, b| {
        let ao = order_pos.get(a.character_name.as_str()).copied().unwrap_or(usize::MAX);
        let bo = order_pos.get(b.character_name.as_str()).copied().unwrap_or(usize::MAX);
        ao.cmp(&bo).then_with(|| a.character_name.cmp(&b.character_name))
    });
    Ok(out)
}

pub fn list_presets_in(store: &PresetStore, cfg: &AppConfig) -> PresetListResponse {
    let mods_root = Path::new(&cfg.mods_path);
    let library_available = !cfg.mods_path.trim().is_empty() && fs::read_dir(mods_root).is_ok();
    let disk_mods = scan_disk_mods(mods_root);
    let disk_map: HashMap<(&str, &str), &DiskModInfo> = disk_mods
        .iter()
        .map(|m| ((m.character_name.as_str(), m.mod_name.as_str()), m))
        .collect();
    let enabled: HashSet<_> = disk_mods
        .iter()
        .filter(|m| m.enabled)
        .map(|m| (m.character_name.as_str(), m.mod_name.as_str()))
        .collect();
    let builtin_no_mod_active = library_available && enabled.is_empty();
    let active_preset_id = store
        .active_preset_id
        .as_ref()
        .filter(|id| {
            if !library_available {
                return false;
            }
            if id.as_str() == BUILTIN_NO_MOD_ID {
                return builtin_no_mod_active;
            }
            store
                .presets
                .iter()
                .find(|p| &p.id == *id)
                .is_some_and(|preset| {
                    let installed_targets: HashSet<_> = preset
                        .mods
                        .iter()
                        .filter(|entry| entry.enabled)
                        .map(|entry| (entry.character_name.as_str(), entry.mod_name.as_str()))
                        .filter(|key| disk_map.contains_key(key))
                        .collect();
                    installed_targets == enabled
                })
        })
        .cloned();

    let presets = store
        .presets
        .iter()
        .map(|p| {
            let mut chars = HashSet::new();
            let mut missing_keys = Vec::new();
            let mut rabbit_fx_count = 0usize;

            for entry in &p.mods {
                if !entry.enabled {
                    continue;
                }
                chars.insert(entry.character_name.clone());
                let key = (entry.character_name.as_str(), entry.mod_name.as_str());
                if let Some(dm) = disk_map.get(&key) {
                    if dm.is_rabbit_fx {
                        rabbit_fx_count += 1;
                    }
                } else {
                    missing_keys.push(format!("{}/{}", entry.character_name, entry.mod_name));
                }
            }

            PresetItemView {
                id: p.id.clone(),
                name: p.name.clone(),
                description: p.description.clone(),
                mods: p.mods.clone(),
                created_at: p.created_at.clone(),
                updated_at: p.updated_at.clone(),
                mod_count: p.mods.iter().filter(|m| m.enabled).count(),
                character_count: chars.len(),
                missing_count: missing_keys.len(),
                missing_keys,
                rabbit_fx_count,
            }
        })
        .collect();

    PresetListResponse {
        active_preset_id,
        builtin_no_mod_active,
        presets,
    }
}

pub fn list_presets(cfg: &AppConfig) -> Result<PresetListResponse, String> {
    let store = load_presets()?;
    Ok(list_presets_in(&store, cfg))
}

pub fn create_preset_in(
    store: &mut PresetStore,
    cfg: &AppConfig,
    name: &str,
    description: &str,
    mods: Option<Vec<PresetModEntry>>,
    snapshot_current: bool,
) -> Result<ModPreset, String> {
    let clean_name = name.trim();
    if clean_name.is_empty() {
        return Err("预设名称不能为空".to_string());
    }

    let entries = if let Some(explicit) = mods {
        explicit
    } else if snapshot_current {
        scan_disk_mods(Path::new(&cfg.mods_path))
            .into_iter()
            .filter(|m| m.enabled)
            .map(|m| PresetModEntry {
                character_name: m.character_name,
                mod_name: m.mod_name,
                enabled: true,
            })
            .collect()
    } else {
        Vec::new()
    };

    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let now = now_iso_utc();
    let preset = ModPreset {
        id: format!("preset_{nanos}"),
        name: clean_name.to_string(),
        description: description.trim().to_string(),
        mods: entries,
        created_at: now.clone(),
        updated_at: now,
    };
    store.presets.push(preset.clone());
    Ok(preset)
}

pub fn create_preset(
    cfg: &AppConfig,
    name: &str,
    description: &str,
    mods: Option<Vec<PresetModEntry>>,
    snapshot_current: bool,
) -> Result<ModPreset, String> {
    let mut store = load_presets()?;
    let preset = create_preset_in(&mut store, cfg, name, description, mods, snapshot_current)?;
    save_presets(&store)?;
    Ok(preset)
}

pub fn update_preset(
    id: &str,
    name: &str,
    description: &str,
    mods: Option<Vec<PresetModEntry>>,
) -> Result<ModPreset, String> {
    let clean_name = name.trim();
    if clean_name.is_empty() {
        return Err("预设名称不能为空".to_string());
    }
    let mut store = load_presets()?;
    let preset = store
        .presets
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or_else(|| "未找到目标预设".to_string())?;
    preset.name = clean_name.to_string();
    preset.description = description.trim().to_string();
    if let Some(m) = mods {
        preset.mods = m;
    }
    preset.updated_at = now_iso_utc();
    let cloned = preset.clone();
    save_presets(&store)?;
    Ok(cloned)
}

pub fn snapshot_update_preset(cfg: &AppConfig, id: &str) -> Result<ModPreset, String> {
    let mut store = load_presets()?;
    let snapshot: Vec<PresetModEntry> = scan_disk_mods(Path::new(&cfg.mods_path))
        .into_iter()
        .filter(|m| m.enabled)
        .map(|m| PresetModEntry {
            character_name: m.character_name,
            mod_name: m.mod_name,
            enabled: true,
        })
        .collect();
    let preset = store
        .presets
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or_else(|| "未找到目标预设".to_string())?;
    preset.mods = snapshot;
    preset.updated_at = now_iso_utc();
    let cloned = preset.clone();
    save_presets(&store)?;
    Ok(cloned)
}

pub fn delete_preset(id: &str) -> Result<(), String> {
    if id == BUILTIN_NO_MOD_ID {
        return Err("不能删除内置系统预设".to_string());
    }
    let mut store = load_presets()?;
    let prev_len = store.presets.len();
    store.presets.retain(|p| p.id != id);
    if store.presets.len() == prev_len {
        return Err("未找到目标预设".to_string());
    }
    if store.active_preset_id.as_deref() == Some(id) {
        store.active_preset_id = None;
    }
    save_presets(&store)
}

pub fn apply_preset_with_store(
    store: &mut PresetStore,
    cfg: &mut AppConfig,
    undo_stack: &Mutex<UndoStack>,
    id: &str,
    force_allow_multiple_rabbit_fx: bool,
) -> Result<ApplyPresetResult, String> {
    apply_preset_transaction(
        store,
        cfg,
        undo_stack,
        id,
        force_allow_multiple_rabbit_fx,
        |_| Ok(()),
    )
}

fn apply_preset_transaction(
    store: &mut PresetStore,
    cfg: &mut AppConfig,
    undo_stack: &Mutex<UndoStack>,
    id: &str,
    force_allow_multiple_rabbit_fx: bool,
    save_store: impl FnOnce(&PresetStore) -> Result<(), String>,
) -> Result<ApplyPresetResult, String> {
    let mods_root = Path::new(&cfg.mods_path).to_path_buf();
    if cfg.mods_path.trim().is_empty() || !mods_root.is_dir() {
        return Err("Mods 目录未配置或不存在".to_string());
    }

    let prev_active_id = store.active_preset_id.clone();
    let disk_mods = scan_disk_mods(&mods_root);
    let disk_lookup: HashMap<(String, String), usize> = disk_mods
        .iter()
        .enumerate()
        .map(|(idx, m)| ((m.character_name.clone(), m.mod_name.clone()), idx))
        .collect();

    let (label, target_enabled_set, missing_mods) = if id == BUILTIN_NO_MOD_ID {
        ("应用预设：无 Mod / 纯净恢复".to_string(), HashSet::new(), Vec::new())
    } else {
        let preset = store
            .presets
            .iter()
            .find(|p| p.id == id)
            .ok_or_else(|| "未找到目标预设".to_string())?;
        let mut target_set = HashSet::new();
        let mut missing = Vec::new();
        for entry in &preset.mods {
            if !entry.enabled {
                continue;
            }
            let key = (entry.character_name.clone(), entry.mod_name.clone());
            if disk_lookup.contains_key(&key) {
                target_set.insert(key);
            } else {
                missing.push(format!("{}/{}", entry.character_name, entry.mod_name));
            }
        }
        (format!("应用预设：{}", preset.name), target_set, missing)
    };

    // RabbitFX conflict check before touching disk
    let target_rabbit_fx: Vec<RabbitFxModEntry> = disk_mods
        .iter()
        .filter(|dm| {
            dm.is_rabbit_fx && target_enabled_set.contains(&(dm.character_name.clone(), dm.mod_name.clone()))
        })
        .map(|dm| RabbitFxModEntry {
            character_name: dm.character_name.clone(),
            mod_name: dm.mod_name.clone(),
            dir_name: dm.dir_name.clone(),
            path: dm.path.to_string_lossy().to_string(),
            enabled: dm.enabled,
        })
        .collect();

    if target_rabbit_fx.len() > 1 && !force_allow_multiple_rabbit_fx {
        return Ok(ApplyPresetResult {
            success: false,
            enabled_count: 0,
            disabled_count: 0,
            missing_mods,
            requires_rabbit_fx_confirm: true,
            conflict_rabbit_fx: target_rabbit_fx,
            message: "该预设包含多个同时启用的 RabbitFX，可能导致游戏启动崩溃，请确认是否继续。".to_string(),
        });
    }

    let mut changes = Vec::new();
    for dm in &disk_mods {
        let should_enable =
            target_enabled_set.contains(&(dm.character_name.clone(), dm.mod_name.clone()));
        if dm.enabled != should_enable {
            let character = assert_safe_segment(&dm.character_name, "角色名称")?;
            let mod_name = assert_safe_segment(&dm.mod_name, "Mod 名称")?;
            changes.push(ModStateChange::new(
                dm.path.clone(),
                character,
                mod_name,
                should_enable,
            ));
        }
    }
    changes.sort_by_key(|change| change.delta.new_enabled);
    let enabled_count = changes
        .iter()
        .filter(|change| change.delta.new_enabled)
        .count();
    let disabled_count = changes.len() - enabled_count;

    let mut guard = undo_stack.lock().map_err(|_| "撤销栈锁异常".to_string())?;
    apply_mod_state_changes(cfg, &changes, || {
        store.active_preset_id = Some(id.to_string());
        if let Err(err) = save_store(store) {
            store.active_preset_id.clone_from(&prev_active_id);
            return Err(err);
        }
        Ok(())
    })?;
    let deltas = changes.into_iter().map(|change| change.delta).collect();
    guard.push(&cfg.mods_path, label, deltas, true, prev_active_id);

    Ok(ApplyPresetResult {
        success: true,
        enabled_count,
        disabled_count,
        missing_mods,
        requires_rabbit_fx_confirm: false,
        conflict_rabbit_fx: Vec::new(),
        message: format!("预设已应用：启用 {enabled_count} 个，禁用 {disabled_count} 个"),
    })
}

pub fn apply_preset(
    cfg: &mut AppConfig,
    undo_stack: &Mutex<UndoStack>,
    id: &str,
    force_allow_multiple_rabbit_fx: bool,
) -> Result<ApplyPresetResult, String> {
    let mut store = load_presets()?;
    apply_preset_transaction(
        &mut store,
        cfg,
        undo_stack,
        id,
        force_allow_multiple_rabbit_fx,
        save_presets,
    )
}

#[cfg(test)]
mod transaction_tests {
    use super::*;

    #[test]
    fn disabled_legacy_mod_is_guarded_by_toggle_preset_and_undo() {
        let root = std::env::temp_dir().join(format!("efmm-preset-legacy-{}", std::process::id()));
        let mods = root.join("Mods");
        let character = mods.join("伊冯");
        let clean_disabled = character.join("DISABLED_Clean");
        let clean = character.join("Clean");
        let stale_disabled = character.join("DISABLED_Stale");
        let stale = character.join("Stale");
        fs::create_dir_all(&clean_disabled).unwrap();
        fs::create_dir_all(stale_disabled.join("sub")).unwrap();
        fs::write(
            stale_disabled.join("sub").join("stale.ini"),
            "[Present]\nif $\\QAQM\\Persist\\Bridge_123456abcdef\\state == 1\nendif\n",
        )
        .unwrap();
        let mut cfg = AppConfig {
            mods_path: mods.to_string_lossy().into_owned(),
            ..AppConfig::default()
        };
        let undo_stack = Mutex::new(UndoStack::default());
        let mut store = PresetStore::default();
        let make_entry = |name: &str| PresetModEntry {
            character_name: "伊冯".into(),
            mod_name: name.into(),
            enabled: true,
        };
        let mixed = create_preset_in(
            &mut store,
            &cfg,
            "混合预设",
            "",
            Some(vec![make_entry("Clean"), make_entry("Stale")]),
            false,
        )
        .unwrap();
        let clean_only = create_preset_in(
            &mut store,
            &cfg,
            "干净预设",
            "",
            Some(vec![make_entry("Clean")]),
            false,
        )
        .unwrap();

        let toggle = |cfg: &mut AppConfig, enable| {
            crate::mods::toggle_mod(cfg, &undo_stack, "伊冯", "Stale", enable, false, false)
        };
        assert!(toggle(&mut cfg, true).unwrap_err().contains("stale.ini"));
        let error = apply_preset_transaction(&mut store, &mut cfg, &undo_stack, &mixed.id, false, |_| {
            panic!("预设包含旧桥接残留，禁止写入")
        })
        .unwrap_err();
        assert!(error.contains("stale.ini"));
        assert!(clean_disabled.is_dir() && stale_disabled.is_dir());
        assert!(store.active_preset_id.is_none());
        assert!(undo_stack.lock().unwrap().summaries().is_empty());

        assert!(apply_preset_with_store(&mut store, &mut cfg, &undo_stack, &clean_only.id, false)
            .unwrap()
            .success);
        assert!(clean.is_dir() && stale_disabled.is_dir());

        // A mod already enabled outside the manager can still be disabled, even if undo cannot re-enable it.
        fs::rename(&stale_disabled, &stale).unwrap();
        assert!(toggle(&mut cfg, false).unwrap().success);
        let mut undo = undo_stack.lock().unwrap();
        assert!(undo.undo_last(&mut cfg).unwrap_err().contains("stale.ini"));
        assert!(clean.is_dir() && stale_disabled.is_dir());
        assert_eq!(undo.summaries().len(), 2);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn active_preset_matches_installed_enabled_mods() {
        let root = std::env::temp_dir().join(format!("efmm-preset-active-{}", std::process::id()));
        fs::create_dir(&root).unwrap();
        let character = root.join("伊冯");
        let skin = character.join("SkinA");
        let disabled_skin = character.join("DISABLED_SkinA");
        let extra = character.join("SkinB");
        let disabled_extra = character.join("DISABLED_SkinB");
        fs::create_dir_all(&skin).unwrap();
        fs::create_dir_all(&disabled_extra).unwrap();
        let cfg = AppConfig {
            mods_path: root.to_string_lossy().into_owned(),
            ..AppConfig::default()
        };
        let mut store = PresetStore::default();
        let preset = create_preset_in(
            &mut store,
            &cfg,
            "伊冯",
            "",
            Some(
                ["SkinA", "Missing"]
                    .into_iter()
                    .map(|mod_name| PresetModEntry {
                        character_name: "伊冯".into(),
                        mod_name: mod_name.into(),
                        enabled: true,
                    })
                    .collect(),
            ),
            false,
        )
        .unwrap();
        store.active_preset_id = Some(preset.id.clone());
        let state = list_presets_in(&store, &cfg);
        assert_eq!(state.active_preset_id.as_deref(), Some(preset.id.as_str()));
        assert_eq!(state.presets[0].missing_count, 1);

        fs::rename(&disabled_extra, &extra).unwrap();
        assert_eq!(list_presets_in(&store, &cfg).active_preset_id, None);

        store.active_preset_id = Some(BUILTIN_NO_MOD_ID.into());
        let state = list_presets_in(&store, &cfg);
        assert_eq!(state.active_preset_id, None);
        assert!(!state.builtin_no_mod_active);

        fs::rename(&extra, &disabled_extra).unwrap();
        fs::rename(&skin, &disabled_skin).unwrap();
        let state = list_presets_in(&store, &cfg);
        assert_eq!(state.active_preset_id.as_deref(), Some(BUILTIN_NO_MOD_ID));
        assert!(state.builtin_no_mod_active);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_preset_save_rolls_back_renames_before_updating_bridge_or_history() {
        let root = std::env::temp_dir().join(format!("efmm-preset-{}", std::process::id()));
        fs::create_dir(&root).unwrap();
        let mods = root.join("Mods");
        let character = mods.join("伊冯");
        let enabled = character.join("SkinA");
        let disabled = character.join("DISABLED_SkinA");
        fs::create_dir_all(&enabled).unwrap();
        let mut cfg = AppConfig {
            mods_path: mods.to_string_lossy().into_owned(),
            persist_bridge_enabled: true,
            ..AppConfig::default()
        };
        let mut store = PresetStore {
            active_preset_id: Some("previous".into()),
            ..PresetStore::default()
        };
        let undo_stack = Mutex::new(UndoStack::default());

        let result = apply_preset_transaction(
            &mut store,
            &mut cfg,
            &undo_stack,
            BUILTIN_NO_MOD_ID,
            false,
            |next| {
                assert!(disabled.is_dir());
                assert_eq!(next.active_preset_id.as_deref(), Some(BUILTIN_NO_MOD_ID));
                Err("模拟预设写入失败".into())
            },
        );

        assert_eq!(result.unwrap_err(), "模拟预设写入失败");
        assert!(enabled.is_dir());
        assert!(!disabled.exists());
        assert!(!root.join(crate::persist_bridge::BRIDGE_DIR).exists());
        assert_eq!(store.active_preset_id.as_deref(), Some("previous"));
        assert!(undo_stack.lock().unwrap().summaries().is_empty());
        fs::remove_dir_all(root).unwrap();
    }
}

pub fn export_presets_file(file_path: &Path) -> Result<usize, String> {
    let store = load_presets()?;
    let count = store.presets.len();
    let json = serde_json::to_string_pretty(&store)
        .map_err(|e| format!("序列化预设文件失败：{e}"))?;
    fs::write(file_path, json).map_err(|e| format!("导出预设文件失败：{e}"))?;
    Ok(count)
}

pub fn import_presets_file(file_path: &Path) -> Result<PresetImportResult, String> {
    let raw = fs::read_to_string(file_path).map_err(|e| format!("读取预设文件失败：{e}"))?;
    let val: Value = serde_json::from_str(raw.trim_start_matches('\u{feff}'))
        .map_err(|e| format!("解析预设 JSON 失败：{e}"))?;

    let raw_list = val
        .get("presets")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "请选择从 Endfield Mod Manager 导出的预设 JSON 文件".to_string())?;

    let mut store = load_presets()?;
    let mut existing_ids: HashSet<String> = store.presets.iter().map(|p| p.id.clone()).collect();
    let mut imported_count = 0usize;
    let mut skipped_count = 0usize;

    for item in raw_list {
        let id = item
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let name = item
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if id.is_empty() || name.is_empty() || existing_ids.contains(&id) {
            skipped_count += 1;
            continue;
        }
        let mods = item
            .get("mods")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|m| {
                        let ch = m.get("characterName").and_then(|v| v.as_str())?.to_string();
                        let mn = m.get("modName").and_then(|v| v.as_str())?.to_string();
                        let en = m.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true);
                        Some(PresetModEntry {
                            character_name: ch,
                            mod_name: mn,
                            enabled: en,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        let now = now_iso_utc();
        store.presets.push(ModPreset {
            id: id.clone(),
            name,
            description: item
                .get("description")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            mods,
            created_at: item
                .get("createdAt")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .unwrap_or(&now)
                .to_string(),
            updated_at: item
                .get("updatedAt")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .unwrap_or(&now)
                .to_string(),
        });
        existing_ids.insert(id);
        imported_count += 1;
    }

    if imported_count > 0 {
        save_presets(&store)?;
    }
    Ok(PresetImportResult {
        imported_count,
        skipped_count,
    })
}
