use crate::characters::now_iso_utc;
use crate::config::{load_presets, save_presets};
use crate::fs_ops::rename_dir_with_retry;
use crate::models::{AppConfig, UndoDelta, UndoEntrySummary, UndoResult};
use crate::mods::resolve_mod_dir;
use crate::persist_bridge;
use std::collections::VecDeque;
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_UNDO_STEPS: usize = 10;

#[derive(Debug, Clone)]
pub struct UndoRecord {
    pub id: String,
    pub label: String,
    pub deltas: Vec<UndoDelta>,
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
        self.entries.push_back(UndoRecord {
            id: format!("undo_{nanos}"),
            label: label.into(),
            deltas,
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
        let Some(record) = self.entries.pop_back() else {
            return Ok(UndoResult {
                undone: false,
                label: String::new(),
                reverted_count: 0,
            });
        };

        let mut reverted = 0usize;
        for delta in record.deltas.iter().rev() {
            let Ok((current_dir, current_enabled)) =
                resolve_mod_dir(cfg, &delta.character_name, &delta.mod_name)
            else {
                continue;
            };
            if current_enabled == delta.prev_enabled {
                continue;
            }
            let Some(parent) = current_dir.parent() else {
                continue;
            };
            let target_name = if delta.prev_enabled {
                delta.mod_name.clone()
            } else {
                format!("DISABLED_{}", delta.mod_name)
            };
            let dst_dir = parent.join(target_name);
            rename_dir_with_retry(&current_dir, &dst_dir)?;
            if cfg.persist_bridge_enabled {
                if delta.prev_enabled {
                    persist_bridge::on_mod_enabled(cfg, &dst_dir);
                } else {
                    persist_bridge::on_mod_disabled(cfg, &dst_dir);
                }
            }
            reverted += 1;
        }

        if record.restore_preset_id {
            if let Ok(mut store) = load_presets() {
                store.active_preset_id = record.prev_active_preset_id.clone();
                let _ = save_presets(&store);
            }
        }

        Ok(UndoResult {
            undone: true,
            label: record.label,
            reverted_count: reverted,
        })
    }
}
