use crate::characters::{
    aliases_for_character, decode_image_data_url, is_non_character_category, now_iso_utc,
};
use crate::config::{load_presets, save_config, save_presets};
use crate::fs_ops::{
    assert_safe_segment, file_mtime_ms, find_image_in_dir, remove_stale_images_except,
    rename_dir_with_retry, trash_path,
};
use crate::ini_engine::{
    collect_ini_files, detect_conflicts_for_mods, get_rabbitfx_status, has_persist_backup,
    parse_hotkeys_for_mod, scan_mod_flags, update_hotkey_in_ini,
};
use crate::models::{
    AppConfig, ModDetails, ModItem, ModListResponse, ModTagsFile, ToggleModResult, UndoDelta,
};
use crate::persist_bridge;
use crate::undo::UndoStack;
use rayon::prelude::*;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub fn read_mod_tags_file(mod_dir: &Path) -> ModTagsFile {
    let tags_path = mod_dir.join("tags.json");
    let Ok(raw) = fs::read_to_string(&tags_path) else {
        return ModTagsFile::default();
    };
    serde_json::from_str::<ModTagsFile>(raw.trim_start_matches('\u{feff}')).unwrap_or_default()
}

pub fn write_mod_tags_file(mod_dir: &Path, tags_file: &mut ModTagsFile) -> Result<(), String> {
    if tags_file.qaqm.is_none() {
        tags_file.qaqm = Some(serde_json::json!({
            "appearanceSectionId": "base",
            "classificationSource": "base-fallback",
            "appearanceAssignedAt": now_iso_utc(),
        }));
    }
    let tags_path = mod_dir.join("tags.json");
    let serialized = serde_json::to_string_pretty(tags_file)
        .map_err(|e| format!("序列化 tags.json 失败：{e}"))?;
    fs::write(&tags_path, serialized).map_err(|e| format!("写入 tags.json 失败：{e}"))?;
    Ok(())
}

pub fn resolve_mod_dir(
    cfg: &AppConfig,
    character_name: &str,
    mod_name: &str,
) -> Result<(PathBuf, bool), String> {
    let safe_char = assert_safe_segment(character_name, "角色名称")?;
    let safe_mod = assert_safe_segment(mod_name, "Mod 名称")?;
    let mods_root = Path::new(&cfg.mods_path);
    if cfg.mods_path.trim().is_empty() || !mods_root.is_dir() {
        return Err("Mods 文件夹未配置或不存在".to_string());
    }
    let char_dir = mods_root.join(&safe_char);
    if !char_dir.is_dir() {
        return Err(format!("角色文件夹不存在：{safe_char}"));
    }
    let enabled_path = char_dir.join(&safe_mod);
    if enabled_path.is_dir() {
        return Ok((enabled_path, true));
    }
    let disabled_path = char_dir.join(format!("DISABLED_{safe_mod}"));
    if disabled_path.is_dir() {
        return Ok((disabled_path, false));
    }
    Err(format!("找不到 Mod 文件夹：{safe_mod}"))
}

pub fn list_mods(cfg: &AppConfig, character_name: &str) -> Result<ModListResponse, String> {
    let safe_char = assert_safe_segment(character_name, "角色名称")?;
    let mods_root = Path::new(&cfg.mods_path);
    if cfg.mods_path.trim().is_empty() || !mods_root.is_dir() {
        return Err("Mods 文件夹未配置或不存在".to_string());
    }
    let char_dir = mods_root.join(&safe_char);
    if !char_dir.is_dir() {
        return Ok(ModListResponse {
            character_name: safe_char.clone(),
            character_aliases: aliases_for_character(&safe_char),
            mods: Vec::new(),
            conflicts: Vec::new(),
            is_non_character_category: is_non_character_category(&safe_char),
        });
    }

    let valid_section_ids: HashSet<String> = cfg
        .character_sections
        .get(&safe_char)
        .map(|secs| secs.iter().map(|s| s.id.clone()).collect())
        .unwrap_or_default();

    let pinned_list = cfg
        .pinned_mods
        .get(&safe_char)
        .cloned()
        .unwrap_or_default();
    let pinned_pos: HashMap<&str, usize> = pinned_list
        .iter()
        .enumerate()
        .map(|(i, n)| (n.as_str(), i))
        .collect();

    let mod_entries: Vec<(String, PathBuf)> = fs::read_dir(&char_dir)
        .map_err(|e| format!("读取角色目录失败：{e}"))?
        .flatten()
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .filter_map(|e| {
            let dir_name = e.file_name().to_string_lossy().to_string();
            if dir_name.starts_with('.') {
                return None;
            }
            Some((dir_name, e.path()))
        })
        .collect();

    struct ScannedMod {
        item: ModItem,
        ini_files: Vec<PathBuf>,
    }

    let scanned: Vec<ScannedMod> = mod_entries
        .into_par_iter()
        .map(|(dir_name, mod_dir)| {
            let enabled = !dir_name.to_ascii_uppercase().starts_with("DISABLED_");
            let clean_name = if enabled {
                dir_name.clone()
            } else {
                dir_name[9..].to_string()
            };

            let ini_files = collect_ini_files(&mod_dir);
            let (is_rabbit_fx, requires_rabbit_fx, is_eff_mod) =
                scan_mod_flags(&mod_dir, &ini_files);

            let preview = find_image_in_dir(&mod_dir, "preview");
            let tags_file = read_mod_tags_file(&mod_dir);
            let raw_sec = tags_file
                .qaqm
                .as_ref()
                .and_then(|q| q.get("appearanceSectionId"))
                .and_then(|s| s.as_str())
                .unwrap_or("base")
                .to_string();
            let section_id = if valid_section_ids.contains(&raw_sec) {
                raw_sec
            } else {
                "base".to_string()
            };

            let added_key = format!("{safe_char}/{clean_name}");
            let added_at_ms = cfg
                .mod_added_at
                .get(&added_key)
                .copied()
                .unwrap_or_else(|| file_mtime_ms(&mod_dir) as i64);

            let p_idx = pinned_pos.get(clean_name.as_str()).copied();

            ScannedMod {
                item: ModItem {
                    name: clean_name,
                    dir_name,
                    path: mod_dir.to_string_lossy().to_string(),
                    character_name: safe_char.clone(),
                    enabled,
                    pinned: p_idx.is_some(),
                    pinned_index: p_idx,
                    marked: tags_file.marked,
                    preview_path: preview.as_ref().map(|(p, _)| p.to_string_lossy().to_string()),
                    preview_mtime: preview.map(|(_, m)| m).unwrap_or(0),
                    section_id,
                    tags: tags_file.tags,
                    notes: tags_file.notes,
                    added_at_ms,
                    requires_rabbit_fx,
                    is_rabbit_fx,
                    is_eff_mod,
                    has_conflict: false,
                    conflict_with: Vec::new(),
                },
                ini_files,
            }
        })
        .collect();

    let enabled_for_conflicts: Vec<(String, Vec<PathBuf>)> = scanned
        .iter()
        .filter(|s| s.item.enabled)
        .map(|s| (s.item.name.clone(), s.ini_files.clone()))
        .collect();
    let conflicts = detect_conflicts_for_mods(&enabled_for_conflicts);

    let mut conflict_map: HashMap<String, HashSet<String>> = HashMap::new();
    for cg in &conflicts {
        for m in &cg.mods {
            let entry = conflict_map.entry(m.clone()).or_default();
            for other in &cg.mods {
                if other != m {
                    entry.insert(other.clone());
                }
            }
        }
    }

    let order_pos: HashMap<&str, usize> = cfg
        .mod_orders
        .get(&safe_char)
        .map(|v| {
            v.iter()
                .enumerate()
                .map(|(i, n)| (n.as_str(), i))
                .collect()
        })
        .unwrap_or_default();

    let mut mods: Vec<ModItem> = scanned
        .into_iter()
        .map(|mut s| {
            if let Some(others) = conflict_map.get(&s.item.name) {
                s.item.has_conflict = true;
                let mut list: Vec<String> = others.iter().cloned().collect();
                list.sort();
                s.item.conflict_with = list;
            }
            s.item
        })
        .collect();

    mods.sort_by(|a, b| {
        match (a.pinned_index, b.pinned_index) {
            (Some(ai), Some(bi)) => return ai.cmp(&bi),
            (Some(_), None) => return std::cmp::Ordering::Less,
            (None, Some(_)) => return std::cmp::Ordering::Greater,
            (None, None) => {}
        }
        let ao = order_pos.get(a.name.as_str()).copied().unwrap_or(usize::MAX);
        let bo = order_pos.get(b.name.as_str()).copied().unwrap_or(usize::MAX);
        ao.cmp(&bo).then_with(|| a.name.cmp(&b.name))
    });

    Ok(ModListResponse {
        character_name: safe_char.clone(),
        character_aliases: aliases_for_character(&safe_char),
        mods,
        conflicts,
        is_non_character_category: is_non_character_category(&safe_char),
    })
}

pub(crate) struct ModStateChange {
    pub(crate) delta: UndoDelta,
    source: PathBuf,
    target: PathBuf,
}

impl ModStateChange {
    pub(crate) fn new(
        source: PathBuf,
        character_name: String,
        mod_name: String,
        enable: bool,
    ) -> Self {
        let target = if enable {
            source.with_file_name(&mod_name)
        } else {
            source.with_file_name(format!("DISABLED_{mod_name}"))
        };
        Self {
            delta: UndoDelta {
                character_name,
                mod_name,
                prev_enabled: !enable,
                new_enabled: enable,
            },
            source,
            target,
        }
    }
}

pub(crate) fn apply_mod_state_changes(
    cfg: &mut AppConfig,
    changes: &[ModStateChange],
    commit: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    for change in changes {
        if !change.source.is_dir() {
            return Err(format!("源目录不可用：{}", change.source.display()));
        }
        match change.target.try_exists() {
            Ok(false) => {}
            Ok(true) => return Err(format!("目标路径已存在：{}", change.target.display())),
            Err(err) => return Err(format!("无法检查目标路径 {}：{err}", change.target.display())),
        }
        if change.delta.new_enabled {
            persist_bridge::check_mod_enable(cfg, &change.source)?;
        }
    }

    // Keep the bridge untouched until every folder move and the preset save succeed.
    let mut applied = 0;
    let result = changes
        .iter()
        .try_for_each(|change| {
            rename_dir_with_retry(&change.source, &change.target)?;
            applied += 1;
            Ok(())
        })
        .and_then(|()| commit());
    if let Err(err) = result {
        let mut rollback_errors = Vec::new();
        for change in changes[..applied].iter().rev() {
            if let Err(rollback_err) = rename_dir_with_retry(&change.target, &change.source) {
                rollback_errors.push(format!("{}：{rollback_err}", change.source.display()));
            }
        }
        if rollback_errors.is_empty() {
            return Err(err);
        }
        return Err(format!("{err}。以下目录未能恢复：{}", rollback_errors.join("；")));
    }

    if cfg.persist_bridge_enabled && !changes.is_empty() {
        for change in changes {
            if change.delta.new_enabled {
                persist_bridge::on_mod_enabled(cfg, &change.target);
            } else {
                persist_bridge::on_mod_disabled(cfg, &change.target);
            }
        }
        let _ = save_config(cfg);
    }
    Ok(())
}

pub fn toggle_mod(
    cfg: &mut AppConfig,
    undo_stack: &Mutex<UndoStack>,
    character_name: &str,
    mod_name: &str,
    enable: bool,
    exclusive: bool,
    force_replace_rabbit_fx: bool,
) -> Result<ToggleModResult, String> {
    let safe_char = assert_safe_segment(character_name, "角色名称")?;
    let safe_mod = assert_safe_segment(mod_name, "Mod 名称")?;
    let mods_root = Path::new(&cfg.mods_path).to_path_buf();
    let char_dir = mods_root.join(&safe_char);
    if !char_dir.is_dir() {
        return Err(format!("角色目录不存在：{safe_char}"));
    }

    let (current_path, currently_enabled) = resolve_mod_dir(cfg, &safe_char, &safe_mod)?;
    if currently_enabled == enable {
        return Ok(ToggleModResult {
            success: true,
            enabled: enable,
            requires_rabbit_fx_confirm: false,
            active_rabbit_fx: Vec::new(),
            message: None,
        });
    }

    let mut pending_rfx_disable = Vec::new();

    // RabbitFX single-instance crash prevention guard
    if enable {
        let target_inis = collect_ini_files(&current_path);
        let (is_rfx, _, _) = scan_mod_flags(&current_path, &target_inis);
        if is_rfx {
            let rfx_status = get_rabbitfx_status(&mods_root);
            let other_enabled: Vec<_> = rfx_status
                .enabled_mods
                .into_iter()
                .filter(|m| m.character_name != safe_char || m.mod_name != safe_mod)
                .collect();
            if !other_enabled.is_empty() {
                if !force_replace_rabbit_fx {
                    return Ok(ToggleModResult {
                        success: false,
                        enabled: false,
                        requires_rabbit_fx_confirm: true,
                        active_rabbit_fx: other_enabled,
                        message: Some(
                            "全库只允许同时启用 1 个 RabbitFX，继续启用会先自动停用旧版以防游戏崩溃。"
                                .to_string(),
                        ),
                    });
                }
                pending_rfx_disable = other_enabled;
            }
        }
    }

    let mut changes: Vec<_> = pending_rfx_disable
        .into_iter()
        .map(|active| {
            ModStateChange::new(
                PathBuf::from(active.path),
                active.character_name,
                active.mod_name,
                false,
            )
        })
        .collect();

    // Exclusive mode: disable other enabled mods under same character
    if enable && exclusive {
        let entries = fs::read_dir(&char_dir).map_err(|e| format!("读取角色目录失败：{e}"))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("读取 Mod 目录失败：{e}"))?;
            let file_type = entry
                .file_type()
                .map_err(|e| format!("读取 Mod 目录属性失败：{e}"))?;
            if !file_type.is_dir() {
                continue;
            }
            let dir_name = entry.file_name().to_string_lossy().to_string();
            let source = entry.path();
            if dir_name.starts_with('.')
                || dir_name.to_ascii_uppercase().starts_with("DISABLED_")
                || dir_name == safe_mod
                || changes.iter().any(|change| change.source == source)
            {
                continue;
            }
            changes.push(ModStateChange::new(source, safe_char.clone(), dir_name, false));
        }
    }

    changes.push(ModStateChange::new(
        current_path,
        safe_char,
        safe_mod.clone(),
        enable,
    ));
    let mut guard = undo_stack.lock().map_err(|_| "撤销栈锁异常".to_string())?;
    apply_mod_state_changes(cfg, &changes, || Ok(()))?;
    let action_label = if enable {
        format!("启用 Mod：{safe_mod}")
    } else {
        format!("禁用 Mod：{safe_mod}")
    };
    let deltas = changes.into_iter().map(|change| change.delta).collect();
    guard.push(&cfg.mods_path, action_label, deltas, false, None);

    Ok(ToggleModResult {
        success: true,
        enabled: enable,
        requires_rabbit_fx_confirm: false,
        active_rabbit_fx: Vec::new(),
        message: None,
    })
}

#[cfg(test)]
mod state_change_tests {
    use super::*;

    #[test]
    fn blocked_exclusive_toggle_and_undo_preserve_mods_and_history() {
        let root = std::env::temp_dir().join(format!("efmm-toggle-{}", std::process::id()));
        fs::create_dir(&root).unwrap();
        let mods = root.join("Mods");
        let character = mods.join("伊冯");
        let skin_a = character.join("SkinA");
        let disabled_a = character.join("DISABLED_SkinA");
        let skin_b = character.join("SkinB");
        let disabled_b = character.join("DISABLED_SkinB");
        fs::create_dir_all(&skin_a).unwrap();
        fs::create_dir_all(&disabled_b).unwrap();
        fs::write(&skin_b, "occupied").unwrap();
        let mut cfg = AppConfig {
            mods_path: mods.to_string_lossy().into_owned(),
            ..AppConfig::default()
        };
        let undo_stack = Mutex::new(UndoStack::default());

        assert!(toggle_mod(&mut cfg, &undo_stack, "伊冯", "SkinB", true, true, false).is_err());
        assert!(skin_a.is_dir());
        assert!(disabled_b.is_dir());
        assert!(undo_stack.lock().unwrap().summaries().is_empty());

        fs::remove_file(&skin_b).unwrap();
        toggle_mod(&mut cfg, &undo_stack, "伊冯", "SkinB", true, true, false).unwrap();

        let mut undo = undo_stack.lock().unwrap();
        let second_library = root.join("OtherMods");
        let second_skin_b = second_library.join("伊冯").join("SkinB");
        fs::create_dir_all(&second_skin_b).unwrap();
        cfg.mods_path = second_library.to_string_lossy().into_owned();
        assert!(undo.undo_last(&mut cfg).is_err());
        assert!(second_skin_b.is_dir());
        assert_eq!(undo.summaries().len(), 1);

        cfg.mods_path = mods.to_string_lossy().into_owned();
        fs::write(&skin_a, "occupied").unwrap();
        assert!(undo.undo_last(&mut cfg).is_err());
        assert!(skin_b.is_dir());
        assert!(disabled_a.is_dir());
        assert_eq!(undo.summaries().len(), 1);

        fs::remove_file(&skin_a).unwrap();
        assert_eq!(undo.undo_last(&mut cfg).unwrap().reverted_count, 2);
        assert!(skin_a.is_dir());
        assert!(disabled_b.is_dir());
        assert!(undo.summaries().is_empty());
        fs::remove_dir_all(root).unwrap();
    }
}

fn read_readme_in_mod(mod_dir: &Path) -> String {
    const CANDIDATES: [&str; 4] = ["说明.txt", "README.txt", "ReadMe.md", "readme.md"];
    for name in CANDIDATES {
        let p = mod_dir.join(name);
        if p.is_file() {
            if let Ok(bytes) = fs::read(&p) {
                return String::from_utf8_lossy(&bytes).to_string();
            }
        }
    }
    // Check one level inside inner mod folder for ReadMe
    if let Ok(entries) = fs::read_dir(mod_dir) {
        for entry in entries.flatten() {
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                for name in CANDIDATES {
                    let p = entry.path().join(name);
                    if p.is_file() {
                        if let Ok(bytes) = fs::read(&p) {
                            return String::from_utf8_lossy(&bytes).to_string();
                        }
                    }
                }
            }
        }
    }
    String::new()
}

pub fn get_mod_details(
    cfg: &AppConfig,
    character_name: &str,
    mod_name: &str,
) -> Result<ModDetails, String> {
    let list_res = list_mods(cfg, character_name)?;
    let mod_item = list_res
        .mods
        .into_iter()
        .find(|m| m.name == mod_name)
        .ok_or_else(|| format!("未找到 Mod：{mod_name}"))?;

    let mod_dir = PathBuf::from(&mod_item.path);
    let ini_files = collect_ini_files(&mod_dir);
    let tags_file = read_mod_tags_file(&mod_dir);
    let hotkeys = parse_hotkeys_for_mod(&mod_dir, &ini_files, &tags_file.hotkey_aliases);
    let readme_text = read_readme_in_mod(&mod_dir);
    let ini_rel_list = ini_files
        .iter()
        .map(|p| {
            p.strip_prefix(&mod_dir)
                .unwrap_or(p)
                .to_string_lossy()
                .to_string()
        })
        .collect();
    let persist_bak = has_persist_backup(&mod_dir);

    Ok(ModDetails {
        mod_item,
        hotkeys,
        readme_text,
        ini_files: ini_rel_list,
        has_persist_backup: persist_bak,
    })
}

pub fn rename_mod(
    cfg: &mut AppConfig,
    character_name: &str,
    old_name: &str,
    new_name: &str,
) -> Result<(), String> {
    let safe_char = assert_safe_segment(character_name, "角色名称")?;
    let old_safe = assert_safe_segment(old_name, "原 Mod 名称")?;
    let new_safe = assert_safe_segment(new_name, "新 Mod 名称")?;
    if old_safe == new_safe {
        return Ok(());
    }
    let (old_dir, enabled) = resolve_mod_dir(cfg, &safe_char, &old_safe)?;
    let char_dir = old_dir.parent().ok_or_else(|| "无效路径".to_string())?;
    let new_dir_name = if enabled {
        new_safe.clone()
    } else {
        format!("DISABLED_{new_safe}")
    };
    let new_dir = char_dir.join(new_dir_name);
    let same_ci = old_safe.eq_ignore_ascii_case(&new_safe);
    // Prevent renaming over enabled/disabled sibling with same clean name unless case-only rename
    if !same_ci
        && (char_dir.join(&new_safe).exists()
            || char_dir.join(format!("DISABLED_{new_safe}")).exists())
    {
        return Err(format!("同名 Mod「{new_safe}」已存在"));
    }
    rename_dir_with_retry(&old_dir, &new_dir)?;

    if let Some(pinned) = cfg.pinned_mods.get_mut(&safe_char) {
        for item in pinned.iter_mut() {
            if *item == old_safe {
                *item = new_safe.clone();
            }
        }
    }
    if let Some(order) = cfg.mod_orders.get_mut(&safe_char) {
        for item in order.iter_mut() {
            if *item == old_safe {
                *item = new_safe.clone();
            }
        }
    }
    let old_added_key = format!("{safe_char}/{old_safe}");
    if let Some(ms) = cfg.mod_added_at.remove(&old_added_key) {
        cfg.mod_added_at
            .insert(format!("{safe_char}/{new_safe}"), ms);
    }
    save_config(cfg)?;

    if let Ok(mut presets) = load_presets() {
        let mut changed = false;
        for preset in &mut presets.presets {
            for m in &mut preset.mods {
                if m.character_name == safe_char && m.mod_name == old_safe {
                    m.mod_name = new_safe.clone();
                    changed = true;
                }
            }
        }
        if changed {
            let _ = save_presets(&presets);
        }
    }
    Ok(())
}

pub fn delete_mod(
    cfg: &mut AppConfig,
    character_name: &str,
    mod_name: &str,
) -> Result<(), String> {
    let safe_char = assert_safe_segment(character_name, "角色名称")?;
    let safe_mod = assert_safe_segment(mod_name, "Mod 名称")?;
    let (mod_dir, _) = resolve_mod_dir(cfg, &safe_char, &safe_mod)?;
    trash_path(&mod_dir)?;

    if let Some(pinned) = cfg.pinned_mods.get_mut(&safe_char) {
        pinned.retain(|x| x != &safe_mod);
    }
    if let Some(order) = cfg.mod_orders.get_mut(&safe_char) {
        order.retain(|x| x != &safe_mod);
    }
    save_config(cfg)?;
    Ok(())
}

pub fn move_mod_to_character(
    cfg: &mut AppConfig,
    source_char: &str,
    mod_name: &str,
    target_char: &str,
) -> Result<(), String> {
    let src_char = assert_safe_segment(source_char, "源角色")?;
    let dst_char = assert_safe_segment(target_char, "目标角色")?;
    let safe_mod = assert_safe_segment(mod_name, "Mod 名称")?;
    if src_char == dst_char {
        return Err("目标分类与当前分类相同".to_string());
    }
    let (src_dir, enabled) = resolve_mod_dir(cfg, &src_char, &safe_mod)?;
    let mods_root = Path::new(&cfg.mods_path);
    let dst_char_dir = mods_root.join(&dst_char);
    if !dst_char_dir.exists() {
        fs::create_dir_all(&dst_char_dir).map_err(|e| format!("创建目标角色目录失败：{e}"))?;
    }
    let dst_dir_name = if enabled {
        safe_mod.clone()
    } else {
        format!("DISABLED_{safe_mod}")
    };
    if dst_char_dir.join(&safe_mod).exists()
        || dst_char_dir.join(format!("DISABLED_{safe_mod}")).exists()
    {
        return Err(format!("目标分类「{dst_char}」中已存在同名 Mod"));
    }
    let dst_dir = dst_char_dir.join(dst_dir_name);
    rename_dir_with_retry(&src_dir, &dst_dir)?;

    // Reset appearance section back to base on moved mod
    let mut tags_file = read_mod_tags_file(&dst_dir);
    if let Some(serde_json::Value::Object(map)) = tags_file.qaqm.as_mut() {
        map.insert(
            "appearanceSectionId".to_string(),
            serde_json::Value::String("base".to_string()),
        );
    }
    let _ = write_mod_tags_file(&dst_dir, &mut tags_file);

    if let Some(pinned) = cfg.pinned_mods.get_mut(&src_char) {
        pinned.retain(|x| x != &safe_mod);
    }
    if let Some(order) = cfg.mod_orders.get_mut(&src_char) {
        order.retain(|x| x != &safe_mod);
    }
    let old_added_key = format!("{src_char}/{safe_mod}");
    if let Some(ms) = cfg.mod_added_at.remove(&old_added_key) {
        cfg.mod_added_at
            .insert(format!("{dst_char}/{safe_mod}"), ms);
    }
    save_config(cfg)?;

    if let Ok(mut presets) = load_presets() {
        let mut changed = false;
        for preset in &mut presets.presets {
            for m in &mut preset.mods {
                if m.character_name == src_char && m.mod_name == safe_mod {
                    m.character_name = dst_char.clone();
                    changed = true;
                }
            }
        }
        if changed {
            let _ = save_presets(&presets);
        }
    }
    Ok(())
}

pub fn assign_mod_section(
    cfg: &AppConfig,
    character_name: &str,
    mod_name: &str,
    section_id: &str,
) -> Result<(), String> {
    let (mod_dir, _) = resolve_mod_dir(cfg, character_name, mod_name)?;
    let mut tags_file = read_mod_tags_file(&mod_dir);
    let clean_sec = if section_id.trim().is_empty() {
        "base"
    } else {
        section_id.trim()
    };
    let now = now_iso_utc();
    if !matches!(tags_file.qaqm, Some(serde_json::Value::Object(_))) {
        tags_file.qaqm = Some(serde_json::json!({}));
    }
    if let Some(serde_json::Value::Object(map)) = tags_file.qaqm.as_mut() {
        map.insert(
            "appearanceSectionId".to_string(),
            serde_json::Value::String(clean_sec.to_string()),
        );
        map.insert(
            "classificationSource".to_string(),
            serde_json::Value::String("manual".to_string()),
        );
        map.insert(
            "appearanceAssignedAt".to_string(),
            serde_json::Value::String(now),
        );
    }
    write_mod_tags_file(&mod_dir, &mut tags_file)
}

pub fn pin_mod(
    cfg: &mut AppConfig,
    character_name: &str,
    mod_name: &str,
    pinned: bool,
) -> Result<(), String> {
    let safe_char = assert_safe_segment(character_name, "角色名称")?;
    let safe_mod = assert_safe_segment(mod_name, "Mod 名称")?;
    let list = cfg.pinned_mods.entry(safe_char).or_default();
    list.retain(|x| x != &safe_mod);
    if pinned {
        list.push(safe_mod);
    }
    save_config(cfg)
}

pub fn set_mod_marked(
    cfg: &AppConfig,
    character_name: &str,
    mod_name: &str,
    marked: bool,
) -> Result<(), String> {
    let (mod_dir, _) = resolve_mod_dir(cfg, character_name, mod_name)?;
    let mut tags_file = read_mod_tags_file(&mod_dir);
    tags_file.marked = marked;
    write_mod_tags_file(&mod_dir, &mut tags_file)
}

pub fn set_mod_preview_data_url(
    cfg: &AppConfig,
    character_name: &str,
    mod_name: &str,
    data_url: &str,
) -> Result<(String, u64), String> {
    let (mod_dir, _) = resolve_mod_dir(cfg, character_name, mod_name)?;
    let (bytes, ext) = decode_image_data_url(data_url)?;
    let target = mod_dir.join(format!("preview.{ext}"));
    fs::write(&target, &bytes).map_err(|e| format!("保存预览图失败：{e}"))?;
    remove_stale_images_except(&mod_dir, "preview", ext);
    let mtime = file_mtime_ms(&target);
    Ok((target.to_string_lossy().to_string(), mtime))
}

pub fn set_mod_preview_file(
    cfg: &AppConfig,
    character_name: &str,
    mod_name: &str,
    src_file: &Path,
) -> Result<(String, u64), String> {
    if !src_file.is_file() {
        return Err("所选预览图不存在".to_string());
    }
    let ext = src_file
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase())
        .filter(|e| matches!(e.as_str(), "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp"))
        .ok_or_else(|| "仅支持 PNG、JPG、WebP、GIF 或 BMP 图片格式".to_string())?;
    let (mod_dir, _) = resolve_mod_dir(cfg, character_name, mod_name)?;
    let target = mod_dir.join(format!("preview.{ext}"));
    fs::copy(src_file, &target).map_err(|e| format!("复制预览图失败：{e}"))?;
    remove_stale_images_except(&mod_dir, "preview", &ext);
    let mtime = file_mtime_ms(&target);
    Ok((target.to_string_lossy().to_string(), mtime))
}

pub fn update_mod_meta(
    cfg: &AppConfig,
    character_name: &str,
    mod_name: &str,
    notes: Option<String>,
    tags: Option<Vec<String>>,
    hotkey_aliases: Option<HashMap<String, String>>,
) -> Result<(), String> {
    let (mod_dir, _) = resolve_mod_dir(cfg, character_name, mod_name)?;
    let mut tags_file = read_mod_tags_file(&mod_dir);
    if let Some(n) = notes {
        tags_file.notes = n;
    }
    if let Some(t) = tags {
        tags_file.tags = t;
    }
    if let Some(ha) = hotkey_aliases {
        tags_file.hotkey_aliases = ha;
    }
    write_mod_tags_file(&mod_dir, &mut tags_file)
}

pub fn update_mod_hotkey(
    cfg: &AppConfig,
    character_name: &str,
    mod_name: &str,
    ini_rel_path: &str,
    section: &str,
    new_key_expr: &str,
) -> Result<(), String> {
    let (mod_dir, _) = resolve_mod_dir(cfg, character_name, mod_name)?;
    update_hotkey_in_ini(&mod_dir, ini_rel_path, section, new_key_expr)
}
