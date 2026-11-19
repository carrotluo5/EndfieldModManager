use crate::config::save_config;
use crate::fs_ops::assert_safe_segment;
use crate::ini_engine::collect_ini_files;
use crate::models::{AppConfig, PersistBridgeStatus};
use rayon::prelude::*;
use sha1::{Digest, Sha1};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

pub fn efmi_root_from_cfg(cfg: &AppConfig) -> Result<PathBuf, String> {
    let mods_root = Path::new(&cfg.mods_path);
    if cfg.mods_path.trim().is_empty() || !mods_root.is_dir() {
        return Err("Mods 目录未配置或不存在".to_string());
    }
    mods_root
        .parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| "无法定位 EFMI 根目录".to_string())
}

pub fn compute_ini_hash12(mods_root: &Path, ini_path: &Path) -> String {
    let rel = ini_path.strip_prefix(mods_root).unwrap_or(ini_path);
    let mut parts = Vec::new();
    for comp in rel.components() {
        if let std::path::Component::Normal(os) = comp {
            let s = os.to_string_lossy();
            let clean = if s.len() >= 9 && s[..9].eq_ignore_ascii_case("DISABLED_") {
                &s[9..]
            } else {
                s.as_ref()
            };
            parts.push(clean.to_ascii_lowercase());
        }
    }
    let normalized = parts.join("/");
    let mut hasher = Sha1::new();
    hasher.update(normalized.as_bytes());
    let digest = hasher.finalize();
    let hex: String = digest.iter().map(|b| format!("{b:02x}")).collect();
    hex.chars().take(12).collect()
}

pub fn ensure_d3dx_include(efmi_root: &Path) -> Result<bool, String> {
    let d3dx_path = efmi_root.join("d3dx.ini");
    if !d3dx_path.is_file() {
        return Err(format!("未找到 d3dx.ini：{}", d3dx_path.display()));
    }
    let bytes = fs::read(&d3dx_path).map_err(|e| format!("读取 d3dx.ini 失败：{e}"))?;
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

    let mut include_header_idx: Option<usize> = None;
    let mut in_include = false;
    let mut already_included = false;

    for (idx, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') && trimmed.len() >= 2 {
            let sec = trimmed[1..trimmed.len() - 1].trim();
            if sec.eq_ignore_ascii_case("include") {
                include_header_idx = Some(idx);
                in_include = true;
            } else if in_include {
                break;
            }
            continue;
        }
        if !in_include || trimmed.is_empty() || trimmed.starts_with(';') {
            continue;
        }
        if let Some((k, v)) = trimmed.split_once('=') {
            if k.trim().eq_ignore_ascii_case("include")
                && v.to_ascii_lowercase().contains("qaqm_includer.ini")
            {
                already_included = true;
                break;
            }
        }
    }

    if already_included {
        return Ok(false);
    }

    if let Some(hdr_idx) = include_header_idx {
        lines.insert(hdr_idx + 1, "include = qaqm\\qaqm_includer.ini".to_string());
    } else {
        lines.push(String::new());
        lines.push("[Include]".to_string());
        lines.push("include = qaqm\\qaqm_includer.ini".to_string());
    }

    let mut out = lines.join(eol);
    if ends_with_nl {
        out.push_str(eol);
    }
    fs::write(&d3dx_path, out.as_bytes()).map_err(|e| format!("写入 d3dx.ini 失败：{e}"))?;
    Ok(true)
}

pub fn is_d3dx_mounted(efmi_root: &Path) -> bool {
    let d3dx_path = efmi_root.join("d3dx.ini");
    let Ok(raw) = fs::read_to_string(&d3dx_path) else {
        return false;
    };
    let mut in_include = false;
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') && trimmed.len() >= 2 {
            in_include = trimmed[1..trimmed.len() - 1]
                .trim()
                .eq_ignore_ascii_case("include");
            continue;
        }
        if in_include && !trimmed.starts_with(';') {
            if let Some((k, v)) = trimmed.split_once('=') {
                if k.trim().eq_ignore_ascii_case("include")
                    && v.to_ascii_lowercase().contains("qaqm_includer.ini")
                {
                    return true;
                }
            }
        }
    }
    false
}

pub fn write_bridge_includers(efmi_root: &Path, active_state_files: &[String]) -> Result<(), String> {
    let qaqm_dir = efmi_root.join("qaqm");
    let cache_dir = qaqm_dir.join("cache");
    fs::create_dir_all(&cache_dir).map_err(|e| format!("创建 qaqm/cache 目录失败：{e}"))?;

    let keypress_path = qaqm_dir.join("qaqm_keypress.ini");
    if !keypress_path.exists() {
        fs::write(
            &keypress_path,
            "[System]\r\ncheck_foreground_window = 0\r\n",
        )
        .map_err(|e| format!("写入 qaqm_keypress.ini 失败：{e}"))?;
    }

    let includer_path = qaqm_dir.join("qaqm_includer.ini");
    fs::write(
        &includer_path,
        "; EFMM Persist Bridge — generated, safe to regenerate\r\n\
         ; Loads keypress + persist-active so F10 reload works with a non-foreground game window.\r\n\
         [IncludeKeypress]\r\n\
         include = qaqm_keypress.ini\r\n\r\n\
         [IncludePersistBridgeActive]\r\n\
         include = qaqm_persist_active.ini\r\n",
    )
    .map_err(|e| format!("写入 qaqm_includer.ini 失败：{e}"))?;

    let mut active_buf = String::from("; EFMM Persist Bridge active cache list\r\n");
    let mut seen = HashSet::new();
    for state_name in active_state_files {
        let clean = state_name.trim();
        if clean.is_empty() || !seen.insert(clean.to_ascii_lowercase()) {
            continue;
        }
        if !cache_dir.join(clean).is_file() {
            continue;
        }
        let stem = clean.strip_suffix(".ini").unwrap_or(clean);
        active_buf.push_str(&format!(
            "[IncludePersistBridge_{stem}]\r\ninclude = cache\\{clean}\r\n\r\n"
        ));
    }

    let active_path = qaqm_dir.join("qaqm_persist_active.ini");
    fs::write(&active_path, active_buf.as_bytes())
        .map_err(|e| format!("写入 qaqm_persist_active.ini 失败：{e}"))?;

    Ok(())
}

pub fn parse_d3dx_user_values(efmi_root: &Path) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let user_ini = efmi_root.join("d3dx_user.ini");
    let Ok(bytes) = fs::read(&user_ini) else {
        return map;
    };
    let raw = String::from_utf8_lossy(&bytes);
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with(';') || trimmed.starts_with('[') {
            continue;
        }
        if let Some((lhs, rhs)) = trimmed.split_once('=') {
            let k = lhs.trim();
            if k.starts_with("$\\") {
                let val = rhs.split(';').next().unwrap_or("").trim();
                if !val.is_empty() {
                    map.insert(k.to_ascii_lowercase(), val.to_string());
                }
            }
        }
    }
    map
}

fn parse_state_file_values(state_path: &Path) -> Vec<(String, String)> {
    let mut vars = Vec::new();
    let Ok(bytes) = fs::read(state_path) else {
        return vars;
    };
    let raw = String::from_utf8_lossy(&bytes);
    for line in raw.lines() {
        let trimmed = line.trim();
        if let Some(rest) = strip_prefix_ignore_ascii_case(trimmed, "global") {
            let rest = rest.trim_start();
            if let Some(after_persist) = strip_prefix_ignore_ascii_case(rest, "persist") {
                let after_persist = after_persist.trim_start();
                if let Some(var_and_val) = after_persist.strip_prefix('$') {
                    if let Some((vname, val_part)) = var_and_val.split_once('=') {
                        let name = vname.trim().to_string();
                        let val = val_part.split(';').next().unwrap_or("0").trim().to_string();
                        if is_valid_ident(&name) {
                            vars.push((name, val));
                        }
                    }
                }
            }
        }
    }
    vars
}

fn write_state_file(state_path: &Path, hash12: &str, vars: &[(String, String)]) -> Result<(), String> {
    let mut buf = format!("namespace = QAQM\\Persist\\Bridge_{hash12}\r\n\r\n[Constants]\r\n");
    for (name, val) in vars {
        buf.push_str(&format!("global persist ${name} = {val}\r\n"));
    }
    fs::write(state_path, buf.as_bytes())
        .map_err(|e| format!("写入持久化状态文件失败（{}）：{e}", state_path.display()))
}

fn strip_prefix_ignore_ascii_case<'a>(s: &'a str, prefix: &str) -> Option<&'a str> {
    if s.len() >= prefix.len() && s[..prefix.len()].eq_ignore_ascii_case(prefix) {
        Some(&s[prefix.len()..])
    } else {
        None
    }
}

fn is_ident_char(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

fn is_valid_ident(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(is_ident_char)
}

fn parse_global_persist_decl(trimmed_line: &str) -> Option<(String, String)> {
    let after_global = strip_prefix_ignore_ascii_case(trimmed_line, "global")?;
    if !after_global.starts_with(char::is_whitespace) {
        return None;
    }
    let after_persist = strip_prefix_ignore_ascii_case(after_global.trim_start(), "persist")?;
    if !after_persist.starts_with(char::is_whitespace) {
        return None;
    }
    let after_dollar = after_persist.trim_start().strip_prefix('$')?;
    if let Some((lhs, rhs)) = after_dollar.split_once('=') {
        let name = lhs.trim();
        if !is_valid_ident(name) {
            return None;
        }
        let val = rhs.split(';').next().unwrap_or("").trim();
        let val = if val.is_empty() { "0" } else { val };
        Some((name.to_string(), val.to_string()))
    } else {
        let name = after_dollar.split(';').next().unwrap_or("").trim();
        if !is_valid_ident(name) {
            return None;
        }
        Some((name.to_string(), "0".to_string()))
    }
}

fn extract_existing_bridge_hash(content: &str) -> Option<String> {
    let lower = content.to_ascii_lowercase();
    for marker in ["\\qaqm\\persist\\bridge_", "qaqm_state_"] {
        if let Some(pos) = lower.find(marker) {
            let start = pos + marker.len();
            let cand: String = lower[start..]
                .chars()
                .take(12)
                .take_while(|c| c.is_ascii_hexdigit())
                .collect();
            if cand.len() == 12 {
                return Some(cand);
            }
        }
    }
    None
}

fn rewrite_code_segment(
    code: &str,
    orig_ns: Option<&str>,
    target_ns: &str,
    var_map_lower: &HashMap<String, String>,
    allow_bare_local: bool,
) -> (String, bool) {
    let bytes = code.as_bytes();
    let len = bytes.len();
    let mut i = 0usize;
    let mut out = String::with_capacity(code.len());
    let mut changed = false;

    while i < len {
        if bytes[i] != b'$' {
            let ch = code[i..].chars().next().unwrap();
            out.push(ch);
            i += ch.len_utf8();
            continue;
        }

        // Case 1: Qualified variable `$\...`
        if i + 1 < len && bytes[i + 1] == b'\\' {
            let mut end = i + 2;
            while end < len && (is_ident_char(bytes[end]) || bytes[end] == b'\\' || bytes[end] == b'/') {
                end += 1;
            }
            let full_token = &code[i..end];
            let inner = &code[i + 2..end];
            if let Some((ns_part, var_part)) = inner.rsplit_once('\\') {
                if let Some(ons) = orig_ns {
                    if ns_part.eq_ignore_ascii_case(ons) {
                        if let Some(canon_var) = var_map_lower.get(&var_part.to_ascii_lowercase()) {
                            out.push_str(&format!("$\\{target_ns}\\{canon_var}"));
                            changed = true;
                            i = end;
                            continue;
                        }
                    }
                }
            }
            out.push_str(full_token);
            i = end;
            continue;
        }

        // Case 2: Bare variable `$ident`
        let mut end = i + 1;
        while end < len && is_ident_char(bytes[end]) {
            end += 1;
        }
        if allow_bare_local && end > i + 1 {
            let ident = &code[i + 1..end];
            if let Some(canon_var) = var_map_lower.get(&ident.to_ascii_lowercase()) {
                out.push_str(&format!("$\\{target_ns}\\{canon_var}"));
                changed = true;
                i = end;
                continue;
            }
        }

        out.push('$');
        i += 1;
    }

    (out, changed)
}

fn rewrite_sibling_ini_references(
    sibling_path: &Path,
    orig_ns: &str,
    target_ns: &str,
    var_map_lower: &HashMap<String, String>,
) -> Result<(), String> {
    let Ok(bytes) = fs::read(sibling_path) else {
        return Ok(());
    };
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

    let mut any_changed = false;
    for line in &mut lines {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with(';') || trimmed.starts_with('[') {
            continue;
        }
        let (code_part, comment_part) = match line.split_once(';') {
            Some((c, cm)) => (c, Some(cm)),
            None => (line.as_str(), None),
        };
        let (new_code, chg) = rewrite_code_segment(
            code_part,
            Some(orig_ns),
            target_ns,
            var_map_lower,
            false,
        );
        if chg {
            any_changed = true;
            *line = match comment_part {
                Some(cm) => format!("{new_code};{cm}"),
                None => new_code,
            };
        }
    }

    if !any_changed {
        return Ok(());
    }

    let bak_path = sibling_path.with_file_name(format!(
        "{}.qaqm-persistbak",
        sibling_path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("mod.ini")
    ));
    if !bak_path.exists() {
        fs::write(&bak_path, &bytes)
            .map_err(|e| format!("创建关联 INI 备份失败（{}）：{e}", bak_path.display()))?;
    }

    let mut out = lines.join(eol);
    if ends_with_nl {
        out.push_str(eol);
    }
    fs::write(sibling_path, out.as_bytes())
        .map_err(|e| format!("写入关联 INI 失败（{}）：{e}", sibling_path.display()))?;
    Ok(())
}

pub fn bridge_ini_file(
    mods_root: &Path,
    efmi_root: &Path,
    mod_dir: &Path,
    ini_path: &Path,
    all_mod_inis: &[PathBuf],
    user_vals: &HashMap<String, String>,
) -> Result<Option<String>, String> {
    let bytes = fs::read(ini_path).map_err(|e| format!("读取 INI 失败（{}）：{e}", ini_path.display()))?;
    let raw = String::from_utf8_lossy(&bytes).into_owned();

    let cache_dir = efmi_root.join("qaqm").join("cache");
    fs::create_dir_all(&cache_dir).map_err(|e| format!("创建缓存目录失败：{e}"))?;

    // If already bridged (either by QAQManager or EFMM), adopt existing hash cleanly
    if let Some(existing_hash) = extract_existing_bridge_hash(&raw) {
        let state_filename = format!("qaqm_state_{existing_hash}.ini");
        let state_path = cache_dir.join(&state_filename);
        if !state_path.is_file() {
            // Try reconstructing from .qaqm-persistbak if cache file was deleted
            let bak_path = ini_path.with_file_name(format!(
                "{}.qaqm-persistbak",
                ini_path
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or("mod.ini")
            ));
            if let Ok(bak_raw) = fs::read_to_string(&bak_path) {
                let mut vars = Vec::new();
                for l in bak_raw.lines() {
                    if let Some((vname, def_val)) = parse_global_persist_decl(l.trim()) {
                        let key = format!(
                            "$\\qaqm\\persist\\bridge_{}\\{}",
                            existing_hash,
                            vname.to_ascii_lowercase()
                        );
                        let val = user_vals.get(&key).cloned().unwrap_or(def_val);
                        vars.push((vname, val));
                    }
                }
                if !vars.is_empty() {
                    write_state_file(&state_path, &existing_hash, &vars)?;
                }
            }
        }
        return Ok(if state_path.is_file() {
            Some(state_filename)
        } else {
            None
        });
    }

    let eol = if raw.contains("\r\n") { "\r\n" } else { "\n" };
    let ends_with_nl = raw.ends_with('\n');
    let mut lines: Vec<String> = raw
        .split('\n')
        .map(|l| l.strip_suffix('\r').unwrap_or(l).to_string())
        .collect();
    if ends_with_nl && lines.last().map(|l| l.is_empty()).unwrap_or(false) {
        lines.pop();
    }

    let mut orig_ns: Option<String> = None;
    let mut decls: Vec<(usize, String, String)> = Vec::new();

    for (idx, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with(';') || trimmed.starts_with('[') {
            continue;
        }
        if let Some((k, v)) = trimmed.split_once('=') {
            if k.trim().eq_ignore_ascii_case("namespace") {
                let ns_val = v.split(';').next().unwrap_or("").trim();
                if !ns_val.is_empty() {
                    orig_ns = Some(ns_val.to_string());
                }
                continue;
            }
        }
        if let Some((vname, def_val)) = parse_global_persist_decl(trimmed) {
            decls.push((idx, vname, def_val));
        }
    }

    if decls.is_empty() {
        return Ok(None);
    }

    let hash12 = compute_ini_hash12(mods_root, ini_path);
    let state_filename = format!("qaqm_state_{hash12}.ini");
    let state_path = cache_dir.join(&state_filename);
    let target_ns = format!("QAQM\\Persist\\Bridge_{hash12}");

    // Inherit values priority: d3dx_user bridge key -> d3dx_user orig_ns key -> existing cache file -> ini default
    let existing_cache_vals: HashMap<String, String> = parse_state_file_values(&state_path)
        .into_iter()
        .map(|(k, v)| (k.to_ascii_lowercase(), v))
        .collect();

    let mut state_vars = Vec::with_capacity(decls.len());
    let mut var_map_lower: HashMap<String, String> = HashMap::new();
    for (_, vname, def_val) in &decls {
        let vlow = vname.to_ascii_lowercase();
        let bridge_key = format!("$\\qaqm\\persist\\bridge_{hash12}\\{vlow}");
        let orig_key = orig_ns
            .as_ref()
            .map(|ns| format!("$\\{}\\{vlow}", ns.to_ascii_lowercase()));

        let resolved_val = user_vals
            .get(&bridge_key)
            .or_else(|| orig_key.as_ref().and_then(|k| user_vals.get(k)))
            .or_else(|| existing_cache_vals.get(&vlow))
            .cloned()
            .unwrap_or_else(|| def_val.clone());

        var_map_lower.insert(vlow, vname.clone());
        state_vars.push((vname.clone(), resolved_val));
    }

    write_state_file(&state_path, &hash12, &state_vars)?;

    // Create lossless backup BEFORE rewriting ini
    let bak_path = ini_path.with_file_name(format!(
        "{}.qaqm-persistbak",
        ini_path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("mod.ini")
    ));
    if !bak_path.exists() {
        fs::write(&bak_path, &bytes)
            .map_err(|e| format!("创建原始 INI 备份失败（{}）：{e}", bak_path.display()))?;
    }

    // Build rewritten lines
    let decl_indices: HashSet<usize> = decls.iter().map(|(i, _, _)| *i).collect();
    let first_decl_idx = decls[0].0;
    let mut new_lines = Vec::with_capacity(lines.len());

    for (idx, line) in lines.into_iter().enumerate() {
        if decl_indices.contains(&idx) {
            if idx == first_decl_idx {
                new_lines.push(format!("; Persisted state is hosted by {state_filename}"));
            }
            continue;
        }
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with(';') || trimmed.starts_with('[') {
            new_lines.push(line);
            continue;
        }
        let (code_part, comment_part) = match line.split_once(';') {
            Some((c, cm)) => (c, Some(cm)),
            None => (line.as_str(), None),
        };
        let (rewritten_code, _) = rewrite_code_segment(
            code_part,
            orig_ns.as_deref(),
            &target_ns,
            &var_map_lower,
            true,
        );
        new_lines.push(match comment_part {
            Some(cm) => format!("{rewritten_code};{cm}"),
            None => rewritten_code,
        });
    }

    let mut out = new_lines.join(eol);
    if ends_with_nl {
        out.push_str(eol);
    }
    fs::write(ini_path, out.as_bytes())
        .map_err(|e| format!("重写持久化桥接 INI 失败（{}）：{e}", ini_path.display()))?;

    // Rewrite sibling ini references if orig_ns existed
    if let Some(ons) = orig_ns.as_deref() {
        for sib in all_mod_inis {
            if sib != ini_path && sib.starts_with(mod_dir) {
                rewrite_sibling_ini_references(sib, ons, &target_ns, &var_map_lower)?;
            }
        }
    }

    Ok(Some(state_filename))
}

fn collect_enabled_mod_dirs(mods_root: &Path) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let Ok(chars) = fs::read_dir(mods_root) else {
        return dirs;
    };
    for char_entry in chars.flatten() {
        if !char_entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let cname = char_entry.file_name().to_string_lossy().to_string();
        if cname.starts_with('.') {
            continue;
        }
        let Ok(mods) = fs::read_dir(char_entry.path()) else {
            continue;
        };
        for mod_entry in mods.flatten() {
            if !mod_entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            let mname = mod_entry.file_name().to_string_lossy().to_string();
            if mname.starts_with('.') || mname.to_ascii_uppercase().starts_with("DISABLED_") {
                continue;
            }
            dirs.push(mod_entry.path());
        }
    }
    dirs
}

fn collect_active_state_files_for_enabled_mods(
    mods_root: &Path,
    efmi_root: &Path,
    user_vals: &HashMap<String, String>,
) -> Result<Vec<String>, String> {
    let enabled_dirs = collect_enabled_mod_dirs(mods_root);
    let results: Vec<Result<Vec<String>, String>> = enabled_dirs
        .par_iter()
        .map(|mod_dir| {
            let inis = collect_ini_files(mod_dir);
            let mut out = Vec::new();
            for ini in &inis {
                if let Some(state_file) =
                    bridge_ini_file(mods_root, efmi_root, mod_dir, ini, &inis, user_vals)?
                {
                    out.push(state_file);
                }
            }
            Ok(out)
        })
        .collect();

    let mut state_files = Vec::new();
    let mut seen = HashSet::new();
    for res in results {
        for sf in res? {
            if seen.insert(sf.to_ascii_lowercase()) {
                state_files.push(sf);
            }
        }
    }
    state_files.sort();
    Ok(state_files)
}

fn merge_enabled_and_recent(
    efmi_root: &Path,
    enabled_states: Vec<String>,
    recent: &[String],
    cache_size: u32,
) -> Vec<String> {
    let cache_dir = efmi_root.join("qaqm").join("cache");
    let mut active = Vec::new();
    let mut seen = HashSet::new();

    for s in enabled_states {
        if cache_dir.join(&s).is_file() && seen.insert(s.to_ascii_lowercase()) {
            active.push(s);
        }
    }
    for s in recent.iter().take(cache_size as usize) {
        if cache_dir.join(s).is_file() && seen.insert(s.to_ascii_lowercase()) {
            active.push(s.clone());
        }
    }
    active
}

pub fn sync_all_enabled_mods(cfg: &mut AppConfig) -> Result<PersistBridgeStatus, String> {
    let efmi_root = efmi_root_from_cfg(cfg)?;
    let mods_root = Path::new(&cfg.mods_path);
    ensure_d3dx_include(&efmi_root)?;

    let user_vals = parse_d3dx_user_values(&efmi_root);
    let enabled_states = collect_active_state_files_for_enabled_mods(mods_root, &efmi_root, &user_vals)?;
    let enabled_set: HashSet<String> = enabled_states.iter().map(|s| s.to_ascii_lowercase()).collect();
    cfg.persist_bridge_recent
        .retain(|s| !enabled_set.contains(&s.to_ascii_lowercase()));

    let merged = merge_enabled_and_recent(
        &efmi_root,
        enabled_states,
        &cfg.persist_bridge_recent,
        cfg.persist_bridge_cache_size,
    );
    write_bridge_includers(&efmi_root, &merged)?;
    cfg.persist_bridge_enabled = true;
    save_config(cfg)?;
    Ok(get_status(cfg))
}

pub fn disable_and_restore_all(cfg: &mut AppConfig) -> Result<PersistBridgeStatus, String> {
    let efmi_root = efmi_root_from_cfg(cfg)?;
    let mods_root = Path::new(&cfg.mods_path);

    let backups: Vec<PathBuf> = WalkDir::new(mods_root)
        .into_iter()
        .flatten()
        .filter(|e| {
            e.file_type().is_file()
                && e.file_name()
                    .to_string_lossy()
                    .to_ascii_lowercase()
                    .ends_with(".ini.qaqm-persistbak")
        })
        .map(|e| e.into_path())
        .collect();

    for bak_path in backups {
        let fname = bak_path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("");
        if fname.len() <= ".qaqm-persistbak".len() {
            continue;
        }
        let orig_name = &fname[..fname.len() - ".qaqm-persistbak".len()];
        let orig_path = bak_path.with_file_name(orig_name);
        let bytes = fs::read(&bak_path)
            .map_err(|e| format!("读取备份文件失败（{}）：{e}", bak_path.display()))?;
        fs::write(&orig_path, &bytes)
            .map_err(|e| format!("还原原始 INI 失败（{}）：{e}", orig_path.display()))?;
        let _ = fs::remove_file(&bak_path);
    }

    let qaqm_dir = efmi_root.join("qaqm");
    if qaqm_dir.is_dir() {
        let _ = fs::write(
            qaqm_dir.join("qaqm_persist_active.ini"),
            b"; EFMM Persist Bridge disabled\r\n",
        );
    }
    cfg.persist_bridge_enabled = false;
    cfg.persist_bridge_recent.clear();
    save_config(cfg)?;
    Ok(get_status(cfg))
}

fn find_bridge_hashes_in_mod(mod_dir: &Path) -> Vec<String> {
    let inis = collect_ini_files(mod_dir);
    let mut hashes = Vec::new();
    let mut seen = HashSet::new();
    for ini in inis {
        if let Ok(raw) = fs::read_to_string(&ini) {
            if let Some(h) = extract_existing_bridge_hash(&raw) {
                if seen.insert(h.clone()) {
                    hashes.push(h);
                }
            }
        }
    }
    hashes
}

pub fn on_mod_disabled(cfg: &mut AppConfig, mod_dir: &Path) {
    if !cfg.persist_bridge_enabled {
        return;
    }
    let Ok(efmi_root) = efmi_root_from_cfg(cfg) else {
        return;
    };
    let mods_root = Path::new(&cfg.mods_path);
    let cache_dir = efmi_root.join("qaqm").join("cache");
    let user_vals = parse_d3dx_user_values(&efmi_root);

    let hashes = find_bridge_hashes_in_mod(mod_dir);
    for h in hashes {
        let state_filename = format!("qaqm_state_{h}.ini");
        let state_path = cache_dir.join(&state_filename);
        if state_path.is_file() {
            let current_vars = parse_state_file_values(&state_path);
            let updated_vars: Vec<(String, String)> = current_vars
                .into_iter()
                .map(|(vname, old_val)| {
                    let key = format!("$\\qaqm\\persist\\bridge_{h}\\{}", vname.to_ascii_lowercase());
                    let next_val = user_vals.get(&key).cloned().unwrap_or(old_val);
                    (vname, next_val)
                })
                .collect();
            let _ = write_state_file(&state_path, &h, &updated_vars);
        }

        cfg.persist_bridge_recent
            .retain(|s| !s.eq_ignore_ascii_case(&state_filename));
        cfg.persist_bridge_recent.insert(0, state_filename);
    }

    let max_recent = cfg.persist_bridge_cache_size as usize;
    cfg.persist_bridge_recent.truncate(max_recent);

    if let Ok(enabled_states) =
        collect_active_state_files_for_enabled_mods(mods_root, &efmi_root, &user_vals)
    {
        let merged = merge_enabled_and_recent(
            &efmi_root,
            enabled_states,
            &cfg.persist_bridge_recent,
            cfg.persist_bridge_cache_size,
        );
        let _ = write_bridge_includers(&efmi_root, &merged);
    }
}

pub fn on_mod_enabled(cfg: &mut AppConfig, mod_dir: &Path) {
    if !cfg.persist_bridge_enabled {
        return;
    }
    let Ok(efmi_root) = efmi_root_from_cfg(cfg) else {
        return;
    };
    let mods_root = Path::new(&cfg.mods_path);
    let _ = ensure_d3dx_include(&efmi_root);
    let user_vals = parse_d3dx_user_values(&efmi_root);

    let inis = collect_ini_files(mod_dir);
    for ini in &inis {
        if let Ok(Some(sf)) = bridge_ini_file(mods_root, &efmi_root, mod_dir, ini, &inis, &user_vals) {
            cfg.persist_bridge_recent
                .retain(|s| !s.eq_ignore_ascii_case(&sf));
        }
    }

    if let Ok(enabled_states) =
        collect_active_state_files_for_enabled_mods(mods_root, &efmi_root, &user_vals)
    {
        let merged = merge_enabled_and_recent(
            &efmi_root,
            enabled_states,
            &cfg.persist_bridge_recent,
            cfg.persist_bridge_cache_size,
        );
        let _ = write_bridge_includers(&efmi_root, &merged);
    }
}

fn clean_d3dx_user_for_hashes_and_ns(
    efmi_root: &Path,
    hashes: &HashSet<String>,
    namespaces: &HashSet<String>,
) {
    if hashes.is_empty() && namespaces.is_empty() {
        return;
    }
    let user_ini = efmi_root.join("d3dx_user.ini");
    let Ok(bytes) = fs::read(&user_ini) else {
        return;
    };
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

    let orig_len = lines.len();
    lines.retain(|line| {
        let trimmed = line.trim();
        if let Some((lhs, _)) = trimmed.split_once('=') {
            let low = lhs.trim().to_ascii_lowercase();
            for h in hashes {
                if low.starts_with(&format!("$\\qaqm\\persist\\bridge_{h}\\")) {
                    return false;
                }
            }
            for ns in namespaces {
                if low.starts_with(&format!("$\\{}\\", ns.to_ascii_lowercase())) {
                    return false;
                }
            }
        }
        true
    });

    if lines.len() != orig_len {
        let mut out = lines.join(eol);
        if ends_with_nl {
            out.push_str(eol);
        }
        let _ = fs::write(&user_ini, out.as_bytes());
    }
}

pub fn reset_single_mod_dir_ini(
    cfg: &mut AppConfig,
    mod_dir: &Path,
    is_enabled: bool,
) -> Result<usize, String> {
    let efmi_root = efmi_root_from_cfg(cfg)?;
    let mods_root = Path::new(&cfg.mods_path);
    let cache_dir = efmi_root.join("qaqm").join("cache");

    let mut count = 0usize;
    let mut hashes_to_clean = HashSet::new();
    let mut ns_to_clean = HashSet::new();

    // Find all backup and ini files directly inside mod_dir
    let mut bak_files = Vec::new();
    let mut ini_files = Vec::new();
    for entry in WalkDir::new(mod_dir).into_iter().flatten() {
        if !entry.file_type().is_file() {
            continue;
        }
        let fname = entry.file_name().to_string_lossy().to_ascii_lowercase();
        if fname.ends_with(".ini.qaqm-persistbak") {
            bak_files.push(entry.into_path());
        } else if fname.ends_with(".ini") && fname != "desktop.ini" {
            ini_files.push(entry.into_path());
        }
    }

    for ini in &ini_files {
        hashes_to_clean.insert(compute_ini_hash12(mods_root, ini));
        if let Ok(raw) = fs::read_to_string(ini) {
            if let Some(h) = extract_existing_bridge_hash(&raw) {
                hashes_to_clean.insert(h);
            }
            for line in raw.lines() {
                if let Some((k, v)) = line.trim().split_once('=') {
                    if k.trim().eq_ignore_ascii_case("namespace") {
                        let ns = v.split(';').next().unwrap_or("").trim();
                        if !ns.is_empty() {
                            ns_to_clean.insert(ns.to_string());
                        }
                    }
                }
            }
        }
    }

    for bak in bak_files {
        let fname = bak.file_name().and_then(|s| s.to_str()).unwrap_or("");
        if fname.len() <= ".qaqm-persistbak".len() {
            continue;
        }
        let orig = bak.with_file_name(&fname[..fname.len() - ".qaqm-persistbak".len()]);
        if let Ok(bytes) = fs::read(&bak) {
            fs::write(&orig, &bytes).map_err(|e| format!("恢复 INI 失败：{e}"))?;
            let _ = fs::remove_file(&bak);
            count += 1;
        }
    }

    for h in &hashes_to_clean {
        let sf = format!("qaqm_state_{h}.ini");
        let sp = cache_dir.join(&sf);
        if sp.is_file() {
            let _ = fs::remove_file(&sp);
            count += 1;
        }
        cfg.persist_bridge_recent
            .retain(|s| !s.eq_ignore_ascii_case(&sf));
    }

    clean_d3dx_user_for_hashes_and_ns(&efmi_root, &hashes_to_clean, &ns_to_clean);

    // If Persist Bridge is enabled and this mod is enabled, re-bridge fresh from defaults
    if cfg.persist_bridge_enabled && is_enabled {
        on_mod_enabled(cfg, mod_dir);
    } else if cfg.persist_bridge_enabled {
        let user_vals = parse_d3dx_user_values(&efmi_root);
        if let Ok(enabled_states) =
            collect_active_state_files_for_enabled_mods(mods_root, &efmi_root, &user_vals)
        {
            let merged = merge_enabled_and_recent(
                &efmi_root,
                enabled_states,
                &cfg.persist_bridge_recent,
                cfg.persist_bridge_cache_size,
            );
            let _ = write_bridge_includers(&efmi_root, &merged);
        }
    }

    save_config(cfg)?;
    Ok(count.max(1))
}

pub fn reset_mod_ini(
    cfg: &mut AppConfig,
    character_name: &str,
    mod_name: &str,
) -> Result<usize, String> {
    let (mod_dir, is_enabled) = crate::mods::resolve_mod_dir(cfg, character_name, mod_name)?;
    reset_single_mod_dir_ini(cfg, &mod_dir, is_enabled)
}

pub fn reset_character_ini(cfg: &mut AppConfig, character_name: &str) -> Result<usize, String> {
    let safe_char = assert_safe_segment(character_name, "角色名称")?;
    let mods_root = Path::new(&cfg.mods_path);
    let char_dir = mods_root.join(&safe_char);
    if !char_dir.is_dir() {
        return Err(format!("角色目录不存在：{safe_char}"));
    }

    let mut dirs = Vec::new();
    if let Ok(entries) = fs::read_dir(&char_dir) {
        for entry in entries.flatten() {
            if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            let dname = entry.file_name().to_string_lossy().to_string();
            if dname.starts_with('.') {
                continue;
            }
            let enabled = !dname.to_ascii_uppercase().starts_with("DISABLED_");
            dirs.push((entry.path(), enabled));
        }
    }

    let mut total_mods = 0usize;
    for (dir, is_enabled) in dirs {
        reset_single_mod_dir_ini(cfg, &dir, is_enabled)?;
        total_mods += 1;
    }
    Ok(total_mods)
}

pub fn clear_cache(cfg: &mut AppConfig) -> Result<usize, String> {
    let efmi_root = efmi_root_from_cfg(cfg)?;
    let mods_root = Path::new(&cfg.mods_path);
    let cache_dir = efmi_root.join("qaqm").join("cache");
    cfg.persist_bridge_recent.clear();

    let mut active_set = HashSet::new();
    let user_vals = parse_d3dx_user_values(&efmi_root);
    if cfg.persist_bridge_enabled {
        if let Ok(enabled_states) =
            collect_active_state_files_for_enabled_mods(mods_root, &efmi_root, &user_vals)
        {
            for sf in &enabled_states {
                active_set.insert(sf.to_ascii_lowercase());
            }
            let _ = write_bridge_includers(&efmi_root, &enabled_states);
        }
    } else {
        let _ = fs::write(
            efmi_root.join("qaqm").join("qaqm_persist_active.ini"),
            b"; EFMM Persist Bridge disabled\r\n",
        );
    }

    let mut removed = 0usize;
    if cache_dir.is_dir() {
        if let Ok(entries) = fs::read_dir(&cache_dir) {
            for entry in entries.flatten() {
                if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
                    continue;
                }
                let fname = entry.file_name().to_string_lossy().to_string();
                let low = fname.to_ascii_lowercase();
                if low.starts_with("qaqm_state_") && !active_set.contains(&low) {
                    if fs::remove_file(entry.path()).is_ok() {
                        removed += 1;
                    }
                }
            }
        }
    }

    save_config(cfg)?;
    Ok(removed)
}

pub fn get_status(cfg: &AppConfig) -> PersistBridgeStatus {
    let Ok(efmi_root) = efmi_root_from_cfg(cfg) else {
        return PersistBridgeStatus {
            enabled: cfg.persist_bridge_enabled,
            cache_size: cfg.persist_bridge_cache_size,
            d3dx_mounted: false,
            active_state_count: 0,
            cache_file_count: 0,
            backup_file_count: 0,
        };
    };
    let mods_root = Path::new(&cfg.mods_path);
    let d3dx_mounted = is_d3dx_mounted(&efmi_root);

    let active_ini = efmi_root.join("qaqm").join("qaqm_persist_active.ini");
    let active_state_count = fs::read_to_string(&active_ini)
        .map(|s| {
            s.lines()
                .filter(|l| l.trim().to_ascii_lowercase().starts_with("[includepersistbridge_"))
                .count()
        })
        .unwrap_or(0);

    let cache_dir = efmi_root.join("qaqm").join("cache");
    let cache_file_count = fs::read_dir(&cache_dir)
        .map(|it| {
            it.flatten()
                .filter(|e| {
                    e.file_type().map(|t| t.is_file()).unwrap_or(false)
                        && e.file_name()
                            .to_string_lossy()
                            .to_ascii_lowercase()
                            .ends_with(".ini")
                })
                .count()
        })
        .unwrap_or(0);

    let backup_file_count = WalkDir::new(mods_root)
        .into_iter()
        .flatten()
        .filter(|e| {
            e.file_type().is_file()
                && e.file_name()
                    .to_string_lossy()
                    .to_ascii_lowercase()
                    .ends_with(".ini.qaqm-persistbak")
        })
        .count();

    PersistBridgeStatus {
        enabled: cfg.persist_bridge_enabled,
        cache_size: cfg.persist_bridge_cache_size,
        d3dx_mounted,
        active_state_count,
        cache_file_count,
        backup_file_count,
    }
}
