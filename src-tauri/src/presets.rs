use crate::characters::{is_non_character_category, now_iso_utc};
use crate::config::{load_presets, save_config, save_presets};
use crate::fs_ops::{assert_safe_segment, rename_dir_with_retry};
use crate::ini_engine::{collect_ini_files, scan_mod_flags};
use crate::models::{
    AppConfig, ApplyPresetResult, CatalogModEntry, CharacterModsCatalog, ModPreset,
    PresetImportResult, PresetItemView, PresetListResponse, PresetModEntry, PresetStore,
    RabbitFxModEntry, UndoDelta,
};
use crate::persist_bridge;
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
    let disk_mods = scan_disk_mods(Path::new(&cfg.mods_path));
    let any_enabled = disk_mods.iter().any(|m| m.enabled);
    let disk_map: HashMap<(String, String), &DiskModInfo> = disk_mods
        .iter()
        .map(|m| ((m.character_name.clone(), m.mod_name.clone()), m))
        .collect();

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
                let key = (entry.character_name.clone(), entry.mod_name.clone());
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
        active_preset_id: store.active_preset_id.clone(),
        builtin_no_mod_active: !any_enabled,
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

    let mut deltas = Vec::new();
    let mut enabled_count = 0usize;
    let mut disabled_count = 0usize;

    // Disable mods first so clean names don't collide unnecessarily
    for dm in &disk_mods {
        let should_enable =
            target_enabled_set.contains(&(dm.character_name.clone(), dm.mod_name.clone()));
        if dm.enabled && !should_enable {
            let safe_char = assert_safe_segment(&dm.character_name, "角色名称")?;
            let safe_mod = assert_safe_segment(&dm.mod_name, "Mod 名称")?;
            let dst = mods_root.join(&safe_char).join(format!("DISABLED_{safe_mod}"));
            rename_dir_with_retry(&dm.path, &dst)?;
            if cfg.persist_bridge_enabled {
                persist_bridge::on_mod_disabled(cfg, &dst);
            }
            deltas.push(UndoDelta {
                character_name: dm.character_name.clone(),
                mod_name: dm.mod_name.clone(),
                prev_enabled: true,
                new_enabled: false,
            });
            disabled_count += 1;
        }
    }

    for dm in &disk_mods {
        let should_enable =
            target_enabled_set.contains(&(dm.character_name.clone(), dm.mod_name.clone()));
        if !dm.enabled && should_enable {
            let safe_char = assert_safe_segment(&dm.character_name, "角色名称")?;
            let safe_mod = assert_safe_segment(&dm.mod_name, "Mod 名称")?;
            let dst = mods_root.join(&safe_char).join(&safe_mod);
            rename_dir_with_retry(&dm.path, &dst)?;
            if cfg.persist_bridge_enabled {
                persist_bridge::on_mod_enabled(cfg, &dst);
            }
            deltas.push(UndoDelta {
                character_name: dm.character_name.clone(),
                mod_name: dm.mod_name.clone(),
                prev_enabled: false,
                new_enabled: true,
            });
            enabled_count += 1;
        }
    }

    if let Ok(mut guard) = undo_stack.lock() {
        guard.push(label, deltas, true, prev_active_id);
    }

    if cfg.persist_bridge_enabled {
        let _ = save_config(cfg);
    }

    store.active_preset_id = Some(id.to_string());

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
    let res = apply_preset_with_store(
        &mut store,
        cfg,
        undo_stack,
        id,
        force_allow_multiple_rabbit_fx,
    )?;
    if res.success {
        save_presets(&store)?;
    }
    Ok(res)
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

    // Support both EFMM PresetStore `{ presets: [...] }` and QAQManager `{ presetsByGame: { endfield: { presets: [...] } } }`
    let raw_list = val
        .get("presets")
        .and_then(|v| v.as_array())
        .or_else(|| {
            val.get("presetsByGame")
                .and_then(|m| m.get("endfield"))
                .and_then(|g| g.get("presets"))
                .and_then(|v| v.as_array())
        })
        .ok_or_else(|| "无法识别的预设文件格式".to_string())?;

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
