import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  Bookmark,
  Check,
  ChevronDown,
  ChevronUp,
  Crop,
  FileText,
  FolderInput,
  FolderOpen,
  History,
  Image as ImageIcon,
  Keyboard,
  Layers,
  LayoutGrid,
  PanelRight,
  Pencil,
  Pin,
  Plus,
  Power,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  Sparkles,
  Tag,
  Trash2,
  Undo2,
  Wrench,
  X,
} from "lucide-react";
import {
  buildModCollectionView,
  getCollectionVariantLabel,
  type DisplayModItem,
} from "../../lib/collections";
import { matchesSearch } from "../../lib/search";
import { api, buildMediaUrl } from "../../lib/tauri";
import { useAppStore } from "../../store/useAppStore";
import type {
  AppearanceSection,
  ConflictGroup,
  HotkeyItem,
  ModDetails,
  ModItem,
  RabbitFxModEntry,
  TagPoolItem,
} from "../../types/mod";
import { BackupRollbackModal } from "../modals/FixerModal";
import { ContextMenu, type ContextMenuState } from "../ui/ContextMenu";
import { HotkeyRecorderModal } from "../ui/HotkeyRecorderModal";
import { ImageCropModal } from "../ui/ImageCropModal";
import { LightboxModal } from "../ui/LightboxModal";
import { Modal } from "../ui/Modal";
import { TagPoolModal } from "../ui/TagPoolModal";
import { AppearanceSectionBar } from "./AppearanceSectionBar";

function getTagBadgeStyle(tagColor?: string): React.CSSProperties | undefined {
  if (!tagColor || !/^#[0-9a-fA-F]{6}$/.test(tagColor)) return undefined;
  return {
    backgroundColor: `${tagColor}22`,
    color: tagColor,
    borderColor: `${tagColor}55`,
  };
}

type SortMode = "custom" | "enabled" | "name" | "recent";
type ViewLayout = "detail" | "grid";

interface SortableModCardProps {
  item: DisplayModItem;
  selected: boolean;
  dndEnabled: boolean;
  compactLayout: boolean;
  tagColorMap: Record<string, string>;
  onSelect: () => void;
  onToggleEnable: () => void;
  onSelectCollectionVariant: (identity: string, variantModName: string) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

function SortableModCard({
  item,
  selected,
  dndEnabled,
  compactLayout,
  tagColorMap,
  onSelect,
  onToggleEnable,
  onSelectCollectionVariant,
  onContextMenu,
}: SortableModCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.name,
    disabled: !dndEnabled,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.65 : 1,
    zIndex: isDragging ? 30 : undefined,
  };

  const previewUrl = buildMediaUrl(item.previewPath, item.previewMtime);

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(dndEnabled ? attributes : {})}
      {...(dndEnabled ? listeners : {})}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      className={`glass-card group flex cursor-pointer flex-col overflow-hidden rounded-2xl transition-all hover:-translate-y-0.5 ${
        selected
          ? "border-[var(--accent)] ring-2 ring-[var(--accent-soft)]"
          : item.enabled
            ? "border-[var(--accent)]/45"
            : "hover:border-[var(--border-strong)]"
      }`}
    >
      {/* 16:10 Preview */}
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-[var(--bg-elevated)]">
        {previewUrl ? (
          <img
            src={previewUrl}
            alt={item.name}
            draggable={false}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-[var(--text-muted)]">
            <ImageIcon className="h-6 w-6 opacity-50" />
            <span className="text-[11px]">无预览图</span>
          </div>
        )}

        {/* Top badges */}
        <div className="pointer-events-none absolute inset-x-2 top-2 flex flex-wrap items-center gap-1">
          {item.pinned && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-[var(--accent)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--accent-contrast)]">
              <Pin className="h-2.5 w-2.5" />
              <span>置顶</span>
            </span>
          )}
          {item.marked && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
              <Bookmark className="h-2.5 w-2.5 fill-current" />
            </span>
          )}
          {item.isRabbitFx && (
            <span className="rounded-full bg-indigo-500/85 px-1.5 py-0.5 text-[10px] font-semibold text-white">
              RabbitFX
            </span>
          )}
          {item.isEffMod && (
            <span className="rounded-full bg-[var(--warning)] px-1.5 py-0.5 text-[10px] font-semibold text-white">
              EFF格式
            </span>
          )}
          {item.hasConflict && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-[var(--danger)] px-1.5 py-0.5 text-[10px] font-semibold text-white">
              <AlertTriangle className="h-2.5 w-2.5" />
              <span>冲突</span>
            </span>
          )}
        </div>

        {/* Enable switch bottom-right */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleEnable();
          }}
          title={item.enabled ? "点击禁用此 Mod" : "点击启用此 Mod"}
          className={`absolute right-2 bottom-2 flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold shadow-sm backdrop-blur-xs transition-all ${
            item.enabled
              ? "bg-[var(--accent)] text-[var(--accent-contrast)]"
              : "bg-black/62 text-white/90 hover:bg-black/80"
          }`}
        >
          <Power className="h-3 w-3" />
          <span>{item.enabled ? "已启用" : "未启用"}</span>
        </button>
      </div>

      {/* Body */}
      <div className={`flex flex-1 flex-col justify-between gap-2 ${compactLayout ? "p-2.5" : "p-3"}`}>
        <div>
          <div className="line-clamp-2 text-xs font-semibold leading-snug text-[var(--text-primary)]">
            {item.collection ? item.collection.name : item.name}
          </div>

          {item.collection && (
            <select
              value={item.name}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => onSelectCollectionVariant(item.collection!.identity, e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1 text-[11px] text-[var(--text-primary)]"
            >
              {item.collection.variants.map((v) => (
                <option key={v.name} value={v.name}>
                  {getCollectionVariantLabel(v)}
                  {v.enabled ? "（已启用）" : ""}
                </option>
              ))}
            </select>
          )}
        </div>

        {item.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {item.tags.slice(0, 3).map((tag) => {
              const customStyle = getTagBadgeStyle(tagColorMap[tag]);
              return (
                <span
                  key={tag}
                  style={customStyle}
                  className="rounded-md border border-transparent bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent)]"
                >
                  {tag}
                </span>
              );
            })}
            {item.tags.length > 3 && (
              <span className="text-[10px] text-[var(--text-muted)]">+{item.tags.length - 3}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface ModViewProps {
  characterName: string;
}

export function ModView({ characterName }: ModViewProps) {
  const config = useAppStore((s) => s.config);
  const modsTick = useAppStore((s) => s.modsTick);
  const undoStack = useAppStore((s) => s.undoStack);
  const pendingFocusMod = useAppStore((s) => s.pendingFocusMod);
  const setSelectedCharacter = useAppStore((s) => s.setSelectedCharacter);
  const setMovingMod = useAppStore((s) => s.setMovingMod);
  const setPendingFocusMod = useAppStore((s) => s.setPendingFocusMod);
  const updateConfigPatch = useAppStore((s) => s.updateConfigPatch);
  const refreshRabbitFxStatus = useAppStore((s) => s.refreshRabbitFxStatus);
  const refreshUndoStack = useAppStore((s) => s.refreshUndoStack);
  const bumpCharactersTick = useAppStore((s) => s.bumpCharactersTick);
  const bumpModsTick = useAppStore((s) => s.bumpModsTick);
  const bumpPresetsTick = useAppStore((s) => s.bumpPresetsTick);
  const openImportWizard = useAppStore((s) => s.openImportWizard);
  const openFixerModal = useAppStore((s) => s.openFixerModal);
  const addToast = useAppStore((s) => s.addToast);

  const [mods, setMods] = useState<ModItem[]>([]);
  const [aliases, setAliases] = useState<string[]>([]);
  const [conflicts, setConflicts] = useState<ConflictGroup[]>([]);
  const [isNonCharCategory, setIsNonCharCategory] = useState(false);
  const [sections, setSections] = useState<AppearanceSection[]>([]);
  const [tagPool, setTagPool] = useState<TagPoolItem[]>([]);
  const [loading, setLoading] = useState(false);

  const [selectedSectionId, setSelectedSectionId] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFilterTags, setSelectedFilterTags] = useState<string[]>([]);
  const [sortMode, setSortMode] = useState<SortMode>("custom");
  const [collapseCollections, setCollapseCollections] = useState(true);
  const [selectedVariants, setSelectedVariants] = useState<Record<string, string>>({});
  const [viewLayout, setViewLayout] = useState<ViewLayout>("detail");

  const [selectedModName, setSelectedModName] = useState<string | null>(null);
  const [details, setDetails] = useState<ModDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);

  // Detail interactive states
  const [notesDraft, setNotesDraft] = useState("");
  const [newTagInput, setNewTagInput] = useState("");
  const [editingHotkeyKey, setEditingHotkeyKey] = useState<string | null>(null);
  const [hotkeyAliasDraft, setHotkeyAliasDraft] = useState("");
  const [readmeOpen, setReadmeOpen] = useState(false);

  // Modals & Menus
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [cropModTarget, setCropModTarget] = useState<ModItem | null>(null);

  const [renameTarget, setRenameTarget] = useState<ModItem | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<ModItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [assignSectionTarget, setAssignSectionTarget] = useState<ModItem | null>(null);
  const [recorderHotkey, setRecorderHotkey] = useState<HotkeyItem | null>(null);
  const [tagPoolOpen, setTagPoolOpen] = useState(false);
  const [resetIniTarget, setResetIniTarget] = useState<ModItem | null>(null);
  const [resettingIni, setResettingIni] = useState(false);
  const [rollbackTarget, setRollbackTarget] = useState<ModItem | null>(null);
  const [undoing, setUndoing] = useState(false);

  const [rabbitFxConfirm, setRabbitFxConfirm] = useState<{
    modName: string;
    enable: boolean;
    activeList: RabbitFxModEntry[];
  } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    })
  );

  // Reset filters when switching character
  useEffect(() => {
    setSelectedSectionId("all");
    setSearchQuery("");
    setSelectedFilterTags([]);
    setSelectedModName(null);
    setDetails(null);
  }, [characterName]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [modsRes, secList, pool] = await Promise.all([
        api.listMods(characterName),
        api.listAppearanceSections(characterName),
        api.getTagsPool(),
      ]);
      setMods(modsRes.mods);
      setAliases(modsRes.characterAliases);
      setConflicts(modsRes.conflicts);
      setIsNonCharCategory(modsRes.isNonCharacterCategory);
      setSections(secList);
      setTagPool(pool.tags);
    } catch (err) {
      addToast("error", `加载 Mod 列表失败：${String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [characterName, addToast]);

  useEffect(() => {
    void loadData();
  }, [loadData, modsTick]);

  const exclusive = useMemo(() => {
    const map = config?.exclusiveByCategory ?? {};
    if (characterName in map) return map[characterName];
    return !isNonCharCategory;
  }, [config?.exclusiveByCategory, characterName, isNonCharCategory]);

  const handleToggleExclusive = async () => {
    const nextMap = { ...(config?.exclusiveByCategory ?? {}), [characterName]: !exclusive };
    try {
      await updateConfigPatch({ exclusiveByCategory: nextMap });
      addToast(
        "info",
        !exclusive ? "已开启互斥切换：启用新 Mod 时自动禁用同分类其他 Mod" : "已关闭互斥切换：允许同时启用多个 Mod"
      );
    } catch (err) {
      addToast("error", String(err));
    }
  };

  // Derive tag options present in this character + pool
  const availableFilterTags = useMemo(() => {
    const set = new Set<string>();
    for (const m of mods) {
      for (const t of m.tags) set.add(t);
    }
    for (const t of tagPool) set.add(t.name);
    return Array.from(set);
  }, [mods, tagPool]);

  const sortedMods = useMemo(() => {
    const list = [...mods];
    if (sortMode === "enabled") {
      list.sort(
        (a, b) =>
          Number(b.enabled) - Number(a.enabled) ||
          Number(b.pinned) - Number(a.pinned) ||
          a.name.localeCompare(b.name, "zh-CN")
      );
    } else if (sortMode === "name") {
      list.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    } else if (sortMode === "recent") {
      list.sort((a, b) => b.addedAtMs - a.addedAtMs || a.name.localeCompare(b.name, "zh-CN"));
    }
    return list;
  }, [mods, sortMode]);

  const filteredMods = useMemo(() => {
    const q = searchQuery.trim();
    return sortedMods.filter((m) => {
      if (selectedSectionId !== "all" && m.sectionId !== selectedSectionId) {
        return false;
      }
      if (selectedFilterTags.length > 0) {
        const hasAll = selectedFilterTags.every((t) => m.tags.includes(t));
        if (!hasAll) return false;
      }
      if (q) {
        const hitName = matchesSearch(m.name, [m.dirName, ...m.tags, m.notes], q);
        if (!hitName) return false;
      }
      return true;
    });
  }, [sortedMods, selectedSectionId, selectedFilterTags, searchQuery]);

  const displayMods: DisplayModItem[] = useMemo(() => {
    if (!collapseCollections) return filteredMods;
    return buildModCollectionView(filteredMods, characterName, aliases, selectedVariants);
  }, [collapseCollections, filteredMods, characterName, aliases, selectedVariants]);

  // Keep selectedModName valid and consume pendingFocusMod
  useEffect(() => {
    if (pendingFocusMod && pendingFocusMod.characterName === characterName) {
      const hit = mods.find((m) => m.name === pendingFocusMod.modName);
      if (hit) {
        setSelectedModName(hit.name);
        setSelectedSectionId("all");
        setPendingFocusMod(null);
        return;
      }
    }
    if (displayMods.length === 0) {
      setSelectedModName(null);
      setDetails(null);
      return;
    }
    const stillExists = selectedModName && mods.some((m) => m.name === selectedModName);
    if (!stillExists) {
      setSelectedModName(displayMods[0].name);
    }
  }, [displayMods, mods, selectedModName, pendingFocusMod, characterName, setPendingFocusMod]);

  // Load ModDetails when selectedModName changes
  useEffect(() => {
    if (!selectedModName) {
      setDetails(null);
      return;
    }
    let cancelled = false;
    setDetailsLoading(true);
    void api
      .getModDetails(characterName, selectedModName)
      .then((res) => {
        if (cancelled) return;
        setDetails(res);
        setNotesDraft(res.modItem.notes);
        setEditingHotkeyKey(null);
      })
      .catch((err) => {
        if (!cancelled) {
          addToast("error", `读取 Mod 详情失败：${String(err)}`);
        }
      })
      .finally(() => {
        if (!cancelled) setDetailsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [characterName, selectedModName, modsTick, addToast]);

  const dndEnabled =
    sortMode === "custom" &&
    !searchQuery.trim() &&
    selectedSectionId === "all" &&
    selectedFilterTags.length === 0;

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = displayMods.findIndex((m) => m.name === active.id);
    const newIndex = displayMods.findIndex((m) => m.name === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reorderedDisplay = arrayMove(displayMods, oldIndex, newIndex);
    const expandedOrder: string[] = [];
    for (const d of reorderedDisplay) {
      if (d.collection && d.collection.variants.length > 0) {
        for (const v of d.collection.variants) expandedOrder.push(v.name);
      } else {
        expandedOrder.push(d.name);
      }
    }

    try {
      await api.saveModOrder(characterName, expandedOrder);
      bumpModsTick();
    } catch (err) {
      addToast("error", `保存排序失败：${String(err)}`);
    }
  };

  const handleToggleMod = async (
    modName: string,
    targetEnable: boolean,
    forceReplaceRabbitFx = false
  ) => {
    try {
      const res = await api.toggleMod(
        characterName,
        modName,
        targetEnable,
        exclusive,
        forceReplaceRabbitFx
      );
      if (res.requiresRabbitFxConfirm) {
        setRabbitFxConfirm({
          modName,
          enable: targetEnable,
          activeList: res.activeRabbitFx,
        });
        return;
      }
      if (res.success) {
        addToast("success", res.message || `${modName} 已${targetEnable ? "启用" : "禁用"}`);
        await refreshRabbitFxStatus();
        await refreshUndoStack();
        bumpModsTick();
        bumpCharactersTick();
      }
    } catch (err) {
      addToast("error", String(err));
    }
  };

  const handleUndo = useCallback(async () => {
    if (undoing || undoStack.length === 0) return;
    setUndoing(true);
    try {
      const res = await api.undoLastAction();
      if (res.undone) {
        addToast("success", `已撤销：${res.label}`);
        await Promise.all([refreshRabbitFxStatus(), refreshUndoStack()]);
        bumpModsTick();
        bumpCharactersTick();
        bumpPresetsTick();
      }
    } catch (err) {
      addToast("error", `撤销失败：${String(err)}`);
    } finally {
      setUndoing(false);
    }
  }, [
    undoing,
    undoStack.length,
    addToast,
    refreshRabbitFxStatus,
    refreshUndoStack,
    bumpModsTick,
    bumpCharactersTick,
    bumpPresetsTick,
  ]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
        const tag = (document.activeElement?.tagName ?? "").toUpperCase();
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        if (undoStack.length === 0) return;
        e.preventDefault();
        void handleUndo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undoStack.length, handleUndo]);

  const handleResetModIniConfirm = async () => {
    if (!resetIniTarget) return;
    setResettingIni(true);
    try {
      await api.resetModIni(characterName, resetIniTarget.name);
      addToast("success", `已重置「${resetIniTarget.name}」的 INI 持久化状态`);
      setResetIniTarget(null);
      bumpModsTick();
    } catch (err) {
      addToast("error", String(err));
    } finally {
      setResettingIni(false);
    }
  };

  const handlePickDirectPreview = async (modItem: ModItem) => {
    try {
      const picked = await openDialog({
        title: `选择预览图：${modItem.name}`,
        multiple: false,
        filters: [{ name: "图片文件", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
      });
      if (typeof picked === "string" && picked) {
        await api.setModPreviewFile(characterName, modItem.name, picked);
        addToast("success", "已更换 Mod 预览图");
        bumpModsTick();
      }
    } catch (err) {
      addToast("error", String(err));
    }
  };

  const handleRenameConfirm = async () => {
    if (!renameTarget) return;
    const trimmed = renameValue.trim();
    if (!trimmed) {
      addToast("warning", "Mod 新名称不能为空");
      return;
    }
    setRenaming(true);
    try {
      await api.renameMod(characterName, renameTarget.name, trimmed);
      if (selectedModName === renameTarget.name) {
        setSelectedModName(trimmed);
      }
      setRenameTarget(null);
      addToast("success", `已重命名为「${trimmed}」`);
      bumpModsTick();
      bumpCharactersTick();
    } catch (err) {
      addToast("error", String(err));
    } finally {
      setRenaming(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.deleteMod(characterName, deleteTarget.name);
      addToast("success", `已将「${deleteTarget.name}」移入 Windows 回收站`);
      setDeleteTarget(null);
      await refreshRabbitFxStatus();
      bumpModsTick();
      bumpCharactersTick();
    } catch (err) {
      addToast("error", String(err));
    } finally {
      setDeleting(false);
    }
  };

  const handleUpdateTags = async (modName: string, nextTags: string[]) => {
    try {
      await api.updateModMeta(characterName, modName, { tags: nextTags });
      bumpModsTick();
    } catch (err) {
      addToast("error", String(err));
    }
  };

  const handleAddTag = async (modName: string, currentTags: string[], rawTag: string) => {
    const clean = rawTag.trim();
    if (!clean) return;
    const next = Array.from(new Set([...currentTags, clean]));
    await handleUpdateTags(modName, next);
    if (!tagPool.some((t) => t.name === clean)) {
      const nextPool = {
        tags: [
          ...tagPool,
          { id: `tag_${Date.now()}`, name: clean, color: "#ec4899" },
        ],
      };
      setTagPool(nextPool.tags);
      void api.saveTagsPool(nextPool);
    }
    setNewTagInput("");
  };

  const handleSaveNotes = async () => {
    if (!details) return;
    if (notesDraft === details.modItem.notes) return;
    try {
      await api.updateModMeta(characterName, details.modItem.name, { notes: notesDraft });
      addToast("success", "备注已保存");
      bumpModsTick();
    } catch (err) {
      addToast("error", String(err));
    }
  };

  const handleSaveHotkeyAlias = async (hotkeyKey: string) => {
    if (!details) return;
    const nextAliases: Record<string, string> = {};
    for (const hk of details.hotkeys) {
      if (hk.alias) nextAliases[hk.section] = hk.alias;
    }
    const clean = hotkeyAliasDraft.trim();
    if (clean) nextAliases[hotkeyKey] = clean;
    else delete nextAliases[hotkeyKey];

    try {
      await api.updateModMeta(characterName, details.modItem.name, {
        hotkeyAliases: nextAliases,
      });
      setEditingHotkeyKey(null);
      bumpModsTick();
    } catch (err) {
      addToast("error", String(err));
    }
  };

  const handleModContextMenu = (e: React.MouseEvent, item: DisplayModItem) => {
    e.preventDefault();
    setSelectedModName(item.name);
    setCtxMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          key: "toggle",
          label: item.enabled ? "禁用此 Mod" : "启用此 Mod",
          icon: <Power className="h-3.5 w-3.5" />,
          onClick: () => void handleToggleMod(item.name, !item.enabled),
        },
        {
          key: "pin",
          label: item.pinned ? "取消置顶" : "置顶显示",
          icon: <Pin className="h-3.5 w-3.5" />,
          onClick: async () => {
            await api.pinMod(characterName, item.name, !item.pinned);
            bumpModsTick();
          },
        },
        {
          key: "mark",
          label: item.marked ? "取消收藏书签" : "添加收藏书签",
          icon: <Bookmark className="h-3.5 w-3.5" />,
          onClick: async () => {
            await api.setModMarked(characterName, item.name, !item.marked);
            bumpModsTick();
          },
        },
        { divider: true, key: "d1" },
        {
          key: "section",
          label: "分配外观分区",
          icon: <Layers className="h-3.5 w-3.5" />,
          onClick: () => setAssignSectionTarget(item),
        },
        {
          key: "move",
          label: "移动到其他角色分类",
          icon: <FolderInput className="h-3.5 w-3.5" />,
          onClick: () => {
            setMovingMod({ sourceCharacter: characterName, modName: item.name });
            setSelectedCharacter(null);
          },
        },
        { divider: true, key: "d2" },
        {
          key: "crop-preview",
          label: "更换预览图（裁剪 16:10）",
          icon: <Crop className="h-3.5 w-3.5" />,
          onClick: () => setCropModTarget(item),
        },
        {
          key: "direct-preview",
          label: "直接选择预览图文件",
          icon: <ImageIcon className="h-3.5 w-3.5" />,
          onClick: () => void handlePickDirectPreview(item),
        },
        {
          key: "rename",
          label: "重命名 Mod",
          icon: <Pencil className="h-3.5 w-3.5" />,
          onClick: () => {
            setRenameTarget(item);
            setRenameValue(item.name);
          },
        },
        {
          key: "explorer",
          label: "在资源管理器中打开",
          icon: <FolderOpen className="h-3.5 w-3.5" />,
          onClick: () => void api.openPathInExplorer(item.path),
        },
        {
          key: "fix-mod",
          label: "修复此 Mod",
          icon: <Wrench className="h-3.5 w-3.5" />,
          onClick: () =>
            openFixerModal({
              scopeKind: "mod",
              characterName,
              modName: item.name,
            }),
        },
        {
          key: "rollback-mod",
          label: "查看 / 回滚修复备份",
          icon: <History className="h-3.5 w-3.5" />,
          onClick: () => setRollbackTarget(item),
        },
        {
          key: "reset-ini",
          label: "重置此 Mod INI",
          icon: <RotateCcw className="h-3.5 w-3.5" />,
          onClick: () => setResetIniTarget(item),
        },
        { divider: true, key: "d3" },
        {
          key: "delete",
          label: "移入回收站",
          icon: <Trash2 className="h-3.5 w-3.5" />,
          danger: true,
          onClick: () => setDeleteTarget(item),
        },
      ],
    });
  };

  const totalEnabled = mods.filter((m) => m.enabled).length;
  const activeDisplayItem = displayMods.find((d) => d.name === selectedModName) ?? null;
  const detailMod = details?.modItem ?? null;
  const detailPreviewUrl = detailMod
    ? buildMediaUrl(detailMod.previewPath, detailMod.previewMtime)
    : null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header & controls */}
      <div className="space-y-2.5 px-5 pt-3.5 pb-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setSelectedCharacter(null)}
              className="glass-surface inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--border-strong)]"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>返回角色</span>
            </button>
            <h1 className="text-lg font-bold text-[var(--text-primary)]">{characterName}</h1>
            <span className="rounded-full bg-[var(--accent-soft)] px-2.5 py-0.5 text-xs font-semibold text-[var(--accent)] tabular-nums">
              {totalEnabled} / {mods.length} 已启用
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Search */}
            <div className="relative w-56">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="筛选 Mod / 标签 / 拼音..."
                className="glass-surface w-full rounded-xl py-1.5 pr-7 pl-8 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute top-1/2 right-2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            {/* Sort */}
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as SortMode)}
              className="glass-surface rounded-xl px-2.5 py-1.5 text-xs font-medium text-[var(--text-primary)]"
            >
              <option value="custom">自定义排序</option>
              <option value="enabled">启用优先</option>
              <option value="name">名称排序</option>
              <option value="recent">最近添加</option>
            </select>

            {/* Exclusive mode */}
            <button
              type="button"
              onClick={handleToggleExclusive}
              title={
                exclusive
                  ? "排他模式开启：同一分类一次仅允许启用 1 个 Mod"
                  : "排他模式关闭：允许同分类同时启用多个 Mod"
              }
              className={`rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors ${
                exclusive
                  ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "glass-surface text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              {exclusive ? "排他模式：开" : "排他模式：关"}
            </button>

            {/* Collection collapse */}
            <button
              type="button"
              onClick={() => setCollapseCollections((v) => !v)}
              className={`inline-flex items-center gap-1 rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors ${
                collapseCollections
                  ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "glass-surface text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>合集折叠</span>
            </button>

            {/* Layout switch */}
            <div className="glass-surface flex items-center rounded-xl p-0.5">
              <button
                type="button"
                onClick={() => setViewLayout("detail")}
                title="双栏详情画廊"
                className={`rounded-lg p-1.5 ${
                  viewLayout === "detail"
                    ? "bg-[var(--accent)] text-[var(--accent-contrast)]"
                    : "text-[var(--text-secondary)]"
                }`}
              >
                <PanelRight className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setViewLayout("grid")}
                title="宽屏网格"
                className={`rounded-lg p-1.5 ${
                  viewLayout === "grid"
                    ? "bg-[var(--accent)] text-[var(--accent-contrast)]"
                    : "text-[var(--text-secondary)]"
                }`}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
              </button>
            </div>

            <button
              type="button"
              onClick={() => openImportWizard([], characterName)}
              className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]"
            >
              <Archive className="h-3.5 w-3.5" />
              <span>导入到此角色</span>
            </button>

            <button
              type="button"
              onClick={() =>
                openFixerModal({
                  scopeKind: "character",
                  characterName,
                })
              }
              className="glass-surface inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl px-2.5 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--border-strong)]"
            >
              <Wrench className="h-3.5 w-3.5" />
              <span>修复本角色</span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (config?.modsPath) {
                  void api.openPathInExplorer(`${config.modsPath}\\${characterName}`);
                }
              }}
              title="打开角色目录"
              className="glass-surface rounded-xl p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              <FolderOpen className="h-3.5 w-3.5" />
            </button>

            <button
              type="button"
              onClick={() => void loadData()}
              disabled={loading}
              title="刷新列表"
              className="glass-surface rounded-xl p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>

            {undoStack.length > 0 && (
              <button
                type="button"
                onClick={() => void handleUndo()}
                disabled={undoing}
                title={`撤销上一步：${undoStack[0].label} (Ctrl+Z)`}
                className="glass-surface inline-flex items-center gap-1 rounded-xl border border-[var(--border-strong)] px-2.5 py-1.5 text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent-soft)] disabled:opacity-50"
              >
                <Undo2 className="h-3.5 w-3.5" />
                <span>撤销</span>
              </button>
            )}
          </div>
        </div>

        {/* Appearance Section bar */}
        <AppearanceSectionBar
          characterName={characterName}
          sections={sections}
          selectedSectionId={selectedSectionId}
          onSelectSection={setSelectedSectionId}
          totalModCount={mods.length}
          totalEnabledCount={totalEnabled}
          onSectionsChanged={bumpModsTick}
        />

        {/* Multi-select AND Tag Filter */}
        <div className="flex flex-wrap items-center gap-1.5">
          {availableFilterTags.length > 0 && (
            <>
              <span className="inline-flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
                <Tag className="h-3 w-3" />
                <span>标签筛选：</span>
              </span>
              {availableFilterTags.map((tagName) => {
                const active = selectedFilterTags.includes(tagName);
                const poolColor = tagPool.find((t) => t.name === tagName)?.color;
                const inactiveStyle = !active ? getTagBadgeStyle(poolColor) : undefined;
                return (
                  <button
                    key={tagName}
                    type="button"
                    style={
                      active && poolColor
                        ? { backgroundColor: poolColor, borderColor: poolColor, color: "#ffffff" }
                        : inactiveStyle
                    }
                    onClick={() =>
                      setSelectedFilterTags((prev) =>
                        prev.includes(tagName)
                          ? prev.filter((x) => x !== tagName)
                          : [...prev, tagName]
                      )
                    }
                    className={`rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                      active
                        ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-contrast)]"
                        : "border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]"
                    }`}
                  >
                    {tagName}
                  </button>
                );
              })}
              {selectedFilterTags.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedFilterTags([])}
                  className="text-[11px] text-[var(--accent)] hover:underline"
                >
                  清除标签
                </button>
              )}
            </>
          )}
          <button
            type="button"
            onClick={() => setTagPoolOpen(true)}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-[var(--border-strong)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            <Plus className="h-3 w-3" />
            <span>管理标签池</span>
          </button>
        </div>

        {/* Hash Conflict Banner */}
        {conflicts.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--danger)]/40 bg-[var(--danger-soft)] px-3.5 py-2 text-xs text-[var(--danger)]">
            <div className="flex items-center gap-2 font-medium">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                检测到 {conflicts.length} 组已启用 Mod 存在相同资源 Hash 冲突：
                {conflicts
                  .slice(0, 2)
                  .map((g) => `${g.mods.join(" / ")}`)
                  .join("；")}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                const firstConflictMod = conflicts[0]?.mods[0];
                if (firstConflictMod) setSelectedModName(firstConflictMod);
              }}
              className="rounded-lg bg-[var(--danger)] px-2.5 py-1 text-[11px] font-semibold text-white hover:opacity-90"
            >
              定位冲突 Mod
            </button>
          </div>
        )}
      </div>

      {/* Main Content Split */}
      <div className="flex flex-1 gap-4 overflow-hidden px-5 pb-4">
        {/* Left: Cards Grid */}
        <div className="flex-1 overflow-y-auto pr-1">
          {displayMods.length === 0 ? (
            <div className="glass-card mx-auto mt-10 max-w-md rounded-2xl p-6 text-center">
              <p className="text-sm font-semibold text-[var(--text-primary)]">
                暂无符合条件的 Mod
              </p>
              <p className="mt-1 text-xs text-[var(--text-secondary)]">
                可尝试切换「全部外观」、清除搜索或标签筛选条件。
              </p>
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={displayMods.map((m) => m.name)}
                strategy={rectSortingStrategy}
              >
                <div
                  className={`grid gap-3.5 pb-4 ${
                    viewLayout === "detail"
                      ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                      : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
                  }`}
                >
                  {displayMods.map((item) => (
                    <SortableModCard
                      key={item.name}
                      item={item}
                      selected={selectedModName === item.name}
                      dndEnabled={dndEnabled}
                      compactLayout={viewLayout === "detail"}
                      tagColorMap={Object.fromEntries(tagPool.map((t) => [t.name, t.color]))}
                      onSelect={() => setSelectedModName(item.name)}
                      onToggleEnable={() => void handleToggleMod(item.name, !item.enabled)}
                      onSelectCollectionVariant={(identity, variantModName) => {
                        setSelectedVariants((prev) => ({
                          ...prev,
                          [identity]: variantModName,
                        }));
                        setSelectedModName(variantModName);
                      }}
                      onContextMenu={(e) => handleModContextMenu(e, item)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>

        {/* Right: Sticky Details Sidebar */}
        {viewLayout === "detail" && detailMod && (
          <aside className="glass-card flex h-full w-[380px] shrink-0 flex-col overflow-hidden rounded-2xl xl:w-[420px]">
            {/* Scrollable Body */}
            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              {/* Large Preview Image */}
              <div className="group relative aspect-[16/10] w-full overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
                {detailPreviewUrl ? (
                  <img
                    src={detailPreviewUrl}
                    alt={detailMod.name}
                    onClick={() => setLightboxOpen(true)}
                    className="h-full w-full cursor-zoom-in object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-xs text-[var(--text-muted)]">
                    <ImageIcon className="h-7 w-7 opacity-45" />
                    <span>暂无预览图</span>
                  </div>
                )}

                <div className="absolute right-2 bottom-2 flex gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => setCropModTarget(detailMod)}
                    className="inline-flex items-center gap-1 rounded-lg bg-black/72 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-xs hover:bg-black/90"
                  >
                    <Crop className="h-3 w-3" />
                    <span>裁剪换图</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handlePickDirectPreview(detailMod)}
                    className="inline-flex items-center gap-1 rounded-lg bg-black/72 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-xs hover:bg-black/90"
                  >
                    <ImageIcon className="h-3 w-3" />
                    <span>直选图片</span>
                  </button>
                </div>
              </div>

              {/* Title + Rename Pencil (UX fix #7) + Bookmark + Pin */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-1 items-start gap-1.5">
                  <h2 className="break-all text-base font-bold text-[var(--text-primary)]">
                    {detailMod.name}
                  </h2>
                  <button
                    type="button"
                    title="重命名 Mod"
                    onClick={() => {
                      setRenameTarget(detailMod);
                      setRenameValue(detailMod.name);
                    }}
                    className="mt-0.5 shrink-0 rounded-lg p-1 text-[var(--text-muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    title={detailMod.marked ? "取消收藏" : "加入收藏书签"}
                    onClick={async () => {
                      await api.setModMarked(characterName, detailMod.name, !detailMod.marked);
                      bumpModsTick();
                    }}
                    className={`rounded-lg p-1.5 transition-colors ${
                      detailMod.marked
                        ? "bg-amber-500/15 text-amber-500"
                        : "text-[var(--text-muted)] hover:bg-[var(--bg-elevated)]"
                    }`}
                  >
                    <Bookmark className={`h-4 w-4 ${detailMod.marked ? "fill-current" : ""}`} />
                  </button>
                  <button
                    type="button"
                    title={detailMod.pinned ? "取消置顶" : "置顶显示"}
                    onClick={async () => {
                      await api.pinMod(characterName, detailMod.name, !detailMod.pinned);
                      bumpModsTick();
                    }}
                    className={`rounded-lg p-1.5 transition-colors ${
                      detailMod.pinned
                        ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                        : "text-[var(--text-muted)] hover:bg-[var(--bg-elevated)]"
                    }`}
                  >
                    <Pin className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Warnings for EFF / RabbitFX / Conflict */}
              {detailMod.isEffMod && (
                <div className="flex items-start gap-2 rounded-xl border border-[var(--warning)]/40 bg-[var(--warning-soft)] px-3 py-2 text-xs text-[var(--warning)]">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    检测到 EFF 框架特征（compiled.bin / format 2），该格式应放入 EFF 加载器目录而非 EFMI\Mods。
                  </span>
                </div>
              )}

              {detailMod.hasConflict && (
                <div className="flex items-start gap-2 rounded-xl border border-[var(--danger)]/40 bg-[var(--danger-soft)] px-3 py-2 text-xs text-[var(--danger)]">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    与同分类已启用的 {detailMod.conflictWith.join("、")} 存在相同纹理 Hash 冲突。
                  </span>
                </div>
              )}

              {/* Collection variant selector */}
              {activeDisplayItem?.collection && (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-semibold text-[var(--text-secondary)]">
                    同合集版本 / 分支切换
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {activeDisplayItem.collection.variants.map((v) => {
                      const active = v.name === detailMod.name;
                      return (
                        <button
                          key={v.name}
                          type="button"
                          onClick={() => {
                            setSelectedVariants((prev) => ({
                              ...prev,
                              [activeDisplayItem.collection!.identity]: v.name,
                            }));
                            setSelectedModName(v.name);
                          }}
                          className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                            active
                              ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-contrast)]"
                              : "border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-primary)] hover:border-[var(--border-strong)]"
                          }`}
                        >
                          {getCollectionVariantLabel(v)}
                          {v.enabled ? " · 启用" : ""}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Appearance section selector */}
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-[var(--text-secondary)]">
                  所属外观分区
                </label>
                <select
                  value={detailMod.sectionId}
                  onChange={async (e) => {
                    try {
                      await api.assignModSection(characterName, detailMod.name, e.target.value);
                      bumpModsTick();
                    } catch (err) {
                      addToast("error", String(err));
                    }
                  }}
                  className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs text-[var(--text-primary)]"
                >
                  {sections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Hotkeys (UX fix #7 Keyboard icon & #8 Disambiguation) */}
              <div className="space-y-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
                    <Keyboard className="h-3.5 w-3.5 text-[var(--accent)]" />
                    <span>Mod 快捷键</span>
                  </div>
                  {detailsLoading && (
                    <span className="text-[10px] text-[var(--text-muted)]">解析中...</span>
                  )}
                </div>

                {details && details.hotkeys.length > 0 ? (
                  <div className="space-y-2">
                    {details.hotkeys.map((hk) => {
                      const editingThis = editingHotkeyKey === hk.section;
                      return (
                        <div
                          key={`${hk.iniRelPath}-${hk.section}`}
                          className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-2 text-xs"
                        >
                          <div className="flex items-center justify-between gap-2">
                            {editingThis ? (
                              <div className="flex flex-1 items-center gap-1.5">
                                <input
                                  type="text"
                                  value={hotkeyAliasDraft}
                                  onChange={(e) => setHotkeyAliasDraft(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") void handleSaveHotkeyAlias(hk.section);
                                    if (e.key === "Escape") setEditingHotkeyKey(null);
                                  }}
                                  placeholder="输入快捷键自定义别名（留空恢复默认）"
                                  autoFocus
                                  className="flex-1 rounded-md border border-[var(--accent)] bg-[var(--bg-elevated)] px-2 py-1 text-[11px]"
                                />
                                <button
                                  type="button"
                                  onClick={() => void handleSaveHotkeyAlias(hk.section)}
                                  className="rounded-md bg-[var(--accent)] p-1 text-[var(--accent-contrast)]"
                                >
                                  <Check className="h-3 w-3" />
                                </button>
                              </div>
                            ) : (
                              <>
                                <span className="truncate font-medium text-[var(--text-primary)]">
                                  {hk.alias || hk.description}
                                </span>
                                <div className="flex shrink-0 items-center gap-1">
                                  {hk.keys.map((k, idx) => (
                                    <kbd
                                      key={`${k}-${idx}`}
                                      className="rounded-md border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[var(--accent)]"
                                    >
                                      {k}
                                    </kbd>
                                  ))}
                                  <button
                                    type="button"
                                    title="编辑显示别名"
                                    onClick={() => {
                                      setEditingHotkeyKey(hk.section);
                                      setHotkeyAliasDraft(hk.alias || "");
                                    }}
                                    className="ml-0.5 rounded p-1 text-[var(--text-muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
                                  >
                                    <Pencil className="h-3 w-3" />
                                  </button>
                                  <button
                                    type="button"
                                    title="修改 INI 快捷键"
                                    onClick={() => setRecorderHotkey(hk)}
                                    className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
                                  >
                                    <Keyboard className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    <p className="text-[10px] text-[var(--text-muted)]">
                      提示：点击铅笔可重命名显示别名，点击键盘可录制并直接改写 `.ini` 键位（游戏内点按联动将在 Phase 3 接入）。
                    </p>
                  </div>
                ) : (
                  <p className="text-[11px] text-[var(--text-muted)]">
                    当前 Mod 的 .ini 中未检测到可调 [Key*] 热键。
                  </p>
                )}
              </div>

              {/* Local Tags Editor */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[11px] font-semibold text-[var(--text-secondary)]">
                  <span className="inline-flex items-center gap-1.5">
                    <Tag className="h-3.5 w-3.5 text-[var(--accent)]" />
                    <span>本地标签</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setTagPoolOpen(true)}
                    className="font-medium text-[var(--accent)] hover:underline"
                  >
                    管理标签池
                  </button>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {detailMod.tags.map((t) => {
                    const poolColor = tagPool.find((tp) => tp.name === t)?.color;
                    return (
                      <span
                        key={t}
                        style={getTagBadgeStyle(poolColor)}
                        className="inline-flex items-center gap-1 rounded-full border border-transparent bg-[var(--accent-soft)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--accent)]"
                      >
                        <span>{t}</span>
                        <button
                          type="button"
                          onClick={() =>
                            void handleUpdateTags(
                              detailMod.name,
                              detailMod.tags.filter((x) => x !== t)
                            )
                          }
                          className="hover:text-[var(--danger)]"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    );
                  })}
                </div>

                {/* Quick tag pool picks */}
                {tagPool.filter((tp) => !detailMod.tags.includes(tp.name)).length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {tagPool
                      .filter((tp) => !detailMod.tags.includes(tp.name))
                      .slice(0, 8)
                      .map((tp) => (
                        <button
                          key={tp.id}
                          type="button"
                          onClick={() =>
                            void handleAddTag(detailMod.name, detailMod.tags, tp.name)
                          }
                          className="inline-flex items-center gap-0.5 rounded-full border border-dashed border-[var(--border-subtle)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                        >
                          <Plus className="h-2.5 w-2.5" />
                          <span>{tp.name}</span>
                        </button>
                      ))}
                  </div>
                )}

                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={newTagInput}
                    onChange={(e) => setNewTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        void handleAddTag(detailMod.name, detailMod.tags, newTagInput);
                      }
                    }}
                    placeholder="输入新标签后按回车添加"
                    className="flex-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-1.5 text-xs text-[var(--text-primary)]"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      void handleAddTag(detailMod.name, detailMod.tags, newTagInput)
                    }
                    className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--border-strong)]"
                  >
                    添加
                  </button>
                </div>
              </div>

              {/* Notes */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-semibold text-[var(--text-secondary)]">
                  <span>本地备注</span>
                  {notesDraft !== detailMod.notes && (
                    <button
                      type="button"
                      onClick={() => void handleSaveNotes()}
                      className="text-[var(--accent)] hover:underline"
                    >
                      点击保存
                    </button>
                  )}
                </div>
                <textarea
                  rows={3}
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  onBlur={() => void handleSaveNotes()}
                  placeholder="记录作者、搭配建议或注意事项（自动保存到本地 tags.json）..."
                  className="w-full resize-none rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-2.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
                />
              </div>

              {/* Readme (说明.txt) */}
              {details?.readmeText && (
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
                  <button
                    type="button"
                    onClick={() => setReadmeOpen((o) => !o)}
                    className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold text-[var(--text-primary)]"
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <FileText className="h-3.5 w-3.5 text-[var(--accent)]" />
                      <span>Mod 说明文档 (说明.txt / README)</span>
                    </span>
                    {readmeOpen ? (
                      <ChevronUp className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                  </button>
                  {readmeOpen && (
                    <pre className="max-h-56 overflow-y-auto border-t border-[var(--border-subtle)] p-3 text-[11px] leading-relaxed whitespace-pre-wrap text-[var(--text-secondary)]">
                      {details.readmeText}
                    </pre>
                  )}
                </div>
              )}
            </div>

            {/* Sticky Bottom Action Bar (UX fix #6) */}
            <div className="sticky bottom-0 flex shrink-0 items-center gap-2 border-t border-[var(--border-subtle)] bg-[var(--bg-surface-strong)] px-4 py-3">
              <button
                type="button"
                onClick={() => void handleToggleMod(detailMod.name, !detailMod.enabled)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold whitespace-nowrap transition-colors ${
                  detailMod.enabled
                    ? "border border-[var(--border-strong)] bg-[var(--bg-elevated)] text-[var(--text-primary)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
                    : "bg-[var(--accent)] text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]"
                }`}
              >
                <Power className="h-3.5 w-3.5" />
                <span>{detailMod.enabled ? "禁用此 Mod" : "启用此 Mod"}</span>
              </button>

              <button
                type="button"
                title="在资源管理器中打开"
                onClick={() => void api.openPathInExplorer(detailMod.path)}
                className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2 text-[var(--text-primary)] hover:border-[var(--border-strong)]"
              >
                <FolderOpen className="h-4 w-4" />
              </button>

              <button
                type="button"
                title="移动到其他角色"
                onClick={() => {
                  setMovingMod({ sourceCharacter: characterName, modName: detailMod.name });
                  setSelectedCharacter(null);
                }}
                className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2 text-[var(--text-primary)] hover:border-[var(--border-strong)]"
              >
                <FolderInput className="h-4 w-4" />
              </button>

              <button
                type="button"
                title="移入回收站"
                onClick={() => setDeleteTarget(detailMod)}
                className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2 text-[var(--danger)] hover:bg-[var(--danger-soft)]"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </aside>
        )}
      </div>

      <ContextMenu menu={ctxMenu} onClose={() => setCtxMenu(null)} />

      <LightboxModal
        open={lightboxOpen}
        src={detailPreviewUrl}
        title={detailMod?.name}
        onClose={() => setLightboxOpen(false)}
      />

      <ImageCropModal
        open={Boolean(cropModTarget)}
        title={`裁剪预览图：${cropModTarget?.name ?? ""}`}
        aspect={16 / 10}
        initialImageUrl={
          cropModTarget
            ? buildMediaUrl(cropModTarget.previewPath, cropModTarget.previewMtime)
            : null
        }
        onClose={() => setCropModTarget(null)}
        onConfirm={async (dataUrl) => {
          if (!cropModTarget) return;
          await api.setModPreviewData(characterName, cropModTarget.name, dataUrl);
          addToast("success", "已保存新的 Mod 预览图");
          bumpModsTick();
        }}
      />

      {/* Rename Mod Modal */}
      <Modal
        open={Boolean(renameTarget)}
        onClose={() => !renaming && setRenameTarget(null)}
        title="重命名 Mod"
        maxWidthClass="max-w-md"
        footer={
          <>
            <button
              type="button"
              onClick={() => setRenameTarget(null)}
              disabled={renaming}
              className="rounded-xl border border-[var(--border-subtle)] px-4 py-2 text-xs font-medium text-[var(--text-secondary)]"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleRenameConfirm}
              disabled={renaming}
              className="rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] disabled:opacity-50"
            >
              {renaming ? "保存中..." : "确认重命名"}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-xs text-[var(--text-secondary)]">
            原名称：<strong className="text-[var(--text-primary)]">{renameTarget?.name}</strong>
          </p>
          <input
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            placeholder="请输入新的 Mod 名称"
            className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-primary)]"
          />
        </div>
      </Modal>

      {/* Assign Section Modal */}
      <Modal
        open={Boolean(assignSectionTarget)}
        onClose={() => setAssignSectionTarget(null)}
        title="分配外观分区"
        subtitle={`目标 Mod：${assignSectionTarget?.name ?? ""}`}
        maxWidthClass="max-w-sm"
      >
        <div className="space-y-2">
          {sections.map((sec) => {
            const active = assignSectionTarget?.sectionId === sec.id;
            return (
              <button
                key={sec.id}
                type="button"
                onClick={async () => {
                  if (!assignSectionTarget) return;
                  try {
                    await api.assignModSection(characterName, assignSectionTarget.name, sec.id);
                    addToast("success", `已分配到「${sec.name}」`);
                    setAssignSectionTarget(null);
                    bumpModsTick();
                  } catch (err) {
                    addToast("error", String(err));
                  }
                }}
                className={`flex w-full items-center justify-between rounded-xl border px-3.5 py-2.5 text-xs font-medium ${
                  active
                    ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-primary)] hover:border-[var(--border-strong)]"
                }`}
              >
                <span>{sec.name}</span>
                {active && <Check className="h-3.5 w-3.5" />}
              </button>
            );
          })}
        </div>
      </Modal>

      {/* RabbitFX Single-Instance Safety Guard Modal */}
      <Modal
        open={Boolean(rabbitFxConfirm)}
        onClose={() => setRabbitFxConfirm(null)}
        title="RabbitFX 单实例保护确认"
        maxWidthClass="max-w-md"
        footer={
          <>
            <button
              type="button"
              onClick={() => setRabbitFxConfirm(null)}
              className="rounded-xl border border-[var(--border-subtle)] px-4 py-2 text-xs font-medium text-[var(--text-secondary)]"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => {
                if (!rabbitFxConfirm) return;
                const { modName, enable } = rabbitFxConfirm;
                setRabbitFxConfirm(null);
                void handleToggleMod(modName, enable, true);
              }}
              className="rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]"
            >
              禁用旧版并启用此版
            </button>
          </>
        }
      >
        <div className="space-y-3 text-xs leading-relaxed text-[var(--text-secondary)]">
          <div className="flex items-start gap-2 rounded-xl border border-[var(--warning)]/40 bg-[var(--warning-soft)] p-3 text-[var(--warning)]">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              在 EFMI 中同时启用多个 RabbitFX 插件会直接导致游戏启动崩溃。系统检测到当前已启用以下 RabbitFX：
            </span>
          </div>
          <ul className="space-y-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 font-medium text-[var(--text-primary)]">
            {rabbitFxConfirm?.activeList.map((entry) => (
              <li key={entry.path}>
                • {entry.characterName} / {entry.modName}
              </li>
            ))}
          </ul>
          <p>
            是否自动禁用上述已启用的 RabbitFX，并启用
            <strong className="mx-1 text-[var(--text-primary)]">
              {rabbitFxConfirm?.modName}
            </strong>
            ？
          </p>
        </div>
      </Modal>

      {/* Delete Mod Modal */}
      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => !deleting && setDeleteTarget(null)}
        title="确认移入回收站"
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
              onClick={handleDeleteConfirm}
              disabled={deleting}
              className="rounded-xl bg-[var(--danger)] px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {deleting ? "处理中..." : "移入回收站"}
            </button>
          </>
        }
      >
        <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
          确定要将 Mod
          <strong className="mx-1 text-[var(--text-primary)]">「{deleteTarget?.name}」</strong>
          移入 Windows 回收站吗？您可以在回收站中随时还原。
        </p>
      </Modal>

      {/* Hotkey Recorder Modal */}
      <HotkeyRecorderModal
        open={Boolean(recorderHotkey)}
        hotkey={recorderHotkey}
        onClose={() => setRecorderHotkey(null)}
        onSave={async (newKeyExpr) => {
          if (!detailMod || !recorderHotkey) return;
          await api.updateModHotkey(
            characterName,
            detailMod.name,
            recorderHotkey.iniRelPath,
            recorderHotkey.section,
            newKeyExpr
          );
          addToast("success", `已将 [${recorderHotkey.section}] 键位写回为 ${newKeyExpr}`);
          bumpModsTick();
        }}
      />

      {/* Local Tag Pool Modal */}
      <TagPoolModal
        open={tagPoolOpen}
        tags={tagPool}
        onClose={() => setTagPoolOpen(false)}
        onSave={async (nextTags) => {
          await api.saveTagsPool({ tags: nextTags });
          setTagPool(nextTags);
          addToast("success", "本地标签池已保存");
          bumpModsTick();
        }}
      />

      {/* Reset Single Mod INI Confirmation Modal */}
      <Modal
        open={Boolean(resetIniTarget)}
        onClose={() => !resettingIni && setResetIniTarget(null)}
        title="重置 Mod INI 状态"
        maxWidthClass="max-w-md"
        footer={
          <>
            <button
              type="button"
              onClick={() => setResetIniTarget(null)}
              disabled={resettingIni}
              className="rounded-xl border border-[var(--border-subtle)] px-4 py-2 text-xs font-medium text-[var(--text-secondary)]"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void handleResetModIniConfirm()}
              disabled={resettingIni}
              className="rounded-xl bg-[var(--warning)] px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {resettingIni ? "重置中..." : "确认重置"}
            </button>
          </>
        }
      >
        <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
          确定要重置
          <strong className="mx-1 text-[var(--text-primary)]">「{resetIniTarget?.name}」</strong>
          的 INI 状态吗？系统将恢复其 `.qaqm-persistbak` 备份、清空对应 Persist Bridge 缓存并移除 `d3dx_user.ini` 中的历史变量记忆。
        </p>
      </Modal>

      <BackupRollbackModal
        open={Boolean(rollbackTarget)}
        characterName={characterName}
        modName={rollbackTarget?.name ?? ""}
        onClose={() => setRollbackTarget(null)}
      />
    </div>
  );
}
