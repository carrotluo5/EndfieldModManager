use crate::config::{load_presets, save_config, save_presets};
use crate::fs_ops::{
    assert_safe_segment, file_mtime_ms, find_image_in_dir, remove_stale_images_except,
    rename_dir_with_retry, trash_path,
};
use crate::models::{AppConfig, AppearanceSection, AppearanceSectionConfig, CharacterItem, ModTagsFile};
use base64::Engine as _;
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

const ROSTER_JSON: &str = include_str!("../resources/endfield-characters.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RosterPair {
    zh: String,
    en: String,
    #[serde(default)]
    jasm_name: String,
    #[serde(default)]
    aliases: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RosterNameMap {
    pairs: Vec<RosterPair>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManualMappingEntry {
    display_name: String,
    #[serde(default)]
    canonical_en_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RosterConfig {
    default_characters: Vec<String>,
    #[serde(default)]
    non_character_categories: Vec<String>,
    #[serde(default)]
    manual_mappings: HashMap<String, ManualMappingEntry>,
    character_name_map: RosterNameMap,
}

fn roster() -> &'static RosterConfig {
    static ROSTER: OnceLock<RosterConfig> = OnceLock::new();
    ROSTER.get_or_init(|| {
        serde_json::from_str(ROSTER_JSON).expect("embedded endfield-characters.json must parse")
    })
}

pub fn default_character_names() -> &'static [String] {
    &roster().default_characters
}

pub fn is_non_character_category(name: &str) -> bool {
    let trimmed = name.trim();
    roster()
        .non_character_categories
        .iter()
        .any(|c| c == trimmed)
}

pub fn aliases_for_character(name: &str) -> Vec<String> {
    let trimmed = name.trim();
    let mut out = vec![trimmed.to_string()];
    for pair in &roster().character_name_map.pairs {
        if pair.zh == trimmed {
            if !pair.en.is_empty() {
                out.push(pair.en.clone());
            }
            if !pair.jasm_name.is_empty() && pair.jasm_name != pair.en {
                out.push(pair.jasm_name.clone());
            }
            for a in &pair.aliases {
                if !a.is_empty() && !out.contains(a) {
                    out.push(a.clone());
                }
            }
        }
    }
    out
}

pub fn resolve_legacy_english_category(dir_name: &str) -> Option<String> {
    let trimmed = dir_name.trim();
    if trimmed.is_empty() {
        return None;
    }
    let cfg = roster();
    if cfg.default_characters.iter().any(|c| c == trimmed) {
        return None;
    }
    let low = trimmed.to_ascii_lowercase();
    let compact: String = low.chars().filter(|c| c.is_alphanumeric() || !c.is_ascii()).collect();

    if let Some(entry) = cfg.manual_mappings.get(&low).or_else(|| cfg.manual_mappings.get(&compact)) {
        if entry.display_name != trimmed && entry.display_name != "管理员" {
            return Some(entry.display_name.clone());
        }
    }
    for entry in cfg.manual_mappings.values() {
        if !entry.canonical_en_name.is_empty()
            && entry.canonical_en_name.eq_ignore_ascii_case(trimmed)
            && entry.display_name != trimmed
        {
            return Some(entry.display_name.clone());
        }
    }
    for pair in &cfg.character_name_map.pairs {
        if pair.zh == trimmed {
            return None;
        }
        if pair.en.eq_ignore_ascii_case(trimmed)
            || pair.jasm_name.eq_ignore_ascii_case(trimmed)
            || pair.aliases.iter().any(|a| a.eq_ignore_ascii_case(trimmed))
        {
            return Some(pair.zh.clone());
        }
    }
    None
}

fn contains_ascii_word(haystack_lower: &str, needle_lower: &str) -> bool {
    if needle_lower.len() < 2 {
        return false;
    }
    let hbytes = haystack_lower.as_bytes();
    let nlen = needle_lower.len();
    let mut start = 0usize;
    while let Some(rel) = haystack_lower[start..].find(needle_lower) {
        let idx = start + rel;
        let left_ok = idx == 0 || !hbytes[idx - 1].is_ascii_alphanumeric();
        let right_idx = idx + nlen;
        let right_ok = right_idx >= hbytes.len() || !hbytes[right_idx].is_ascii_alphanumeric();
        if left_ok && right_ok {
            return true;
        }
        start = idx + 1;
    }
    false
}

fn contains_single_cjk_token(text: &str, token: &str) -> bool {
    let mut start = 0usize;
    while let Some(rel) = text[start..].find(token) {
        let idx = start + rel;
        let prev = text[..idx].chars().next_back();
        let next = text[idx + token.len()..].chars().next();
        let is_sep = |c: Option<char>| match c {
            None => true,
            Some(ch) => {
                ch.is_whitespace()
                    || matches!(
                        ch,
                        '-' | '_' | '.' | '/' | '\\' | '[' | ']' | '【' | '】' | '(' | ')' | '（' | '）' | ':' | '：'
                    )
            }
        };
        if is_sep(prev) && is_sep(next) {
            return true;
        }
        start = idx + token.len();
    }
    false
}

pub fn match_character_from_text(
    text: &str,
    existing_chars: &[String],
) -> Option<(String, String)> {
    let stripped = text
        .trim()
        .strip_prefix("DISABLED_")
        .or_else(|| text.trim().strip_prefix("disabled_"))
        .unwrap_or(text.trim());
    if stripped.is_empty() {
        return None;
    }
    let low = stripped.to_ascii_lowercase();
    let cfg = roster();

    // Collect (alias, canonical_zh, priority, reason)
    let mut candidates: Vec<(String, String, usize, String)> = Vec::new();
    for ch in existing_chars {
        if !ch.is_empty() {
            candidates.push((ch.clone(), ch.clone(), ch.chars().count() * 10 + 5, format!("匹配目录「{ch}」")));
        }
    }
    for pair in &cfg.character_name_map.pairs {
        candidates.push((
            pair.zh.clone(),
            pair.zh.clone(),
            pair.zh.chars().count() * 10 + 4,
            format!("命中干员名「{}」", pair.zh),
        ));
        if !pair.en.is_empty() {
            candidates.push((
                pair.en.clone(),
                pair.zh.clone(),
                pair.en.len() * 2,
                format!("命中英文名「{}」", pair.en),
            ));
        }
        if !pair.jasm_name.is_empty() && pair.jasm_name != pair.en {
            candidates.push((
                pair.jasm_name.clone(),
                pair.zh.clone(),
                pair.jasm_name.len() * 2,
                format!("命中标准名「{}」", pair.jasm_name),
            ));
        }
        for a in &pair.aliases {
            if !a.is_empty() {
                candidates.push((
                    a.clone(),
                    pair.zh.clone(),
                    a.chars().count() * 6,
                    format!("命中别名「{a}」"),
                ));
            }
        }
    }
    for (k, entry) in &cfg.manual_mappings {
        if entry.display_name == "管理员" {
            continue;
        }
        candidates.push((
            k.clone(),
            entry.display_name.clone(),
            k.chars().count() * 4,
            format!("命中映射「{k}」"),
        ));
    }

    candidates.sort_by(|a, b| b.2.cmp(&a.2));

    for (alias, zh, _, reason) in candidates {
        if alias.is_ascii() {
            let alias_low = alias.to_ascii_lowercase();
            if alias_low.len() < 2 {
                continue;
            }
            if contains_ascii_word(&low, &alias_low) {
                return Some((zh, reason));
            }
        } else if alias.chars().count() == 1 {
            if contains_single_cjk_token(stripped, &alias) {
                return Some((zh, reason));
            }
        } else if stripped.contains(&alias) {
            return Some((zh, reason));
        }
    }

    None
}

pub fn now_iso_utc() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Simple ISO-8601 epoch format or precise enough timestamp string
    let days = secs / 86400;
    let rem = secs % 86400;
    let hh = rem / 3600;
    let mm = (rem % 3600) / 60;
    let ss = rem % 60;
    // Howard Hinnant civil-from-days algorithm
    let z = days as i64 + 719468;
    let era = z.div_euclid(146097);
    let doe = z.rem_euclid(146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let yr = if m <= 2 { y + 1 } else { y };
    format!("{yr:04}-{m:02}-{d:02}T{hh:02}:{mm:02}:{ss:02}.000Z")
}

pub fn resolve_character_dir(cfg: &AppConfig, char_name: &str) -> Result<PathBuf, String> {
    let safe = assert_safe_segment(char_name, "角色名称")?;
    let mods_root = Path::new(&cfg.mods_path);
    if cfg.mods_path.trim().is_empty() || !mods_root.is_dir() {
        return Err("Mods 文件夹路径未配置或不存在".to_string());
    }
    Ok(mods_root.join(safe))
}

fn count_mods_in_char_dir(char_dir: &Path) -> (usize, usize) {
    let Ok(entries) = fs::read_dir(char_dir) else {
        return (0, 0);
    };
    let mut total = 0usize;
    let mut enabled = 0usize;
    for entry in entries.flatten() {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        total += 1;
        if !name.to_ascii_uppercase().starts_with("DISABLED_") {
            enabled += 1;
        }
    }
    (total, enabled)
}

pub fn list_characters(cfg: &AppConfig) -> Result<Vec<CharacterItem>, String> {
    let mods_root = Path::new(&cfg.mods_path);
    let has_mods_root = !cfg.mods_path.trim().is_empty() && mods_root.is_dir();

    let mut items_map: HashMap<String, CharacterItem> = HashMap::new();
    let pinned_set: HashSet<&str> = cfg.pinned_characters.iter().map(|s| s.as_str()).collect();

    if has_mods_root {
        let entries = fs::read_dir(mods_root)
            .map_err(|e| format!("读取 Mods 目录失败：{e}"))?;
        for entry in entries.flatten() {
            if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            let char_path = entry.path();
            let (mod_count, enabled_count) = count_mods_in_char_dir(&char_path);
            let cover = find_image_in_dir(&char_path, "_cover");
            let section_count = cfg
                .character_sections
                .get(&name)
                .map(|v| v.len())
                .unwrap_or(0);

            items_map.insert(
                name.clone(),
                CharacterItem {
                    name: name.clone(),
                    path: char_path.to_string_lossy().to_string(),
                    cover_path: cover.as_ref().map(|(p, _)| p.to_string_lossy().to_string()),
                    cover_mtime: cover.map(|(_, m)| m).unwrap_or(0),
                    mod_count,
                    enabled_count,
                    pinned: pinned_set.contains(name.as_str()),
                    aliases: aliases_for_character(&name),
                    is_non_character_category: is_non_character_category(&name),
                    section_count,
                    exists_on_disk: true,
                },
            );
        }
    }

    if cfg.show_all_characters {
        for def_name in default_character_names() {
            if !items_map.contains_key(def_name) {
                let virtual_path = if has_mods_root {
                    mods_root.join(def_name).to_string_lossy().to_string()
                } else {
                    String::new()
                };
                items_map.insert(
                    def_name.clone(),
                    CharacterItem {
                        name: def_name.clone(),
                        path: virtual_path,
                        cover_path: None,
                        cover_mtime: 0,
                        mod_count: 0,
                        enabled_count: 0,
                        pinned: pinned_set.contains(def_name.as_str()),
                        aliases: aliases_for_character(def_name),
                        is_non_character_category: is_non_character_category(def_name),
                        section_count: cfg
                            .character_sections
                            .get(def_name)
                            .map(|v| v.len())
                            .unwrap_or(0),
                        exists_on_disk: false,
                    },
                );
            }
        }
    }

    let order_index: HashMap<&str, usize> = cfg
        .character_order
        .iter()
        .enumerate()
        .map(|(i, n)| (n.as_str(), i))
        .collect();
    let pinned_index: HashMap<&str, usize> = cfg
        .pinned_characters
        .iter()
        .enumerate()
        .map(|(i, n)| (n.as_str(), i))
        .collect();

    let mut list: Vec<CharacterItem> = items_map.into_values().collect();
    list.sort_by(|a, b| {
        let ap = pinned_index.get(a.name.as_str());
        let bp = pinned_index.get(b.name.as_str());
        match (ap, bp) {
            (Some(ai), Some(bi)) => return ai.cmp(bi),
            (Some(_), None) => return std::cmp::Ordering::Less,
            (None, Some(_)) => return std::cmp::Ordering::Greater,
            (None, None) => {}
        }
        let ao = order_index.get(a.name.as_str()).copied().unwrap_or(usize::MAX);
        let bo = order_index.get(b.name.as_str()).copied().unwrap_or(usize::MAX);
        ao.cmp(&bo).then_with(|| a.name.cmp(&b.name))
    });

    Ok(list)
}

pub fn decode_image_data_url(data_url: &str) -> Result<(Vec<u8>, &'static str), String> {
    let Some((header, b64)) = data_url.split_once(',') else {
        return Err("无效的图片 Data URL 格式".to_string());
    };
    let ext = if header.contains("image/webp") {
        "webp"
    } else if header.contains("image/jpeg") || header.contains("image/jpg") {
        "jpg"
    } else {
        "png"
    };
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64.trim())
        .map_err(|e| format!("解码图片数据失败：{e}"))?;
    Ok((bytes, ext))
}

pub fn add_character(
    cfg: &mut AppConfig,
    name: &str,
    cover_data_url: Option<&str>,
) -> Result<CharacterItem, String> {
    let safe = assert_safe_segment(name, "角色名称")?;
    let mods_root = Path::new(&cfg.mods_path);
    if cfg.mods_path.trim().is_empty() || !mods_root.is_dir() {
        return Err("请先在系统设置中配置有效的 EFMI Mods 文件夹".to_string());
    }
    let char_dir = mods_root.join(&safe);
    if char_dir.exists() {
        return Err(format!("角色分类「{safe}」已存在"));
    }
    fs::create_dir_all(&char_dir).map_err(|e| format!("创建角色目录失败：{e}"))?;

    let info_json = serde_json::json!({
        "name": safe,
        "createdAt": now_iso_utc(),
        "description": ""
    });
    let _ = fs::write(
        char_dir.join("info.json"),
        serde_json::to_string_pretty(&info_json).unwrap_or_default(),
    );

    if let Some(url) = cover_data_url {
        if !url.trim().is_empty() {
            let (bytes, ext) = decode_image_data_url(url)?;
            let cover_file = char_dir.join(format!("_cover.{ext}"));
            fs::write(&cover_file, &bytes).map_err(|e| format!("保存封面失败：{e}"))?;
        }
    }

    if !cfg.character_order.contains(&safe) {
        cfg.character_order.push(safe.clone());
        save_config(cfg)?;
    }

    let cover = find_image_in_dir(&char_dir, "_cover");
    Ok(CharacterItem {
        name: safe.clone(),
        path: char_dir.to_string_lossy().to_string(),
        cover_path: cover.as_ref().map(|(p, _)| p.to_string_lossy().to_string()),
        cover_mtime: cover.map(|(_, m)| m).unwrap_or(0),
        mod_count: 0,
        enabled_count: 0,
        pinned: false,
        aliases: aliases_for_character(&safe),
        is_non_character_category: is_non_character_category(&safe),
        section_count: 0,
        exists_on_disk: true,
    })
}

pub fn rename_character(cfg: &mut AppConfig, old_name: &str, new_name: &str) -> Result<(), String> {
    let old_safe = assert_safe_segment(old_name, "原角色名称")?;
    let new_safe = assert_safe_segment(new_name, "新角色名称")?;
    if old_safe == new_safe {
        return Ok(());
    }
    let mods_root = Path::new(&cfg.mods_path);
    if cfg.mods_path.trim().is_empty() || !mods_root.is_dir() {
        return Err("Mods 文件夹未配置或不存在".to_string());
    }
    let old_dir = mods_root.join(&old_safe);
    let new_dir = mods_root.join(&new_safe);
    rename_dir_with_retry(&old_dir, &new_dir)?;

    for item in &mut cfg.character_order {
        if *item == old_safe {
            *item = new_safe.clone();
        }
    }
    for item in &mut cfg.pinned_characters {
        if *item == old_safe {
            *item = new_safe.clone();
        }
    }
    if let Some(v) = cfg.pinned_mods.remove(&old_safe) {
        cfg.pinned_mods.insert(new_safe.clone(), v);
    }
    if let Some(v) = cfg.mod_orders.remove(&old_safe) {
        cfg.mod_orders.insert(new_safe.clone(), v);
    }
    if let Some(v) = cfg.character_sections.remove(&old_safe) {
        cfg.character_sections.insert(new_safe.clone(), v);
    }
    if let Some(v) = cfg.exclusive_by_category.remove(&old_safe) {
        cfg.exclusive_by_category.insert(new_safe.clone(), v);
    }
    save_config(cfg)?;

    if let Ok(mut presets) = load_presets() {
        let mut changed = false;
        for preset in &mut presets.presets {
            for m in &mut preset.mods {
                if m.character_name == old_safe {
                    m.character_name = new_safe.clone();
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

pub fn delete_character(cfg: &mut AppConfig, char_name: &str) -> Result<(), String> {
    let dir = resolve_character_dir(cfg, char_name)?;
    trash_path(&dir)?;
    cfg.character_order.retain(|x| x != char_name);
    cfg.pinned_characters.retain(|x| x != char_name);
    cfg.pinned_mods.remove(char_name);
    cfg.mod_orders.remove(char_name);
    cfg.character_sections.remove(char_name);
    save_config(cfg)?;
    Ok(())
}

pub fn set_character_cover_data_url(
    cfg: &AppConfig,
    char_name: &str,
    data_url: &str,
) -> Result<(String, u64), String> {
    let dir = resolve_character_dir(cfg, char_name)?;
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("创建角色目录失败：{e}"))?;
    }
    let (bytes, ext) = decode_image_data_url(data_url)?;
    let target = dir.join(format!("_cover.{ext}"));
    fs::write(&target, &bytes).map_err(|e| format!("保存封面图片失败：{e}"))?;
    remove_stale_images_except(&dir, "_cover", ext);
    let mtime = file_mtime_ms(&target);
    Ok((target.to_string_lossy().to_string(), mtime))
}

pub fn set_character_cover_file(
    cfg: &AppConfig,
    char_name: &str,
    src_file: &Path,
) -> Result<(String, u64), String> {
    if !src_file.is_file() {
        return Err("所选封面图片文件不存在".to_string());
    }
    let ext = src_file
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase())
        .filter(|e| matches!(e.as_str(), "png" | "jpg" | "jpeg" | "webp" | "gif"))
        .ok_or_else(|| "仅支持 PNG、JPG、WebP 或 GIF 图片格式".to_string())?;
    let dir = resolve_character_dir(cfg, char_name)?;
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("创建角色目录失败：{e}"))?;
    }
    let target = dir.join(format!("_cover.{ext}"));
    fs::copy(src_file, &target).map_err(|e| format!("复制封面图片失败：{e}"))?;
    remove_stale_images_except(&dir, "_cover", &ext);
    let mtime = file_mtime_ms(&target);
    Ok((target.to_string_lossy().to_string(), mtime))
}

pub fn read_mod_section_id(mod_dir: &Path) -> String {
    let tags_path = mod_dir.join("tags.json");
    let Ok(raw) = fs::read_to_string(&tags_path) else {
        return "base".to_string();
    };
    let Ok(val) = serde_json::from_str::<serde_json::Value>(raw.trim_start_matches('\u{feff}')) else {
        return "base".to_string();
    };
    val.get("qaqm")
        .and_then(|q| q.get("appearanceSectionId"))
        .and_then(|s| s.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "base".to_string())
}

pub fn list_appearance_sections(
    cfg: &AppConfig,
    char_name: &str,
) -> Result<Vec<AppearanceSection>, String> {
    let safe_char = assert_safe_segment(char_name, "角色名称")?;
    let custom_secs = cfg
        .character_sections
        .get(&safe_char)
        .cloned()
        .unwrap_or_default();
    let custom_ids: HashSet<String> = custom_secs.iter().map(|s| s.id.clone()).collect();

    let mut counts: HashMap<String, (usize, usize)> = HashMap::new();
    let mods_root = Path::new(&cfg.mods_path);
    let char_dir = mods_root.join(&safe_char);
    if char_dir.is_dir() {
        if let Ok(entries) = fs::read_dir(&char_dir) {
            for entry in entries.flatten() {
                if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    continue;
                }
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with('.') {
                    continue;
                }
                let enabled = !name.to_ascii_uppercase().starts_with("DISABLED_");
                let raw_sec = read_mod_section_id(&entry.path());
                let effective_sec = if custom_ids.contains(&raw_sec) {
                    raw_sec
                } else {
                    "base".to_string()
                };
                let counter = counts.entry(effective_sec).or_insert((0, 0));
                counter.0 += 1;
                if enabled {
                    counter.1 += 1;
                }
            }
        }
    }

    let base_cover = if char_dir.is_dir() {
        find_image_in_dir(&char_dir, "_cover")
    } else {
        None
    };
    let (base_total, base_enabled) = counts.get("base").copied().unwrap_or((0, 0));
    let mut out = vec![AppearanceSection {
        id: "base".to_string(),
        name: "原角色".to_string(),
        name_en: "Original".to_string(),
        cover_path: base_cover.as_ref().map(|(p, _)| p.to_string_lossy().to_string()),
        cover_mtime: base_cover.map(|(_, m)| m).unwrap_or(0),
        is_base: true,
        mod_count: base_total,
        enabled_count: base_enabled,
    }];

    for sec in custom_secs {
        let (total, enabled) = counts.get(&sec.id).copied().unwrap_or((0, 0));
        let cov_path = if sec.cover_path.trim().is_empty() {
            None
        } else {
            let p = PathBuf::from(&sec.cover_path);
            if p.is_file() {
                Some((sec.cover_path.clone(), file_mtime_ms(&p)))
            } else {
                None
            }
        };
        out.push(AppearanceSection {
            id: sec.id,
            name: sec.name,
            name_en: sec.name_en,
            cover_path: cov_path.as_ref().map(|(p, _)| p.clone()),
            cover_mtime: cov_path.map(|(_, m)| m).unwrap_or(0),
            is_base: false,
            mod_count: total,
            enabled_count: enabled,
        });
    }

    Ok(out)
}

fn save_section_cover_data_url(
    char_name: &str,
    section_id: &str,
    data_url: &str,
) -> Result<String, String> {
    let dir = crate::config::app_data_dir()?
        .join("section-covers")
        .join(char_name);
    fs::create_dir_all(&dir).map_err(|e| format!("创建分区封面目录失败：{e}"))?;
    let (bytes, ext) = decode_image_data_url(data_url)?;
    let clean_id = section_id.replace(':', "_");
    let target = dir.join(format!("{clean_id}.{ext}"));
    fs::write(&target, &bytes).map_err(|e| format!("保存分区封面失败：{e}"))?;
    Ok(target.to_string_lossy().to_string())
}

pub fn create_appearance_section(
    cfg: &mut AppConfig,
    char_name: &str,
    name: &str,
    name_en: &str,
    cover_data_url: Option<&str>,
) -> Result<AppearanceSectionConfig, String> {
    let safe_char = assert_safe_segment(char_name, "角色名称")?;
    let clean_name = name.trim();
    if clean_name.is_empty() {
        return Err("分区名称不能为空".to_string());
    }
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let sec_id = format!("custom:{ts}");
    let cover_path = if let Some(url) = cover_data_url.filter(|u| !u.trim().is_empty()) {
        save_section_cover_data_url(&safe_char, &sec_id, url)?
    } else {
        String::new()
    };
    let now = now_iso_utc();
    let sec = AppearanceSectionConfig {
        id: sec_id,
        name: clean_name.to_string(),
        name_en: name_en.trim().to_string(),
        cover_path,
        created_at: now.clone(),
        updated_at: now,
    };
    cfg.character_sections
        .entry(safe_char)
        .or_default()
        .push(sec.clone());
    save_config(cfg)?;
    Ok(sec)
}

pub fn update_appearance_section(
    cfg: &mut AppConfig,
    char_name: &str,
    section_id: &str,
    name: &str,
    name_en: &str,
    cover_data_url: Option<&str>,
    clear_cover: bool,
) -> Result<(), String> {
    let safe_char = assert_safe_segment(char_name, "角色名称")?;
    let clean_name = name.trim();
    if clean_name.is_empty() {
        return Err("分区名称不能为空".to_string());
    }
    let mut new_cover: Option<String> = None;
    if let Some(url) = cover_data_url.filter(|u| !u.trim().is_empty()) {
        new_cover = Some(save_section_cover_data_url(&safe_char, section_id, url)?);
    }

    let list = cfg
        .character_sections
        .get_mut(&safe_char)
        .ok_or_else(|| "未找到该角色的分区列表".to_string())?;
    let sec = list
        .iter_mut()
        .find(|s| s.id == section_id)
        .ok_or_else(|| "未找到目标外观分区".to_string())?;
    sec.name = clean_name.to_string();
    sec.name_en = name_en.trim().to_string();
    if clear_cover {
        sec.cover_path.clear();
    } else if let Some(cov) = new_cover {
        sec.cover_path = cov;
    }
    sec.updated_at = now_iso_utc();
    save_config(cfg)?;
    Ok(())
}

pub fn delete_appearance_section(
    cfg: &mut AppConfig,
    char_name: &str,
    section_id: &str,
) -> Result<usize, String> {
    let safe_char = assert_safe_segment(char_name, "角色名称")?;
    if section_id == "base" {
        return Err("不能删除默认的「原角色」分区".to_string());
    }
    let mut reassigned = 0usize;
    let char_dir = Path::new(&cfg.mods_path).join(&safe_char);
    if char_dir.is_dir() {
        if let Ok(entries) = fs::read_dir(&char_dir) {
            for entry in entries.flatten() {
                if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    continue;
                }
                let tags_path = entry.path().join("tags.json");
                let Ok(raw) = fs::read_to_string(&tags_path) else {
                    continue;
                };
                let Ok(mut parsed) =
                    serde_json::from_str::<ModTagsFile>(raw.trim_start_matches('\u{feff}'))
                else {
                    continue;
                };
                let current_id = parsed
                    .qaqm
                    .as_ref()
                    .and_then(|q| q.get("appearanceSectionId"))
                    .and_then(|s| s.as_str())
                    .unwrap_or("base");
                if current_id == section_id {
                    if let Some(serde_json::Value::Object(map)) = parsed.qaqm.as_mut() {
                        map.insert(
                            "appearanceSectionId".to_string(),
                            serde_json::Value::String("base".to_string()),
                        );
                        map.insert(
                            "classificationSource".to_string(),
                            serde_json::Value::String("manual".to_string()),
                        );
                    }
                    if let Ok(json_str) = serde_json::to_string_pretty(&parsed) {
                        let _ = fs::write(&tags_path, json_str);
                        reassigned += 1;
                    }
                }
            }
        }
    }

    if let Some(secs) = cfg.character_sections.get_mut(&safe_char) {
        secs.retain(|s| s.id != section_id);
    }
    save_config(cfg)?;
    Ok(reassigned)
}
