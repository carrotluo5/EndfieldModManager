use crate::config::save_config;
use crate::fs_ops::assert_safe_segment;
use crate::models::{AppConfig, PersistBridgeStatus};
use rayon::prelude::*;
use sha1::{Digest, Sha1};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::{DirEntry, WalkDir};

pub const BRIDGE_DIR: &str = "efmm";
pub const BRIDGE_INCLUDE: &str = "efmm\\efmm_includer.ini";
pub const KEYPRESS_FILE: &str = "efmm_keypress.ini";
pub const BACKUP_SUFFIX: &str = ".efmm-persistbak";
const ACTIVE_FILE: &str = "efmm_persist_active.ini";
const STATE_PREFIX: &str = "efmm_state_";
const OWNED_STATE_MARKER: &str = "; EFMM persisted state: ";

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
            let clean = strip_prefix_ignore_ascii_case(&s, "DISABLED_").unwrap_or(&s);
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

fn ini_rule(line: &str) -> &str {
    line.split(';')
        .next()
        .unwrap_or("")
        .trim()
        .trim_start_matches('\u{feff}')
        .trim()
}

fn include_value(rule: &str) -> Option<String> {
    let (key, value) = rule.split_once('=')?;
    if !key.trim().eq_ignore_ascii_case("include") {
        return None;
    }
    let value = value.trim().replace('/', "\\").to_ascii_lowercase();
    Some(value.trim_start_matches(".\\").to_string())
}

fn is_include_section(rule: &str) -> Option<bool> {
    Some(rule.strip_prefix('[')?.strip_suffix(']')?.trim().eq_ignore_ascii_case("include"))
}

pub fn ensure_d3dx_include(efmi_root: &Path) -> Result<bool, String> {
    let path = efmi_root.join("d3dx.ini");
    let mut bytes = fs::read(&path)
        .map_err(|e| format!("读取 d3dx.ini 失败（{}）：{e}", path.display()))?;
    if bytes.contains(&0) {
        return Err("d3dx.ini 使用了不支持的编码，无法添加 EFMM 挂载规则。".to_string());
    }
    let eol = if bytes.windows(2).any(|pair| pair == b"\r\n") { "\r\n" } else { "\n" };
    let mut header_end = None;
    let mut offset = 0;
    let mut in_include = false;
    for line in bytes.split_inclusive(|&b| b == b'\n') {
        offset += line.len();
        let text = String::from_utf8_lossy(line);
        let rule = ini_rule(&text);
        if let Some(is_include) = is_include_section(rule) {
            in_include = is_include;
            if is_include && header_end.is_none() {
                header_end = Some(offset);
            }
        } else if in_include && include_value(rule).as_deref() == Some(BRIDGE_INCLUDE) {
            return Ok(false);
        }
    }

    let include = format!("include = {BRIDGE_INCLUDE}{eol}");
    if let Some(pos) = header_end {
        let leading_eol = if bytes.get(pos.saturating_sub(1)) == Some(&b'\n') { "" } else { eol };
        bytes.splice(pos..pos, format!("{leading_eol}{include}").bytes());
    } else {
        if !bytes.is_empty() && !bytes.ends_with(b"\n") {
            bytes.extend_from_slice(eol.as_bytes());
        }
        bytes.extend_from_slice(format!("[Include]{eol}{include}").as_bytes());
    }
    fs::write(&path, bytes).map_err(|e| format!("写入 d3dx.ini 失败：{e}"))?;
    Ok(true)
}

pub fn is_d3dx_mounted(efmi_root: &Path) -> bool {
    let Ok(bytes) = fs::read(efmi_root.join("d3dx.ini")) else {
        return false;
    };
    let raw = String::from_utf8_lossy(&bytes);
    let mut in_include = false;
    raw.lines().any(|line| {
        let rule = ini_rule(line);
        if let Some(is_include) = is_include_section(rule) {
            in_include = is_include;
        }
        in_include && include_value(rule).as_deref() == Some(BRIDGE_INCLUDE)
    })
}

fn cache_dir(efmi_root: &Path) -> PathBuf {
    efmi_root.join(BRIDGE_DIR).join("cache")
}

fn active_file(efmi_root: &Path) -> PathBuf {
    efmi_root.join(BRIDGE_DIR).join(ACTIVE_FILE)
}

pub(crate) fn backup_path(ini: &Path) -> PathBuf {
    let mut name = ini.file_name().unwrap_or_default().to_os_string();
    name.push(BACKUP_SUFFIX);
    ini.with_file_name(name)
}

fn is_owned_backup(name: &str) -> bool {
    name.to_ascii_lowercase()
        .strip_suffix(BACKUP_SUFFIX)
        .is_some_and(|name| name.ends_with(".ini"))
}

fn state_file_hash(name: &str) -> Option<&str> {
    let hash = name.strip_prefix(STATE_PREFIX)?.strip_suffix(".ini")?;
    (hash.len() == 12 && hash.bytes().all(|byte| byte.is_ascii_hexdigit())).then_some(hash)
}

pub(crate) fn ensure_keypress_files(efmi_root: &Path) -> Result<(), String> {
    let efmm_dir = efmi_root.join(BRIDGE_DIR);
    fs::create_dir_all(&efmm_dir).map_err(|e| format!("创建 EFMM 设置目录失败：{e}"))?;
    let keypress_path = efmm_dir.join(KEYPRESS_FILE);
    if !keypress_path.exists() {
        fs::write(&keypress_path, "[System]\r\ncheck_foreground_window = 0\r\n")
            .map_err(|e| format!("写入 {KEYPRESS_FILE} 失败：{e}"))?;
    }
    let active = active_file(efmi_root);
    if !active.exists() {
        fs::write(&active, b"; EFMM Persist Bridge disabled\r\n")
            .map_err(|e| format!("写入 {ACTIVE_FILE} 失败：{e}"))?;
    }
    let includer_path = efmi_root.join(BRIDGE_INCLUDE.replace('\\', "/"));
    if !includer_path.exists() {
        fs::write(
            &includer_path,
            format!("; Generated by Endfield Mod Manager\r\n[IncludeEFMMKeypress]\r\n\
                     include = {KEYPRESS_FILE}\r\n\r\n[IncludeEFMMPersistActive]\r\n\
                     include = {ACTIVE_FILE}\r\n"),
        )
        .map_err(|e| format!("写入 EFMM 挂载文件失败：{e}"))?;
    }
    ensure_d3dx_include(efmi_root)?;
    Ok(())
}

pub fn write_bridge_includers(efmi_root: &Path, active_state_files: &[String]) -> Result<(), String> {
    ensure_keypress_files(efmi_root)?;
    let cache_dir = cache_dir(efmi_root);
    fs::create_dir_all(&cache_dir).map_err(|e| format!("创建 efmm/cache 目录失败：{e}"))?;

    let mut active_buf = String::from("; EFMM Persist Bridge active cache list\r\n");
    let mut seen = HashSet::new();
    for state_name in active_state_files {
        let clean = state_name.trim();
        if state_file_hash(clean).is_none() || !seen.insert(clean.to_ascii_lowercase()) {
            continue;
        }
        if !cache_dir.join(clean).is_file() {
            continue;
        }
        let stem = clean.strip_suffix(".ini").unwrap_or(clean);
        active_buf.push_str(&format!(
            "[IncludeEFMMPersist_{stem}]\r\ninclude = cache\\{clean}\r\n\r\n"
        ));
    }

    fs::write(active_file(efmi_root), active_buf.as_bytes())
        .map_err(|e| format!("写入 efmm_persist_active.ini 失败：{e}"))?;

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
        let trimmed = ini_rule(line);
        if trimmed.is_empty() || trimmed.starts_with(';') || trimmed.starts_with('[') {
            continue;
        }
        if let Some((lhs, rhs)) = trimmed.split_once('=') {
            let k = lhs.trim();
            if strip_prefix_ignore_ascii_case(k, "$\\efmm\\persist\\bridge_").is_some() {
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
    let mut buf = format!("namespace = EFMM\\Persist\\Bridge_{hash12}\r\n\r\n[Constants]\r\n");
    for (name, val) in vars {
        buf.push_str(&format!("global persist ${name} = {val}\r\n"));
    }
    fs::write(state_path, buf.as_bytes())
        .map_err(|e| format!("写入持久化状态文件失败（{}）：{e}", state_path.display()))
}

fn strip_prefix_ignore_ascii_case<'a>(s: &'a str, prefix: &str) -> Option<&'a str> {
    if s.get(..prefix.len()).is_some_and(|head| head.eq_ignore_ascii_case(prefix)) {
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
    content.lines().find_map(|line| {
        let name = line.trim().strip_prefix(OWNED_STATE_MARKER)?;
        state_file_hash(name).map(str::to_ascii_lowercase)
    })
}

fn references_legacy_bridge(content: &str) -> bool {
    content.lines().any(|line| {
        let text = line.trim().to_ascii_lowercase();
        ini_rule(&text).contains("\\qaqm\\persist\\")
            || text.starts_with("; persisted state is hosted by qaqm_state_")
    })
}

fn has_legacy_backup(ini: &Path) -> bool {
    let mut name = ini.file_name().unwrap_or_default().to_os_string();
    name.push(".qaqm-persistbak");
    ini.with_file_name(name).is_file()
}

fn includes_in_file(path: &Path) -> Vec<String> {
    fs::read(path)
        .map(|bytes| String::from_utf8_lossy(&bytes)
            .lines()
            .filter_map(|line| include_value(ini_rule(line)))
            .collect())
        .unwrap_or_default()
}

fn legacy_state_is_mounted(efmi_root: &Path) -> bool {
    includes_in_file(&efmi_root.join("d3dx.ini")).into_iter().any(|include| {
        match include.as_str() {
            "qaqm\\qaqm_includer.ini" | "qaqm\\includer.ini" => {
                let path = efmi_root.join(include.replace('\\', "/"));
                includes_in_file(&path).iter().any(|child| {
                    matches!(child.as_str(), "qaqm_persist_active.ini" | "persist_active.ini")
                        && legacy_active_list_has_states(&efmi_root.join("qaqm").join(child))
                })
            }
            "qaqm\\qaqm_persist_active.ini" | "qaqm\\persist_active.ini" => {
                legacy_active_list_has_states(&efmi_root.join(include.replace('\\', "/")))
            }
            _ => false,
        }
    })
}

fn legacy_active_list_has_states(path: &Path) -> bool {
    // The manifest is enough to detect a conflict without opening any old state files.
    includes_in_file(path)
        .iter()
        .any(|entry| entry.starts_with("cache\\") && entry.ends_with(".ini"))
}

const LEGACY_BRIDGE_MESSAGE: &str = "检测到旧版 Persist Bridge 仍在使用此 Mod 库。请先在原管理器中关闭状态持久化并还原 INI，然后再开启 Endfield Mod Manager 的独立 Persist Bridge。";

fn is_bridge_input_dir(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    !name.starts_with("disabled")
        && !name.starts_with('.')
        && !name.starts_with("_ps_t_draw_fix_backup_")
}

fn bridge_files(root: &Path) -> impl Iterator<Item = DirEntry> {
    WalkDir::new(root)
        .into_iter()
        .filter_entry(|entry| {
            if entry.depth() == 0 {
                return true;
            }
            let name = entry.file_name().to_string_lossy();
            if entry.file_type().is_dir() {
                is_bridge_input_dir(&name)
            } else {
                !name.to_ascii_lowercase().starts_with("disabled")
            }
        })
        .flatten()
        .filter(|entry| entry.file_type().is_file())
}

fn is_bridge_ini(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    name.ends_with(".ini") && name != "desktop.ini"
}

fn collect_bridge_ini_files(mod_dir: &Path) -> Vec<PathBuf> {
    let mut inis: Vec<_> = bridge_files(mod_dir)
        .filter(|entry| is_bridge_ini(&entry.file_name().to_string_lossy()))
        .map(DirEntry::into_path)
        .collect();
    inis.sort();
    inis
}

fn legacy_bridge_artifact(root: &Path) -> Option<PathBuf> {
    bridge_files(root)
        .find(|entry| {
            let name = entry.file_name().to_string_lossy();
            name.to_ascii_lowercase().ends_with(".ini.qaqm-persistbak")
                || (is_bridge_ini(&name)
                    && fs::read(entry.path()).is_ok_and(|bytes| {
                        references_legacy_bridge(&String::from_utf8_lossy(&bytes))
                    }))
        })
        .map(DirEntry::into_path)
}

pub(crate) fn legacy_bridge_conflict(cfg: &AppConfig) -> Option<String> {
    let efmi_root = efmi_root_from_cfg(cfg).ok()?;
    if legacy_state_is_mounted(&efmi_root) {
        return Some(LEGACY_BRIDGE_MESSAGE.to_string());
    }
    legacy_bridge_artifact(Path::new(&cfg.mods_path))
        .map(|path| format!("{LEGACY_BRIDGE_MESSAGE}\n残留文件：{}", path.display()))
}

pub(crate) fn check_mod_enable(cfg: &AppConfig, mod_dir: &Path) -> Result<(), String> {
    // The root is still named DISABLED_… during preflight. Its live contents must be checked.
    let Some(artifact) = legacy_bridge_artifact(mod_dir) else {
        return Ok(());
    };
    if !cfg.persist_bridge_enabled
        && efmi_root_from_cfg(cfg).is_ok_and(|root| legacy_state_is_mounted(&root))
    {
        return Ok(());
    }
    Err(format!(
        "此 Mod 仍有旧版 Persist Bridge 改写痕迹，启用前请还原原始 INI 或重新安装原版 Mod。\n残留文件：{}",
        artifact.display()
    ))
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
    if references_legacy_bridge(&raw) {
        return Err(LEGACY_BRIDGE_MESSAGE.to_string());
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

    let bak_path = backup_path(sibling_path);
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
    if all_mod_inis.iter().any(|path| has_legacy_backup(path)) {
        return Err(LEGACY_BRIDGE_MESSAGE.to_string());
    }
    let bytes = fs::read(ini_path).map_err(|e| format!("读取 INI 失败（{}）：{e}", ini_path.display()))?;
    let raw = String::from_utf8_lossy(&bytes).into_owned();
    if references_legacy_bridge(&raw) {
        return Err(LEGACY_BRIDGE_MESSAGE.to_string());
    }

    let cache_dir = cache_dir(efmi_root);

    // The owner marker distinguishes declarations from references in sibling INIs.
    if let Some(existing_hash) = extract_existing_bridge_hash(&raw) {
        let state_filename = format!("efmm_state_{existing_hash}.ini");
        let state_path = cache_dir.join(&state_filename);
        if !state_path.is_file() {
            fs::create_dir_all(&cache_dir).map_err(|e| format!("创建缓存目录失败：{e}"))?;
            let bak_path = backup_path(ini_path);
            if let Ok(bak_raw) = fs::read_to_string(&bak_path) {
                let mut vars = Vec::new();
                for l in bak_raw.lines() {
                    if let Some((vname, def_val)) = parse_global_persist_decl(l.trim()) {
                        let key = format!(
                            "$\\efmm\\persist\\bridge_{}\\{}",
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

    fs::create_dir_all(&cache_dir).map_err(|e| format!("创建缓存目录失败：{e}"))?;
    let hash12 = compute_ini_hash12(mods_root, ini_path);
    let state_filename = format!("efmm_state_{hash12}.ini");
    let state_path = cache_dir.join(&state_filename);
    let target_ns = format!("EFMM\\Persist\\Bridge_{hash12}");

    // EFMM's game variables and cache take precedence over the original INI defaults.
    let existing_cache_vals: HashMap<String, String> = parse_state_file_values(&state_path)
        .into_iter()
        .map(|(k, v)| (k.to_ascii_lowercase(), v))
        .collect();

    let mut state_vars = Vec::with_capacity(decls.len());
    let mut var_map_lower: HashMap<String, String> = HashMap::new();
    for (_, vname, def_val) in &decls {
        let vlow = vname.to_ascii_lowercase();
        let bridge_key = format!("$\\efmm\\persist\\bridge_{hash12}\\{vlow}");
        let resolved_val = user_vals
            .get(&bridge_key)
            .or_else(|| existing_cache_vals.get(&vlow))
            .cloned()
            .unwrap_or_else(|| def_val.clone());

        var_map_lower.insert(vlow, vname.clone());
        state_vars.push((vname.clone(), resolved_val));
    }

    write_state_file(&state_path, &hash12, &state_vars)?;

    // Create lossless backup BEFORE rewriting ini
    let bak_path = backup_path(ini_path);
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
                new_lines.push(format!("{OWNED_STATE_MARKER}{state_filename}"));
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
        if !is_bridge_input_dir(&char_entry.file_name().to_string_lossy()) {
            continue;
        }
        let Ok(mods) = fs::read_dir(char_entry.path()) else {
            continue;
        };
        for mod_entry in mods.flatten() {
            if !mod_entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            if !is_bridge_input_dir(&mod_entry.file_name().to_string_lossy()) {
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
            let inis = collect_bridge_ini_files(mod_dir);
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
    let cache_dir = cache_dir(efmi_root);
    let mut active = Vec::new();
    let mut seen = HashSet::new();

    for s in enabled_states {
        if cache_dir.join(&s).is_file() && seen.insert(s.to_ascii_lowercase()) {
            active.push(s);
        }
    }
    for s in recent.iter().take(cache_size as usize) {
        if state_file_hash(s).is_some()
            && cache_dir.join(s).is_file()
            && seen.insert(s.to_ascii_lowercase())
        {
            active.push(s.clone());
        }
    }
    active
}

pub fn sync_all_enabled_mods(cfg: &mut AppConfig) -> Result<PersistBridgeStatus, String> {
    let efmi_root = efmi_root_from_cfg(cfg)?;
    let mods_root = Path::new(&cfg.mods_path);
    if let Some(conflict) = legacy_bridge_conflict(cfg) {
        return Err(conflict);
    }
    ensure_keypress_files(&efmi_root)?;

    let user_vals = parse_d3dx_user_values(&efmi_root);
    let enabled_states = collect_active_state_files_for_enabled_mods(mods_root, &efmi_root, &user_vals)?;
    let enabled_set: HashSet<String> = enabled_states.iter().map(|s| s.to_ascii_lowercase()).collect();
    cfg.persist_bridge_recent
        .retain(|s| state_file_hash(s).is_some() && !enabled_set.contains(&s.to_ascii_lowercase()));

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
            e.file_type().is_file() && is_owned_backup(&e.file_name().to_string_lossy())
        })
        .map(|e| e.into_path())
        .collect();

    for bak_path in backups {
        restore_owned_backup(&bak_path)?;
    }

    let active = active_file(&efmi_root);
    if active.is_file() {
        fs::write(active, b"; EFMM Persist Bridge disabled\r\n")
            .map_err(|e| format!("关闭 EFMM 状态挂载失败：{e}"))?;
    }
    cfg.persist_bridge_enabled = false;
    cfg.persist_bridge_recent.clear();
    save_config(cfg)?;
    Ok(get_status(cfg))
}

fn restore_owned_backup(backup: &Path) -> Result<(), String> {
    let fname = backup.file_name().and_then(|s| s.to_str())
        .ok_or_else(|| format!("无法识别 INI 备份文件名（{}）", backup.display()))?;
    let orig_path = backup.with_file_name(&fname[..fname.len() - BACKUP_SUFFIX.len()]);
    if fs::read(&orig_path).is_ok_and(|bytes| references_legacy_bridge(&String::from_utf8_lossy(&bytes))) {
        return Err(LEGACY_BRIDGE_MESSAGE.to_string());
    }
    let bytes = fs::read(backup)
        .map_err(|e| format!("读取备份文件失败（{}）：{e}", backup.display()))?;
    fs::write(&orig_path, &bytes)
        .map_err(|e| format!("还原原始 INI 失败（{}）：{e}", orig_path.display()))?;
    fs::remove_file(backup)
        .map_err(|e| format!("删除已还原备份失败（{}）：{e}", backup.display()))
}

fn find_bridge_hashes_in_mod(mod_dir: &Path) -> Vec<String> {
    let inis = collect_bridge_ini_files(mod_dir);
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
    if legacy_state_is_mounted(&efmi_root)
        || (!is_d3dx_mounted(&efmi_root) && legacy_bridge_conflict(cfg).is_some())
    {
        return;
    }
    let mods_root = Path::new(&cfg.mods_path);
    let cache_dir = cache_dir(&efmi_root);
    let user_vals = parse_d3dx_user_values(&efmi_root);

    let hashes = find_bridge_hashes_in_mod(mod_dir);
    for h in hashes {
        let state_filename = format!("efmm_state_{h}.ini");
        let state_path = cache_dir.join(&state_filename);
        if state_path.is_file() {
            let current_vars = parse_state_file_values(&state_path);
            let updated_vars: Vec<(String, String)> = current_vars
                .into_iter()
                .map(|(vname, old_val)| {
                    let key = format!("$\\efmm\\persist\\bridge_{h}\\{}", vname.to_ascii_lowercase());
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
    if legacy_state_is_mounted(&efmi_root)
        || (!is_d3dx_mounted(&efmi_root) && legacy_bridge_conflict(cfg).is_some())
    {
        return;
    }
    let mods_root = Path::new(&cfg.mods_path);
    let user_vals = parse_d3dx_user_values(&efmi_root);

    let inis = collect_bridge_ini_files(mod_dir);
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

fn clean_owned_user_values(efmi_root: &Path, hashes: &HashSet<String>) -> Result<bool, String> {
    if hashes.is_empty() {
        return Ok(false);
    }
    let user_ini = efmi_root.join("d3dx_user.ini");
    let bytes = match fs::read(&user_ini) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(format!("读取 d3dx_user.ini 失败：{error}")),
    };
    let mut out = Vec::with_capacity(bytes.len());
    for line in bytes.split_inclusive(|&b| b == b'\n') {
        let text = String::from_utf8_lossy(line);
        let rule = ini_rule(&text);
        let belongs_to_mod = rule.split_once('=').is_some_and(|(lhs, _)| {
            let lower = lhs.trim().to_ascii_lowercase();
            lower.strip_prefix("$\\efmm\\persist\\bridge_")
                .and_then(|rest| rest.split_once('\\'))
                .is_some_and(|(hash, _)| hashes.contains(hash))
        });
        if !belongs_to_mod {
            out.extend_from_slice(line);
        } else if line.starts_with(b"\xef\xbb\xbf") {
            out.extend_from_slice(b"\xef\xbb\xbf");
        }
    }
    if out.len() == bytes.len() {
        return Ok(false);
    }
    fs::write(&user_ini, out).map_err(|e| format!("写入 d3dx_user.ini 失败：{e}"))?;
    Ok(true)
}

pub fn reset_single_mod_dir_ini(
    cfg: &mut AppConfig,
    mod_dir: &Path,
    is_enabled: bool,
) -> Result<usize, String> {
    let efmi_root = efmi_root_from_cfg(cfg)?;
    let mods_root = Path::new(&cfg.mods_path);
    let cache_dir = cache_dir(&efmi_root);

    let mut count = 0usize;
    let mut hashes_to_clean = HashSet::new();

    // Find all backup and ini files directly inside mod_dir
    let mut bak_files = Vec::new();
    let mut ini_files = Vec::new();
    for entry in WalkDir::new(mod_dir).into_iter().flatten() {
        if !entry.file_type().is_file() {
            continue;
        }
        let fname = entry.file_name().to_string_lossy().to_ascii_lowercase();
        if is_owned_backup(&fname) {
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
        }
    }

    for bak in bak_files {
        restore_owned_backup(&bak)?;
        count += 1;
    }

    for h in &hashes_to_clean {
        let sf = format!("efmm_state_{h}.ini");
        let sp = cache_dir.join(&sf);
        if sp.is_file() {
            let _ = fs::remove_file(&sp);
            count += 1;
        }
        cfg.persist_bridge_recent
            .retain(|s| !s.eq_ignore_ascii_case(&sf));
    }

    count += usize::from(clean_owned_user_values(&efmi_root, &hashes_to_clean)?);

    // If Persist Bridge is enabled and this mod is enabled, re-bridge fresh from defaults
    if cfg.persist_bridge_enabled && is_enabled {
        on_mod_enabled(cfg, mod_dir);
    } else if cfg.persist_bridge_enabled && !legacy_state_is_mounted(&efmi_root) {
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
    Ok(count)
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
        total_mods += usize::from(reset_single_mod_dir_ini(cfg, &dir, is_enabled)? > 0);
    }
    Ok(total_mods)
}

pub fn clear_cache(cfg: &mut AppConfig) -> Result<usize, String> {
    let efmi_root = efmi_root_from_cfg(cfg)?;
    let mods_root = Path::new(&cfg.mods_path);
    let cache_dir = cache_dir(&efmi_root);

    let mut active_set = HashSet::new();
    let user_vals = parse_d3dx_user_values(&efmi_root);
    if cfg.persist_bridge_enabled {
        if let Some(conflict) = legacy_bridge_conflict(cfg) {
            return Err(conflict);
        }
        let enabled_states =
            collect_active_state_files_for_enabled_mods(mods_root, &efmi_root, &user_vals)?;
        for sf in &enabled_states {
            active_set.insert(sf.to_ascii_lowercase());
        }
        write_bridge_includers(&efmi_root, &enabled_states)?;
    } else {
        let active = active_file(&efmi_root);
        if active.is_file() {
            fs::write(active, b"; EFMM Persist Bridge disabled\r\n")
                .map_err(|e| format!("关闭 EFMM 状态挂载失败：{e}"))?;
        }
    }

    let mut removed = 0usize;
    let mut deleted_hashes = HashSet::new();
    if cache_dir.is_dir() {
        if let Ok(entries) = fs::read_dir(&cache_dir) {
            for entry in entries.flatten() {
                if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
                    continue;
                }
                let fname = entry.file_name().to_string_lossy().to_string();
                let low = fname.to_ascii_lowercase();
                if let Some(hash) = state_file_hash(&low) {
                    if !active_set.contains(&low) && fs::remove_file(entry.path()).is_ok() {
                        deleted_hashes.insert(hash.to_string());
                        removed += 1;
                    }
                }
            }
        }
    }

    clean_owned_user_values(&efmi_root, &deleted_hashes)?;
    cfg.persist_bridge_recent.clear();
    save_config(cfg)?;
    Ok(removed)
}

pub fn get_status(cfg: &AppConfig) -> PersistBridgeStatus {
    let Ok(efmi_root) = efmi_root_from_cfg(cfg) else {
        return PersistBridgeStatus {
            enabled: cfg.persist_bridge_enabled,
            legacy_conflict: false,
            cache_size: cfg.persist_bridge_cache_size,
            d3dx_mounted: false,
            active_state_count: 0,
            cache_file_count: 0,
            backup_file_count: 0,
        };
    };
    let mods_root = Path::new(&cfg.mods_path);
    let d3dx_mounted = is_d3dx_mounted(&efmi_root);

    let active_ini = active_file(&efmi_root);
    let active_state_count = fs::read_to_string(&active_ini)
        .map(|s| {
            s.lines()
                .filter(|line| {
                    include_value(ini_rule(line)).is_some_and(|path| {
                        path.strip_prefix("cache\\").is_some_and(|name| state_file_hash(name).is_some())
                    })
                })
                .count()
        })
        .unwrap_or(0);

    let cache_dir = cache_dir(&efmi_root);
    let cache_file_count = fs::read_dir(&cache_dir)
        .map(|it| {
            it.flatten()
                .filter(|e| {
                    e.file_type().map(|t| t.is_file()).unwrap_or(false)
                        && state_file_hash(&e.file_name().to_string_lossy().to_ascii_lowercase()).is_some()
                })
                .count()
        })
        .unwrap_or(0);

    let mut backup_file_count = 0;
    let legacy_conflict = legacy_bridge_conflict(cfg).is_some();
    for entry in WalkDir::new(mods_root).into_iter().flatten() {
        if entry.file_type().is_file() {
            let name = entry.file_name().to_string_lossy();
            backup_file_count += usize::from(is_owned_backup(&name));
        }
    }

    PersistBridgeStatus {
        enabled: cfg.persist_bridge_enabled,
        legacy_conflict,
        cache_size: cfg.persist_bridge_cache_size,
        d3dx_mounted,
        active_state_count,
        cache_file_count,
        backup_file_count,
    }
}
