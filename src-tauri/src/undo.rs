use crate::characters::now_iso_utc;
use crate::config::{load_presets, save_presets};
use crate::models::{AppConfig, UndoDelta, UndoEntrySummary, UndoResult};
use crate::mods::{apply_mod_state_changes, resolve_mod_dir, ModStateChange};
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_UNDO_STEPS: usize = 10;

#[derive(Debug, Clone)]
pub struct UndoRecord {
    pub id: String,
    pub label: String,
    pub deltas: Vec<UndoDelta>,
    mods_root: PathBuf,
    pub restore_preset_id: bool,
    pub prev_active_preset_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Default)]
pub struct UndoStack {
    entries: VecDeque<UndoRecord>,
}

impl UndoStack {
    pub fn push(
        &mut self,
        mods_path: &str,
        label: impl Into<String>,
        deltas: Vec<UndoDelta>,
        restore_preset_id: bool,
        prev_active_preset_id: Option<String>,
    ) {
        if deltas.is_empty() {
            return;
        }
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        if self.entries.len() >= MAX_UNDO_STEPS {
            self.entries.pop_front();
        }
        let mods_path = Path::new(mods_path);
        let mods_root = mods_path
            .canonicalize()
            .unwrap_or_else(|_| mods_path.to_path_buf());
        self.entries.push_back(UndoRecord {
            id: format!("undo_{nanos}"),
            label: label.into(),
            deltas,
            mods_root,
            restore_preset_id,
            prev_active_preset_id,
            created_at: now_iso_utc(),
        });
    }

    pub fn summaries(&self) -> Vec<UndoEntrySummary> {
        self.entries
            .iter()
            .rev()
            .map(|r| UndoEntrySummary {
                id: r.id.clone(),
                label: r.label.clone(),
                change_count: r.deltas.len(),
                created_at: r.created_at.clone(),
            })
            .collect()
    }

    pub fn undo_last(&mut self, cfg: &mut AppConfig) -> Result<UndoResult, String> {
        let Some(record) = self.entries.back() else {
            return Ok(UndoResult {
                undone: false,
                label: String::new(),
                reverted_count: 0,
            });
        };
        let mods_path = Path::new(&cfg.mods_path);
        let current_root = mods_path
            .canonicalize()
            .unwrap_or_else(|_| mods_path.to_path_buf());
        if !current_root.is_dir() || current_root != record.mods_root {
            return Err("请切换回执行此操作时使用的 Mods 目录，再重试撤销。".to_string());
        }

        let mut changes = Vec::new();
        for delta in record.deltas.iter().rev() {
            let Ok((current_dir, current_enabled)) =
                resolve_mod_dir(cfg, &delta.character_name, &delta.mod_name)
            else {
                continue;
            };
            if current_enabled == delta.prev_enabled {
                continue;
            }
            changes.push(ModStateChange::new(
                current_dir,
                delta.character_name.clone(),
                delta.mod_name.clone(),
                delta.prev_enabled,
            ));
        }

        apply_mod_state_changes(cfg, &changes, || {
            if record.restore_preset_id {
                let mut store = load_presets()?;
                store.active_preset_id = record.prev_active_preset_id.clone();
                save_presets(&store)?;
            }
            Ok(())
        })?;

        let label = record.label.clone();
        self.entries.pop_back();
        Ok(UndoResult {
            undone: true,
            label,
            reverted_count: changes.len(),
        })
    }
}
