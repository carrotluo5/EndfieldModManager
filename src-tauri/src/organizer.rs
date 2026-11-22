use crate::characters::{
    aliases_for_character, default_character_names, is_non_character_category,
    match_character_from_text, resolve_legacy_english_category,
};
use crate::fs_ops::{assert_safe_segment, rename_dir_with_retry};
use crate::models::{
    AppConfig, DirtyItem, LegacyMigrationItem, MisplacedModItem, OrganizeApplyResult,
    OrganizeScanReport,
};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const LOOSE_MOD_RESOURCE_FOLDERS: [&str; 6] =
    ["meshes", "textures", "shaders", "buffer", "buffers", "dds"];

fn is_ignored_system_file(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "desktop.ini" | "thumbs.db" | ".ds_store"
    )
}

fn is_ignored_char_meta_file(name: &str) -> bool {
    let low = name.to_ascii_lowercase();
    is_ignored_system_file(&low)
        || low == "info.json"
        || low.starts_with("_cover.")
        || low.starts_with("preview.")
}

fn mod_matches_own_character(mod_name: &str, char_name: &str) -> bool {
    let low = mod_name.to_ascii_lowercase();
    for alias in aliases_for_character(char_name) {
        if alias.is_empty() {
            continue;
        }
        if alias.is_ascii() {
            if alias.len() >= 3 && low.contains(&alias.to_ascii_lowercase()) {
                return true;
            }
        } else if mod_name.contains(&alias) {
            return true;
        }
    }
    false
}

pub fn scan_mods_health_and_organize(cfg: &AppConfig) -> Result<OrganizeScanReport, String> {
    let mods_root = Path::new(&cfg.mods_path);
    if cfg.mods_path.trim().is_empty() || !mods_root.is_dir() {
        return Err("Mods 目录未配置或不存在".to_string());
    }

    let mut existing_dirs: Vec<(String, PathBuf)> = Vec::new();
    let mut existing_names_set: HashSet<String> = HashSet::new();
    let mut dirty_items: Vec<DirtyItem> = Vec::new();

    for entry in fs::read_dir(mods_root)
        .map_err(|e| format!("读取 Mods 目录失败：{e}"))?
        .flatten()
    {
        let ftype = match entry.file_type() {
            Ok(t) => t,
            Err(_) => continue,
        };
        let fname = entry.file_name().to_string_lossy().to_string();
        if fname.starts_with('.') {
            continue;
        }
        if ftype.is_file() {
            if is_ignored_system_file(&fname) {
                continue;
            }
            dirty_items.push(DirtyItem {
                kind: "root_file".to_string(),
                name: fname,
                path: entry.path().to_string_lossy().to_string(),
                parent_character: None,
                reason: "Mods 根目录散落文件（应归入对应角色与 Mod 文件夹内）".to_string(),
            });
            continue;
        }
        if ftype.is_dir() {
            existing_names_set.insert(fname.clone());
            existing_dirs.push((fname, entry.path()));
        }
    }

    let missing_default_characters: Vec<String> = default_character_names()
        .iter()
        .filter(|n| !existing_names_set.contains(*n))
        .cloned()
        .collect();

    let mut legacy_migrations: Vec<LegacyMigrationItem> = Vec::new();
    let mut legacy_set: HashSet<String> = HashSet::new();
    for (dir_name, dir_path) in &existing_dirs {
        if let Some(target_name) = resolve_legacy_english_category(dir_name) {
            let mod_count = fs::read_dir(dir_path)
                .into_iter()
                .flatten()
                .flatten()
                .filter(|e| {
                    e.file_type().map(|t| t.is_dir()).unwrap_or(false)
                        && !e.file_name().to_string_lossy().starts_with('.')
                })
                .count();
            legacy_set.insert(dir_name.clone());
            legacy_migrations.push(LegacyMigrationItem {
                legacy_name: dir_name.clone(),
                target_name,
                mod_count,
                legacy_path: dir_path.to_string_lossy().to_string(),
            });
        }
    }

    let existing_names: Vec<String> = existing_dirs.iter().map(|(n, _)| n.clone()).collect();
    let mut misplaced_mods: Vec<MisplacedModItem> = Vec::new();

    for (char_name, char_dir) in &existing_dirs {
        if legacy_set.contains(char_name) {
            continue;
        }
        let non_char = is_non_character_category(char_name);
        let Ok(entries) = fs::read_dir(char_dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(ftype) = entry.file_type() else {
                continue;
            };
            let item_name = entry.file_name().to_string_lossy().to_string();
            if item_name.starts_with('.') {
                continue;
            }
            if ftype.is_file() {
                if is_ignored_char_meta_file(&item_name) {
                    continue;
                }
                dirty_items.push(DirtyItem {
                    kind: "loose_char_file".to_string(),
                    name: item_name,
                    path: entry.path().to_string_lossy().to_string(),
                    parent_character: Some(char_name.clone()),
                    reason: format!("直接散落在角色「{char_name}」目录下的文件"),
                });
                continue;
            }

            if !ftype.is_dir() {
                continue;
            }
            if item_name.to_ascii_lowercase().starts_with("disabled_loose-") {
                continue;
            }
            if LOOSE_MOD_RESOURCE_FOLDERS.contains(&item_name.to_ascii_lowercase().as_str()) {
                dirty_items.push(DirtyItem {
                    kind: "loose_resource_dir".to_string(),
                    name: item_name,
                    path: entry.path().to_string_lossy().to_string(),
                    parent_character: Some(char_name.clone()),
                    reason: format!("疑似将 Mod 内层资源目录直接解压到了「{char_name}」下"),
                });
                continue;
            }

            if non_char {
                continue;
            }
            let clean_mod = item_name
                .strip_prefix("DISABLED_")
                .or_else(|| item_name.strip_prefix("disabled_"))
                .unwrap_or(&item_name)
                .to_string();
            if mod_matches_own_character(&clean_mod, char_name) {
                continue;
            }
            if let Some((suggested, reason)) = match_character_from_text(&clean_mod, &existing_names)
            {
                if suggested != *char_name && !is_non_character_category(&suggested) {
                    misplaced_mods.push(MisplacedModItem {
                        source_character: char_name.clone(),
                        mod_name: clean_mod,
                        dir_name: item_name,
                        suggested_character: suggested,
                        reason,
                        path: entry.path().to_string_lossy().to_string(),
                    });
                }
            }
        }
    }

    Ok(OrganizeScanReport {
        missing_default_characters,
        legacy_migrations,
        misplaced_mods,
        dirty_items,
    })
}

pub fn create_missing_default_characters(cfg: &AppConfig) -> Result<usize, String> {
    let mods_root = Path::new(&cfg.mods_path);
    if cfg.mods_path.trim().is_empty() || !mods_root.is_dir() {
        return Err("Mods 目录未配置或不存在".to_string());
    }
    let mut created = 0usize;
    for name in default_character_names() {
        let dir = mods_root.join(name);
        if !dir.exists() {
            fs::create_dir_all(&dir).map_err(|e| format!("创建目录失败（{name}）：{e}"))?;
            created += 1;
        }
    }
    Ok(created)
}

fn find_unique_target_mod(dst_char_dir: &Path, dir_name: &str) -> PathBuf {
    let (prefix, clean) = if dir_name.to_ascii_uppercase().starts_with("DISABLED_") {
        ("DISABLED_", &dir_name[9..])
    } else {
        ("", dir_name)
    };
    let mut suffix_idx = 1usize;
    loop {
        let candidate_clean = if suffix_idx == 1 {
            clean.to_string()
        } else {
            format!("{clean} ({suffix_idx})")
        };
        let enabled_cand = dst_char_dir.join(&candidate_clean);
        let disabled_cand = dst_char_dir.join(format!("DISABLED_{candidate_clean}"));
        if !enabled_cand.exists() && !disabled_cand.exists() {
            return dst_char_dir.join(format!("{prefix}{candidate_clean}"));
        }
        suffix_idx += 1;
    }
}

pub fn execute_legacy_migrations(
    cfg: &AppConfig,
    legacy_names: Vec<String>,
) -> Result<OrganizeApplyResult, String> {
    let mods_root = Path::new(&cfg.mods_path);
    if cfg.mods_path.trim().is_empty() || !mods_root.is_dir() {
        return Err("Mods 目录未配置或不存在".to_string());
    }

    let mut moved_count = 0usize;
    let mut migrated_dirs = 0usize;
    let mut warnings = Vec::new();

    for legacy_name in legacy_names {
        let Some(target_char) = resolve_legacy_english_category(&legacy_name) else {
            continue;
        };
        let src_dir = mods_root.join(&legacy_name);
        if !src_dir.is_dir() {
            continue;
        }
        let dst_char_dir = mods_root.join(&target_char);
        fs::create_dir_all(&dst_char_dir)
            .map_err(|e| format!("创建目标角色目录失败（{target_char}）：{e}"))?;

        if let Ok(entries) = fs::read_dir(&src_dir) {
            for entry in entries.flatten() {
                if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    continue;
                }
                let mod_dir_name = entry.file_name().to_string_lossy().to_string();
                if mod_dir_name.starts_with('.') {
                    continue;
                }
                let dst = find_unique_target_mod(&dst_char_dir, &mod_dir_name);
                if let Err(e) = rename_dir_with_retry(&entry.path(), &dst) {
                    warnings.push(format!("{mod_dir_name}：{e}"));
                } else {
                    moved_count += 1;
                }
            }
        }

        // Remove legacy folder only if empty (except system junk files)
        let remaining_dirs = fs::read_dir(&src_dir)
            .into_iter()
            .flatten()
            .flatten()
            .filter(|e| {
                let n = e.file_name().to_string_lossy().to_string();
                e.file_type().map(|t| t.is_dir()).unwrap_or(false) || !is_ignored_char_meta_file(&n)
            })
            .count();
        if remaining_dirs == 0 {
            let _ = fs::remove_dir_all(&src_dir);
            migrated_dirs += 1;
        }
    }

    Ok(OrganizeApplyResult {
        moved_count,
        quarantined_count: 0,
        migrated_dirs,
        warnings,
    })
}

pub fn execute_organize_actions(
    cfg: &AppConfig,
    moves: Vec<(String, String, String)>,
    quarantine_paths: Vec<String>,
) -> Result<OrganizeApplyResult, String> {
    let mods_root = Path::new(&cfg.mods_path);
    if cfg.mods_path.trim().is_empty() || !mods_root.is_dir() {
        return Err("Mods 目录未配置或不存在".to_string());
    }

    let mut moved_count = 0usize;
    let mut quarantined_count = 0usize;
    let mut warnings = Vec::new();

    for (src_char, mod_name, target_char) in moves {
        let Ok(sc) = assert_safe_segment(&src_char, "源角色") else {
            continue;
        };
        let Ok(tc) = assert_safe_segment(&target_char, "目标角色") else {
            continue;
        };
        let Ok(sm) = assert_safe_segment(&mod_name, "Mod 名称") else {
            continue;
        };
        if sc.eq_ignore_ascii_case(&tc) {
            continue;
        }
        let src_char_dir = mods_root.join(&sc);
        let enabled_src = src_char_dir.join(&sm);
        let disabled_src = src_char_dir.join(format!("DISABLED_{sm}"));
        let (src_path, dir_name) = if enabled_src.is_dir() {
            (enabled_src, sm)
        } else if disabled_src.is_dir() {
            (disabled_src, format!("DISABLED_{sm}"))
        } else {
            continue;
        };

        let dst_char_dir = mods_root.join(&tc);
        fs::create_dir_all(&dst_char_dir)
            .map_err(|e| format!("创建目标分类目录失败（{tc}）：{e}"))?;
        let dst_path = find_unique_target_mod(&dst_char_dir, &dir_name);
        if let Err(e) = rename_dir_with_retry(&src_path, &dst_path) {
            warnings.push(format!("{dir_name}：{e}"));
        } else {
            moved_count += 1;
        }
    }

    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    for raw_path in quarantine_paths {
        let src = PathBuf::from(&raw_path);
        if !src.exists() || !src.starts_with(mods_root) {
            continue;
        }
        let Some(parent) = src.parent() else {
            continue;
        };
        let quarantine_dir = parent.join(format!("DISABLED_loose-{ts}"));
        if let Err(e) = fs::create_dir_all(&quarantine_dir) {
            warnings.push(format!("创建隔离目录失败：{e}"));
            continue;
        }
        if let Some(fname) = src.file_name() {
            let dst = quarantine_dir.join(fname);
            if let Err(e) = rename_dir_with_retry(&src, &dst) {
                warnings.push(format!("隔离 {} 失败：{e}", fname.to_string_lossy()));
            } else {
                quarantined_count += 1;
            }
        }
    }

    Ok(OrganizeApplyResult {
        moved_count,
        quarantined_count,
        migrated_dirs: 0,
        warnings,
    })
}
