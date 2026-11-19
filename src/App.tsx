import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { ShieldCheck, UploadCloud } from "lucide-react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { CloseConfirmModal } from "./components/layout/CloseConfirmModal";
import { Sidebar } from "./components/layout/Sidebar";
import { TitleBar } from "./components/layout/TitleBar";
import { DiagnosticsModal } from "./components/modals/DiagnosticsModal";
import { FixerModal } from "./components/modals/FixerModal";
import { ImportWizardModal } from "./components/modals/ImportWizardModal";
import { OrganizeModal } from "./components/modals/OrganizeModal";
import { SetupWizardModal } from "./components/modals/SetupWizardModal";
import { Modal } from "./components/ui/Modal";
import { ToastHost } from "./components/ui/ToastHost";
import { CharactersView } from "./components/views/CharactersView";
import { ModView } from "./components/views/ModView";
import { PersonalizationView } from "./components/views/PersonalizationView";
import { PresetView } from "./components/views/PresetView";
import { SettingsView } from "./components/views/SettingsView";
import { createPreblurredBackgroundUrl } from "./lib/bgPreblur";
import { buildMediaUrl } from "./lib/tauri";
import { useAppStore } from "./store/useAppStore";
import type { AppConfig, NavigateToModPayload } from "./types/mod";

const EMPTY_IMPORT_PATHS: string[] = [];

function hexToRgba(hex: string, alpha: number): string | null {
  const cleaned = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return null;
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function App() {
  const config = useAppStore((s) => s.config);
  const activeTab = useAppStore((s) => s.activeTab);
  const selectedCharacter = useAppStore((s) => s.selectedCharacter);
  const setupWizardOpen = useAppStore((s) => s.setupWizardOpen);
  const diagnosticsOpen = useAppStore((s) => s.diagnosticsOpen);
  const organizeModalOpen = useAppStore((s) => s.organizeModalOpen);
  const importWizardRequest = useAppStore((s) => s.importWizardRequest);
  const fixerModalRequest = useAppStore((s) => s.fixerModalRequest);

  const initApp = useAppStore((s) => s.initApp);
  const setCloseModalOpen = useAppStore((s) => s.setCloseModalOpen);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const setSelectedCharacter = useAppStore((s) => s.setSelectedCharacter);
  const setPendingFocusMod = useAppStore((s) => s.setPendingFocusMod);
  const updateConfigPatch = useAppStore((s) => s.updateConfigPatch);
  const setSetupWizardOpen = useAppStore((s) => s.setSetupWizardOpen);
  const setDiagnosticsOpen = useAppStore((s) => s.setDiagnosticsOpen);
  const setOrganizeModalOpen = useAppStore((s) => s.setOrganizeModalOpen);
  const closeImportWizard = useAppStore((s) => s.closeImportWizard);
  const openFixerModal = useAppStore((s) => s.openFixerModal);
  const bumpCharactersTick = useAppStore((s) => s.bumpCharactersTick);
  const bumpModsTick = useAppStore((s) => s.bumpModsTick);
  const bumpPresetsTick = useAppStore((s) => s.bumpPresetsTick);
  const refreshPresetCount = useAppStore((s) => s.refreshPresetCount);
  const refreshUndoStack = useAppStore((s) => s.refreshUndoStack);
  const refreshRabbitFxStatus = useAppStore((s) => s.refreshRabbitFxStatus);

  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [preblurredBgUrl, setPreblurredBgUrl] = useState<string | null>(null);
  const activeBlobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    void initApp();
  }, [initApp]);

  useEffect(() => {
    const cleanups: Array<() => void> = [];
    let cancelled = false;

    const register = async () => {
      try {
        const un1 = await listen("close-requested", () => {
          setCloseModalOpen(true);
        });
        if (cancelled) un1();
        else cleanups.push(un1);

        const un2 = await listen<AppConfig>("settings-changed", (ev) => {
          if (ev.payload) {
            useAppStore.setState({ config: ev.payload });
          }
        });
        if (cancelled) un2();
        else cleanups.push(un2);

        const un3 = await listen("characters-changed", () => {
          bumpCharactersTick();
          void refreshRabbitFxStatus();
        });
        if (cancelled) un3();
        else cleanups.push(un3);

        const un4 = await listen("mods-changed", () => {
          bumpModsTick();
          void refreshRabbitFxStatus();
        });
        if (cancelled) un4();
        else cleanups.push(un4);

        const un5 = await listen("presets-changed", () => {
          bumpPresetsTick();
          void refreshPresetCount();
        });
        if (cancelled) un5();
        else cleanups.push(un5);

        const un6 = await listen("undo-changed", () => {
          void refreshUndoStack();
        });
        if (cancelled) un6();
        else cleanups.push(un6);

        const un7 = await listen<NavigateToModPayload>("navigate-to-mod", (ev) => {
          if (!ev.payload) return;
          setActiveTab("characters");
          setSelectedCharacter(ev.payload.characterName);
          setPendingFocusMod({
            characterName: ev.payload.characterName,
            modName: ev.payload.modName,
          });
        });
        if (cancelled) un7();
        else cleanups.push(un7);
      } catch {
        // Pure browser preview fallback
      }
    };

    void register();

    return () => {
      cancelled = true;
      for (const fn of cleanups) fn();
    };
  }, [
    setCloseModalOpen,
    setActiveTab,
    setSelectedCharacter,
    setPendingFocusMod,
    bumpCharactersTick,
    bumpModsTick,
    bumpPresetsTick,
    refreshPresetCount,
    refreshUndoStack,
    refreshRabbitFxStatus,
  ]);

  // Apply theme tokens, compatibility mode, sidebar zoom & custom accent dynamically
  useEffect(() => {
    const root = document.documentElement;
    if (!config) {
      root.dataset.theme = "rose-light";
      root.dataset.compatLevel = "0";
      return;
    }

    root.dataset.theme = config.theme || "rose-light";
    root.dataset.compatLevel = String(config.compatLevel ?? 0);
    root.style.setProperty("--sidebar-zoom", String((config.sidebarZoom || 100) / 100));

    const accent = config.customAccent?.trim();
    if (accent) {
      root.style.setProperty("--accent", accent);
      root.style.setProperty("--accent-hover", accent);
      const soft = hexToRgba(accent, 0.16);
      if (soft) root.style.setProperty("--accent-soft", soft);
    } else {
      root.style.removeProperty("--accent");
      root.style.removeProperty("--accent-hover");
      root.style.removeProperty("--accent-soft");
    }
  }, [config]);

  const bgImageUrl = config?.activeBgImage ? buildMediaUrl(config.activeBgImage) : null;
  const bgOpacity = (config?.bgOpacity ?? 92) / 100;
  const bgOverlay = (config?.bgOverlay ?? 30) / 100;
  const bgBlur = config?.bgBlur ?? 0;

  useEffect(() => {
    return () => {
      if (activeBlobUrlRef.current) {
        URL.revokeObjectURL(activeBlobUrlRef.current);
        activeBlobUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!bgImageUrl || bgBlur <= 0.2) {
      if (activeBlobUrlRef.current) {
        URL.revokeObjectURL(activeBlobUrlRef.current);
        activeBlobUrlRef.current = null;
      }
      setPreblurredBgUrl(null);
      return;
    }

    let cancelled = false;
    void createPreblurredBackgroundUrl(bgImageUrl, bgBlur)
      .then((blobUrl) => {
        if (cancelled) {
          if (blobUrl) URL.revokeObjectURL(blobUrl);
          return;
        }
        if (activeBlobUrlRef.current && activeBlobUrlRef.current !== blobUrl) {
          URL.revokeObjectURL(activeBlobUrlRef.current);
        }
        activeBlobUrlRef.current = blobUrl;
        setPreblurredBgUrl(blobUrl);
      })
      .catch(() => {
        if (!cancelled) {
          if (activeBlobUrlRef.current) {
            URL.revokeObjectURL(activeBlobUrlRef.current);
            activeBlobUrlRef.current = null;
          }
          setPreblurredBgUrl(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [bgImageUrl, bgBlur]);

  // Global Tauri v2 native file drag & drop
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    const registerDrop = async () => {
      try {
        const fn = await getCurrentWebview().onDragDropEvent((event) => {
          const payload = event.payload;
          if (payload.type === "enter" || payload.type === "over") {
            setIsDraggingFiles(true);
          } else if (payload.type === "leave") {
            setIsDraggingFiles(false);
          } else if (payload.type === "drop") {
            setIsDraggingFiles(false);
            if (payload.paths && payload.paths.length > 0) {
              const st = useAppStore.getState();
              st.openImportWizard(
                payload.paths,
                st.activeTab === "characters" ? st.selectedCharacter : null
              );
            }
          }
        });
        if (cancelled) fn();
        else unlisten = fn;
      } catch {
        // Pure browser preview fallback
      }
    };

    void registerDrop();
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, []);

  const effectiveBgSrc = bgBlur > 0.2 && preblurredBgUrl ? preblurredBgUrl : bgImageUrl;
  const usingPreblurredCanvas = Boolean(bgBlur > 0.2 && preblurredBgUrl);
  const viewKey =
    activeTab === "characters"
      ? selectedCharacter
        ? `mod-${selectedCharacter}`
        : "chars"
      : activeTab;

  return (
    <MotionConfig reducedMotion={(config?.compatLevel ?? 0) >= 3 ? "always" : "user"}>
      <div
        style={{ backgroundImage: "var(--bg-canvas-accent)" }}
        className="relative flex h-screen w-screen flex-col overflow-hidden bg-[var(--bg-canvas)] text-[var(--text-primary)]"
      >
      {/* Custom local background wallpaper layer */}
      {effectiveBgSrc && (
        <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
          <img
            src={effectiveBgSrc}
            alt="自定义背景"
            style={
              usingPreblurredCanvas
                ? { opacity: bgOpacity }
                : {
                    opacity: bgOpacity,
                    filter: bgBlur > 0 ? `blur(${bgBlur}px)` : undefined,
                    transform: bgBlur > 0 ? "scale(1.06)" : undefined,
                  }
            }
            className="h-full w-full object-cover transition-opacity duration-200"
          />
          <div
            style={{ opacity: bgOverlay }}
            className="absolute inset-0 bg-[var(--bg-canvas)]"
          />
        </div>
      )}

      {/* Custom Frameless Theme-Integrated TitleBar */}
      <TitleBar />

      {/* Main Layout */}
      <div className="relative z-10 flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="relative flex-1 overflow-hidden">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={viewKey}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.14, ease: "easeOut" }}
              className="h-full w-full"
            >
              {activeTab === "characters" &&
                (selectedCharacter ? (
                  <ModView characterName={selectedCharacter} />
                ) : (
                  <CharactersView />
                ))}
              {activeTab === "presets" && <PresetView />}
              {activeTab === "personalization" && <PersonalizationView />}
              {activeTab === "settings" && <SettingsView />}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* Fullscreen frosted drop zone */}
      <AnimatePresence>
        {isDraggingFiles && (
          <motion.div
            key="drag-drop-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14 }}
            className="modal-backdrop-blur pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-6"
          >
            <motion.div
              initial={{ scale: 0.96, y: 8 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.96, y: 6 }}
              transition={{ type: "spring", stiffness: 420, damping: 30 }}
              className="glass-surface-strong flex max-w-md flex-col items-center rounded-3xl border-2 border-dashed border-[var(--accent)] px-10 py-8 text-center shadow-[var(--shadow-floating)]"
            >
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
                <UploadCloud className="h-7 w-7" />
              </div>
              <div className="mt-4 text-base font-bold text-[var(--text-primary)]">
                松开即可导入 Mod 安装包 / 文件夹
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-[var(--text-secondary)]">
                {activeTab === "characters" && selectedCharacter
                  ? `将直接锁定导入到当前角色分类「${selectedCharacter}」`
                  : "支持 ZIP / 7z / RAR / QAQM MP4 与文件夹，将自动识别归属角色"}
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* First-launch local offline disclaimer modal */}
      <Modal
        open={Boolean(config && !config.disclaimerDismissed && !setupWizardOpen)}
        onClose={() => void updateConfigPatch({ disclaimerDismissed: true })}
        title="使用须知与纯本地离线声明"
        subtitle="Endfield Mod Manager · 专为《明日方舟：终末地》EFMI / XXMI 打造"
        maxWidthClass="max-w-lg"
        footer={
          <>
            <button
              type="button"
              onClick={() => {
                void updateConfigPatch({ disclaimerDismissed: true });
                setSetupWizardOpen(true);
              }}
              className="rounded-xl border border-[var(--border-strong)] bg-[var(--accent-soft)] px-4 py-2 text-xs font-semibold text-[var(--accent)] hover:bg-[var(--accent)] hover:text-[var(--accent-contrast)]"
            >
              进入 4 步初始化向导
            </button>
            <button
              type="button"
              onClick={() => void updateConfigPatch({ disclaimerDismissed: true })}
              className="rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]"
            >
              我已了解，开始使用
            </button>
          </>
        }
      >
        <div className="space-y-3 text-xs leading-relaxed text-[var(--text-secondary)]">
          <div className="flex items-start gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-emerald-500">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              本软件坚持 100% 纯本地离线运行：无需登录账号、无云端遥测、无商业赞助墙，所有主题壁纸、标签与预设均仅存储在本地。
            </span>
          </div>
          <ul className="list-inside list-disc space-y-1.5">
            <li>本工具仅管理本地 EFMI / XXMI 的 Mod 文件目录及 3DMigoto 配置脚本，不修改任何游戏客户端原始文件。</li>
            <li>请遵守游戏社区规范，切勿在官方平台传播第三方外观替换截图。</li>
            <li>首次配置路径或迁移旧版 QAQManager v4 数据，建议点击下方「进入 4 步初始化向导」。</li>
          </ul>
        </div>
      </Modal>

      <ImportWizardModal
        open={Boolean(importWizardRequest)}
        initialSourcePaths={importWizardRequest?.sourcePaths ?? EMPTY_IMPORT_PATHS}
        lockedCharacter={importWizardRequest?.lockedCharacter ?? null}
        onClose={closeImportWizard}
      />
      <OrganizeModal
        open={organizeModalOpen}
        onClose={() => setOrganizeModalOpen(false)}
      />
      <FixerModal
        open={Boolean(fixerModalRequest)}
        scopeKind={fixerModalRequest?.scopeKind ?? "all"}
        characterName={fixerModalRequest?.characterName ?? null}
        modName={fixerModalRequest?.modName ?? null}
        onClose={() => openFixerModal(null)}
      />
      <DiagnosticsModal
        open={diagnosticsOpen}
        onClose={() => setDiagnosticsOpen(false)}
      />
      <SetupWizardModal
        open={setupWizardOpen}
        onClose={() => setSetupWizardOpen(false)}
      />

      <CloseConfirmModal />
      <ToastHost />
      </div>
    </MotionConfig>
  );
}

export default App;
