use crate::models::{
    ConflictGroup, HotkeyAlternative, HotkeyItem, RabbitFxModEntry, RabbitFxStatus,
};
use rayon::prelude::*;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

pub fn collect_ini_files(mod_dir: &Path) -> Vec<PathBuf> {
    if !mod_dir.is_dir() {
        return Vec::new();
    }
    let mut files = Vec::new();
    let walker = WalkDir::new(mod_dir).into_iter().filter_entry(|entry| {
        if entry.depth() == 0 {
            return true;
        }
        if entry.file_type().is_dir() {
            let name = entry.file_name().to_string_lossy();
            let lower = name.to_ascii_lowercase();
            return !lower.starts_with("disabled") && !name.starts_with('.');
        }
        true
    });

    for entry in walker.flatten() {
        if !entry.file_type().is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy();
        let lower = name.to_ascii_lowercase();
        if lower.ends_with(".ini") && lower != "desktop.ini" {
            files.push(entry.into_path());
        }
    }
    files.sort();
    files
}

pub fn has_persist_backup(mod_dir: &Path) -> bool {
    if !mod_dir.is_dir() {
        return false;
    }
    WalkDir::new(mod_dir)
        .into_iter()
        .flatten()
        .any(|e| {
            e.file_type().is_file()
                && e.file_name()
                    .to_string_lossy()
                    .to_ascii_lowercase()
                    .ends_with(".qaqm-persistbak")
        })
}

pub fn scan_mod_flags(mod_dir: &Path, ini_files: &[PathBuf]) -> (bool, bool, bool) {
    let mut is_rabbit_fx = false;
    let mut is_eff = false;
    let mut requires_rabbit_fx = false;

    // Check compiled.bin in mod root or immediate subfolder for EFF
    if mod_dir.join("compiled.bin").is_file() {
        is_eff = true;
    } else if let Ok(entries) = fs::read_dir(mod_dir) {
        for entry in entries.flatten() {
            if entry.path().is_dir() && entry.path().join("compiled.bin").is_file() {
                is_eff = true;
                break;
            }
        }
    }

    for ini_path in ini_files {
        let fname = ini_path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if fname == "rabbitfx.ini" {
            is_rabbit_fx = true;
        }
        if let Ok(content) = fs::read_to_string(ini_path) {
            let lower = content.to_ascii_lowercase();
            if lower.contains("; eff resource-input mod format") {
                is_eff = true;
            }
            if !is_rabbit_fx && lower.contains("rabbitfx") {
                requires_rabbit_fx = true;
            }
        }
    }

    (is_rabbit_fx, requires_rabbit_fx, is_eff)
}

pub fn extract_hashes_from_content(content: &str) -> Vec<String> {
    let mut hashes = Vec::new();
    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with(';') || line.starts_with('[') {
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            if k.trim().eq_ignore_ascii_case("hash") {
                let val = v.split(';').next().unwrap_or("").trim().to_ascii_lowercase();
                if val.len() >= 6 && val.len() <= 16 && val.chars().all(|c| c.is_ascii_hexdigit()) {
                    hashes.push(val);
                }
            }
        }
    }
    hashes
}

pub fn detect_conflicts_for_mods(enabled_mod_dirs: &[(String, Vec<PathBuf>)]) -> Vec<ConflictGroup> {
    let per_mod: Vec<(String, HashSet<String>)> = enabled_mod_dirs
        .par_iter()
        .map(|(mod_name, ini_files)| {
            let mut set = HashSet::new();
            for ini_path in ini_files {
                if let Ok(content) = fs::read_to_string(ini_path) {
                    for h in extract_hashes_from_content(&content) {
                        set.insert(h);
                    }
                }
            }
            (mod_name.clone(), set)
        })
        .collect();

    let mut hash_map: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for (mod_name, hashes) in per_mod {
        for h in hashes {
            hash_map.entry(h).or_default().push(mod_name.clone());
        }
    }

    let mut conflicts = Vec::new();
    for (hash, mut mods) in hash_map {
        mods.sort();
        mods.dedup();
        if mods.len() > 1 {
            conflicts.push(ConflictGroup { hash, mods });
        }
    }
    conflicts
}

pub fn get_rabbitfx_status(mods_path: &Path) -> RabbitFxStatus {
    if !mods_path.is_dir() {
        return RabbitFxStatus {
            enabled_count: 0,
            enabled_mods: Vec::new(),
            all_mods: Vec::new(),
            status: "missing".to_string(),
        };
    }

    let char_dirs: Vec<PathBuf> = fs::read_dir(mods_path)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .map(|e| e.path())
        .filter(|p| {
            let n = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
            !n.starts_with('.')
        })
        .collect();

    let mut all_mods: Vec<RabbitFxModEntry> = char_dirs
        .par_iter()
        .flat_map(|char_dir| {
            let char_name = char_dir
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            let mut found = Vec::new();
            let Ok(entries) = fs::read_dir(char_dir) else {
                return found;
            };
            for entry in entries.flatten() {
                if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    continue;
                }
                let dir_name = entry.file_name().to_string_lossy().to_string();
                if dir_name.starts_with('.') {
                    continue;
                }
                let enabled = !dir_name.to_ascii_uppercase().starts_with("DISABLED_");
                let clean_name = if enabled {
                    dir_name.clone()
                } else {
                    dir_name[9..].to_string()
                };
                let ini_files = collect_ini_files(&entry.path());
                let is_rfx = ini_files.iter().any(|p| {
                    p.file_name()
                        .and_then(|s| s.to_str())
                        .map(|s| s.eq_ignore_ascii_case("rabbitfx.ini"))
                        .unwrap_or(false)
                });
                if is_rfx {
                    found.push(RabbitFxModEntry {
                        character_name: char_name.clone(),
                        mod_name: clean_name,
                        dir_name,
                        path: entry.path().to_string_lossy().to_string(),
                        enabled,
                    });
                }
            }
            found
        })
        .collect();

    all_mods.sort_by(|a, b| a.mod_name.cmp(&b.mod_name));
    let enabled_mods: Vec<RabbitFxModEntry> =
        all_mods.iter().filter(|m| m.enabled).cloned().collect();
    let enabled_count = enabled_mods.len();
    let status = if enabled_count == 1 {
        "ok"
    } else if enabled_count == 0 {
        "missing"
    } else {
        "multiple"
    }
    .to_string();

    RabbitFxStatus {
        enabled_count,
        enabled_mods,
        all_mods,
        status,
    }
}

fn format_key_token(tok: &str) -> (String, bool) {
    let lower = tok.trim().to_ascii_lowercase();
    let upper = tok.trim().to_ascii_uppercase();
    match lower.as_str() {
        "ctrl" | "control" | "lctrl" | "rctrl" | "vk_control" | "vk_lcontrol" | "vk_rcontrol" => {
            ("Ctrl".to_string(), true)
        }
        "alt" | "lalt" | "ralt" | "vk_menu" | "vk_lmenu" | "vk_rmenu" => ("Alt".to_string(), true),
        "shift" | "lshift" | "rshift" | "vk_shift" | "vk_lshift" | "vk_rshift" => {
            ("Shift".to_string(), true)
        }
        "vk_up" | "up" => ("Up".to_string(), true),
        "vk_down" | "down" => ("Down".to_string(), true),
        "vk_left" | "left" => ("Left".to_string(), true),
        "vk_right" | "right" => ("Right".to_string(), true),
        "vk_space" | "space" => ("Space".to_string(), true),
        "vk_return" | "enter" | "return" => ("Enter".to_string(), true),
        "vk_back" | "backspace" => ("Backspace".to_string(), true),
        "vk_tab" | "tab" => ("Tab".to_string(), true),
        "vk_home" | "home" => ("Home".to_string(), true),
        "vk_end" | "end" => ("End".to_string(), true),
        "vk_insert" | "insert" => ("Insert".to_string(), true),
        "vk_delete" | "delete" => ("Delete".to_string(), true),
        "vk_prior" | "pageup" | "pgup" => ("PgUp".to_string(), true),
        "vk_next" | "pagedown" | "pgdn" => ("PgDn".to_string(), true),
        "vk_oem_1" | ";" => (";".to_string(), true),
        "vk_oem_plus" | "=" | "+" => ("=".to_string(), true),
        "vk_oem_comma" | "," => (",".to_string(), true),
        "vk_oem_minus" | "-" => ("-".to_string(), true),
        "vk_oem_period" | "." => (".".to_string(), true),
        "vk_oem_2" | "/" => ("/".to_string(), true),
        "vk_oem_3" | "`" | "~" => ("`".to_string(), true),
        "vk_oem_4" | "[" => ("[".to_string(), true),
        "vk_oem_5" | "\\" => ("\\".to_string(), true),
        "vk_oem_6" | "]" => ("]".to_string(), true),
        "vk_oem_7" | "'" => ("'".to_string(), true),
        "vk_lbutton" | "lbutton" => ("鼠标左键".to_string(), false),
        "vk_rbutton" | "rbutton" => ("鼠标右键".to_string(), false),
        "vk_mbutton" | "mbutton" => ("鼠标中键".to_string(), false),
        "vk_xbutton1" | "xbutton1" => ("鼠标侧键1".to_string(), false),
        "vk_xbutton2" | "xbutton2" => ("鼠标侧键2".to_string(), false),
        _ => {
            if upper.starts_with("XB_") {
                return (upper, false);
            }
            if let Some(rest) = upper.strip_prefix("VK_NUMPAD") {
                return (format!("Num{rest}"), true);
            }
            if let Some(rest) = upper.strip_prefix("VK_") {
                if rest.len() == 1 || (rest.starts_with('F') && rest[1..].chars().all(|c| c.is_ascii_digit())) {
                    return (rest.to_string(), true);
                }
            }
            if tok.len() == 1 {
                return (tok.to_ascii_uppercase(), true);
            }
            (tok.to_string(), !lower.contains("mouse") && !lower.contains("button"))
        }
    }
}

fn parse_hotkey_expression(expr: &str) -> HotkeyAlternative {
    let mut keys = Vec::new();
    let mut can_apply = true;

    for raw in expr.split_whitespace() {
        let low = raw.to_ascii_lowercase();
        if low == "no_modifiers"
            || low == "no_ctrl"
            || low == "no_alt"
            || low == "no_shift"
            || low == "no_win"
            || low.starts_with("no_")
        {
            continue;
        }
        let clean = raw.trim_start_matches('!');
        let (label, apply_ok) = format_key_token(clean);
        if !apply_ok {
            can_apply = false;
        }
        keys.push(label);
    }

    if keys.is_empty() {
        can_apply = false;
        keys.push(expr.trim().to_string());
    }

    let label = keys.join(" + ");
    HotkeyAlternative {
        original: expr.trim().to_string(),
        display_keys: keys,
        label,
        can_apply,
        is_preferred: false,
    }
}

fn semantic_signature(expr: &str) -> String {
    let alt = parse_hotkey_expression(expr);
    let mut parts: Vec<String> = alt
        .display_keys
        .into_iter()
        .map(|k| k.to_ascii_lowercase())
        .collect();
    parts.sort();
    parts.join("+")
}

pub fn parse_hotkeys_from_ini_content(content: &str, ini_rel_path: &str) -> Vec<HotkeyItem> {
    let mut hotkeys = Vec::new();
    let mut current_section: Option<String> = None;
    let mut current_keys: Vec<String> = Vec::new();
    let mut current_desc: Option<String> = None;

    let flush = |section_opt: &Option<String>,
                 keys: &[String],
                 desc_opt: &Option<String>,
                 out: &mut Vec<HotkeyItem>| {
        let Some(section) = section_opt else {
            return;
        };
        if keys.is_empty() {
            return;
        }
        let mut deduped_exprs = Vec::new();
        let mut seen_sigs = HashSet::new();
        for k in keys {
            let trimmed = k.trim();
            if trimmed.is_empty() {
                continue;
            }
            let sig = semantic_signature(trimmed);
            if seen_sigs.insert(sig) {
                deduped_exprs.push(trimmed.to_string());
            }
        }
        if deduped_exprs.is_empty() {
            return;
        }

        let mut alts: Vec<HotkeyAlternative> = deduped_exprs
            .iter()
            .map(|e| parse_hotkey_expression(e))
            .collect();
        let pref_idx = alts.iter().position(|a| a.can_apply).unwrap_or(0);
        if let Some(a) = alts.get_mut(pref_idx) {
            a.is_preferred = true;
        }
        let pref = alts.get(pref_idx).cloned().unwrap_or(HotkeyAlternative {
            original: String::new(),
            display_keys: Vec::new(),
            label: String::new(),
            can_apply: false,
            is_preferred: true,
        });

        let suffix = section
            .get(3..)
            .unwrap_or(section)
            .trim()
            .trim_start_matches('_');
        let base_desc = desc_opt.clone().unwrap_or_else(|| {
            if suffix.is_empty() {
                section.clone()
            } else {
                suffix.to_string()
            }
        });
        let is_menu = base_desc.eq_ignore_ascii_case("menu");
        let description = if is_menu {
            "菜单".to_string()
        } else {
            base_desc
        };

        out.push(HotkeyItem {
            section: section.clone(),
            description,
            alias: None,
            keys: pref.display_keys,
            raw_keys: deduped_exprs,
            alternatives: alts,
            is_menu,
            can_apply: pref.can_apply,
            ini_rel_path: ini_rel_path.to_string(),
        });
    };

    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with(';') {
            continue;
        }
        if line.starts_with('[') && line.ends_with(']') && line.len() >= 2 {
            flush(&current_section, &current_keys, &current_desc, &mut hotkeys);
            let inner = &line[1..line.len() - 1];
            if inner.len() >= 3 && inner[..3].eq_ignore_ascii_case("key") {
                let sec_name = inner.trim().to_string();
                let nice = sec_name[3..].trim().trim_start_matches('_').to_string();
                current_section = Some(sec_name);
                current_keys.clear();
                current_desc = if nice.is_empty() { None } else { Some(nice) };
            } else {
                current_section = None;
                current_keys.clear();
                current_desc = None;
            }
            continue;
        }
        if current_section.is_none() {
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            let key_lhs = k.trim();
            let val_rhs = v.split(';').next().unwrap_or("").trim();
            if key_lhs.eq_ignore_ascii_case("key") && !val_rhs.is_empty() {
                current_keys.push(val_rhs.to_string());
            } else if let Some(var_part) = key_lhs.strip_prefix('$') {
                let raw_var = var_part.trim();
                let var_name = raw_var.rsplit('\\').next().unwrap_or(raw_var).trim();
                let low = var_name.to_ascii_lowercase();
                if !var_name.is_empty()
                    && !matches!(low.as_str(), "active" | "active0" | "active1" | "pressed" | "hold")
                {
                    current_desc = Some(var_name.to_string());
                }
            }
        }
    }
    flush(&current_section, &current_keys, &current_desc, &mut hotkeys);
    hotkeys
}

pub fn parse_hotkeys_for_mod(
    mod_dir: &Path,
    ini_files: &[PathBuf],
    aliases: &HashMap<String, String>,
) -> Vec<HotkeyItem> {
    let mut collected: Vec<HotkeyItem> = Vec::new();
    let mut seen_semantic: HashMap<String, usize> = HashMap::new();

    for ini_path in ini_files {
        let rel = ini_path
            .strip_prefix(mod_dir)
            .unwrap_or(ini_path)
            .to_string_lossy()
            .to_string();
        let Ok(content) = fs::read_to_string(ini_path) else {
            continue;
        };
        for item in parse_hotkeys_from_ini_content(&content, &rel) {
            let mut sigs: Vec<String> = item.raw_keys.iter().map(|e| semantic_signature(e)).collect();
            sigs.sort();
            let semantic_key = sigs.join("|");
            if let Some(&existing_idx) = seen_semantic.get(&semantic_key) {
                if item.is_menu && !collected[existing_idx].is_menu {
                    collected[existing_idx] = item;
                }
                continue;
            }
            seen_semantic.insert(semantic_key, collected.len());
            collected.push(item);
        }
    }

    // Disambiguate duplicate descriptions (e.g., multiple "gui_active" sections)
    let mut desc_counts: HashMap<String, usize> = HashMap::new();
    for item in &collected {
        *desc_counts
            .entry(item.description.to_ascii_lowercase())
            .or_insert(0) += 1;
    }

    for item in &mut collected {
        let short_sec = item
            .section
            .get(3..)
            .unwrap_or("")
            .trim()
            .trim_start_matches('_');
        let custom_alias = aliases
            .get(&item.section)
            .or_else(|| aliases.get(short_sec))
            .or_else(|| aliases.get(&item.description))
            .cloned();
        item.alias = custom_alias;

        if desc_counts
            .get(&item.description.to_ascii_lowercase())
            .copied()
            .unwrap_or(0)
            > 1
            && !item.section.is_empty()
            && !item.section.eq_ignore_ascii_case(&item.description)
        {
            item.description = format!("{} · {}", item.description, item.section);
        }
    }

    collected
}

fn ini_section_matches(header_inner: &str, target_section: &str) -> bool {
    let h = header_inner.trim();
    let t = target_section.trim();
    if h.eq_ignore_ascii_case(t) {
        return true;
    }
    let t_low = t.to_ascii_lowercase();
    if !t_low.starts_with("key") {
        let with_key = format!("Key{t}");
        if h.eq_ignore_ascii_case(&with_key) {
            return true;
        }
    }
    false
}

fn patch_single_ini_hotkey(path: &Path, section: &str, new_key_expr: &str) -> Result<bool, String> {
    let bytes = fs::read(path).map_err(|e| format!("读取 INI 失败（{}）：{e}", path.display()))?;
    let raw = String::from_utf8_lossy(&bytes).into_owned();
    let eol = if raw.contains("\r\n") { "\r\n" } else { "\n" };
    let ends_with_nl = raw.ends_with('\n');

    let mut lines: Vec<String> = raw
        .split('\n')
        .map(|l| l.strip_suffix('\r').unwrap_or(l).to_string())
        .collect();
    if ends_with_nl && lines.last().map(|l| l.is_empty()).unwrap_or(false) {
        lines.pop();
    }

    let mut in_target = false;
    let mut found_section = false;
    let mut section_header_idx: Option<usize> = None;
    let mut replaced = false;

    for (idx, line) in lines.iter_mut().enumerate() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') && trimmed.len() >= 2 {
            let inner = &trimmed[1..trimmed.len() - 1];
            if ini_section_matches(inner, section) {
                in_target = true;
                found_section = true;
                section_header_idx = Some(idx);
            } else {
                if in_target && !replaced {
                    break;
                }
                in_target = false;
            }
            continue;
        }
        if !in_target || trimmed.is_empty() || trimmed.starts_with(';') {
            continue;
        }
        if let Some((lhs, rhs)) = line.split_once('=') {
            if lhs.trim().eq_ignore_ascii_case("key") {
                let indent: String = line.chars().take_while(|c| c.is_whitespace()).collect();
                let comment_suffix = if let Some((_, cmt)) = rhs.split_once(';') {
                    format!(" ;{}", cmt)
                } else {
                    String::new()
                };
                *line = format!("{indent}key = {new_key_expr}{comment_suffix}");
                replaced = true;
                break;
            }
        }
    }

    if !found_section {
        return Ok(false);
    }

    if !replaced {
        if let Some(hdr_idx) = section_header_idx {
            lines.insert(hdr_idx + 1, format!("key = {new_key_expr}"));
        }
    }

    let mut output = lines.join(eol);
    if ends_with_nl {
        output.push_str(eol);
    }
    fs::write(path, output.as_bytes())
        .map_err(|e| format!("写入 INI 失败（{}）：{e}", path.display()))?;
    Ok(true)
}

pub fn update_hotkey_in_ini(
    mod_dir: &Path,
    ini_rel_path: &str,
    section: &str,
    new_key_expr: &str,
) -> Result<(), String> {
    let clean_rel = ini_rel_path.trim().replace('\\', "/");
    if clean_rel.is_empty() {
        return Err("快捷键所属 INI 路径不能为空".to_string());
    }
    if new_key_expr.contains('\r') || new_key_expr.contains('\n') {
        return Err("快捷键表达式不能包含换行符".to_string());
    }
    let expr = new_key_expr.trim();
    if expr.is_empty() {
        return Err("快捷键表达式不能为空".to_string());
    }
    let rel_path = Path::new(&clean_rel);
    if rel_path.is_absolute() || clean_rel.contains(':') {
        return Err("非法的 INI 相对路径".to_string());
    }
    for comp in rel_path.components() {
        if matches!(comp, std::path::Component::ParentDir | std::path::Component::RootDir | std::path::Component::Prefix(_)) {
            return Err("INI 路径不允许包含上级目录跳转".to_string());
        }
    }

    let target_ini = mod_dir.join(rel_path);
    if !target_ini.is_file() {
        return Err(format!("找不到目标 INI 文件：{}", target_ini.display()));
    }
    if !target_ini
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.eq_ignore_ascii_case("ini"))
        .unwrap_or(false)
    {
        return Err("只能修改 .ini 文件中的快捷键".to_string());
    }

    let patched = patch_single_ini_hotkey(&target_ini, section, expr)?;
    if !patched {
        return Err(format!("未在 {} 中找到区块 [{}]", clean_rel, section));
    }

    // Keep .qaqm-persistbak synchronized so disabling Persist Bridge won't revert user's edited key
    let bak_name = format!(
        "{}.qaqm-persistbak",
        target_ini
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("mod.ini")
    );
    let bak_path = target_ini.with_file_name(bak_name);
    if bak_path.is_file() {
        let _ = patch_single_ini_hotkey(&bak_path, section, expr);
    }

    Ok(())
}
