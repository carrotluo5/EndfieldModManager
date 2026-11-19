import { useCallback, useEffect, useMemo, useState } from "react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  HardDriveDownload,
  Layers,
  Pencil,
  Play,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Undo2,
  Upload,
} from "lucide-react";
import { matchesSearch } from "../../lib/search";
import { api } from "../../lib/tauri";
import { useAppStore } from "../../store/useAppStore";
import type {
  CharacterModsCatalog,
  PresetItemView,
  PresetListResponse,
  PresetModEntry,
  RabbitFxModEntry,
} from "../../types/mod";
import { Modal } from "../ui/Modal";

const BUILTIN_NO_MOD_ID = "__builtin_no_mod__";

export function PresetView() {
  const config = useAppStore((s) => s.config);
  const presetsTick = useAppStore((s) => s.presetsTick);
  const undoStack = useAppStore((s) => s.undoStack);
  const refreshPresetCount = useAppStore((s) => s.refreshPresetCount);
  const refreshRabbitFxStatus = useAppStore((s) => s.refreshRabbitFxStatus);
  const refreshUndoStack = useAppStore((s) => s.refreshUndoStack);
  const bumpCharactersTick = useAppStore((s) => s.bumpCharactersTick);
  const bumpModsTick = useAppStore((s) => s.bumpModsTick);
  const bumpPresetsTick = useAppStore((s) => s.bumpPresetsTick);
  const addToast = useAppStore((s) => s.addToast);

  const [presetList, setPresetList] = useState<PresetListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [importingQaqm, setImportingQaqm] = useState(false);
  const [undoing, setUndoing] = useState(false);

  // Create / Visual Editor Modal
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingPreset, setEditingPreset] = useState<PresetItemView | null>(null);
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [catalog, setCatalog] = useState<CharacterModsCatalog[]>([]);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [selectedMap, setSelectedMap] = useState<Record<string, PresetModEntry>>({});
  const [savingEditor, setSavingEditor] = useState(false);

  // Delete confirmation modal
  const [deleteTarget, setDeleteTarget] = useState<PresetItemView | null>(null);
  const [deleting, setDeleting] = useState(false);

  // RabbitFX conflict modal when applying a preset
  const [rabbitFxConfirm, setRabbitFxConfirm] = useState<{
    presetId: string;
    conflicts: RabbitFxModEntry[];
  } | null>(null);

  const loadPresets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listPresets();
      setPresetList(res);
    } catch (err) {
      addToast("error", `加载预设失败：${String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    void loadPresets();
  }, [loadPresets, presetsTick, config?.modsPath]);

  const makeEntryKey = (charName: string, modName: string) => `${charName}\0${modName}`;

  const openCreateModal = async () => {
    setEditingPreset(null);
    setFormName("");
    setFormDesc("");
    setCatalogSearch("");
    setEditorOpen(true);
    try {
      const cats = await api.listAllModsCatalog();
      setCatalog(cats);
      const initial: Record<string, PresetModEntry> = {};
      for (const c of cats) {
        for (const m of c.mods) {
          if (m.enabled) {
            initial[makeEntryKey(c.characterName, m.name)] = {
              characterName: c.characterName,
              modName: m.name,
              enabled: true,
            };
          }
        }
      }
      setSelectedMap(initial);
    } catch (err) {
      addToast("error", String(err));
    }
  };

  const openEditModal = async (preset: PresetItemView) => {
    setEditingPreset(preset);
    setFormName(preset.name);
    setFormDesc(preset.description);
    setCatalogSearch("");
    setEditorOpen(true);

    const map: Record<string, PresetModEntry> = {};
    for (const m of preset.mods) {
      if (m.enabled) {
        map[makeEntryKey(m.characterName, m.modName)] = { ...m };
      }
    }
    setSelectedMap(map);

    try {
      const cats = await api.listAllModsCatalog();
      setCatalog(cats);
    } catch (err) {
      addToast("error", String(err));
    }
  };

  const handleSnapshotIntoEditor = () => {
    const next: Record<string, PresetModEntry> = {};
    for (const c of catalog) {
      for (const m of c.mods) {
        if (m.enabled) {
          next[makeEntryKey(c.characterName, m.name)] = {
            characterName: c.characterName,
            modName: m.name,
            enabled: true,
          };
        }
      }
    }
    setSelectedMap(next);
    addToast("info", `已载入当前已启用的 ${Object.keys(next).length} 个 Mod`);
  };

  const handleSaveEditor = async () => {
    const cleanName = formName.trim();
    if (!cleanName) {
      addToast("warning", "请输入预设名称");
      return;
    }
    const entries = Object.values(selectedMap);
    setSavingEditor(true);
    try {
      if (editingPreset) {
        await api.updatePreset(editingPreset.id, cleanName, formDesc, entries);
        addToast("success", `已保存预设「${cleanName}」`);
      } else {
        await api.createPreset(cleanName, formDesc, entries, false);
        addToast("success", `已创建预设「${cleanName}」`);
      }
      setEditorOpen(false);
      await refreshPresetCount();
      bumpPresetsTick();
    } catch (err) {
      addToast("error", String(err));
    } finally {
      setSavingEditor(false);
    }
  };

  const handleApplyPreset = async (id: string, forceAllowMultipleRabbitFx = false) => {
    setApplyingId(id);
    try {
      const res = await api.applyPreset(id, forceAllowMultipleRabbitFx);
      if (res.requiresRabbitFxConfirm) {
        setRabbitFxConfirm({ presetId: id, conflicts: res.conflictRabbitFx });
        return;
      }
      if (res.success) {
        const missingNote =
          res.missingMods.length > 0 ? `（${res.missingMods.length} 个缺失项已跳过）` : "";
        addToast("success", `${res.message}${missingNote}`);
        await Promise.all([refreshRabbitFxStatus(), refreshUndoStack()]);
        bumpPresetsTick();
        bumpCharactersTick();
        bumpModsTick();
      }
    } catch (err) {
      addToast("error", String(err));
    } finally {
      setApplyingId(null);
    }
  };

  const handleSnapshotUpdate = async (preset: PresetItemView) => {
    try {
      await api.snapshotUpdatePreset(preset.id);
      addToast("success", `已用当前全部启用 Mod 覆盖更新「${preset.name}」`);
      bumpPresetsTick();
    } catch (err) {
      addToast("error", String(err));
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.deletePreset(deleteTarget.id);
      addToast("success", `已删除预设「${deleteTarget.name}」`);
      setDeleteTarget(null);
      await refreshPresetCount();
      bumpPresetsTick();
    } catch (err) {
      addToast("error", String(err));
    } finally {
      setDeleting(false);
    }
  };

  const handleImportJson = async () => {
    try {
      const picked = await openDialog({
        title: "导入预设 JSON（兼容 QAQManager presets.json）",
        multiple: false,
        filters: [{ name: "JSON 文件", extensions: ["json"] }],
      });
      if (typeof picked !== "string" || !picked) return;
      const res = await api.importPresetsFile(picked);
      await refreshPresetCount();
      bumpPresetsTick();
      addToast(
        "success",
        `已导入 ${res.importedCount} 个预设${
          res.skippedCount > 0 ? `（跳过 ${res.skippedCount} 个重名或已存在项）` : ""
        }`
      );
    } catch (err) {
      addToast("error", String(err));
    }
  };

  const handleExportJson = async () => {
    try {
      const target = await saveDialog({
        title: "导出全部预设为 JSON",
        defaultPath: "efmm-presets.json",
        filters: [{ name: "JSON 文件", extensions: ["json"] }],
      });
      if (!target) return;
      const count = await api.exportPresetsFile(target);
      addToast("success", `已导出 ${count} 个预设到文件`);
    } catch (err) {
      addToast("error", String(err));
    }
  };

  const handleImportQaqm = async () => {
    setImportingQaqm(true);
    try {
      const summary = await api.importFromQaqmanager();
      await refreshPresetCount();
      bumpPresetsTick();
      if (summary.importedPresetCount > 0) {
        addToast("success", `成功迁移 ${summary.importedPresetCount} 个 QAQManager 预设`);
      } else {
        addToast("info", summary.warnings[0] || "未发现新的可迁移预设");
      }
    } catch (err) {
      addToast("error", String(err));
    } finally {
      setImportingQaqm(false);
    }
  };

  const handleUndo = async () => {
    if (undoing || undoStack.length === 0) return;
    setUndoing(true);
    try {
      const res = await api.undoLastAction();
      if (res.undone) {
        addToast("success", `已撤销：${res.label}`);
        await Promise.all([refreshRabbitFxStatus(), refreshUndoStack()]);
        bumpPresetsTick();
        bumpCharactersTick();
        bumpModsTick();
      }
    } catch (err) {
      addToast("error", String(err));
    } finally {
      setUndoing(false);
    }
  };

  const filteredCatalog = useMemo(() => {
    const q = catalogSearch.trim();
    if (!q) return catalog;
    return catalog
      .map((cat) => {
        const charHit = matchesSearch(cat.characterName, [], q);
        const matchingMods = charHit
          ? cat.mods
          : cat.mods.filter((m) => matchesSearch(m.name, [cat.characterName], q));
        return { ...cat, mods: matchingMods };
      })
      .filter((cat) => cat.mods.length > 0);
  }, [catalog, catalogSearch]);

  const missingInDiskEntries = useMemo(() => {
    const known = new Set<string>();
    for (const c of catalog) {
      for (const m of c.mods) known.add(makeEntryKey(c.characterName, m.name));
    }
    return Object.entries(selectedMap)
      .filter(([k]) => !known.has(k))
      .map(([, v]) => v);
  }, [catalog, selectedMap]);

  const builtinActive =
    Boolean(presetList?.builtinNoModActive) || presetList?.activePresetId === BUILTIN_NO_MOD_ID;

  return (
    <div className="h-full overflow-y-auto px-6 py-5">
      <div className="mx-auto max-w-5xl space-y-5 pb-8">
        {/* Header & Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-[var(--text-primary)]">Mod 组合预设</h1>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              一键切换整套角色装扮与功能插件配置，支持可视化编辑、缺失标红及最近 10 步撤销
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {undoStack.length > 0 && (
              <button
                type="button"
                onClick={() => void handleUndo()}
                disabled={undoing}
                title={`撤销：${undoStack[0].label}`}
                className="glass-surface inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-strong)] px-3 py-2 text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent-soft)] disabled:opacity-50"
              >
                <Undo2 className="h-3.5 w-3.5" />
                <span>撤销上一步</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => void handleImportQaqm()}
              disabled={importingQaqm}
              className="glass-surface inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--border-strong)] disabled:opacity-50"
            >
              <HardDriveDownload className="h-3.5 w-3.5" />
              <span>{importingQaqm ? "迁移中..." : "QAQ 迁移"}</span>
            </button>

            <button
              type="button"
              onClick={() => void handleImportJson()}
              className="glass-surface inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--border-strong)]"
            >
              <Upload className="h-3.5 w-3.5" />
              <span>导入 JSON</span>
            </button>

            <button
              type="button"
              onClick={() => void handleExportJson()}
              disabled={!presetList || presetList.presets.length === 0}
              className="glass-surface inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--border-strong)] disabled:opacity-45"
            >
              <Download className="h-3.5 w-3.5" />
              <span>导出 JSON</span>
            </button>

            <button
              type="button"
              onClick={() => void openCreateModal()}
              disabled={!config?.modsPath.trim()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] disabled:opacity-45"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>新建预设</span>
            </button>
          </div>
        </div>

        {/* Builtin System Card: No Mod / Clean */}
        <div
          className={`glass-card flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-4 transition-all ${
            builtinActive
              ? "border-[var(--accent)] ring-2 ring-[var(--accent-soft)]"
              : "border-[var(--border-subtle)]"
          }`}
        >
          <div className="flex items-center gap-3.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-[var(--text-primary)]">
                  无 Mod / 纯净恢复
                </h2>
                <span className="rounded-md bg-[var(--bg-elevated)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-secondary)]">
                  内置系统预设
                </span>
                {builtinActive && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[var(--success-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--success)]">
                    <Check className="h-3 w-3" />
                    <span>当前全库已清空</span>
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-[var(--text-secondary)]">
                一键停用当前 Mods 目录下全部已启用 Mod（重命名加上 DISABLED_），方便排错或体验原版画面，可随时撤销恢复。
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void handleApplyPreset(BUILTIN_NO_MOD_ID)}
            disabled={applyingId === BUILTIN_NO_MOD_ID || !config?.modsPath.trim()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-strong)] bg-[var(--accent-soft)] px-4 py-2 text-xs font-semibold text-[var(--accent)] hover:bg-[var(--accent)] hover:text-[var(--accent-contrast)] disabled:opacity-45"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            <span>{applyingId === BUILTIN_NO_MOD_ID ? "应用中..." : "一键停用全部"}</span>
          </button>
        </div>

        {/* User Presets List */}
        {loading && !presetList ? (
          <div className="glass-card rounded-2xl p-8 text-center text-xs text-[var(--text-muted)]">
            正在加载预设列表...
          </div>
        ) : presetList && presetList.presets.length > 0 ? (
          <div className="space-y-3">
            {presetList.presets.map((preset) => {
              const isActive = presetList.activePresetId === preset.id;
              const isExpanded = Boolean(expandedIds[preset.id]);
              const missingSet = new Set(preset.missingKeys);

              // Group preset mods by character
              const groupedByChar = new Map<string, PresetModEntry[]>();
              for (const m of preset.mods) {
                if (!m.enabled) continue;
                const list = groupedByChar.get(m.characterName) ?? [];
                list.push(m);
                groupedByChar.set(m.characterName, list);
              }

              return (
                <div
                  key={preset.id}
                  className={`glass-card overflow-hidden rounded-2xl border transition-all ${
                    isActive
                      ? "border-[var(--accent)] ring-2 ring-[var(--accent-soft)]"
                      : "border-[var(--border-subtle)]"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedIds((prev) => ({ ...prev, [preset.id]: !isExpanded }))
                        }
                        title={isExpanded ? "收起详情" : "展开查看预设包含的 Mod"}
                        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </button>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-sm font-bold text-[var(--text-primary)]">
                            {preset.name}
                          </h3>
                          {isActive && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--success-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--success)]">
                              <span className="h-1.5 w-1.5 rounded-full bg-[var(--success)]" />
                              <span>最近应用</span>
                            </span>
                          )}
                          <span className="rounded-full bg-[var(--bg-elevated)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)] tabular-nums">
                            {preset.characterCount} 个分类 · {preset.modCount} 个 Mod
                          </span>
                          {preset.missingCount > 0 && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--danger-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--danger)]">
                              <AlertTriangle className="h-3 w-3" />
                              <span>缺失 {preset.missingCount} 项</span>
                            </span>
                          )}
                          {preset.rabbitFxCount > 1 && (
                            <span className="rounded-full bg-[var(--warning-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--warning)]">
                              含 {preset.rabbitFxCount} 个 RabbitFX
                            </span>
                          )}
                        </div>
                        {preset.description && (
                          <p className="mt-1 text-xs text-[var(--text-secondary)]">
                            {preset.description}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => void handleApplyPreset(preset.id)}
                        disabled={applyingId === preset.id || !config?.modsPath.trim()}
                        className="inline-flex items-center gap-1 rounded-xl bg-[var(--accent)] px-3.5 py-1.5 text-xs font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] disabled:opacity-50"
                      >
                        <Play className="h-3 w-3 fill-current" />
                        <span>{applyingId === preset.id ? "应用中..." : "应用"}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => void handleSnapshotUpdate(preset)}
                        disabled={!config?.modsPath.trim()}
                        title="用当前已启用的全部 Mod 快照覆盖更新此预设"
                        className="inline-flex items-center gap-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--border-strong)]"
                      >
                        <Camera className="h-3.5 w-3.5" />
                        <span>快照更新</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => void openEditModal(preset)}
                        title="可视化编辑预设内容"
                        className="inline-flex items-center gap-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--border-strong)]"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        <span>编辑</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setDeleteTarget(preset)}
                        title="删除预设"
                        className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-1.5 text-[var(--danger)] hover:bg-[var(--danger-soft)]"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-3">
                      {groupedByChar.size > 0 ? (
                        <div className="space-y-2.5">
                          {Array.from(groupedByChar.entries()).map(([charName, items]) => (
                            <div key={charName} className="flex flex-wrap items-start gap-2 text-xs">
                              <span className="mt-0.5 min-w-[76px] shrink-0 font-semibold text-[var(--text-primary)]">
                                {charName}
                              </span>
                              <div className="flex flex-1 flex-wrap gap-1.5">
                                {items.map((entry) => {
                                  const isMissing = missingSet.has(
                                    `${entry.characterName}/${entry.modName}`
                                  );
                                  return (
                                    <span
                                      key={`${entry.characterName}/${entry.modName}`}
                                      className={`rounded-lg border px-2 py-0.5 text-[11px] font-medium ${
                                        isMissing
                                          ? "border-[var(--danger)]/45 bg-[var(--danger-soft)] text-[var(--danger)] line-through"
                                          : "border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)]"
                                      }`}
                                      title={isMissing ? "磁盘上找不到该 Mod（已删除或改名）" : undefined}
                                    >
                                      {entry.modName}
                                      {isMissing ? "（已缺失）" : ""}
                                    </span>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-[var(--text-muted)]">
                          该预设暂未勾选任何 Mod（应用后等效于全禁用）
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="glass-card rounded-2xl p-8 text-center">
            <Layers className="mx-auto h-9 w-9 text-[var(--text-muted)]" />
            <div className="mt-3 text-sm font-semibold text-[var(--text-primary)]">
              暂无自定义 Mod 预设
            </div>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              点击右上角「新建预设」可一键快照当前装扮，或通过「QAQ 迁移 / 导入 JSON」载入历史方案。
            </p>
          </div>
        )}
      </div>

      {/* Create / Visual Edit Modal */}
      <Modal
        open={editorOpen}
        onClose={() => !savingEditor && setEditorOpen(false)}
        title={editingPreset ? `编辑预设：${editingPreset.name}` : "新建组合预设"}
        subtitle="支持快照当前开启列表，也可手动搜索勾选任意角色下的 Mod"
        maxWidthClass="max-w-3xl"
        footer={
          <>
            <span className="mr-auto text-xs text-[var(--text-secondary)]">
              已勾选 <strong className="text-[var(--accent)]">{Object.keys(selectedMap).length}</strong> 个 Mod
            </span>
            <button
              type="button"
              onClick={() => setEditorOpen(false)}
              disabled={savingEditor}
              className="rounded-xl border border-[var(--border-subtle)] px-4 py-2 text-xs font-medium text-[var(--text-secondary)]"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void handleSaveEditor()}
              disabled={savingEditor}
              className="rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] disabled:opacity-50"
            >
              {savingEditor ? "保存中..." : "保存预设"}
            </button>
          </>
        }
      >
        <div className="space-y-4 text-xs">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block font-medium text-[var(--text-secondary)]">
                预设名称 *
              </label>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="例如：日常探索配置 / 清凉高帧率"
                className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-primary)]"
              />
            </div>
            <div>
              <label className="mb-1 block font-medium text-[var(--text-secondary)]">
                备注说明（可选）
              </label>
              <input
                type="text"
                value={formDesc}
                onChange={(e) => setFormDesc(e.target.value)}
                placeholder="记录这套预设适用场景..."
                className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-primary)]"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                type="text"
                value={catalogSearch}
                onChange={(e) => setCatalogSearch(e.target.value)}
                placeholder="在全库角色或 Mod 名称中搜索（支持拼音）..."
                className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] py-1.5 pr-3 pl-8 text-xs text-[var(--text-primary)]"
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSnapshotIntoEditor}
                className="inline-flex items-center gap-1 rounded-xl border border-[var(--border-strong)] bg-[var(--accent-soft)] px-3 py-1.5 font-medium text-[var(--accent)] hover:bg-[var(--accent)] hover:text-[var(--accent-contrast)]"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>快照当前已启用</span>
              </button>
              <button
                type="button"
                onClick={() => setSelectedMap({})}
                className="rounded-xl border border-[var(--border-subtle)] px-3 py-1.5 font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                全部清空
              </button>
            </div>
          </div>

          {missingInDiskEntries.length > 0 && (
            <div className="rounded-xl border border-[var(--danger)]/40 bg-[var(--danger-soft)] p-3">
              <div className="font-semibold text-[var(--danger)]">
                以下已失效/重命名的记录仍在预设中（可点击移除）：
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {missingInDiskEntries.map((entry) => {
                  const k = makeEntryKey(entry.characterName, entry.modName);
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() =>
                        setSelectedMap((prev) => {
                          const copy = { ...prev };
                          delete copy[k];
                          return copy;
                        })
                      }
                      className="rounded-lg border border-[var(--danger)]/40 bg-[var(--bg-surface)] px-2 py-0.5 text-[11px] text-[var(--danger)] hover:line-through"
                    >
                      {entry.characterName} / {entry.modName} ×
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
            {filteredCatalog.map((cat) => {
              const charKeys = cat.mods.map((m) => makeEntryKey(cat.characterName, m.name));
              const checkedCount = charKeys.filter((k) => Boolean(selectedMap[k])).length;
              return (
                <div
                  key={cat.characterName}
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2 font-semibold text-[var(--text-primary)]">
                      <span>{cat.characterName}</span>
                      <span className="text-[11px] font-normal text-[var(--text-muted)]">
                        （已选 {checkedCount}/{cat.mods.length}）
                      </span>
                    </div>
                    <div className="flex gap-2 text-[11px]">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedMap((prev) => {
                            const next = { ...prev };
                            for (const m of cat.mods) {
                              next[makeEntryKey(cat.characterName, m.name)] = {
                                characterName: cat.characterName,
                                modName: m.name,
                                enabled: true,
                              };
                            }
                            return next;
                          });
                        }}
                        className="text-[var(--accent)] hover:underline"
                      >
                        全选
                      </button>
                      {checkedCount > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedMap((prev) => {
                              const next = { ...prev };
                              for (const k of charKeys) delete next[k];
                              return next;
                            });
                          }}
                          className="text-[var(--text-secondary)] hover:underline"
                        >
                          清空
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {cat.mods.map((m) => {
                      const k = makeEntryKey(cat.characterName, m.name);
                      const checked = Boolean(selectedMap[k]);
                      return (
                        <label
                          key={k}
                          className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 transition-colors ${
                            checked
                              ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text-primary)]"
                              : "border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]"
                          }`}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                setSelectedMap((prev) => {
                                  const next = { ...prev };
                                  if (e.target.checked) {
                                    next[k] = {
                                      characterName: cat.characterName,
                                      modName: m.name,
                                      enabled: true,
                                    };
                                  } else {
                                    delete next[k];
                                  }
                                  return next;
                                });
                              }}
                              className="h-3.5 w-3.5 shrink-0 accent-[var(--accent)]"
                            />
                            <span className="truncate font-medium">{m.name}</span>
                          </span>
                          <span className="flex shrink-0 items-center gap-1">
                            {m.isRabbitFx && (
                              <span className="rounded bg-indigo-500/80 px-1 py-0.5 text-[9px] font-semibold text-white">
                                RFX
                              </span>
                            )}
                            {m.enabled && (
                              <span className="rounded bg-[var(--success-soft)] px-1 py-0.5 text-[9px] font-semibold text-[var(--success)]">
                                当前开启
                              </span>
                            )}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => !deleting && setDeleteTarget(null)}
        title="删除预设"
        maxWidthClass="max-w-md"
        footer={
          <>
            <button
              type="button"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
              className="rounded-xl border border-[var(--border-subtle)] px-4 py-2 text-xs font-medium text-[var(--text-secondary)]"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void handleDeleteConfirm()}
              disabled={deleting}
              className="rounded-xl bg-[var(--danger)] px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {deleting ? "删除中..." : "确认删除"}
            </button>
          </>
        }
      >
        <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
          确定要删除预设
          <strong className="mx-1 text-[var(--text-primary)]">「{deleteTarget?.name}」</strong>
          吗？此操作不会删除硬盘上的任何 Mod 文件。
        </p>
      </Modal>

      {/* RabbitFX Conflict Confirm Modal */}
      <Modal
        open={Boolean(rabbitFxConfirm)}
        onClose={() => setRabbitFxConfirm(null)}
        title="RabbitFX 多开警告"
        maxWidthClass="max-w-md"
        footer={
          <>
            <button
              type="button"
              onClick={() => setRabbitFxConfirm(null)}
              className="rounded-xl border border-[var(--border-subtle)] px-4 py-2 text-xs font-medium text-[var(--text-secondary)]"
            >
              取消应用
            </button>
            <button
              type="button"
              onClick={() => {
                if (!rabbitFxConfirm) return;
                const { presetId } = rabbitFxConfirm;
                setRabbitFxConfirm(null);
                void handleApplyPreset(presetId, true);
              }}
              className="rounded-xl bg-[var(--warning)] px-4 py-2 text-xs font-semibold text-white hover:opacity-90"
            >
              依然强制应用
            </button>
          </>
        }
      >
        <div className="space-y-3 text-xs leading-relaxed text-[var(--text-secondary)]">
          <div className="flex items-start gap-2 rounded-xl border border-[var(--warning)]/40 bg-[var(--warning-soft)] p-3 text-[var(--warning)]">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              该预设将同时启用以下多个 RabbitFX 实例，极可能导致终末地游戏崩溃，建议先点「编辑」去掉多余版本：
            </span>
          </div>
          <ul className="space-y-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 font-medium text-[var(--text-primary)]">
            {rabbitFxConfirm?.conflicts.map((c) => (
              <li key={c.path}>
                • {c.characterName} / {c.modName}
              </li>
            ))}
          </ul>
        </div>
      </Modal>
    </div>
  );
}
