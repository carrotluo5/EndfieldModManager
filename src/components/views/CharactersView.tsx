import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  Archive,
  FolderInput,
  FolderOpen,
  FolderSync,
  Image as ImageIcon,
  Pencil,
  Pin,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  UserPlus,
  Wand2,
  Wrench,
  X,
} from "lucide-react";
import { matchesSearch } from "../../lib/search";
import { api, buildMediaUrl } from "../../lib/tauri";
import { useAppStore } from "../../store/useAppStore";
import type { CharacterItem } from "../../types/mod";
import { ContextMenu, type ContextMenuState } from "../ui/ContextMenu";
import { ImageCropModal } from "../ui/ImageCropModal";
import { Modal } from "../ui/Modal";

const CHARACTER_SORT_KEY = "efmm.characterSort";
const CHARACTER_SORT_OPTIONS = [
  { value: "custom", label: "自定义" },
  { value: "modCount", label: "Mod 数量" },
  { value: "name", label: "名称" },
] as const;
const characterNameCollator = new Intl.Collator("zh-CN", { numeric: true });
const characterControlClass =
  "rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] aria-pressed:bg-[var(--accent-soft)] aria-pressed:font-semibold aria-pressed:text-[var(--accent)]";

type CharacterSortMode = (typeof CHARACTER_SORT_OPTIONS)[number]["value"];

function readCharacterSort(): CharacterSortMode {
  try {
    const saved = localStorage.getItem(CHARACTER_SORT_KEY);
    if (saved === "modCount" || saved === "name") return saved;
  } catch {
    // The view still works when browser storage is unavailable.
  }
  return "custom";
}

interface CharacterCardProps {
  item: CharacterItem;
  dndEnabled: boolean;
  isMoveTarget: boolean;
  canDropCover: boolean;
  coverDropActive: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

function SortableCharacterCard({
  item,
  dndEnabled,
  isMoveTarget,
  canDropCover,
  coverDropActive,
  onClick,
  onContextMenu,
}: CharacterCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.name,
    disabled: { draggable: !dndEnabled, droppable: !dndEnabled },
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.65 : 1,
    zIndex: isDragging ? 30 : undefined,
  };

  const coverUrl = buildMediaUrl(item.coverPath, item.coverMtime);

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-cover-drop-target={canDropCover ? item.name : undefined}
      {...(dndEnabled ? attributes : { role: "button", tabIndex: 0 })}
      {...(dndEnabled ? listeners : {})}
      aria-label={item.name}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick();
        }
      }}
      onContextMenu={onContextMenu}
      className={`glass-card group relative aspect-[303/386] cursor-pointer overflow-hidden rounded-2xl transition-all hover:-translate-y-0.5 hover:border-[var(--border-strong)] ${
        isMoveTarget ? "ring-2 ring-[var(--accent)]" : ""
      }`}
    >
      {coverUrl ? (
        <img
          src={coverUrl}
          alt={item.name}
          draggable={false}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-[var(--accent-soft)] via-[var(--bg-elevated)] to-[var(--bg-surface)] px-3 text-center">
          <span className="text-4xl font-bold tracking-wider text-[var(--accent)] opacity-85">
            {item.name.slice(0, 1)}
          </span>
          <span className="mt-2 text-xs text-[var(--text-muted)]">暂无封面</span>
        </div>
      )}
      {coverDropActive && (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-2xl border-2 border-dashed border-[var(--accent)] bg-[var(--bg-surface-strong)]/85 text-sm font-semibold text-[var(--accent)]">
          松开以裁剪封面
        </div>
      )}

      {/* Top badges - NOTE: intentionally NO hover close/delete X button (UX fix #4) */}
      <div className="pointer-events-none absolute inset-x-2 top-2 flex items-start justify-between gap-1">
        {item.pinned ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-fill)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent-contrast)] shadow-xs">
            <Pin className="h-2.5 w-2.5" />
            <span>置顶</span>
          </span>
        ) : (
          <span />
        )}

        {item.isNonCharacterCategory && (
          <span className="rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-xs">
            功能分类
          </span>
        )}
      </div>

      {/* Bottom gradient bar */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/82 via-black/48 to-transparent px-3 pt-10 pb-2.5 text-white">
        <div className="flex items-end justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold drop-shadow-xs">{item.name}</div>
            {!item.existsOnDisk && (
              <div className="text-[10px] text-white/70">尚未建立目录</div>
            )}
          </div>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
              item.enabledCount > 0
                ? "bg-[var(--accent-fill)] text-[var(--accent-contrast)]"
                : "bg-white/20 text-white"
            }`}
          >
            {item.enabledCount}/{item.modCount}
          </span>
        </div>
      </div>
    </div>
  );
}

interface CharactersViewProps {
  coverDropTarget: string | null;
  droppedCover: { name: string; path: string } | null;
  clearDroppedCover: () => void;
}

export function CharactersView({ coverDropTarget, droppedCover, clearDroppedCover }: CharactersViewProps) {
  const config = useAppStore((s) => s.config);
  const movingMod = useAppStore((s) => s.movingMod);
  const charactersTick = useAppStore((s) => s.charactersTick);
  const setSelectedCharacter = useAppStore((s) => s.setSelectedCharacter);
  const setMovingMod = useAppStore((s) => s.setMovingMod);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const updateConfigPatch = useAppStore((s) => s.updateConfigPatch);
  const refreshRabbitFxStatus = useAppStore((s) => s.refreshRabbitFxStatus);
  const bumpCharactersTick = useAppStore((s) => s.bumpCharactersTick);
  const bumpModsTick = useAppStore((s) => s.bumpModsTick);
  const openImportWizard = useAppStore((s) => s.openImportWizard);
  const setOrganizeModalOpen = useAppStore((s) => s.setOrganizeModalOpen);
  const openFixerModal = useAppStore((s) => s.openFixerModal);
  const setSetupWizardOpen = useAppStore((s) => s.setSetupWizardOpen);
  const addToast = useAppStore((s) => s.addToast);

  const [characters, setCharacters] = useState<CharacterItem[]>([]);
  const [loading, setLoading] = useState(false);
  const loadId = useRef(0);
  const [savingOrder, setSavingOrder] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortMode, setSortMode] = useState(readCharacterSort);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);

  // Add character modal
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addCoverDataUrl, setAddCoverDataUrl] = useState<string | null>(null);
  const [addCropOpen, setAddCropOpen] = useState(false);
  const [addSaving, setAddSaving] = useState(false);

  // Rename character modal
  const [renameTarget, setRenameTarget] = useState<CharacterItem | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);

  // Change cover crop modal
  const [coverTarget, setCoverTarget] = useState<CharacterItem | null>(null);
  const [coverSource, setCoverSource] = useState<string | null>(null);

  useEffect(() => {
    if (!droppedCover) return;
    const item = characters.find((character) => character.name === droppedCover.name);
    if (item) {
      setCoverSource(buildMediaUrl(droppedCover.path, Date.now()));
      setCoverTarget(item);
    }
    clearDroppedCover();
  }, [characters, droppedCover, clearDroppedCover]);

  // Delete confirmation modal
  const [deleteTarget, setDeleteTarget] = useState<CharacterItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Reset character INI confirmation modal
  const [resetIniTarget, setResetIniTarget] = useState<CharacterItem | null>(null);
  const [resettingIni, setResettingIni] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    })
  );

  const loadCharacters = useCallback(async () => {
    const currentLoad = ++loadId.current;
    if (!config?.modsPath.trim()) {
      setCharacters([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const list = await api.listCharacters(true);
      if (currentLoad === loadId.current) setCharacters(list);
    } catch (err) {
      if (currentLoad === loadId.current) {
        addToast("error", `加载角色列表失败：${String(err)}`);
      }
    } finally {
      if (currentLoad === loadId.current) setLoading(false);
    }
  }, [config?.modsPath, addToast]);

  useEffect(() => {
    void loadCharacters();
  }, [loadCharacters, charactersTick]);

  const showAll = Boolean(config?.showAllCharacters || movingMod);
  const normalizedQuery = searchQuery.trim();

  const visibleCharacters = useMemo(() => {
    const filtered = characters.filter(
      (item) =>
        (showAll || item.pinned || item.modCount > 0 || item.sectionCount > 0) &&
        matchesSearch(item.name, item.aliases, normalizedQuery)
    );
    if (sortMode === "custom") return filtered;
    return filtered.sort((left, right) => {
      if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
      if (sortMode === "modCount" && left.modCount !== right.modCount) {
        return right.modCount - left.modCount;
      }
      return characterNameCollator.compare(left.name, right.name);
    });
  }, [characters, normalizedQuery, showAll, sortMode]);

  const totalModCount = characters.reduce((sum, item) => sum + item.modCount, 0);
  const visibleModCount = visibleCharacters.reduce((sum, item) => sum + item.modCount, 0);
  const reorderableCharacters = visibleCharacters.filter((item) => !item.pinned);
  const dndEnabled =
    sortMode === "custom" && !normalizedQuery && !movingMod && !loading && !savingOrder;

  const handleSortChange = (mode: CharacterSortMode) => {
    setSortMode(mode);
    try {
      localStorage.setItem(CHARACTER_SORT_KEY, mode);
    } catch {
      // Keep the current selection for this view when storage is unavailable.
    }
  };

  const handleShowAllChange = async (next: boolean) => {
    if (movingMod || next === showAll) return;
    try {
      await updateConfigPatch({ showAllCharacters: next });
    } catch (err) {
      addToast("error", `保存角色显示设置失败：${String(err)}`);
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!dndEnabled || !config || !over || active.id === over.id) return;

    const oldIndex = reorderableCharacters.findIndex((item) => item.name === active.id);
    const newIndex = reorderableCharacters.findIndex((item) => item.name === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(reorderableCharacters, oldIndex, newIndex);
    const replacements = new Map(
      reorderableCharacters.map((item, index) => [item.name, reordered[index]])
    );
    const nextCharacters = characters.map((item) => replacements.get(item.name) ?? item);

    // Preserve pinned cards' saved positions so unpinning restores their custom order.
    const characterNames = new Set(nextCharacters.map((item) => item.name));
    const pinnedNames = new Set(nextCharacters.filter((item) => item.pinned).map((item) => item.name));
    const slots = new Set(config.characterOrder.filter((name) => characterNames.has(name)));
    nextCharacters.forEach((item) => slots.add(item.name));
    const unpinned = nextCharacters.filter((item) => !item.pinned);
    let unpinnedIndex = 0;
    const nextOrder = Array.from(slots, (name) =>
      pinnedNames.has(name) ? name : unpinned[unpinnedIndex++].name
    );

    setSavingOrder(true);
    setCharacters(nextCharacters);
    try {
      await api.saveCharacterOrder(nextOrder);
      useAppStore.setState((state) =>
        state.config?.modsPath === config.modsPath
          ? { config: { ...state.config, characterOrder: nextOrder } }
          : {}
      );
    } catch (err) {
      addToast("error", `保存角色排序失败：${String(err)}`);
      void loadCharacters();
    } finally {
      setSavingOrder(false);
    }
  };

  const handleCardClick = async (item: CharacterItem) => {
    if (movingMod) {
      if (movingMod.sourceCharacter === item.name) {
        addToast("info", "源分类与目标分类相同");
        return;
      }
      try {
        await api.moveModToCharacter(movingMod.sourceCharacter, movingMod.modName, item.name);
        addToast("success", `已将「${movingMod.modName}」移动至「${item.name}」`);
        setMovingMod(null);
        bumpCharactersTick();
        bumpModsTick();
      } catch (err) {
        addToast("error", String(err));
      }
      return;
    }
    setSelectedCharacter(item.name);
  };

  const handleCardContextMenu = (e: React.MouseEvent, item: CharacterItem) => {
    e.preventDefault();
    setCtxMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          key: "open",
          label: "进入分类管理 Mod",
          icon: <FolderOpen className="h-3.5 w-3.5" />,
          onClick: () => setSelectedCharacter(item.name),
        },
        {
          key: "pin",
          label: item.pinned ? "取消置顶" : "置顶该角色",
          icon: <Pin className="h-3.5 w-3.5" />,
          onClick: async () => {
            try {
              await api.togglePinCharacter(item.name, !item.pinned);
              bumpCharactersTick();
            } catch (err) {
              addToast("error", String(err));
            }
          },
        },
        {
          key: "cover",
          label: "更换或裁剪封面",
          icon: <ImageIcon className="h-3.5 w-3.5" />,
          onClick: () => setCoverTarget(item),
        },
        {
          key: "rename",
          label: "重命名角色分类",
          icon: <Pencil className="h-3.5 w-3.5" />,
          onClick: () => {
            setRenameTarget(item);
            setRenameValue(item.name);
          },
        },
        {
          key: "import-to-char",
          label: "导入 Mod 到此分类",
          icon: <Archive className="h-3.5 w-3.5" />,
          onClick: () => openImportWizard([], item.name),
        },
        {
          key: "fix-char",
          label: "修复该角色 Mod",
          icon: <Wrench className="h-3.5 w-3.5" />,
          disabled: !item.existsOnDisk || item.modCount === 0,
          onClick: () => openFixerModal({ scopeKind: "character", characterName: item.name }),
        },
        {
          key: "explorer",
          label: "在资源管理器中打开",
          icon: <FolderOpen className="h-3.5 w-3.5" />,
          disabled: !item.existsOnDisk,
          onClick: async () => {
            try {
              await api.openPathInExplorer(item.path);
            } catch (err) {
              addToast("error", String(err));
            }
          },
        },
        {
          key: "reset-ini",
          label: "重置本分类全部 INI",
          icon: <RotateCcw className="h-3.5 w-3.5" />,
          disabled: !item.existsOnDisk || item.modCount === 0,
          onClick: () => setResetIniTarget(item),
        },
        { divider: true, key: "d1" },
        {
          key: "delete",
          label: "移入回收站",
          icon: <Trash2 className="h-3.5 w-3.5" />,
          danger: true,
          disabled: !item.existsOnDisk,
          onClick: () => setDeleteTarget(item),
        },
      ],
    });
  };

  const handleCreateCharacter = async () => {
    const trimmed = addName.trim();
    if (!trimmed) {
      addToast("warning", "请输入角色名称");
      return;
    }
    setAddSaving(true);
    try {
      await api.addCharacter(trimmed, addCoverDataUrl);
      addToast("success", `已新增角色分类「${trimmed}」`);
      setAddOpen(false);
      setAddName("");
      setAddCoverDataUrl(null);
      bumpCharactersTick();
    } catch (err) {
      addToast("error", String(err));
    } finally {
      setAddSaving(false);
    }
  };

  const handleRenameConfirm = async () => {
    if (!renameTarget) return;
    const trimmed = renameValue.trim();
    if (!trimmed) {
      addToast("warning", "新名称不能为空");
      return;
    }
    setRenaming(true);
    try {
      await api.renameCharacter(renameTarget.name, trimmed);
      addToast("success", `已重命名为「${trimmed}」`);
      setRenameTarget(null);
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
      await api.deleteCharacter(deleteTarget.name);
      addToast("success", `已将「${deleteTarget.name}」移入 Windows 回收站`);
      setDeleteTarget(null);
      bumpCharactersTick();
      void refreshRabbitFxStatus();
    } catch (err) {
      addToast("error", String(err));
    } finally {
      setDeleting(false);
    }
  };

  const handleResetCharIniConfirm = async () => {
    if (!resetIniTarget) return;
    setResettingIni(true);
    try {
      const count = await api.resetCharacterIni(resetIniTarget.name);
      addToast("success", `已重置「${resetIniTarget.name}」下 ${count} 个 Mod 的 INI 状态与缓存`);
      setResetIniTarget(null);
      bumpModsTick();
    } catch (err) {
      addToast("error", String(err));
    } finally {
      setResettingIni(false);
    }
  };

  const handleQuickAutoDetect = async () => {
    try {
      const detected = await api.autoDetectPaths();
      if (detected.modsPath) {
        await updateConfigPatch({
          modsPath: detected.modsPath,
          gamePath: detected.gamePath ?? config?.gamePath ?? "",
          xxmiPath: detected.xxmiPath ?? config?.xxmiPath ?? "",
        });
        bumpCharactersTick();
        addToast("success", `已自动关联 Mods 目录：${detected.modsPath}`);
      } else {
        addToast("warning", "未检测到 EFMI\\Mods 目录，请前往设置手动指定");
      }
    } catch (err) {
      addToast("error", String(err));
    }
  };

  if (!config?.modsPath.trim()) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="glass-card max-w-lg rounded-2xl p-7 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
            <Sparkles className="h-6 w-6" />
          </div>
          <h1 className="mt-4 text-lg font-bold text-[var(--text-primary)]">
            欢迎使用 Endfield Mod Manager
          </h1>
          <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">
            尚未配置 EFMI 的 Mods 根目录。可以自动检测本机路径，或前往设置选择目录。
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2.5">
            <button
              type="button"
              onClick={() => setSetupWizardOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent-fill)] px-4 py-2 text-xs font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-fill-hover)]"
            >
              <Wand2 className="h-3.5 w-3.5" />
              <span>打开 4 步初始化向导</span>
            </button>
            <button
              type="button"
              onClick={handleQuickAutoDetect}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-2 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--border-strong)]"
            >
              <Search className="h-3.5 w-3.5" />
              <span>自动检测路径</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("settings")}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-2 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--border-strong)]"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              <span>前往设置选择目录</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Moving Mod banner */}
      {movingMod && (
        <div className="mx-5 mt-3 flex items-center justify-between gap-3 rounded-xl border border-[var(--accent)] bg-[var(--accent-soft)] px-4 py-2.5 text-xs">
          <div className="flex items-center gap-2 font-medium text-[var(--text-primary)]">
            <FolderInput className="h-4 w-4 text-[var(--accent)]" />
            <span>
              正在移动「<strong className="text-[var(--accent)]">{movingMod.modName}</strong>」—
              请点击下方任意目标角色分类卡片完成移动
            </span>
          </div>
          <button
            type="button"
            onClick={() => setMovingMod(null)}
            className="inline-flex items-center gap-1 rounded-lg bg-[var(--bg-surface-strong)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <X className="h-3.5 w-3.5" />
            <span>取消移动</span>
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3">
        <div className="relative min-w-[240px] flex-1 max-w-md">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="搜索角色"
            placeholder="搜索角色 / 拼音 / 首字母 / 别名（如 pq、admin）..."
            className="glass-surface w-full rounded-xl py-2 pr-8 pl-9 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              aria-label="清空搜索"
              className="absolute top-1/2 right-2.5 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => openImportWizard([], null)}
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl bg-[var(--accent-fill)] px-3 py-2 text-xs font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-fill-hover)]"
          >
            <Archive className="h-3.5 w-3.5" />
            <span>导入 Mod</span>
          </button>

          <button
            type="button"
            onClick={() => setOrganizeModalOpen(true)}
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--border-strong)]"
          >
            <FolderSync className="h-3.5 w-3.5" />
            <span>整理 / 体检</span>
          </button>

          <button
            type="button"
            onClick={() => openFixerModal({ scopeKind: "all" })}
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--border-strong)]"
          >
            <Wrench className="h-3.5 w-3.5" />
            <span>全库修复</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setAddName("");
              setAddCoverDataUrl(null);
              setAddOpen(true);
            }}
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--border-strong)]"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>新增角色</span>
          </button>

          <button
            type="button"
            onClick={() => void loadCharacters()}
            disabled={loading}
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--border-strong)]"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>刷新</span>
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="角色显示范围"
            className="glass-surface inline-flex items-center gap-0.5 rounded-xl p-0.5"
          >
            <button
              type="button"
              aria-pressed={!showAll}
              disabled={Boolean(movingMod)}
              onClick={() => void handleShowAllChange(false)}
              className={`${characterControlClass} disabled:cursor-default disabled:opacity-60`}
            >
              有内容
            </button>
            <button
              type="button"
              aria-pressed={showAll}
              disabled={Boolean(movingMod)}
              onClick={() => void handleShowAllChange(true)}
              className={`${characterControlClass} disabled:cursor-default`}
            >
              全部角色
            </button>
          </div>

          <div
            role="group"
            aria-label="角色排序"
            className="glass-surface inline-flex items-center gap-0.5 rounded-xl p-0.5"
          >
            {CHARACTER_SORT_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                aria-pressed={sortMode === value}
                onClick={() => handleSortChange(value)}
                className={characterControlClass}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div role="status" className="text-xs tabular-nums text-[var(--text-muted)]">
          {loading && characters.length === 0
            ? "正在加载角色分类…"
            : `分类 ${visibleCharacters.length}/${characters.length} · Mod ${visibleModCount}/${totalModCount}`}
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto px-5 pb-6">
        {loading && characters.length === 0 ? null : visibleCharacters.length === 0 ? (
          <div className="glass-card mx-auto mt-10 max-w-md rounded-2xl p-6 text-center">
            <UserPlus className="mx-auto h-8 w-8 text-[var(--text-muted)]" />
            <div className="mt-3 text-sm font-semibold text-[var(--text-primary)]">
              {normalizedQuery ? "没有匹配的角色分类" : "当前没有可显示的角色分类"}
            </div>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              {normalizedQuery
                ? "试试其他关键词，或切换到「全部角色」。"
                : "切换到「全部角色」查看预设角色，或新增角色分类。"}
            </p>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={reorderableCharacters.map((item) => item.name)}
              strategy={rectSortingStrategy}
            >
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
                {visibleCharacters.map((item) => (
                  <SortableCharacterCard
                    key={item.name}
                    item={item}
                    canDropCover={item.existsOnDisk && !movingMod}
                    coverDropActive={coverDropTarget === item.name}
                    dndEnabled={dndEnabled && !item.pinned}
                    isMoveTarget={
                      Boolean(movingMod) && movingMod?.sourceCharacter !== item.name
                    }
                    onClick={() => void handleCardClick(item)}
                    onContextMenu={(e) => handleCardContextMenu(e, item)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      <ContextMenu menu={ctxMenu} onClose={() => setCtxMenu(null)} />

      {/* Add character modal */}
      <Modal
        open={addOpen}
        onClose={() => !addSaving && setAddOpen(false)}
        title="新增角色或分类目录"
        maxWidthClass="max-w-md"
        footer={
          <>
            <button
              type="button"
              onClick={() => setAddOpen(false)}
              disabled={addSaving}
              className="rounded-xl border border-[var(--border-subtle)] px-4 py-2 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleCreateCharacter}
              disabled={addSaving}
              className="rounded-xl bg-[var(--accent-fill)] px-4 py-2 text-xs font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-fill-hover)] disabled:opacity-50"
            >
              {addSaving ? "创建中..." : "创建分类"}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
              角色 / 分类文件夹名称 *
            </label>
            <input
              type="text"
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              placeholder="例如：伊冯 / 祀 / 功能"
              className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-primary)]"
            />
          </div>

          <div className="flex items-center gap-3">
            <div className="h-24 w-19 shrink-0 overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
              {addCoverDataUrl ? (
                <img src={addCoverDataUrl} alt="新封面" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-[10px] text-[var(--text-muted)]">
                  可选封面
                </div>
              )}
            </div>
            <div className="space-y-2 text-xs">
              <button
                type="button"
                onClick={() => setAddCropOpen(true)}
                className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 font-medium text-[var(--text-primary)] hover:border-[var(--border-strong)]"
              >
                {addCoverDataUrl ? "重新裁剪封面" : "上传并裁剪封面 (303×386)"}
              </button>
              {addCoverDataUrl && (
                <button
                  type="button"
                  onClick={() => setAddCoverDataUrl(null)}
                  className="ml-2 text-xs text-[var(--danger)] hover:underline"
                >
                  清除
                </button>
              )}
              <p className="text-[11px] text-[var(--text-muted)]">
                封面图将保存为目录内的 _cover.png，兼容现有目录规范。
              </p>
            </div>
          </div>
        </div>
      </Modal>

      <ImageCropModal
        open={addCropOpen}
        title="裁剪角色封面 (303×386)"
        aspect={303 / 386}
        onClose={() => setAddCropOpen(false)}
        onConfirm={(dataUrl) => setAddCoverDataUrl(dataUrl)}
      />

      {/* Change existing character cover crop modal */}
      <ImageCropModal
        open={Boolean(coverTarget)}
        title={`更换封面：${coverTarget?.name ?? ""}`}
        aspect={303 / 386}
        initialImageUrl={
          coverSource ?? (coverTarget ? buildMediaUrl(coverTarget.coverPath, coverTarget.coverMtime) : null)
        }
        onClose={() => {
          setCoverTarget(null);
          setCoverSource(null);
        }}
        onConfirm={async (dataUrl) => {
          if (!coverTarget) return;
          await api.setCharacterCoverData(coverTarget.name, dataUrl);
          addToast("success", `已更新「${coverTarget.name}」的封面`);
          bumpCharactersTick();
        }}
      />

      {/* Rename character modal */}
      <Modal
        open={Boolean(renameTarget)}
        onClose={() => !renaming && setRenameTarget(null)}
        title="重命名角色分类"
        maxWidthClass="max-w-md"
        footer={
          <>
            <button
              type="button"
              onClick={() => setRenameTarget(null)}
              disabled={renaming}
              className="rounded-xl border border-[var(--border-subtle)] px-4 py-2 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleRenameConfirm}
              disabled={renaming}
              className="rounded-xl bg-[var(--accent-fill)] px-4 py-2 text-xs font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-fill-hover)] disabled:opacity-50"
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
            placeholder="请输入新的文件夹名称"
            className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-primary)]"
          />
        </div>
      </Modal>

      {/* Delete confirmation modal */}
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
              className="rounded-xl border border-[var(--border-subtle)] px-4 py-2 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]"
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
          确定要将角色分类
          <strong className="mx-1 text-[var(--text-primary)]">「{deleteTarget?.name}」</strong>
          及其下全部 Mod（共 {deleteTarget?.modCount ?? 0} 个）移入 Windows 回收站吗？您可以在回收站中恢复。
        </p>
      </Modal>

      {/* Reset Character INI modal */}
      <Modal
        open={Boolean(resetIniTarget)}
        onClose={() => !resettingIni && setResetIniTarget(null)}
        title="重置分类 INI 状态"
        maxWidthClass="max-w-md"
        footer={
          <>
            <button
              type="button"
              onClick={() => setResetIniTarget(null)}
              disabled={resettingIni}
              className="rounded-xl border border-[var(--border-subtle)] px-4 py-2 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleResetCharIniConfirm}
              disabled={resettingIni}
              className="rounded-xl bg-[var(--warning)] px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {resettingIni ? "重置中..." : "确认重置"}
            </button>
          </>
        }
      >
        <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
          此操作会恢复
          <strong className="mx-1 text-[var(--text-primary)]">「{resetIniTarget?.name}」</strong>
          下所有 Mod 的 EFMM INI 备份，并清理对应的 EFMM 持久化缓存。本地快捷键修改会保留。
        </p>
      </Modal>
    </div>
  );
}
