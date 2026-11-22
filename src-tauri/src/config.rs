use crate::models::{AppConfig, PresetStore, TagsPoolStore};
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

static ATOMIC_WRITE_LOCK: Mutex<()> = Mutex::new(());
static TEMP_FILE_SEQ: AtomicU64 = AtomicU64::new(0);

pub(crate) fn custom_app_data_dir() -> Option<PathBuf> {
    if let Some(custom_dir) = std::env::var_os("EFMM_DATA_DIR").filter(|path| !path.is_empty()) {
        return Some(PathBuf::from(custom_dir));
    }

    #[cfg(not(test))]
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            if exe_dir.join("portable.flag").is_file() || exe_dir.join("data").is_dir() {
                return Some(exe_dir.join("data"));
            }
        }
    }
    None
}

pub fn app_data_dir() -> Result<PathBuf, String> {
    if let Some(dir) = custom_app_data_dir() {
        fs::create_dir_all(&dir)
            .map_err(|err| format!("无法创建数据目录 {}：{err}", dir.display()))?;
        return Ok(dir);
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
    let serialized = serde_json::to_string_pretty(data)
        .map_err(|e| format!("序列化 JSON 失败：{e}"))?;

    let _guard = ATOMIC_WRITE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{e}"))?;
        }
    }

    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let seq = TEMP_FILE_SEQ.fetch_add(1, Ordering::Relaxed);
    let base_name = path
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "data.json".to_string());
    let tmp_path = path.with_file_name(format!(".{base_name}.{ts}.{seq}.tmp"));
    let bak_path = path.with_extension("json.bak");

    if let Err(err) = fs::write(&tmp_path, serialized.as_bytes()) {
        let _ = fs::remove_file(&tmp_path);
        return Err(format!("写入临时配置文件失败：{err}"));
    }

    if path.exists() {
        let _ = fs::copy(path, &bak_path);
    }

    if let Err(err) = fs::rename(&tmp_path, path) {
        // Fallback when target already exists and rename cannot overwrite atomically
        if path.exists() {
            let _ = fs::remove_file(path);
        }
        if let Err(err2) = fs::rename(&tmp_path, path) {
            let _ = fs::remove_file(&tmp_path);
            return Err(format!("替换配置文件失败：{err}（重试失败：{err2}）"));
        }
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
