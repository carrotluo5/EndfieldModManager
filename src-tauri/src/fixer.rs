use crate::characters::now_iso_utc;
use crate::fs_ops::assert_safe_segment;
use crate::models::{AppConfig, FixBackupEntry, FixerRunReport};
use crate::mods::resolve_mod_dir;
use crate::persist_bridge;
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use walkdir::WalkDir;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const BACKUPS_DIR_NAME: &str = ".efmm-backups";

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupMeta {
    created_at: String,
    fixer_name: String,
    file_count: usize,
}

fn collect_mod_ini_files_including_disabled_subdirs(mod_dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for entry in WalkDir::new(mod_dir)
        .into_iter()
        .filter_entry(|e| {
            let n = e.file_name().to_string_lossy();
            n != BACKUPS_DIR_NAME
        })
        .flatten()
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let low = entry.file_name().to_string_lossy().to_ascii_lowercase();
        if low.ends_with(".ini") && low != "desktop.ini" {
            out.push(entry.into_path());
        }
    }
    out.sort();
    out
}

pub fn create_mod_ini_backup(
    mod_dir: &Path,
    fixer_name: &str,
) -> Result<Option<FixBackupEntry>, String> {
    let inis = collect_mod_ini_files_including_disabled_subdirs(mod_dir);
    if inis.is_empty() {
        return Ok(None);
    }
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let backups_parent = mod_dir.join(BACKUPS_DIR_NAME);
    let mut suffix = 0usize;
    let (backup_id, bak_root) = loop {
        let cand_id = if suffix == 0 {
            format!("bak_{millis}")
        } else {
            format!("bak_{millis}_{suffix}")
        };
        let cand_root = backups_parent.join(&cand_id);
        if !cand_root.exists() {
            break (cand_id, cand_root);
        }
        suffix += 1;
    };
    fs::create_dir_all(&bak_root).map_err(|e| format!("创建修复备份目录失败：{e}"))?;

    let mut copied = 0usize;
    for ini_path in inis {
        let Ok(rel) = ini_path.strip_prefix(mod_dir) else {
            continue;
        };
        let dst = bak_root.join(rel);
        if let Some(p) = dst.parent() {
            fs::create_dir_all(p).map_err(|e| format!("创建备份子目录失败：{e}"))?;
        }
        fs::copy(&ini_path, &dst).map_err(|e| format!("备份 INI 文件失败：{e}"))?;
        copied += 1;
    }

    let created_at = now_iso_utc();
    let meta = BackupMeta {
        created_at: created_at.clone(),
        fixer_name: fixer_name.to_string(),
        file_count: copied,
    };
    let _ = fs::write(
        bak_root.join("meta.json"),
        serde_json::to_string_pretty(&meta).unwrap_or_default(),
    );

    Ok(Some(FixBackupEntry {
        id: backup_id,
        created_at,
        fixer_name: fixer_name.to_string(),
        file_count: copied,
    }))
}

pub fn list_mod_fix_backups(
    cfg: &AppConfig,
    character_name: &str,
    mod_name: &str,
) -> Result<Vec<FixBackupEntry>, String> {
    let (mod_dir, _) = resolve_mod_dir(cfg, character_name, mod_name)?;
    let bak_base = mod_dir.join(BACKUPS_DIR_NAME);
    if !bak_base.is_dir() {
        return Ok(Vec::new());
    }
    let mut entries = Vec::new();
    for entry in fs::read_dir(&bak_base)
        .map_err(|e| format!("读取备份列表失败：{e}"))?
        .flatten()
    {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let id = entry.file_name().to_string_lossy().to_string();
        let meta_path = entry.path().join("meta.json");
        let meta = fs::read_to_string(&meta_path)
            .ok()
            .and_then(|s| serde_json::from_str::<BackupMeta>(s.trim_start_matches('\u{feff}')).ok())
            .unwrap_or_else(|| BackupMeta {
                created_at: String::new(),
                fixer_name: "未知工具".to_string(),
                file_count: collect_mod_ini_files_including_disabled_subdirs(&entry.path()).len(),
            });
        entries.push(FixBackupEntry {
            id,
            created_at: meta.created_at,
            fixer_name: meta.fixer_name,
            file_count: meta.file_count,
        });
    }
    entries.sort_by(|a, b| b.id.cmp(&a.id));
    Ok(entries)
}

pub fn rollback_mod_fix_backup(
    cfg: &mut AppConfig,
    character_name: &str,
    mod_name: &str,
    backup_id: &str,
) -> Result<usize, String> {
    let safe_id = assert_safe_segment(backup_id, "备份 ID")?;
    let (mod_dir, is_enabled) = resolve_mod_dir(cfg, character_name, mod_name)?;
    let bak_root = mod_dir.join(BACKUPS_DIR_NAME).join(&safe_id);
    if !bak_root.is_dir() {
        return Err("找不到指定的修复备份版本".to_string());
    }

    let mut restored = 0usize;
    for entry in WalkDir::new(&bak_root).into_iter().flatten() {
        if !entry.file_type().is_file() {
            continue;
        }
        let fname = entry.file_name().to_string_lossy().to_ascii_lowercase();
        if fname == "meta.json" || !fname.ends_with(".ini") {
            continue;
        }
        let Ok(rel) = entry.path().strip_prefix(&bak_root) else {
            continue;
        };
        let dst = mod_dir.join(rel);
        if let Some(parent) = dst.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("还原目录失败：{e}"))?;
        }
        fs::copy(entry.path(), &dst).map_err(|e| format!("还原 INI 文件失败：{e}"))?;
        restored += 1;
    }

    if cfg.persist_bridge_enabled && is_enabled {
        persist_bridge::on_mod_enabled(cfg, &mod_dir);
    }
    Ok(restored)
}

fn normalize_single_ini(ini_path: &Path) -> Result<bool, String> {
    let bytes = fs::read(ini_path).map_err(|e| format!("读取 INI 失败：{e}"))?;
    let raw_str = String::from_utf8_lossy(&bytes);
    let stripped_bom = raw_str.strip_prefix('\u{FEFF}').unwrap_or(&raw_str);
    let eol = if stripped_bom.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let ends_with_nl = stripped_bom.ends_with('\n');

    let mut out_lines: Vec<String> = Vec::new();
    let mut blank_run = 0usize;
    for raw_line in stripped_bom.split('\n') {
        let line = raw_line.strip_suffix('\r').unwrap_or(raw_line).trim_end();
        if line.is_empty() {
            blank_run += 1;
            if blank_run <= 2 {
                out_lines.push(String::new());
            }
        } else {
            blank_run = 0;
            out_lines.push(line.to_string());
        }
    }
    while out_lines.last().map(|l| l.is_empty()).unwrap_or(false) && ends_with_nl {
        out_lines.pop();
    }

    let mut rebuilt = out_lines.join(eol);
    if ends_with_nl && !rebuilt.is_empty() {
        rebuilt.push_str(eol);
    }

    if rebuilt.as_bytes() == bytes.as_slice() {
        return Ok(false);
    }
    fs::write(ini_path, rebuilt.as_bytes()).map_err(|e| format!("写回规范化 INI 失败：{e}"))?;
    Ok(true)
}

fn collect_target_mod_dirs(
    cfg: &AppConfig,
    scope_kind: &str,
    character_name: Option<&str>,
    mod_name: Option<&str>,
) -> Result<(PathBuf, Vec<PathBuf>), String> {
    let mods_root = Path::new(&cfg.mods_path);
    if cfg.mods_path.trim().is_empty() || !mods_root.is_dir() {
        return Err("Mods 目录未配置或不存在".to_string());
    }

    match scope_kind {
        "mod" => {
            let ch = character_name.ok_or_else(|| "缺少角色名称".to_string())?;
            let mn = mod_name.ok_or_else(|| "缺少 Mod 名称".to_string())?;
            let (mod_dir, _) = resolve_mod_dir(cfg, ch, mn)?;
            Ok((mod_dir.clone(), vec![mod_dir]))
        }
        "character" => {
            let ch = assert_safe_segment(
                character_name.ok_or_else(|| "缺少角色名称".to_string())?,
                "角色名称",
            )?;
            let char_dir = mods_root.join(ch);
            if !char_dir.is_dir() {
                return Err("目标角色目录不存在".to_string());
            }
            let dirs = fs::read_dir(&char_dir)
                .map_err(|e| format!("读取角色目录失败：{e}"))?
                .flatten()
                .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
                .map(|e| e.path())
                .filter(|p| {
                    p.file_name()
                        .and_then(|s| s.to_str())
                        .map(|n| !n.starts_with('.'))
                        .unwrap_or(false)
                })
                .collect();
            Ok((char_dir, dirs))
        }
        "all" => {
            let mut dirs = Vec::new();
            for c_entry in fs::read_dir(mods_root)
                .map_err(|e| format!("读取 Mods 目录失败：{e}"))?
                .flatten()
            {
                if !c_entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    continue;
                }
                if c_entry.file_name().to_string_lossy().starts_with('.') {
                    continue;
                }
                if let Ok(m_entries) = fs::read_dir(c_entry.path()) {
                    for m_entry in m_entries.flatten() {
                        if m_entry.file_type().map(|t| t.is_dir()).unwrap_or(false)
                            && !m_entry.file_name().to_string_lossy().starts_with('.')
                        {
                            dirs.push(m_entry.path());
                        }
                    }
                }
            }
            Ok((mods_root.to_path_buf(), dirs))
        }
        other => Err(format!("不支持的修复范围：{other}")),
    }
}

fn snapshot_ini_bytes(mod_dirs: &[PathBuf]) -> HashMap<PathBuf, Vec<u8>> {
    let mut map = HashMap::new();
    for dir in mod_dirs {
        for ini in collect_mod_ini_files_including_disabled_subdirs(dir) {
            if let Ok(bytes) = fs::read(&ini) {
                map.insert(ini, bytes);
            }
        }
    }
    map
}

fn run_external_fixer_exe(exe_path: &Path, work_dir: &Path) -> Result<String, String> {
    if !exe_path.is_file() {
        return Err(format!("外部修复器不存在：{}", exe_path.display()));
    }
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut cmd = Command::new(exe_path);
    cmd.current_dir(work_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("启动外部修复器失败（{}）：{e}", exe_path.display()))?;

    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(b"\n\n");
    }

    let stdout_pipe = child.stdout.take();
    let stderr_pipe = child.stderr.take();
    let out_handle = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(mut pipe) = stdout_pipe {
            let _ = pipe.read_to_end(&mut buf);
        }
        buf
    });
    let err_handle = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(mut pipe) = stderr_pipe {
            let _ = pipe.read_to_end(&mut buf);
        }
        buf
    });

    let deadline = std::time::Instant::now() + Duration::from_secs(20);
    loop {
        match child.try_wait() {
            Ok(Some(_status)) => {
                let out_bytes = out_handle.join().unwrap_or_default();
                let err_bytes = err_handle.join().unwrap_or_default();
                let stdout = String::from_utf8_lossy(&out_bytes);
                let stderr = String::from_utf8_lossy(&err_bytes);
                return Ok(format!("{} {}", stdout.trim(), stderr.trim()).trim().to_string());
            }
            Ok(None) => {
                if std::time::Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    drop(out_handle);
                    drop(err_handle);
                    return Err("外部修复器执行超时（超过 20 秒），已安全终止；如需查看交互提示请直接双击该工具".to_string());
                }
                std::thread::sleep(Duration::from_millis(80));
            }
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("等待修复器退出失败：{e}"));
            }
        }
    }
}

pub fn run_mod_fixer(
    cfg: &AppConfig,
    scope_kind: &str,
    character_name: Option<&str>,
    mod_name: Option<&str>,
    fixer_exe_path: Option<&str>,
) -> Result<FixerRunReport, String> {
    let (work_root, target_mod_dirs) =
        collect_target_mod_dirs(cfg, scope_kind, character_name, mod_name)?;
    if target_mod_dirs.is_empty() {
        return Err("目标范围内没有可修复的 Mod".to_string());
    }

    let clean_exe = fixer_exe_path.map(|s| s.trim()).filter(|s| !s.is_empty());
    let fixer_label = clean_exe
        .and_then(|p| Path::new(p).file_name().and_then(|s| s.to_str()))
        .unwrap_or("内置 INI 规范化修复")
        .to_string();

    // Backup before modifying
    let mut backup_count = 0usize;
    for dir in &target_mod_dirs {
        if create_mod_ini_backup(dir, &fixer_label)?.is_some() {
            backup_count += 1;
        }
    }

    let mut modified_files = 0usize;

    let log_output = if let Some(exe_str) = clean_exe {
        let before = snapshot_ini_bytes(&target_mod_dirs);
        let mut out = run_external_fixer_exe(Path::new(exe_str), &work_root)?;
        let after = snapshot_ini_bytes(&target_mod_dirs);
        for (p, new_bytes) in after {
            if before.get(&p) != Some(&new_bytes) {
                modified_files += 1;
            }
        }
        if out.is_empty() {
            out = format!("已调用外部修复器：{}", exe_str);
        }
        out
    } else {
        for dir in &target_mod_dirs {
            for ini in collect_mod_ini_files_including_disabled_subdirs(dir) {
                if normalize_single_ini(&ini)? {
                    modified_files += 1;
                }
            }
        }
        if modified_files > 0 {
            format!("内置规范化修复完成：清理 BOM 与多余空白行，共优化 {modified_files} 个 .ini 文件。")
        } else {
            "所有目标 .ini 文件格式均已规范，无需改写（仍已保留时间戳备份）。".to_string()
        }
    };

    Ok(FixerRunReport {
        backup_count,
        processed_mods: target_mod_dirs.len(),
        modified_files,
        log_output,
    })
}
