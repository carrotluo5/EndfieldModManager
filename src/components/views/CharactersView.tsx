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
import {
  Archive,
  Eye,
  EyeOff,
  FolderInput,
  FolderOpen,
  FolderSync,
  HardDriveDownload,
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

interface CharacterCardProps {
  item: CharacterItem;
  dndEnabled: boolean;
  isMoveTarget: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

function SortableCharacterCard({
  item,
  dndEnabled,
  isMoveTarget,
  onClick,
  onContextMenu,
}: CharacterCardProps) {
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

  const coverUrl = buildMediaUrl(item.coverPath, item.coverMtime);

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(dndEnabled ? attributes : {})}
      {...(dndEnabled ? listeners : {})}
      onClick={onClick}
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

      {/* Top badges - NOTE: intentionally NO hover close/delete X button (UX fix #4) */}
      <div className="pointer-events-none absolute inset-x-2 top-2 flex items-start justify-between gap-1">
        {item.pinned ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--accent)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent-contrast)] shadow-xs">
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
                ? "bg-[var(--accent)] text-[var(--accent-contrast)]"
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

export function CharactersView() {
  const config = useAppStore((s) => s.config);
  const movingMod = useAppStore((s) => s.movingMod);
  const charactersTick = useAppStore((s) => s.charactersTick);
  const setSelectedCharacter = useAppStore((s) => s.setSelectedCharacter);
  const setMovingMod = useAppStore((s) => s.setMovingMod);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const updateConfigPatch = useAppStore((s) => s.updateConfigPatch);
  const refreshPresetCount = useAppStore((s) => s.refreshPresetCount);
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
  const [searchQuery, setSearchQuery] = useState("");
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
    if (!config?.modsPath.trim()) {
      setCharacters([]);
      return;
    }
    setLoading(true);
    try {
      const list = await api.listCharacters();
      setCharacters(list);
    } catch (err) {
      addToast("error", `加载角色列表失败：${String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [config?.modsPath, addToast]);

  useEffect(() => {
    void loadCharacters();
  }, [loadCharacters, charactersTick]);

  const showAll = config?.showAllCharacters ?? false;

  const visibleCharacters = useMemo(() => {
    const q = searchQuery.trim();
    return characters.filter((c) => {
      if (!q && !showAll && c.modCount === 0 && !c.existsOnDisk && !c.pinned) {
        return false;
      }
      if (!q && !showAll && c.modCount === 0 && !c.pinned) {
        return false;
      }
      return matchesSearch(c.name, c.aliases, q);
    });
  }, [characters, searchQuery, showAll]);

  const dndEnabled = !searchQuery.trim() && !movingMod;

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = visibleCharacters.findIndex((c) => c.name === active.id);
    const newIndex = visibleCharacters.findIndex((c) => c.name === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reorderedVisible = arrayMove(visibleCharacters, oldIndex, newIndex);
    const visibleSet = new Set(reorderedVisible.map((c) => c.name));
    const hiddenNames = characters.filter((c) => !visibleSet.has(c.name)).map((c) => c.name);
    const nextOrder = [...reorderedVisible.map((c) => c.name), ...hiddenNames];

    // Optimistic update
    const charMap = new Map(characters.map((c) => [c.name, c]));
    setCharacters(nextOrder.map((n) => charMap.get(n)!).filter(Boolean));

    try {
      await api.saveCharacterOrder(nextOrder);
    } catch (err) {
      addToast("error", `保存角色排序失败：${String(err)}`);
      void loadCharacters();
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

  const handleQuickImportQaqm = async () => {
    try {
      const summary = await api.importFromQaqmanager();
      await refreshPresetCount();
      await refreshRabbitFxStatus();
      bumpCharactersTick();
      if (summary.importedPaths) {
        addToast("success", "已成功迁移 QAQManager 路径、排序与预设");
      } else {
        addToast("info", summary.warnings[0] || "未能迁移到有效的 Mods 路径");
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
            尚未配置 EFMI 的 Mods 根目录。您可以自动探测本机路径、从旧版 QAQManager 一键只读迁移，或前往设置手动选择目录。
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2.5">
            <button
              type="button"
              onClick={() => setSetupWizardOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]"
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
              onClick={handleQuickImportQaqm}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-strong)] bg-[var(--accent-soft)] px-4 py-2 text-xs font-semibold text-[var(--accent)] hover:bg-[var(--accent)] hover:text-[var(--accent-contrast)]"
            >
              <HardDriveDownload className="h-3.5 w-3.5" />
              <span>从 QAQManager 一键导入</span>
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
            placeholder="搜索角色 / 拼音 / 首字母 / 别名（如 pq、admin）..."
            className="glass-surface w-full rounded-xl py-2 pr-8 pl-9 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
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
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]"
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
            onClick={() => updateConfigPatch({ showAllCharacters: !showAll })}
            className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${
              showAll
                ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                : "glass-surface text-[var(--text-primary)] hover:border-[var(--border-strong)]"
            }`}
          >
            {showAll ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            <span>{showAll ? "显示全部干员" : "仅看已有 Mod"}</span>
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

      {/* Grid */}
      <div className="flex-1 overflow-y-auto px-5 pb-6">
        {visibleCharacters.length === 0 ? (
          <div className="glass-card mx-auto mt-10 max-w-md rounded-2xl p-6 text-center">
            <UserPlus className="mx-auto h-8 w-8 text-[var(--text-muted)]" />
            <div className="mt-3 text-sm font-semibold text-[var(--text-primary)]">
              {searchQuery ? "没有匹配的角色分类" : "当前没有包含 Mod 的角色目录"}
            </div>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              {searchQuery
                ? "请尝试更换关键词或清除搜索过滤。"
                : "可点击上方「显示全部干员」查看预设角色表，或在目录中新增角色文件夹。"}
            </p>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={visibleCharacters.map((c) => c.name)}
              strategy={rectSortingStrategy}
            >
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
                {visibleCharacters.map((item) => (
                  <SortableCharacterCard
                    key={item.name}
                    item={item}
                    dndEnabled={dndEnabled}
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
              className="rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] disabled:opacity-50"
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
          coverTarget ? buildMediaUrl(coverTarget.coverPath, coverTarget.coverMtime) : null
        }
        onClose={() => setCoverTarget(null)}
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
          下所有 Mod 的 `.qaqm-persistbak` 备份、清理 `d3dx_user.ini` 与 Persist Bridge 状态缓存。您修改过的本地快捷键如已同步过仍会保留。
        </p>
      </Modal>
    </div>
  );
}
