use crate::characters::{
    default_character_names, match_character_from_text, now_iso_utc,
};
use crate::config::save_config;
use crate::fs_ops::assert_safe_segment;
use crate::ini_engine::{collect_ini_files, scan_mod_flags};
use crate::models::{
    AppConfig, ImportAnalysisResponse, ImportAnalyzedItem, ImportExecutionSummary,
    ImportItemResult, ImportPlanItem,
};
use crate::mods::{read_mod_tags_file, write_mod_tags_file};
use crate::persist_bridge;
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use walkdir::WalkDir;
use zip::ZipArchive;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

pub const DISGUISE_MAGIC: &[u8; 8] = b"QAQM0002";
pub const DISGUISE_XOR_KEY: [u8; 16] = [
    165, 163, 127, 209, 142, 66, 185, 106, 240, 29, 83, 200, 116, 43, 230, 145,
];
pub const DISGUISE_PASSWORD: &str = "qsl";
const LARGE_ARCHIVE_WARN_BYTES: u64 = 10 * 1024 * 1024 * 1024;

pub struct ImportSession {
    pub temp_roots: Vec<PathBuf>,
    pub staged_by_item_id: HashMap<String, PathBuf>,
}

#[derive(Default)]
pub struct ImportSessionStore {
    pub sessions: Mutex<HashMap<String, ImportSession>>,
}

impl ImportSessionStore {
    pub fn cleanup_session(&self, session_id: &str) {
        if let Ok(mut guard) = self.sessions.lock() {
            if let Some(sess) = guard.remove(session_id) {
                for dir in sess.temp_roots {
                    let _ = fs::remove_dir_all(dir);
                }
            }
        }
    }
}

fn decode_zip_entry_name(raw: &[u8]) -> String {
    if let Ok(s) = std::str::from_utf8(raw) {
        return s.replace('\\', "/");
    }
    let (cow, _, _) = encoding_rs::GB18030.decode(raw);
    cow.replace('\\', "/")
}

fn safe_rel_path(rel: &str) -> Option<PathBuf> {
    let mut out = PathBuf::new();
    for comp in Path::new(&rel.replace('\\', "/")).components() {
        match comp {
            Component::Normal(part) => {
                let s = part.to_string_lossy();
                if s.contains(':') || s.chars().any(|c| matches!(c, '<' | '>' | '"' | '|' | '?' | '*')) {
                    let sanitized: String = s
                        .chars()
                        .map(|c| {
                            if matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*') {
                                '_'
                            } else {
                                c
                            }
                        })
                        .collect();
                    out.push(sanitized);
                } else {
                    out.push(part);
                }
            }
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => return None,
        }
    }
    if out.as_os_str().is_empty() {
        None
    } else {
        Some(out)
    }
}

pub fn extract_zip_safe(zip_path: &Path, dest_dir: &Path) -> Result<usize, String> {
    let file = File::open(zip_path)
        .map_err(|e| format!("打开 ZIP 文件失败（{}）：{e}", zip_path.display()))?;
    let mut archive =
        ZipArchive::new(file).map_err(|e| format!("解析 ZIP 压缩包失败：{e}"))?;
    fs::create_dir_all(dest_dir).map_err(|e| format!("创建解压目录失败：{e}"))?;

    let mut count = 0usize;
    for idx in 0..archive.len() {
        let mut entry = archive
            .by_index(idx)
            .map_err(|e| format!("读取 ZIP 条目失败：{e}"))?;
        let raw_name = entry.name_raw().to_vec();
        let decoded = decode_zip_entry_name(&raw_name);
        let Some(rel_path) = safe_rel_path(&decoded) else {
            continue;
        };
        let target = dest_dir.join(&rel_path);
        if entry.is_dir() || decoded.ends_with('/') {
            fs::create_dir_all(&target).map_err(|e| format!("创建目录失败：{e}"))?;
            continue;
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("创建父目录失败：{e}"))?;
        }
        let mut out_file =
            File::create(&target).map_err(|e| format!("写出文件失败（{}）：{e}", target.display()))?;
        std::io::copy(&mut entry, &mut out_file)
            .map_err(|e| format!("解压文件失败（{}）：{e}", target.display()))?;
        count += 1;
    }
    Ok(count)
}

pub fn find_disguise_magic(file_path: &Path) -> Option<u64> {
    let mut file = File::open(file_path).ok()?;
    let file_size = file.metadata().ok()?.len();
    if file_size < DISGUISE_MAGIC.len() as u64 {
        return None;
    }

    const CHUNK_SIZE: usize = 4 * 1024 * 1024;
    let overlap = DISGUISE_MAGIC.len() - 1;
    let mut pos = file_size;
    let mut carry: Vec<u8> = Vec::new();

    while pos > 0 {
        let read_len = std::cmp::min(CHUNK_SIZE as u64, pos) as usize;
        pos -= read_len as u64;
        if file.seek(SeekFrom::Start(pos)).is_err() {
            return None;
        }
        let mut chunk = vec![0u8; read_len + carry.len()];
        if file.read_exact(&mut chunk[..read_len]).is_err() {
            return None;
        }
        if !carry.is_empty() {
            chunk[read_len..].copy_from_slice(&carry);
        }
        if let Some(idx) = chunk
            .windows(DISGUISE_MAGIC.len())
            .rposition(|w| w == DISGUISE_MAGIC)
        {
            return Some(pos + idx as u64);
        }
        let take = std::cmp::min(overlap, chunk.len());
        carry = chunk[..take].to_vec();
    }
    None
}

pub fn is_disguised_mp4(file_path: &Path) -> bool {
    let ext = file_path
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
    if ext != "mp4" || !file_path.is_file() {
        return false;
    }
    find_disguise_magic(file_path).is_some()
}

fn find_external_tool(candidates: &[&str], program_files_paths: &[&str]) -> Option<PathBuf> {
    if let Ok(cur_exe) = std::env::current_exe() {
        if let Some(dir) = cur_exe.parent() {
            for c in candidates {
                let p = dir.join(c);
                if p.is_file() {
                    return Some(p);
                }
                let bin_p = dir.join("bin").join(c);
                if bin_p.is_file() {
                    return Some(bin_p);
                }
            }
        }
    }
    for abs in program_files_paths {
        let p = PathBuf::from(abs);
        if p.is_file() {
            return Some(p);
        }
    }
    for name in candidates {
        if let Some(paths) = std::env::var_os("PATH") {
            for pdir in std::env::split_paths(&paths) {
                let cand = pdir.join(name);
                if cand.is_file() {
                    return Some(cand);
                }
            }
        }
    }
    None
}

fn run_hidden_command(exe: &Path, args: &[&str]) -> Result<(), String> {
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut cmd = Command::new(exe);
    cmd.args(args);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let output = cmd
        .output()
        .map_err(|e| format!("调用解压程序失败（{}）：{e}", exe.display()))?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        let out = String::from_utf8_lossy(&output.stdout);
        return Err(format!("解压命令返回错误：{} {}", err.trim(), out.trim()));
    }
    Ok(())
}

fn extract_with_external_or_tar(
    archive_path: &Path,
    dest_dir: &Path,
    password: Option<&str>,
) -> Result<(), String> {
    fs::create_dir_all(dest_dir).map_err(|e| format!("创建临时解压目录失败：{e}"))?;
    let ext = archive_path
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();

    let archive_str = archive_path.to_string_lossy().to_string();
    let out_flag = format!("-o{}", dest_dir.to_string_lossy());

    if ext == "rar" {
        if let Some(unrar) = find_external_tool(
            &["UnRAR.exe", "unrar.exe"],
            &[r"C:\Program Files\WinRAR\UnRAR.exe"],
        ) {
            let mut args = vec!["x", "-y", "-idq"];
            let pw_arg;
            if let Some(pw) = password {
                pw_arg = format!("-p{pw}");
                args.push(&pw_arg);
            } else {
                args.push("-p-");
            }
            args.push(&archive_str);
            let dest_str = dest_dir.to_string_lossy().to_string();
            args.push(&dest_str);
            return run_hidden_command(&unrar, &args);
        }
    }

    if let Some(sevenz) = find_external_tool(
        &["7za.exe", "7z.exe"],
        &[
            r"C:\Program Files\7-Zip\7z.exe",
            r"C:\Program Files (x86)\7-Zip\7z.exe",
        ],
    ) {
        let mut args = vec!["x", "-y", &out_flag];
        let pw_arg;
        if let Some(pw) = password {
            pw_arg = format!("-p{pw}");
            args.push(&pw_arg);
        } else {
            args.push("-p");
        }
        args.push(&archive_str);
        return run_hidden_command(&sevenz, &args);
    }

    // Windows 10/11 built-in bsdtar (supports unencrypted zip/7z/tar/iso/some rar)
    let dest_str = dest_dir.to_string_lossy().to_string();
    run_hidden_command(Path::new("tar.exe"), &["-xf", &archive_str, "-C", &dest_str])
        .map_err(|e| {
            format!(
                "解压失败（若为加密 RAR/7z 归档请先安装 7-Zip 或放 7za.exe 至程序目录）：{e}"
            )
        })
}

pub fn decrypt_disguised_mp4_to_dir(
    mp4_path: &Path,
    dest_dir: &Path,
    temp_work_dir: &Path,
) -> Result<(), String> {
    let magic_off = find_disguise_magic(mp4_path)
        .ok_or_else(|| "该 MP4 文件不包含伪装数据头（不是有效的加密 Mod 视频）".to_string())?;
    let data_offset = magic_off + DISGUISE_MAGIC.len() as u64;
    let mut in_file =
        File::open(mp4_path).map_err(|e| format!("读取 MP4 文件失败：{}", e))?;
    let total_size = in_file
        .metadata()
        .map_err(|e| format!("获取 MP4 大小失败：{e}"))?
        .len();
    if total_size <= data_offset {
        return Err("MP4 伪装载荷为空".to_string());
    }
    in_file
        .seek(SeekFrom::Start(data_offset))
        .map_err(|e| format!("定位 MP4 载荷失败：{e}"))?;

    fs::create_dir_all(temp_work_dir).map_err(|e| format!("创建临时目录失败：{e}"))?;
    let decoded_path = temp_work_dir.join("payload.bin");
    let mut out_file =
        File::create(&decoded_path).map_err(|e| format!("写入解密临时文件失败：{e}"))?;

    let mut buf = vec![0u8; 4 * 1024 * 1024];
    let mut offset = 0usize;
    let mut head_magic = [0u8; 8];
    let mut head_captured = 0usize;

    loop {
        let n = in_file
            .read(&mut buf)
            .map_err(|e| format!("读取 MP4 载荷失败：{e}"))?;
        if n == 0 {
            break;
        }
        for byte in &mut buf[..n] {
            *byte ^= DISGUISE_XOR_KEY[offset & 15];
            if head_captured < 8 {
                head_magic[head_captured] = *byte;
                head_captured += 1;
            }
            offset += 1;
        }
        out_file
            .write_all(&buf[..n])
            .map_err(|e| format!("写出解密载荷失败：{e}"))?;
    }
    drop(out_file);

    fs::create_dir_all(dest_dir).map_err(|e| format!("创建目标解压目录失败：{e}"))?;

    if head_captured >= 4 && head_magic[0..4] == [0x50, 0x4B, 0x03, 0x04] {
        let zip_path = temp_work_dir.join("outer.zip");
        let _ = fs::rename(&decoded_path, &zip_path);
        let stage1 = temp_work_dir.join("stage1");
        extract_zip_safe(&zip_path, &stage1)?;

        // Check if outer zip holds single encrypted inner .7z archive (QAQM disguise v2 pattern)
        let top_entries: Vec<PathBuf> = fs::read_dir(&stage1)
            .into_iter()
            .flatten()
            .flatten()
            .map(|e| e.path())
            .collect();
        if top_entries.len() == 1
            && top_entries[0].is_file()
            && top_entries[0]
                .extension()
                .and_then(|s| s.to_str())
                .map(|s| s.eq_ignore_ascii_case("7z"))
                .unwrap_or(false)
        {
            if extract_with_external_or_tar(&top_entries[0], dest_dir, Some(DISGUISE_PASSWORD))
                .is_err()
            {
                extract_with_external_or_tar(&top_entries[0], dest_dir, None)?;
            }
        } else {
            copy_dir_contents(&stage1, dest_dir)?;
        }
        return Ok(());
    }

    if head_captured >= 6 && head_magic[0..6] == [0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C] {
        let arc_7z = temp_work_dir.join("outer.7z");
        let _ = fs::rename(&decoded_path, &arc_7z);
        if extract_with_external_or_tar(&arc_7z, dest_dir, Some(DISGUISE_PASSWORD)).is_err() {
            extract_with_external_or_tar(&arc_7z, dest_dir, None)?;
        }
        return Ok(());
    }

    Err("未能识别解密后的压缩包格式".to_string())
}

pub fn extract_archive_to_dir(
    archive_path: &Path,
    dest_dir: &Path,
    temp_work_dir: &Path,
) -> Result<bool, String> {
    let ext = archive_path
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();

    match ext.as_str() {
        "zip" => {
            extract_zip_safe(archive_path, dest_dir)?;
            Ok(false)
        }
        "mp4" => {
            if !is_disguised_mp4(archive_path) {
                return Err("普通 MP4 视频文件，未包含 Mod 伪装数据，已自动跳过".to_string());
            }
            decrypt_disguised_mp4_to_dir(archive_path, dest_dir, temp_work_dir)?;
            Ok(true)
        }
        "7z" | "rar" | "exe" => {
            extract_with_external_or_tar(archive_path, dest_dir, None)?;
            Ok(false)
        }
        _ => Err(format!("不支持的归档格式：.{}", ext)),
    }
}

pub fn copy_dir_contents(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("创建目标目录失败（{}）：{e}", dst.display()))?;
    for entry in fs::read_dir(src).map_err(|e| format!("读取目录失败：{e}"))?.flatten() {
        let s_path = entry.path();
        let d_path = dst.join(entry.file_name());
        if s_path.is_dir() {
            copy_dir_contents(&s_path, &d_path)?;
        } else if s_path.is_file() {
            fs::copy(&s_path, &d_path)
                .map_err(|e| format!("复制文件失败（{}）：{e}", d_path.display()))?;
        }
    }
    Ok(())
}

fn dir_contains_mod_markers(dir: &Path) -> bool {
    WalkDir::new(dir)
        .max_depth(3)
        .into_iter()
        .flatten()
        .any(|e| {
            if !e.file_type().is_file() {
                return false;
            }
            let low = e.file_name().to_string_lossy().to_ascii_lowercase();
            (low.ends_with(".ini") && low != "desktop.ini") || low == "compiled.bin"
        })
}

fn looks_like_modpack_root(dir: &Path) -> Option<PathBuf> {
    // Pattern 1: root/Mods/<Char>/<Mod>
    let mods_sub = dir.join("Mods");
    if mods_sub.is_dir() {
        return Some(mods_sub);
    }
    // Pattern 2: root has >= 2 character-named subdirectories whose children contain .ini files
    let known_chars: std::collections::HashSet<&str> = default_character_names()
        .iter()
        .map(|s| s.as_str())
        .collect();
    let subdirs: Vec<PathBuf> = fs::read_dir(dir)
        .ok()?
        .flatten()
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .map(|e| e.path())
        .collect();
    let char_hits = subdirs
        .iter()
        .filter(|p| {
            p.file_name()
                .and_then(|s| s.to_str())
                .map(|n| known_chars.contains(n))
                .unwrap_or(false)
        })
        .count();
    if char_hits >= 2 {
        return Some(dir.to_path_buf());
    }
    None
}

fn list_existing_chars(mods_root: &Path) -> Vec<String> {
    let mut set = Vec::new();
    for c in default_character_names() {
        set.push(c.clone());
    }
    if mods_root.is_dir() {
        if let Ok(entries) = fs::read_dir(mods_root) {
            for e in entries.flatten() {
                if e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    let n = e.file_name().to_string_lossy().to_string();
                    if !n.starts_with('.') && !set.contains(&n) {
                        set.push(n);
                    }
                }
            }
        }
    }
    set
}

fn dir_size_bytes(dir: &Path) -> u64 {
    WalkDir::new(dir)
        .into_iter()
        .flatten()
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| e.metadata().ok())
        .map(|m| m.len())
        .sum()
}

pub fn analyze_import_sources(
    cfg: &AppConfig,
    store: &ImportSessionStore,
    source_paths: Vec<String>,
    locked_character: Option<String>,
) -> Result<ImportAnalysisResponse, String> {
    if source_paths.is_empty() {
        return Err("请至少选择一个待导入的文件或文件夹".to_string());
    }
    let mods_root = Path::new(&cfg.mods_path);
    let existing_chars = list_existing_chars(mods_root);

    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let session_id = format!("imp_{nanos}");
    let session_tmp = std::env::temp_dir().join(format!("efmm_import_{nanos}"));
    fs::create_dir_all(&session_tmp).map_err(|e| format!("创建临时导入目录失败：{e}"))?;

    let temp_roots = vec![session_tmp.clone()];
    let mut staged_by_item_id: HashMap<String, PathBuf> = HashMap::new();
    let mut items: Vec<ImportAnalyzedItem> = Vec::new();
    let mut skipped_messages: Vec<String> = Vec::new();
    let mut counter = 0usize;

    for raw_src in source_paths {
        let src_path = PathBuf::from(raw_src.trim());
        if !src_path.exists() {
            skipped_messages.push(format!("路径不存在，已跳过：{}", src_path.display()));
            continue;
        }

        let file_name = src_path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("ImportedMod")
            .to_string();

        let (inspect_root, original_stem, is_disguised, file_size, is_large) = if src_path.is_file()
        {
            let size = src_path.metadata().map(|m| m.len()).unwrap_or(0);
            let ext = src_path
                .extension()
                .and_then(|s| s.to_str())
                .map(|s| s.to_ascii_lowercase())
                .unwrap_or_default();
            let large = ext != "mp4" && size >= LARGE_ARCHIVE_WARN_BYTES;
            let stem = src_path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("ImportedMod")
                .to_string();

            counter += 1;
            let extract_dest = session_tmp.join(format!("arc_{counter}"));
            let extract_work = session_tmp.join(format!("work_{counter}"));
            match extract_archive_to_dir(&src_path, &extract_dest, &extract_work) {
                Ok(disguised) => (extract_dest, stem, disguised, size, large),
                Err(msg) => {
                    skipped_messages.push(format!("{file_name}：{msg}"));
                    continue;
                }
            }
        } else if src_path.is_dir() {
            let size = dir_size_bytes(&src_path);
            (src_path.clone(), file_name.clone(), false, size, false)
        } else {
            continue;
        };

        // Case A: Modpack (Mods/<Char>/<Mod> or multi-char folders)
        if locked_character.is_none() {
            if let Some(pack_root) = looks_like_modpack_root(&inspect_root) {
                if let Ok(char_entries) = fs::read_dir(&pack_root) {
                    for c_entry in char_entries.flatten() {
                        if !c_entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                            continue;
                        }
                        let c_name = c_entry.file_name().to_string_lossy().to_string();
                        if c_name.starts_with('.') {
                            continue;
                        }
                        let resolved_char =
                            match_character_from_text(&c_name, &existing_chars)
                                .map(|(zh, _)| zh)
                                .unwrap_or_else(|| c_name.clone());

                        if let Ok(mod_entries) = fs::read_dir(c_entry.path()) {
                            for m_entry in mod_entries.flatten() {
                                if !m_entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                                    continue;
                                }
                                let m_dir_name = m_entry.file_name().to_string_lossy().to_string();
                                if m_dir_name.starts_with('.') {
                                    continue;
                                }
                                let clean_m_name = m_dir_name
                                    .strip_prefix("DISABLED_")
                                    .unwrap_or(&m_dir_name)
                                    .to_string();
                                counter += 1;
                                let item_id = format!("item_{counter}");
                                let m_path = m_entry.path();
                                let inis = collect_ini_files(&m_path);
                                let (_, _, is_eff) = scan_mod_flags(&m_path, &inis);
                                let warn = if is_eff {
                                    Some("检测到 EFF 框架 Mod（compiled.bin / format 2），建议安装到 EFF 加载器目录而非 EFMI\\Mods".to_string())
                                } else {
                                    None
                                };
                                staged_by_item_id.insert(item_id.clone(), m_path.clone());
                                items.push(ImportAnalyzedItem {
                                    item_id,
                                    original_path: src_path.to_string_lossy().to_string(),
                                    staged_path: m_path.to_string_lossy().to_string(),
                                    display_name: clean_m_name.clone(),
                                    import_kind: "modpack".to_string(),
                                    suggested_character: Some(resolved_char.clone()),
                                    match_confidence: "high".to_string(),
                                    suggested_mod_name: clean_m_name,
                                    is_eff_mod: is_eff,
                                    is_disguised_mp4: is_disguised,
                                    is_large_archive: is_large,
                                    file_size_bytes: file_size,
                                    warning: warn,
                                });
                            }
                        }
                    }
                }
                if !items.is_empty() {
                    continue;
                }
            }
        }

        // Case B: Check unwrap when archive created a single wrapping subfolder
        let mut candidate_root = inspect_root.clone();
        let mut candidate_name = original_stem.clone();
        if src_path.is_file() {
            let entries: Vec<PathBuf> = fs::read_dir(&inspect_root)
                .into_iter()
                .flatten()
                .flatten()
                .map(|e| e.path())
                .filter(|p| {
                    p.file_name()
                        .and_then(|s| s.to_str())
                        .map(|n| !n.eq_ignore_ascii_case("__MACOSX") && !n.starts_with('.'))
                        .unwrap_or(false)
                })
                .collect();
            let has_top_ini = entries.iter().any(|p| {
                p.is_file()
                    && p.extension()
                        .and_then(|s| s.to_str())
                        .map(|e| e.eq_ignore_ascii_case("ini") || e.eq_ignore_ascii_case("bin"))
                        .unwrap_or(false)
            });
            if !has_top_ini && entries.len() == 1 && entries[0].is_dir() {
                candidate_root = entries[0].clone();
                if let Some(sub_n) = candidate_root.file_name().and_then(|s| s.to_str()) {
                    candidate_name = sub_n.to_string();
                }
            } else if !has_top_ini && entries.len() > 1 && entries.iter().all(|p| p.is_dir()) {
                // Multi-mod bundle inside archive (siblings each having .ini)
                let mod_children: Vec<PathBuf> = entries
                    .into_iter()
                    .filter(|p| dir_contains_mod_markers(p))
                    .collect();
                if mod_children.len() > 1 {
                    for mc in mod_children {
                        counter += 1;
                        let item_id = format!("item_{counter}");
                        let cname = mc
                            .file_name()
                            .and_then(|s| s.to_str())
                            .unwrap_or("Mod")
                            .strip_prefix("DISABLED_")
                            .unwrap_or_else(|| mc.file_name().and_then(|s| s.to_str()).unwrap_or("Mod"))
                            .to_string();
                        let inis = collect_ini_files(&mc);
                        let (_, _, is_eff) = scan_mod_flags(&mc, &inis);
                        let (sugg_char, conf) = if let Some(ref locked) = locked_character {
                            (Some(locked.clone()), "high".to_string())
                        } else if let Some((ch, _)) =
                            match_character_from_text(&cname, &existing_chars)
                        {
                            (Some(ch), "high".to_string())
                        } else if let Some((ch, _)) =
                            match_character_from_text(&original_stem, &existing_chars)
                        {
                            (Some(ch), "medium".to_string())
                        } else {
                            (None, "none".to_string())
                        };
                        let warn = if is_eff {
                            Some("检测到 EFF 框架 Mod（compiled.bin / format 2），不应放入 EFMI\\Mods".to_string())
                        } else {
                            None
                        };
                        staged_by_item_id.insert(item_id.clone(), mc.clone());
                        items.push(ImportAnalyzedItem {
                            item_id,
                            original_path: src_path.to_string_lossy().to_string(),
                            staged_path: mc.to_string_lossy().to_string(),
                            display_name: cname.clone(),
                            import_kind: "multi".to_string(),
                            suggested_character: sugg_char,
                            match_confidence: conf,
                            suggested_mod_name: cname,
                            is_eff_mod: is_eff,
                            is_disguised_mp4: is_disguised,
                            is_large_archive: is_large,
                            file_size_bytes: dir_size_bytes(&mc),
                            warning: warn,
                        });
                    }
                    continue;
                }
            }
        }

        // Case C: Single Mod folder
        counter += 1;
        let item_id = format!("item_{counter}");
        let clean_name = candidate_name
            .strip_prefix("DISABLED_")
            .unwrap_or(&candidate_name)
            .to_string();
        let inis = collect_ini_files(&candidate_root);
        let (_, _, is_eff) = scan_mod_flags(&candidate_root, &inis);

        let (sugg_char, conf) = if let Some(ref locked) = locked_character {
            (Some(locked.clone()), "high".to_string())
        } else if let Some((ch, _)) = match_character_from_text(&clean_name, &existing_chars) {
            (Some(ch), "high".to_string())
        } else if let Some((ch, _)) = match_character_from_text(&original_stem, &existing_chars) {
            (Some(ch), "medium".to_string())
        } else {
            (None, "none".to_string())
        };

        let mut warnings = Vec::new();
        if is_eff {
            warnings.push("检测到 EFF 框架 Mod（compiled.bin / format 2），不应放入 EFMI\\Mods".to_string());
        }
        if is_large {
            warnings.push("压缩包体积超过 10GB，若解压较慢建议使用 7-Zip 手动解压后直接拖入文件夹".to_string());
        }
        if !dir_contains_mod_markers(&candidate_root) {
            warnings.push("未在该目录内发现 .ini 文件，请确认是否为有效 Mod 目录".to_string());
        }

        staged_by_item_id.insert(item_id.clone(), candidate_root.clone());
        items.push(ImportAnalyzedItem {
            item_id,
            original_path: src_path.to_string_lossy().to_string(),
            staged_path: candidate_root.to_string_lossy().to_string(),
            display_name: clean_name.clone(),
            import_kind: "single".to_string(),
            suggested_character: sugg_char,
            match_confidence: conf,
            suggested_mod_name: clean_name,
            is_eff_mod: is_eff,
            is_disguised_mp4: is_disguised,
            is_large_archive: is_large,
            file_size_bytes: file_size,
            warning: if warnings.is_empty() {
                None
            } else {
                Some(warnings.join("；"))
            },
        });
    }

    let _ = temp_roots.len();
    if let Ok(mut guard) = store.sessions.lock() {
        guard.insert(
            session_id.clone(),
            ImportSession {
                temp_roots,
                staged_by_item_id,
            },
        );
    }

    Ok(ImportAnalysisResponse {
        session_id,
        items,
        skipped_messages,
    })
}

fn find_unique_mod_dir(char_dir: &Path, clean_mod_name: &str) -> (PathBuf, String) {
    let mut candidate = clean_mod_name.to_string();
    let mut idx = 2usize;
    loop {
        let enabled_path = char_dir.join(&candidate);
        let disabled_path = char_dir.join(format!("DISABLED_{candidate}"));
        if !enabled_path.exists() && !disabled_path.exists() {
            return (enabled_path, candidate);
        }
        candidate = format!("{clean_mod_name} ({idx})");
        idx += 1;
    }
}

pub fn execute_import_plan(
    cfg: &mut AppConfig,
    store: &ImportSessionStore,
    session_id: &str,
    plans: Vec<ImportPlanItem>,
) -> Result<ImportExecutionSummary, String> {
    let mods_root = Path::new(&cfg.mods_path).to_path_buf();
    if cfg.mods_path.trim().is_empty() || !mods_root.is_dir() {
        return Err("Mods 目录未配置或不存在".to_string());
    }

    let staged_map = {
        let guard = store.sessions.lock().map_err(|_| "导入会话锁异常".to_string())?;
        guard
            .get(session_id)
            .map(|s| s.staged_by_item_id.clone())
            .ok_or_else(|| "导入会话已过期或不存在".to_string())?
    };

    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    let mut installed_count = 0usize;
    let mut skipped_count = 0usize;
    let mut failed_count = 0usize;
    let mut results = Vec::new();

    for plan in plans {
        if plan.skip {
            skipped_count += 1;
            results.push(ImportItemResult {
                item_id: plan.item_id,
                mod_name: plan.target_mod_name,
                target_character: plan.target_character,
                success: true,
                message: "用户已跳过".to_string(),
            });
            continue;
        }

        let Some(src_dir) = staged_map.get(&plan.item_id) else {
            failed_count += 1;
            results.push(ImportItemResult {
                item_id: plan.item_id,
                mod_name: plan.target_mod_name,
                target_character: plan.target_character,
                success: false,
                message: "找不到暂存目录".to_string(),
            });
            continue;
        };

        let safe_char = match assert_safe_segment(&plan.target_character, "角色名称") {
            Ok(s) => s,
            Err(e) => {
                failed_count += 1;
                results.push(ImportItemResult {
                    item_id: plan.item_id,
                    mod_name: plan.target_mod_name,
                    target_character: plan.target_character,
                    success: false,
                    message: e,
                });
                continue;
            }
        };
        let safe_mod = match assert_safe_segment(&plan.target_mod_name, "Mod 名称") {
            Ok(s) => s,
            Err(e) => {
                failed_count += 1;
                results.push(ImportItemResult {
                    item_id: plan.item_id,
                    mod_name: plan.target_mod_name,
                    target_character: plan.target_character,
                    success: false,
                    message: e,
                });
                continue;
            }
        };

        let char_dir = mods_root.join(&safe_char);
        if !char_dir.exists() {
            if let Err(e) = fs::create_dir_all(&char_dir) {
                failed_count += 1;
                results.push(ImportItemResult {
                    item_id: plan.item_id,
                    mod_name: safe_mod,
                    target_character: safe_char,
                    success: false,
                    message: format!("创建角色目录失败：{e}"),
                });
                continue;
            }
        }

        let (dst_dir, final_mod_name) = find_unique_mod_dir(&char_dir, &safe_mod);
        if let Err(e) = copy_dir_contents(src_dir, &dst_dir) {
            failed_count += 1;
            results.push(ImportItemResult {
                item_id: plan.item_id,
                mod_name: final_mod_name,
                target_character: safe_char,
                success: false,
                message: e,
            });
            continue;
        }

        // Write appearance section tag if specified
        let sec = plan.target_section_id.trim();
        let mut tags_file = read_mod_tags_file(&dst_dir);
        tags_file.qaqm = Some(serde_json::json!({
            "appearanceSectionId": if sec.is_empty() { "base" } else { sec },
            "classificationSource": if sec.is_empty() || sec == "base" { "base-fallback" } else { "manual" },
            "appearanceAssignedAt": now_iso_utc(),
        }));
        let _ = write_mod_tags_file(&dst_dir, &mut tags_file);

        cfg.mod_added_at
            .insert(format!("{safe_char}/{final_mod_name}"), now_ms);
        if cfg.persist_bridge_enabled {
            persist_bridge::on_mod_enabled(cfg, &dst_dir);
        }

        installed_count += 1;
        results.push(ImportItemResult {
            item_id: plan.item_id,
            mod_name: final_mod_name,
            target_character: safe_char,
            success: true,
            message: "安装成功".to_string(),
        });
    }

    let _ = save_config(cfg);
    store.cleanup_session(session_id);

    Ok(ImportExecutionSummary {
        installed_count,
        skipped_count,
        failed_count,
        results,
    })
}
