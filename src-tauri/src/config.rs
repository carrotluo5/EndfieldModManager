use crate::models::{AppConfig, AppearanceSectionConfig, PresetModEntry, PresetStore, QaqmImportSummary, TagsPoolStore};
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

pub fn app_data_dir() -> Result<PathBuf, String> {
    if let Some(custom_dir) = std::env::var_os("EFMM_DATA_DIR") {
        let dir = PathBuf::from(custom_dir);
        if !dir.as_os_str().is_empty() {
            if !dir.exists() {
                fs::create_dir_all(&dir).map_err(|e| format!("创建数据目录失败：{e}"))?;
            }
            return Ok(dir);
        }
    }

    #[cfg(test)]
    {
        let dir = std::env::temp_dir().join("efmm_unit_tests_appdata");
        if !dir.exists() {
            fs::create_dir_all(&dir).map_err(|e| format!("创建测试配置目录失败：{e}"))?;
        }
        return Ok(dir);
    }

    #[cfg(not(test))]
    {
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                if exe_dir.join("portable.flag").is_file() || exe_dir.join("data").is_dir() {
                    let portable_dir = exe_dir.join("data");
                    if !portable_dir.exists() {
                        fs::create_dir_all(&portable_dir)
                            .map_err(|e| format!("创建便携数据目录失败：{e}"))?;
                    }
                    return Ok(portable_dir);
                }
            }
        }

        let base = std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os("USERPROFILE")
                    .map(|p| PathBuf::from(p).join("AppData").join("Roaming"))
            })
            .ok_or_else(|| "无法解析 APPDATA 目录".to_string())?;
        let dir = base.join("EndfieldModManager");
        if !dir.exists() {
            fs::create_dir_all(&dir).map_err(|e| format!("创建配置目录失败：{e}"))?;
        }
        Ok(dir)
    }
}

pub fn config_path_in(dir: &Path) -> PathBuf {
    dir.join("config.json")
}

pub fn presets_path_in(dir: &Path) -> PathBuf {
    dir.join("presets.json")
}

pub fn tags_pool_path_in(dir: &Path) -> PathBuf {
    dir.join("tags-pool.json")
}

pub fn atomic_write_json<T: Serialize>(path: &Path, data: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{e}"))?;
        }
    }
    let tmp_path = path.with_extension("json.tmp");
    let bak_path = path.with_extension("json.bak");
    let serialized = serde_json::to_string_pretty(data)
        .map_err(|e| format!("序列化 JSON 失败：{e}"))?;

    fs::write(&tmp_path, serialized.as_bytes())
        .map_err(|e| format!("写入临时配置文件失败：{e}"))?;

    if path.exists() {
        let _ = fs::copy(path, &bak_path);
    }

    if let Err(err) = fs::rename(&tmp_path, path) {
        // Fallback when target already exists and rename cannot overwrite atomically
        if path.exists() {
            let _ = fs::remove_file(path);
        }
        fs::rename(&tmp_path, path).map_err(|_| format!("替换配置文件失败：{err}"))?;
    }
    Ok(())
}

pub fn load_json_with_backup<T: DeserializeOwned + Default>(path: &Path) -> T {
    let try_read = |p: &Path| -> Option<T> {
        let raw = fs::read_to_string(p).ok()?;
        let content = raw.trim_start_matches('\u{feff}');
        if content.trim().is_empty() {
            return None;
        }
        serde_json::from_str::<T>(content).ok()
    };

    if let Some(val) = try_read(path) {
        return val;
    }
    let bak_path = path.with_extension("json.bak");
    if let Some(val) = try_read(&bak_path) {
        return val;
    }
    T::default()
}

pub fn load_config() -> Result<AppConfig, String> {
    let dir = app_data_dir()?;
    Ok(load_json_with_backup(&config_path_in(&dir)))
}

pub fn save_config(cfg: &AppConfig) -> Result<(), String> {
    let dir = app_data_dir()?;
    atomic_write_json(&config_path_in(&dir), cfg)
}

pub fn load_presets() -> Result<PresetStore, String> {
    let dir = app_data_dir()?;
    Ok(load_json_with_backup(&presets_path_in(&dir)))
}

pub fn save_presets(store: &PresetStore) -> Result<(), String> {
    let dir = app_data_dir()?;
    atomic_write_json(&presets_path_in(&dir), store)
}

pub fn load_tags_pool() -> Result<TagsPoolStore, String> {
    let dir = app_data_dir()?;
    Ok(load_json_with_backup(&tags_pool_path_in(&dir)))
}

pub fn save_tags_pool(store: &TagsPoolStore) -> Result<(), String> {
    let dir = app_data_dir()?;
    atomic_write_json(&tags_pool_path_in(&dir), store)
}

fn qaqm_data_dir() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(|p| PathBuf::from(p).join("QAQManager"))
}

pub fn import_from_qaqmanager_dir(
    qaqm_dir: &Path,
    cfg: &mut AppConfig,
    presets: &mut PresetStore,
) -> Result<QaqmImportSummary, String> {
    if !qaqm_dir.exists() {
        return Err(format!("未找到 QAQManager 数据目录：{}", qaqm_dir.display()));
    }
    let mut summary = QaqmImportSummary {
        imported_paths: false,
        imported_order_count: 0,
        imported_preset_count: 0,
        warnings: Vec::new(),
    };

    let q_cfg_path = qaqm_dir.join("config.json");
    if q_cfg_path.is_file() {
        let raw = fs::read_to_string(&q_cfg_path)
            .map_err(|e| format!("读取 QAQManager config.json 失败：{e}"))?;
        let val: Value = serde_json::from_str(&raw)
            .map_err(|e| format!("解析 QAQManager config.json 失败：{e}"))?;

        // Extract Endfield game entry if present in games[]
        let mut endfield_game: Option<&Value> = None;
        if let Some(games) = val.get("games").and_then(|g| g.as_array()) {
            endfield_game = games.iter().find(|g| g.get("id").and_then(|v| v.as_str()) == Some("endfield"));
        }

        let mods_path = endfield_game
            .and_then(|g| g.get("modFolderPath").and_then(|v| v.as_str()))
            .or_else(|| val.get("modsPath").and_then(|v| v.as_str()))
            .unwrap_or("")
            .trim()
            .to_string();
        let game_path = endfield_game
            .and_then(|g| g.get("gamePath").and_then(|v| v.as_str()))
            .or_else(|| val.get("gamePath").and_then(|v| v.as_str()))
            .unwrap_or("")
            .trim()
            .to_string();
        let xxmi_path = endfield_game
            .and_then(|g| g.get("modLoaderPath").and_then(|v| v.as_str()))
            .or_else(|| val.get("xxmiPath").and_then(|v| v.as_str()))
            .or_else(|| val.get("efmiPath").and_then(|v| v.as_str()))
            .unwrap_or("")
            .trim()
            .to_string();

        if !mods_path.is_empty() {
            cfg.mods_path = mods_path;
            summary.imported_paths = true;
        }
        if !game_path.is_empty() {
            cfg.game_path = game_path;
            summary.imported_paths = true;
        }
        if !xxmi_path.is_empty() {
            cfg.xxmi_path = xxmi_path;
            summary.imported_paths = true;
        }

        // Character order
        let order_arr = val
            .get("characterOrdersByGame")
            .and_then(|m| m.get("endfield"))
            .and_then(|v| v.as_array())
            .or_else(|| val.get("characterOrder").and_then(|v| v.as_array()));

        if let Some(arr) = order_arr {
            let order: Vec<String> = arr
                .iter()
                .filter_map(|v| v.as_str().map(|s| s.trim().to_string()))
                .filter(|s| !s.is_empty())
                .collect();
            if !order.is_empty() {
                summary.imported_order_count = order.len();
                cfg.character_order = order;
            }
        }

        // Character sections
        if let Some(sec_obj) = val
            .get("characterSectionsByGame")
            .and_then(|m| m.get("endfield"))
            .and_then(|v| v.as_object())
        {
            for (char_name, list_val) in sec_obj {
                if let Some(items) = list_val.as_array() {
                    let mut out_secs = Vec::new();
                    for item in items {
                        let id = item.get("id").and_then(|v| v.as_str()).unwrap_or("").trim();
                        let name = item.get("name").and_then(|v| v.as_str()).unwrap_or("").trim();
                        if id.is_empty() || name.is_empty() {
                            continue;
                        }
                        out_secs.push(AppearanceSectionConfig {
                            id: id.to_string(),
                            name: name.to_string(),
                            name_en: item.get("nameEn").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                            cover_path: item.get("coverImagePath").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                            created_at: item.get("createdAt").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                            updated_at: item.get("updatedAt").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                        });
                    }
                    if !out_secs.is_empty() {
                        cfg.character_sections.insert(char_name.clone(), out_secs);
                    }
                }
            }
        }

        // modAddedAt["game:endfield"]
        if let Some(added_map) = val
            .get("modAddedAt")
            .and_then(|m| m.get("game:endfield"))
            .and_then(|v| v.as_object())
        {
            for (k, v) in added_map {
                if let Some(ms) = v.as_i64() {
                    cfg.mod_added_at.insert(k.clone(), ms);
                }
            }
        }

        // pinnedMods
        if let Some(pinned_obj) = val.get("pinnedMods").and_then(|v| v.as_object()) {
            let mut merged: HashMap<String, Vec<String>> = cfg.pinned_mods.clone();
            for (char_key, list_val) in pinned_obj {
                if let Some(arr) = list_val.as_array() {
                    let names: Vec<String> = arr
                        .iter()
                        .filter_map(|x| x.as_str().map(|s| s.to_string()))
                        .collect();
                    if !names.is_empty() {
                        merged.insert(char_key.clone(), names);
                    }
                }
            }
            cfg.pinned_mods = merged;
        }

        // Overlay & Persist Bridge tuning
        if let Some(hk) = val.get("overlayHotkey").and_then(|v| v.as_str()) {
            if !hk.trim().is_empty() {
                cfg.overlay_hotkey = hk.trim().to_string();
            }
        }
        if let Some(pb) = val.get("persistBridgeEnabled").and_then(|v| v.as_bool()) {
            cfg.persist_bridge_enabled = pb;
        }
        if let Some(cs) = val.get("persistBridgeCacheSize").and_then(|v| v.as_u64()) {
            cfg.persist_bridge_cache_size = cs.min(30) as u32;
        }
    } else {
        summary.warnings.push("未找到 QAQManager/config.json".to_string());
    }

    let q_presets_path = qaqm_dir.join("presets.json");
    if q_presets_path.is_file() {
        let raw = fs::read_to_string(&q_presets_path)
            .map_err(|e| format!("读取 QAQManager presets.json 失败：{e}"))?;
        let val: Value = serde_json::from_str(&raw)
            .map_err(|e| format!("解析 QAQManager presets.json 失败：{e}"))?;
        if let Some(arr) = val
            .get("presetsByGame")
            .and_then(|m| m.get("endfield"))
            .and_then(|g| g.get("presets"))
            .and_then(|v| v.as_array())
        {
            let existing_ids: std::collections::HashSet<String> =
                presets.presets.iter().map(|p| p.id.clone()).collect();
            for p in arr {
                let id = p.get("id").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
                let name = p.get("name").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
                if id.is_empty() || name.is_empty() || existing_ids.contains(&id) {
                    continue;
                }
                let mods = p
                    .get("mods")
                    .and_then(|v| v.as_array())
                    .map(|list| {
                        list.iter()
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

                presets.presets.push(crate::models::ModPreset {
                    id,
                    name,
                    description: p.get("description").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    mods,
                    created_at: p.get("createdAt").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    updated_at: p.get("updatedAt").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                });
                summary.imported_preset_count += 1;
            }
        }
    }

    Ok(summary)
}

pub fn import_from_default_qaqmanager() -> Result<QaqmImportSummary, String> {
    let qaqm_dir = qaqm_data_dir().ok_or_else(|| "无法定位 APPDATA\\QAQManager 目录".to_string())?;
    let mut cfg = load_config()?;
    let mut presets = load_presets()?;
    let summary = import_from_qaqmanager_dir(&qaqm_dir, &mut cfg, &mut presets)?;
    save_config(&cfg)?;
    save_presets(&presets)?;
    Ok(summary)
}

pub fn export_config_file(cfg: &AppConfig, dest_path: &Path) -> Result<(), String> {
    let serialized =
        serde_json::to_string_pretty(cfg).map_err(|e| format!("序列化配置失败：{e}"))?;
    fs::write(dest_path, serialized).map_err(|e| format!("导出配置文件失败：{e}"))
}

pub fn import_config_file(src_path: &Path) -> Result<AppConfig, String> {
    let raw = fs::read_to_string(src_path).map_err(|e| format!("读取配置文件失败：{e}"))?;
    let cleaned = raw.trim_start_matches('\u{feff}');
    let next_cfg: AppConfig =
        serde_json::from_str(cleaned).map_err(|e| format!("配置文件 JSON 格式无效：{e}"))?;
    save_config(&next_cfg)?;
    Ok(next_cfg)
}
