import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  AlertTriangle,
  Bookmark,
  ExternalLink,
  Eye,
  EyeOff,
  FolderOpen,
  Image as ImageIcon,
  Layers,
  LayoutGrid,
  List,
  Menu,
  Pin,
  Power,
  RotateCcw,
  Settings,
  ShieldAlert,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  buildModCollectionView,
  getCollectionVariantLabel,
  type DisplayModItem,
} from "../lib/collections";
import { api, buildMediaUrl } from "../lib/tauri";
import type {
  AppConfig,
  CharacterItem,
  GameRuntimeStatus,
  ModItem,
  OverlayStateSnapshot,
  PresetListResponse,
  RabbitFxModEntry,
} from "../types/mod";
import { ContextMenu, type ContextMenuState } from "../components/ui/ContextMenu";
import { applyThemeToDocument, getOverlayPanelBg } from "./themeSync";

type SortMode = "custom" | "enabled" | "name" | "recent";
type OverlayLayout = "grid" | "list";

export function OverlayApp() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [overlayState, setOverlayState] = useState<OverlayStateSnapshot | null>(null);
  const [gameStatus, setGameStatus] = useState<GameRuntimeStatus | null>(null);
  const [characters, setCharacters] = useState<CharacterItem[]>([]);
  const [selectedChar, setSelectedChar] = useState<string | null>(null);
  const [showAllChars, setShowAllChars] = useState(false);

  const [mods, setMods] = useState<ModItem[]>([]);
  const [charAliases, setCharAliases] = useState<string[]>([]);
  const [isNonCharCategory, setIsNonCharCategory] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("custom");
  const [collapseCollections, setCollapseCollections] = useState(true);
  const [selectedVariants, setSelectedVariants] = useState<Record<string, string>>({});
  const [layout, setLayout] = useState<OverlayLayout>("grid");

  const [presets, setPresets] = useState<PresetListResponse | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hotkeyDraft, setHotkeyDraft] = useState("Alt+F");
  const [opacityDraft, setOpacityDraft] = useState(90);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const [rabbitFxConfirm, setRabbitFxConfirm] = useState<{
    kind: "mod" | "preset";
    modName?: string;
    targetEnable?: boolean;
    presetId?: string;
    conflicts: RabbitFxModEntry[];
  } | null>(null);

  // 900ms optimistic anti-jitter guard
  const optimisticUntilRef = useRef<number>(0);
  const deferredReloadTimerRef = useRef<number | null>(null);

  const flashBanner = useCallback((msg: string) => {
    setStatusBanner(msg);
    window.setTimeout(() => {
      setStatusBanner((cur) => (cur === msg ? null : cur));
    }, 2600);
  }, []);

  const loadModsForChar = useCallback(async (charName: string | null) => {
    if (!charName) {
      setMods([]);
      return;
    }
    try {
      const res = await api.listMods(charName);
      setMods(res.mods);
      setCharAliases(res.characterAliases);
      setIsNonCharCategory(res.isNonCharacterCategory);
    } catch {
      setMods([]);
    }
  }, []);

  const loadBaseData = useCallback(async () => {
    try {
      const [cfg, ovState, charList, presetRes, runtime] = await Promise.all([
        api.getConfig(),
        api.getOverlayState(),
        api.listCharacters(),
        api.listPresets(),
        api.getGameRuntimeStatus(),
      ]);
      setConfig(cfg);
      applyThemeToDocument(cfg);
      setHotkeyDraft(cfg.overlayHotkey || "Alt+F");
      setOpacityDraft(cfg.overlayOpacity ?? 90);
      setOverlayState(ovState);
      setCharacters(charList);
      setPresets(presetRes);
      setGameStatus(runtime);

      const candidateChar =
        ovState.selectedCharacter && charList.some((c) => c.name === ovState.selectedCharacter)
          ? ovState.selectedCharacter
          : charList.find((c) => c.modCount > 0)?.name ?? charList[0]?.name ?? null;
      setSelectedChar(candidateChar);
      if (candidateChar) {
        await loadModsForChar(candidateChar);
      }
    } catch {
      // Initial mount fallback
    }
  }, [loadModsForChar]);

  useEffect(() => {
    void loadBaseData();
  }, [loadBaseData]);

  // Real-time event bus listeners
  useEffect(() => {
    const cleanups: Array<() => void> = [];
    let cancelled = false;

    const setup = async () => {
      const un1 = await listen<AppConfig>("settings-changed", (ev) => {
        if (ev.payload) {
          setConfig(ev.payload);
          applyThemeToDocument(ev.payload);
          setHotkeyDraft(ev.payload.overlayHotkey);
          setOpacityDraft(ev.payload.overlayOpacity);
        }
      });
      if (cancelled) un1();
      else cleanups.push(un1);

      const un2 = await listen<OverlayStateSnapshot>("overlay-state-changed", (ev) => {
        if (!ev.payload) return;
        setOverlayState(ev.payload);
        if (ev.payload.visible) {
          void api.getGameRuntimeStatus().then(setGameStatus).catch(() => {});
        }
        if (ev.payload.selectedCharacter && ev.payload.selectedCharacter !== selectedChar) {
          setSelectedChar(ev.payload.selectedCharacter);
          void loadModsForChar(ev.payload.selectedCharacter);
        }
      });
      if (cancelled) un2();
      else cleanups.push(un2);

      const un3 = await listen("characters-changed", () => {
        void api.listCharacters().then(setCharacters).catch(() => {});
      });
      if (cancelled) un3();
      else cleanups.push(un3);

      const un4 = await listen("mods-changed", () => {
        const now = Date.now();
        if (now < optimisticUntilRef.current) {
          if (deferredReloadTimerRef.current) {
            window.clearTimeout(deferredReloadTimerRef.current);
          }
          deferredReloadTimerRef.current = window.setTimeout(() => {
            void loadModsForChar(selectedChar);
          }, Math.max(80, optimisticUntilRef.current - now + 40));
          return;
        }
        void loadModsForChar(selectedChar);
      });
      if (cancelled) un4();
      else cleanups.push(un4);

      const un5 = await listen("presets-changed", () => {
        void api.listPresets().then(setPresets).catch(() => {});
      });
      if (cancelled) un5();
      else cleanups.push(un5);
    };

    void setup();
    return () => {
      cancelled = true;
      for (const fn of cleanups) fn();
      if (deferredReloadTimerRef.current) {
        window.clearTimeout(deferredReloadTimerRef.current);
      }
    };
  }, [selectedChar, loadModsForChar]);

  // Layered Escape closing
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (ctxMenu) {
        setCtxMenu(null);
        return;
      }
      if (settingsOpen) {
        setSettingsOpen(false);
        return;
      }
      void api.hideOverlay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ctxMenu, settingsOpen]);

  const visibleCharacters = useMemo(() => {
    return characters.filter((c) => showAllChars || c.modCount > 0 || c.pinned);
  }, [characters, showAllChars]);

  const exclusive = useMemo(() => {
    if (!selectedChar) return true;
    const map = config?.exclusiveByCategory ?? {};
    if (selectedChar in map) return map[selectedChar];
    return !isNonCharCategory;
  }, [config?.exclusiveByCategory, selectedChar, isNonCharCategory]);

  const sortedMods = useMemo(() => {
    const list = [...mods];
    if (sortMode === "enabled") {
      list.sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name, "zh-CN"));
    } else if (sortMode === "name") {
      list.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    } else if (sortMode === "recent") {
      list.sort((a, b) => b.addedAtMs - a.addedAtMs || a.name.localeCompare(b.name, "zh-CN"));
    }
    return list;
  }, [mods, sortMode]);

  const displayMods: DisplayModItem[] = useMemo(() => {
    if (!collapseCollections || !selectedChar) return sortedMods;
    return buildModCollectionView(sortedMods, selectedChar, charAliases, selectedVariants);
  }, [collapseCollections, sortedMods, selectedChar, charAliases, selectedVariants]);

  const handleToggleMod = async (
    modName: string,
    targetEnable: boolean,
    forceReplaceRabbitFx = false
  ) => {
    if (!selectedChar) return;

    // 900ms optimistic state update
    optimisticUntilRef.current = Date.now() + 900;
    setMods((prev) =>
      prev.map((m) => {
        if (m.name === modName) return { ...m, enabled: targetEnable };
        if (targetEnable && exclusive && m.enabled) return { ...m, enabled: false };
        return m;
      })
    );

    try {
      const res = await api.toggleMod(
        selectedChar,
        modName,
        targetEnable,
        exclusive,
        forceReplaceRabbitFx
      );
      if (res.requiresRabbitFxConfirm) {
        optimisticUntilRef.current = 0;
        await loadModsForChar(selectedChar);
        setRabbitFxConfirm({
          kind: "mod",
          modName,
          targetEnable,
          conflicts: res.activeRabbitFx,
        });
        return;
      }
      if (res.success && config?.overlayAutoReload) {
        void api
          .sendF10Reload()
          .then(() => flashBanner("已切换并发送 F10 刷新"))
          .catch((err) => flashBanner(`已切换（F10 提示：${String(err)}）`));
      }
    } catch (err) {
      optimisticUntilRef.current = 0;
      await loadModsForChar(selectedChar);
      flashBanner(String(err));
    }
  };

  const handleApplyPreset = async (presetId: string, forceAllowMultipleRabbitFx = false) => {
    try {
      const res = await api.applyPreset(presetId, forceAllowMultipleRabbitFx);
      if (res.requiresRabbitFxConfirm) {
        setRabbitFxConfirm({
          kind: "preset",
          presetId,
          conflicts: res.conflictRabbitFx,
        });
        return;
      }
      if (res.success) {
        await Promise.all([api.listPresets().then(setPresets), loadModsForChar(selectedChar)]);
        if (config?.overlayPresetAutoReload) {
          void api
            .sendF10Reload()
            .then(() => flashBanner(`${res.message} · 已发送 F10`))
            .catch(() => flashBanner(res.message));
        } else {
          flashBanner(res.message);
        }
      }
    } catch (err) {
      flashBanner(String(err));
    }
  };

  const handleSelectCharacter = async (charName: string) => {
    setSelectedChar(charName);
    await loadModsForChar(charName);
    void api.openOverlaySidePanel(
      overlayState?.sideMode === "bubbles" ? "bubbles" : "closed",
      charName,
      null
    );
  };

  const handleCardContextMenu = (e: React.MouseEvent, item: DisplayModItem) => {
    e.preventDefault();
    if (!selectedChar) return;
    setCtxMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          key: "open-dir",
          label: "打开源文件夹",
          icon: <FolderOpen className="h-3.5 w-3.5" />,
          onClick: () => void api.openPathInExplorer(item.path),
        },
        {
          key: "focus-main",
          label: "在主管理器中定位此 Mod",
          icon: <ExternalLink className="h-3.5 w-3.5" />,
          onClick: () => void api.focusMainWindowOnMod(selectedChar, item.name),
        },
        { divider: true, key: "d1" },
        {
          key: "pin",
          label: item.pinned ? "取消置顶" : "置顶显示",
          icon: <Pin className="h-3.5 w-3.5" />,
          onClick: () => void api.pinMod(selectedChar, item.name, !item.pinned),
        },
        {
          key: "mark",
          label: item.marked ? "取消收藏书签" : "收藏此 Mod",
          icon: <Bookmark className="h-3.5 w-3.5" />,
          onClick: () => void api.setModMarked(selectedChar, item.name, !item.marked),
        },
        {
          key: "reset-ini",
          label: "重置此 Mod INI 状态",
          icon: <RotateCcw className="h-3.5 w-3.5" />,
          onClick: async () => {
            await api.resetModIni(selectedChar, item.name);
            flashBanner(`已重置「${item.name}」INI 状态`);
          },
        },
      ],
    });
  };

  const scale = config?.overlayScale ?? 1.0;
  const pinned = overlayState?.pinned ?? false;

  return (
    <div
      style={{ backgroundColor: getOverlayPanelBg(config) }}
      className="relative flex h-screen w-screen flex-col overflow-hidden rounded-2xl border border-[var(--border-strong)] text-[var(--text-primary)] shadow-2xl"
    >
      {/* Draggable Title Bar */}
      <header
        data-tauri-drag-region
        className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-3"
      >
        <div
          data-tauri-drag-region
          className="pointer-events-none flex items-center gap-1.5 text-xs font-bold"
        >
          <Sparkles className="h-3.5 w-3.5 text-[var(--accent)]" />
          <span className="truncate">终末地局内悬浮栏</span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            title="缩小浮窗"
            onClick={() => void api.setOverlayScale(Math.max(0.85, Number((scale - 0.1).toFixed(2))))}
            className="rounded-lg px-1.5 py-1 text-[10px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
          >
            A-
          </button>
          <button
            type="button"
            title="重置为 100%"
            onClick={() => void api.setOverlayScale(1.0)}
            className="rounded-lg px-1.5 py-1 text-[10px] font-semibold tabular-nums text-[var(--text-secondary)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
          >
            {Math.round(scale * 100)}%
          </button>
          <button
            type="button"
            title="放大浮窗"
            onClick={() => void api.setOverlayScale(Math.min(1.45, Number((scale + 0.1).toFixed(2))))}
            className="rounded-lg px-1.5 py-1 text-[10px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
          >
            A+
          </button>

          <button
            type="button"
            title="浮窗设置"
            onClick={() => setSettingsOpen((o) => !o)}
            className={`rounded-lg p-1.5 transition-colors ${
              settingsOpen
                ? "bg-[var(--accent)] text-[var(--accent-contrast)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
            }`}
          >
            <Settings className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            title={pinned ? "已图钉固定（失焦不自动隐藏）" : "固定浮窗"}
            onClick={() => void api.setOverlayPinned(!pinned)}
            className={`rounded-lg p-1.5 transition-colors ${
              pinned
                ? "bg-[var(--accent)] text-[var(--accent-contrast)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
            }`}
          >
            <Pin className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            title="隐藏浮窗 (Esc)"
            onClick={() => void api.hideOverlay()}
            className="rounded-lg p-1.5 text-[var(--text-secondary)] hover:bg-[var(--danger)] hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      {/* UIPI Admin Elevation Warning */}
      {gameStatus?.uipiBlocked && (
        <div className="flex items-center justify-between gap-2 border-b border-[var(--danger)]/35 bg-[var(--danger-soft)] px-3 py-1.5 text-[11px] text-[var(--danger)]">
          <div className="flex min-w-0 items-center gap-1.5">
            <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate font-medium">游戏以管理员运行，按键同步已被 UIPI 拦截</span>
          </div>
          <button
            type="button"
            onClick={() => void api.relaunchAsAdmin()}
            className="shrink-0 rounded-md bg-[var(--danger)] px-2 py-0.5 text-[10px] font-semibold text-white hover:opacity-90"
          >
            以管理员重启
          </button>
        </div>
      )}

      {/* Character Strip */}
      <div className="flex items-center gap-1.5 border-b border-[var(--border-subtle)] px-2.5 py-2">
        <button
          type="button"
          title="展开干员头像气泡网"
          onClick={() =>
            void api.openOverlaySidePanel(
              overlayState?.sideMode === "bubbles" ? "closed" : "bubbles",
              selectedChar,
              null
            )
          }
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-colors ${
            overlayState?.sideMode === "bubbles"
              ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-contrast)]"
              : "border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:border-[var(--accent)]"
          }`}
        >
          <Menu className="h-3.5 w-3.5" />
        </button>

        <div
          onWheel={(e) => {
            e.currentTarget.scrollLeft += e.deltaY;
          }}
          className="flex flex-1 items-center gap-1 overflow-x-auto pb-0.5"
        >
          {visibleCharacters.map((c) => {
            const active = c.name === selectedChar;
            return (
              <button
                key={c.name}
                type="button"
                onClick={() => void handleSelectCharacter(c.name)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setCtxMenu({
                    x: e.clientX,
                    y: e.clientY,
                    items: [
                      {
                        key: "reset-char-ini",
                        label: `重置「${c.name}」全部 INI`,
                        icon: <RotateCcw className="h-3.5 w-3.5" />,
                        onClick: async () => {
                          const cnt = await api.resetCharacterIni(c.name);
                          flashBanner(`已重置「${c.name}」(${cnt} 项)`);
                        },
                      },
                    ],
                  });
                }}
                className={`flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium whitespace-nowrap transition-colors ${
                  active
                    ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-contrast)]"
                    : "border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:border-[var(--border-strong)]"
                }`}
              >
                <span>{c.name}</span>
                <span className="text-[10px] opacity-80 tabular-nums">
                  {c.enabledCount}/{c.modCount}
                </span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          title={showAllChars ? "仅看有 Mod 的分类" : "显示全部预设分类"}
          onClick={() => setShowAllChars((v) => !v)}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--accent)]"
        >
          {showAllChars ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* Controls Strip */}
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-3 py-1.5 text-[11px]">
        <div className="flex items-center gap-1.5">
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1 text-[11px] text-[var(--text-primary)]"
          >
            <option value="custom">自定义</option>
            <option value="enabled">已启用优先</option>
            <option value="name">名称</option>
            <option value="recent">最新</option>
          </select>

          <button
            type="button"
            onClick={() => {
              if (!selectedChar) return;
              const nextMap = {
                ...(config?.exclusiveByCategory ?? {}),
                [selectedChar]: !exclusive,
              };
              void api.updateConfig({ exclusiveByCategory: nextMap });
            }}
            className={`rounded-lg border px-2 py-1 font-medium ${
              exclusive
                ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                : "border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)]"
            }`}
          >
            单选:{exclusive ? "开" : "关"}
          </button>

          <button
            type="button"
            onClick={() => setCollapseCollections((v) => !v)}
            className={`rounded-lg border px-2 py-1 font-medium ${
              collapseCollections
                ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                : "border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)]"
            }`}
          >
            合集
          </button>
        </div>

        <div className="flex items-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-0.5">
          <button
            type="button"
            title="双列画廊"
            onClick={() => setLayout("grid")}
            className={`rounded p-1 ${
              layout === "grid"
                ? "bg-[var(--accent)] text-[var(--accent-contrast)]"
                : "text-[var(--text-secondary)]"
            }`}
          >
            <LayoutGrid className="h-3 w-3" />
          </button>
          <button
            type="button"
            title="紧凑列表"
            onClick={() => setLayout("list")}
            className={`rounded p-1 ${
              layout === "list"
                ? "bg-[var(--accent)] text-[var(--accent-contrast)]"
                : "text-[var(--text-secondary)]"
            }`}
          >
            <List className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Main Mod List / Gallery */}
      <div className="relative flex-1 overflow-y-auto p-2.5">
        {displayMods.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 text-center text-xs text-[var(--text-muted)]">
            <Layers className="h-7 w-7 opacity-40" />
            <span>{selectedChar ? `「${selectedChar}」下暂无 Mod` : "请先配置 Mods 目录"}</span>
          </div>
        ) : layout === "grid" ? (
          <div className="grid grid-cols-2 gap-2.5">
            {displayMods.map((item) => {
              const imgUrl = buildMediaUrl(item.previewPath, item.previewMtime);
              const detailActive =
                overlayState?.sideMode === "detail" && overlayState?.selectedModName === item.name;
              return (
                <div
                  key={item.name}
                  onClick={() =>
                    void api.openOverlaySidePanel("detail", selectedChar, item.name)
                  }
                  onContextMenu={(e) => handleCardContextMenu(e, item)}
                  className={`group flex cursor-pointer flex-col overflow-hidden rounded-xl border bg-[var(--bg-surface)] transition-all ${
                    detailActive
                      ? "border-[var(--accent)] ring-2 ring-[var(--accent-soft)]"
                      : item.enabled
                        ? "border-[var(--accent)]/55"
                        : "border-[var(--border-subtle)] hover:border-[var(--border-strong)]"
                  }`}
                >
                  <div className="relative aspect-[16/10] w-full overflow-hidden bg-[var(--bg-elevated)]">
                    {imgUrl ? (
                      <img
                        src={imgUrl}
                        alt={item.name}
                        draggable={false}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[var(--text-muted)]">
                        <ImageIcon className="h-5 w-5 opacity-45" />
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleToggleMod(item.name, !item.enabled);
                      }}
                      className={`absolute right-1.5 bottom-1.5 flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold shadow-sm ${
                        item.enabled
                          ? "bg-[var(--accent)] text-[var(--accent-contrast)]"
                          : "bg-black/65 text-white"
                      }`}
                    >
                      <Power className="h-2.5 w-2.5" />
                      <span>{item.enabled ? "开启" : "关闭"}</span>
                    </button>
                  </div>

                  <div className="space-y-1 p-2">
                    <div className="line-clamp-2 text-[11px] font-semibold leading-snug">
                      {item.collection ? item.collection.name : item.name}
                    </div>
                    {item.collection && (
                      <select
                        value={item.name}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          setSelectedVariants((prev) => ({
                            ...prev,
                            [item.collection!.identity]: e.target.value,
                          }));
                        }}
                        className="w-full rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px]"
                      >
                        {item.collection.variants.map((v) => (
                          <option key={v.name} value={v.name}>
                            {getCollectionVariantLabel(v)}
                            {v.enabled ? " · 启用" : ""}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="space-y-1.5">
            {displayMods.map((item) => {
              const detailActive =
                overlayState?.sideMode === "detail" && overlayState?.selectedModName === item.name;
              return (
                <div
                  key={item.name}
                  onClick={() =>
                    void api.openOverlaySidePanel("detail", selectedChar, item.name)
                  }
                  onContextMenu={(e) => handleCardContextMenu(e, item)}
                  className={`flex cursor-pointer items-center justify-between gap-2 rounded-xl border px-2.5 py-2 text-xs ${
                    detailActive
                      ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                      : "border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--border-strong)]"
                  }`}
                >
                  <span className="truncate font-medium">
                    {item.collection ? item.collection.name : item.name}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleToggleMod(item.name, !item.enabled);
                    }}
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${
                      item.enabled
                        ? "bg-[var(--accent)] text-[var(--accent-contrast)]"
                        : "bg-[var(--bg-elevated)] text-[var(--text-secondary)]"
                    }`}
                  >
                    {item.enabled ? "已启用" : "未启用"}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Slide-Over Settings Drawer */}
        {settingsOpen && (
          <div className="absolute inset-0 z-30 flex flex-col bg-[var(--bg-surface-strong)] p-3.5 backdrop-blur-md">
            <div className="mb-3 flex items-center justify-between border-b border-[var(--border-subtle)] pb-2">
              <span className="text-xs font-bold">浮窗与按键设置</span>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="rounded-lg p-1 text-[var(--text-secondary)] hover:bg-[var(--accent-soft)]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto pr-1 text-xs">
              <label className="block space-y-1">
                <div className="flex justify-between">
                  <span>背景不透明度</span>
                  <span className="tabular-nums font-semibold">{opacityDraft}%</span>
                </div>
                <input
                  type="range"
                  min={20}
                  max={100}
                  value={opacityDraft}
                  onChange={(e) => setOpacityDraft(Number(e.target.value))}
                  onPointerUp={() => void api.updateConfig({ overlayOpacity: opacityDraft })}
                  className="w-full accent-[var(--accent)]"
                />
              </label>

              <div className="space-y-1">
                <label className="block text-[11px] text-[var(--text-secondary)]">
                  全局呼出快捷键
                </label>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={hotkeyDraft}
                    onChange={(e) => setHotkeyDraft(e.target.value)}
                    className="flex-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-1.5 font-mono text-xs"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await api.setOverlayHotkey(hotkeyDraft);
                        flashBanner(`呼出快捷键已更新为 ${hotkeyDraft}`);
                      } catch (err) {
                        flashBanner(String(err));
                      }
                    }}
                    className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-[11px] font-semibold text-[var(--accent-contrast)]"
                  >
                    应用
                  </button>
                </div>
              </div>

              {(
                [
                  {
                    key: "overlayAutoReload" as const,
                    label: "切换 Mod 后自动发送 F10 刷新",
                    val: config?.overlayAutoReload ?? true,
                  },
                  {
                    key: "overlayPresetAutoReload" as const,
                    label: "切换预设后自动发送 F10 刷新",
                    val: config?.overlayPresetAutoReload ?? true,
                  },
                  {
                    key: "overlayClickableHotkeys" as const,
                    label: "详情页允许点击快捷键直发游戏",
                    val: config?.overlayClickableHotkeys ?? true,
                  },
                  {
                    key: "overlayAutoMinimizeMain" as const,
                    label: "呼出浮窗时自动最小化主窗",
                    val: config?.overlayAutoMinimizeMain ?? true,
                  },
                ] as const
              ).map((sw) => (
                <label
                  key={sw.key}
                  className="flex cursor-pointer items-center justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2"
                >
                  <span>{sw.label}</span>
                  <input
                    type="checkbox"
                    checked={sw.val}
                    onChange={(e) => void api.updateConfig({ [sw.key]: e.target.checked })}
                    className="h-3.5 w-3.5 accent-[var(--accent)]"
                  />
                </label>
              ))}

              <div className="flex items-center justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2">
                <span>Persist Bridge 状态桥接</span>
                <button
                  type="button"
                  onClick={async () => {
                    const next = !(config?.persistBridgeEnabled ?? false);
                    await api.setPersistBridgeEnabled(next);
                    flashBanner(next ? "已开启 Persist Bridge" : "已关闭并还原 INI 备份");
                  }}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ${
                    config?.persistBridgeEnabled
                      ? "bg-[var(--accent)] text-[var(--accent-contrast)]"
                      : "bg-[var(--bg-surface)] text-[var(--text-secondary)]"
                  }`}
                >
                  {config?.persistBridgeEnabled ? "已开启" : "未开启"}
                </button>
              </div>

              <button
                type="button"
                onClick={async () => {
                  const removed = await api.clearPersistBridgeCache();
                  flashBanner(`已清理 ${removed} 个未用缓存文件`);
                }}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] py-2 text-xs text-[var(--text-secondary)] hover:border-[var(--danger)] hover:text-[var(--danger)]"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>清理未使用 Persist 缓存</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Status Toast Banner */}
      {statusBanner && (
        <div className="border-t border-[var(--border-subtle)] bg-[var(--accent-soft)] px-3 py-1 text-center text-[11px] font-medium text-[var(--accent)]">
          {statusBanner}
        </div>
      )}

      {/* Bottom Preset Quick Bar */}
      <footer
        onWheel={(e) => {
          e.currentTarget.scrollLeft += e.deltaY;
        }}
        className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-t border-[var(--border-subtle)] px-2.5 py-2"
      >
        <button
          type="button"
          onClick={() => void handleApplyPreset("__builtin_no_mod__")}
          className={`shrink-0 rounded-lg border px-2.5 py-1 text-[11px] font-medium whitespace-nowrap ${
            presets?.builtinNoModActive
              ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-contrast)]"
              : "border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]"
          }`}
        >
          纯净无 Mod
        </button>

        {presets?.presets.map((p) => {
          const active = presets.activePresetId === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => void handleApplyPreset(p.id)}
              className={`shrink-0 rounded-lg border px-2.5 py-1 text-[11px] font-medium whitespace-nowrap ${
                active
                  ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-contrast)]"
                  : "border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:border-[var(--border-strong)]"
              }`}
            >
              {p.name}
            </button>
          );
        })}
      </footer>

      <ContextMenu menu={ctxMenu} onClose={() => setCtxMenu(null)} />

      {/* Inline RabbitFX Confirm Dialog */}
      {rabbitFxConfirm && (
        <div className="modal-backdrop-blur fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="glass-surface-strong w-full max-w-sm space-y-3 rounded-2xl p-4 text-xs shadow-2xl">
            <div className="flex items-center gap-2 font-bold text-[var(--warning)]">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>RabbitFX 多开警告</span>
            </div>
            <p className="leading-relaxed text-[var(--text-secondary)]">
              当前已有其他启用的 RabbitFX，同时多开会导致终末地崩溃：
            </p>
            <ul className="space-y-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-2.5 font-medium">
              {rabbitFxConfirm.conflicts.map((c) => (
                <li key={c.path}>
                  • {c.characterName} / {c.modName}
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setRabbitFxConfirm(null)}
                className="rounded-lg border border-[var(--border-subtle)] px-3 py-1.5 text-[var(--text-secondary)]"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  const pending = rabbitFxConfirm;
                  setRabbitFxConfirm(null);
                  if (pending.kind === "mod" && pending.modName !== undefined) {
                    void handleToggleMod(pending.modName, Boolean(pending.targetEnable), true);
                  } else if (pending.kind === "preset" && pending.presetId) {
                    void handleApplyPreset(pending.presetId, true);
                  }
                }}
                className="rounded-lg bg-[var(--accent)] px-3 py-1.5 font-semibold text-[var(--accent-contrast)]"
              >
                替换并继续
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
