import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import {
  Activity,
  AlertTriangle,
  ArrowUpCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Database,
  Download,
  ExternalLink,
  FolderOpen,
  FolderSync,
  Keyboard,
  PackageCheck,
  RefreshCw,
  Rocket,
  Search,
  ShieldAlert,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
  Wrench,
} from "lucide-react";
import { api } from "../../lib/tauri";
import { useAppStore } from "../../store/useAppStore";
import type {
  CloseBehavior,
  GameRuntimeStatus,
  LaunchMode,
  PersistBridgeStatus,
  UpdateCheckResult,
  UpdateProgressEvent,
  XxmiConsistency,
} from "../../types/mod";

function formatUpdateBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "未知大小";
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}

export function SettingsView() {
  const config = useAppStore((s) => s.config);
  const rabbitFxStatus = useAppStore((s) => s.rabbitFxStatus);
  const modsTick = useAppStore((s) => s.modsTick);
  const updateConfigPatch = useAppStore((s) => s.updateConfigPatch);
  const refreshPresetCount = useAppStore((s) => s.refreshPresetCount);
  const refreshRabbitFxStatus = useAppStore((s) => s.refreshRabbitFxStatus);
  const bumpCharactersTick = useAppStore((s) => s.bumpCharactersTick);
  const bumpPresetsTick = useAppStore((s) => s.bumpPresetsTick);
  const setSetupWizardOpen = useAppStore((s) => s.setSetupWizardOpen);
  const setDiagnosticsOpen = useAppStore((s) => s.setDiagnosticsOpen);
  const setOrganizeModalOpen = useAppStore((s) => s.setOrganizeModalOpen);
  const openFixerModal = useAppStore((s) => s.openFixerModal);
  const addToast = useAppStore((s) => s.addToast);

  const [modsPath, setModsPath] = useState(config?.modsPath ?? "");
  const [gamePath, setGamePath] = useState(config?.gamePath ?? "");
  const [xxmiPath, setXxmiPath] = useState(config?.xxmiPath ?? "");
  const [launchArgs, setLaunchArgs] = useState(config?.launchArgs ?? "");

  const [consistency, setConsistency] = useState<XxmiConsistency | null>(null);
  const [checkingConsistency, setCheckingConsistency] = useState(false);
  const [detecting, setDetecting] = useState(false);

  const [pbStatus, setPbStatus] = useState<PersistBridgeStatus | null>(null);
  const [pbBusy, setPbBusy] = useState(false);
  const [pbCacheSizeDraft, setPbCacheSizeDraft] = useState(config?.persistBridgeCacheSize ?? 12);

  const [gameRuntime, setGameRuntime] = useState<GameRuntimeStatus | null>(null);
  const [hotkeyDraft, setHotkeyDraft] = useState(config?.overlayHotkey ?? "Alt+F");
  const [hotkeyRegistered, setHotkeyRegistered] = useState<boolean | null>(null);
  const [overlayScaleDraft, setOverlayScaleDraft] = useState(config?.overlayScale ?? 1.0);
  const [overlayOpacityDraft, setOverlayOpacityDraft] = useState(config?.overlayOpacity ?? 90);
  const [autostartEnabled, setAutostartEnabled] = useState(false);
  const [autostartBusy, setAutostartBusy] = useState(false);
  const [customFixerPath, setCustomFixerPath] = useState(config?.customFixerPath ?? "");
  const [pkgUpdating, setPkgUpdating] = useState(false);
  const [configTransferBusy, setConfigTransferBusy] = useState(false);

  const [appVersion, setAppVersion] = useState("0.1.0");
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updatingApp, setUpdatingApp] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateProgress, setUpdateProgress] = useState<UpdateProgressEvent | null>(null);
  const [updateAdvancedOpen, setUpdateAdvancedOpen] = useState(false);
  const [updateRepoDraft, setUpdateRepoDraft] = useState(
    config?.updateRepo ?? "carrotluo5/EndfieldModManager"
  );
  const [updateMirrorDraft, setUpdateMirrorDraft] = useState(config?.updateMirrorPrefix ?? "");
  const [updateTokenDraft, setUpdateTokenDraft] = useState(config?.updateGithubToken ?? "");

  useEffect(() => {
    if (!config) return;
    setModsPath(config.modsPath);
    setGamePath(config.gamePath);
    setXxmiPath(config.xxmiPath);
    setLaunchArgs(config.launchArgs);
    setPbCacheSizeDraft(config.persistBridgeCacheSize);
    setHotkeyDraft(config.overlayHotkey);
    setOverlayScaleDraft(config.overlayScale);
    setOverlayOpacityDraft(config.overlayOpacity);
    setCustomFixerPath(config.customFixerPath ?? "");
    setUpdateRepoDraft(config.updateRepo || "carrotluo5/EndfieldModManager");
    setUpdateMirrorDraft(config.updateMirrorPrefix ?? "");
    setUpdateTokenDraft(config.updateGithubToken ?? "");
  }, [config]);

  useEffect(() => {
    void api
      .getAutostartEnabled()
      .then((enabled) => setAutostartEnabled(enabled))
      .catch(() => {});
    void api
      .getAppVersion()
      .then((v) => {
        if (v) setAppVersion(v);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void listen<UpdateProgressEvent>("update-progress", (ev) => {
      if (ev.payload) setUpdateProgress(ev.payload);
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, []);

  const loadGameRuntime = async () => {
    try {
      const st = await api.getGameRuntimeStatus();
      setGameRuntime(st);
    } catch {
      // Ignore outside Tauri
    }
  };

  useEffect(() => {
    void loadGameRuntime();
  }, []);

  useEffect(() => {
    if (!config?.overlayHotkey) return;
    let current = true;
    void api.getOverlayHotkeyRegistered().then((registered) => {
      if (current) setHotkeyRegistered(registered);
    }).catch(() => {});
    return () => { current = false; };
  }, [config?.overlayHotkey]);

  const loadPersistBridgeStatus = async () => {
    try {
      const status = await api.getPersistBridgeStatus();
      setPbStatus(status);
    } catch {
      // Ignore
    }
  };

  useEffect(() => {
    void loadPersistBridgeStatus();
  }, [config?.modsPath, config?.persistBridgeEnabled, modsTick]);

  const handleTogglePersistBridge = async () => {
    if (pbBusy || !config) return;
    const nextEnabled = !config.persistBridgeEnabled;
    setPbBusy(true);
    try {
      const status = await api.setPersistBridgeEnabled(nextEnabled);
      setPbStatus(status);
      addToast(
        "success",
        nextEnabled
          ? `Persist Bridge 已开启（挂载 ${status.activeStateCount} 份状态缓存），请重启游戏使其在游戏内生效`
          : "已关闭 Persist Bridge，并还原 Endfield Mod Manager 的 INI 备份"
      );
    } catch (err) {
      addToast("error", String(err));
    } finally {
      setPbBusy(false);
    }
  };

  const handleCommitCacheSize = async (val: number) => {
    try {
      const status = await api.setPersistBridgeCacheSize(val);
      setPbStatus(status);
    } catch (err) {
      addToast("error", String(err));
    }
  };

  const handleClearPersistCache = async () => {
    setPbBusy(true);
    try {
      const removed = await api.clearPersistBridgeCache();
      await loadPersistBridgeStatus();
      addToast(
        "success",
        removed > 0 ? `已清理 ${removed} 个未使用的持久化缓存文件` : "暂无需要清理的冗余缓存"
      );
    } catch (err) {
      addToast("error", String(err));
    } finally {
      setPbBusy(false);
    }
  };

  const runCheckConsistency = async () => {
    setCheckingConsistency(true);
    try {
      const res = await api.checkXxmiConsistency();
      setConsistency(res);
    } catch (err) {
      addToast("error", `一致性检查失败：${String(err)}`);
    } finally {
      setCheckingConsistency(false);
    }
  };

  useEffect(() => {
    void runCheckConsistency();
  }, [config?.modsPath, config?.xxmiPath]);

  const savePaths = async (next: { modsPath?: string; gamePath?: string; xxmiPath?: string }) => {
    try {
      await updateConfigPatch(next);
      bumpCharactersTick();
      void runCheckConsistency();
      addToast("success", "路径设置已保存");
    } catch (err) {
      addToast("error", String(err));
    }
  };

  const handleBrowseDir = async (field: "modsPath", title: string, current: string) => {
    try {
      const picked = await openDialog({
        title,
        directory: true,
        multiple: false,
        defaultPath: current || undefined,
      });
      if (typeof picked === "string" && picked) {
        setModsPath(picked);
        await savePaths({ [field]: picked });
      }
    } catch (err) {
      addToast("error", `打开目录选择器失败：${String(err)}`);
    }
  };

  const handleBrowseExe = async (
    field: "gamePath" | "xxmiPath",
    title: string,
    current: string
  ) => {
    try {
      const picked = await openDialog({
        title,
        directory: false,
        multiple: false,
        defaultPath: current || undefined,
        filters: [{ name: "可执行文件", extensions: ["exe"] }],
      });
      if (typeof picked === "string" && picked) {
        if (field === "gamePath") setGamePath(picked);
        else setXxmiPath(picked);
        await savePaths({ [field]: picked });
      }
    } catch (err) {
      addToast("error", `打开文件选择器失败：${String(err)}`);
    }
  };

  const handleAutoDetect = async () => {
    setDetecting(true);
    try {
      const detected = await api.autoDetectPaths();
      const patch: Partial<{ modsPath: string; gamePath: string; xxmiPath: string }> = {};
      if (detected.modsPath && !modsPath.trim()) {
        patch.modsPath = detected.modsPath;
        setModsPath(detected.modsPath);
      }
      if (detected.gamePath && !gamePath.trim()) {
        patch.gamePath = detected.gamePath;
        setGamePath(detected.gamePath);
      }
      if (detected.xxmiPath && !xxmiPath.trim()) {
        patch.xxmiPath = detected.xxmiPath;
        setXxmiPath(detected.xxmiPath);
      }

      const foundCount = [detected.modsPath, detected.gamePath, detected.xxmiPath].filter(
        Boolean
      ).length;

      if (Object.keys(patch).length > 0) {
        await updateConfigPatch(patch);
        bumpCharactersTick();
        void runCheckConsistency();
        addToast("success", `已自动检测并填入 ${Object.keys(patch).length} 项路径`);
      } else if (foundCount > 0) {
        addToast("info", "当前路径已配置，无需覆盖；如需更新请先清空对应输入框");
      } else {
        addToast("warning", "未能在本机常见目录检测到终末地或 EFMI/XXMI 路径");
      }
    } catch (err) {
      addToast("error", String(err));
    } finally {
      setDetecting(false);
    }
  };

  const handleOpenFolder = async (target: string) => {
    if (!target.trim()) return;
    try {
      await api.openPathInExplorer(target);
    } catch (err) {
      addToast("error", String(err));
    }
  };

  const handleToggleAutostart = async () => {
    if (autostartBusy) return;
    const next = !autostartEnabled;
    setAutostartBusy(true);
    try {
      await api.setAutostartEnabled(next);
      setAutostartEnabled(next);
      addToast("success", next ? "已开启 Windows 开机自启动" : "已关闭 Windows 开机自启动");
    } catch (err) {
      addToast("error", `修改开机自启失败：${String(err)}`);
    } finally {
      setAutostartBusy(false);
    }
  };

  const handleUpdatePackage = async (targetKind: "xxmi" | "efmi") => {
    try {
      const picked = await openDialog({
        title: targetKind === "xxmi" ? "选择本地 XXMI 升级压缩包" : "选择本地 EFMI 升级压缩包",
        filters: [{ name: "本地压缩包 (*.zip, *.7z, *.rar)", extensions: ["zip", "7z", "rar"] }],
      });
      if (typeof picked !== "string" || !picked.trim()) return;
      setPkgUpdating(true);
      const res = await api.updateXxmiOrEfmiPackage(targetKind, picked);
      addToast("success", res.message);
      void runCheckConsistency();
    } catch (err) {
      addToast("error", `安全更新失败：${String(err)}`);
    } finally {
      setPkgUpdating(false);
    }
  };

  const handleBrowseCustomFixer = async () => {
    try {
      const picked = await openDialog({
        title: "选择默认外部 Mod Fixer 可执行文件",
        filters: [{ name: "可执行文件", extensions: ["exe", "bat", "cmd"] }],
      });
      if (typeof picked === "string" && picked.trim()) {
        setCustomFixerPath(picked);
        await updateConfigPatch({ customFixerPath: picked });
        addToast("success", "已保存默认外部 Fixer 路径");
      }
    } catch (err) {
      addToast("error", String(err));
    }
  };

  const handleSaveCustomFixer = async (nextPath: string) => {
    try {
      await updateConfigPatch({ customFixerPath: nextPath.trim() });
      addToast(
        "success",
        nextPath.trim() ? "已保存外部 Fixer 路径" : "已恢复默认使用内置 INI 规范化修复引擎"
      );
    } catch (err) {
      addToast("error", String(err));
    }
  };

  const handleExportConfig = async () => {
    setConfigTransferBusy(true);
    try {
      const filePath = await saveDialog({
        title: "导出 Endfield Mod Manager 完整配置",
        defaultPath: "endfield-mod-manager-config.json",
        filters: [{ name: "JSON 配置文件", extensions: ["json"] }],
      });
      if (typeof filePath === "string" && filePath.trim()) {
        await api.exportConfigFile(filePath);
        addToast("success", "完整配置已导出保存");
      }
    } catch (err) {
      addToast("error", `导出配置失败：${String(err)}`);
    } finally {
      setConfigTransferBusy(false);
    }
  };

  const handleImportConfig = async () => {
    setConfigTransferBusy(true);
    try {
      const filePath = await openDialog({
        title: "从备份 JSON 导入配置",
        filters: [{ name: "JSON 配置文件", extensions: ["json"] }],
      });
      if (typeof filePath === "string" && filePath.trim()) {
        const nextCfg = await api.importConfigFile(filePath);
        useAppStore.setState({ config: nextCfg });
        bumpCharactersTick();
        bumpPresetsTick();
        void refreshPresetCount();
        void refreshRabbitFxStatus();
        void runCheckConsistency();
        addToast("success", "配置已导入并立即应用");
      }
    } catch (err) {
      addToast("error", `导入配置失败：${String(err)}`);
    } finally {
      setConfigTransferBusy(false);
    }
  };

  const handleSaveUpdateSettings = async () => {
    try {
      await updateConfigPatch({
        updateRepo: updateRepoDraft.trim() || "carrotluo5/EndfieldModManager",
        updateMirrorPrefix: updateMirrorDraft.trim(),
        updateGithubToken: updateTokenDraft.trim(),
      });
      addToast("success", "GitHub 更新源配置已保存");
    } catch (err) {
      addToast("error", String(err));
    }
  };

  const handleCheckUpdates = async () => {
    if (checkingUpdate || updatingApp) return;
    setCheckingUpdate(true);
    setUpdateError(null);
    try {
      await updateConfigPatch({
        updateRepo: updateRepoDraft.trim() || "carrotluo5/EndfieldModManager",
        updateMirrorPrefix: updateMirrorDraft.trim(),
        updateGithubToken: updateTokenDraft.trim(),
      });
      const res = await api.checkForUpdates();
      setUpdateResult(res);
      if (res.hasUpdate) {
        addToast("success", `检测到新版本 v${res.latestVersion}`);
      } else {
        addToast("info", `当前已是最新版本 v${res.currentVersion}`);
      }
    } catch (err) {
      const msg = String(err);
      setUpdateError(msg);
      addToast("error", msg);
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleDownloadAndApplyUpdate = async () => {
    if (!updateResult?.downloadUrl || !updateResult.canAutoUpdate || updatingApp) return;
    setUpdatingApp(true);
    setUpdateError(null);
    setUpdateProgress({
      stage: "downloading",
      downloadedBytes: 0,
      totalBytes: updateResult.fileSize || 0,
      percent: 0,
      message: "正在准备下载更新包...",
    });
    try {
      await api.downloadAndApplyUpdate(
        updateResult.downloadUrl,
        updateResult.sha256 || null
      );
    } catch (err) {
      const msg = String(err);
      setUpdateError(msg);
      addToast("error", `自动更新失败：${msg}`);
      setUpdatingApp(false);
    }
  };

  const handleOpenReleasesPage = async () => {
    const repo = (updateRepoDraft.trim() || config?.updateRepo || "carrotluo5/EndfieldModManager").replace(/^\/+|\/+$/g, "");
    const target = updateResult?.releaseUrl || `https://github.com/${repo}/releases`;
    try {
      await api.openExternalUrl(target);
    } catch (err) {
      addToast("error", String(err));
    }
  };

  return (
    <div className="h-full overflow-y-auto px-6 py-5">
      <div className="mx-auto max-w-4xl space-y-5 pb-8">
        <div>
          <h1 className="text-xl font-bold text-[var(--text-primary)]">设置与环境检查</h1>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            配置 EFMI / XXMI 路径、游戏启动参数与本地软件行为（纯本地离线运行，不联网）
          </p>
        </div>

        <section className="glass-card flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4">
          <div className="flex items-start gap-3">
            <Search className="mt-0.5 h-5 w-5 shrink-0 text-[var(--accent)]" />
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                自动检测本机路径
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
                扫描 XXMI 配置与常见盘符（EFMI\Mods、Endfield.exe、XXMI Launcher.exe）并自动填入空白项。
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleAutoDetect}
            disabled={detecting}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent-fill)] px-3.5 py-2 text-xs font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-fill-hover)] disabled:opacity-50"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>{detecting ? "扫描中..." : "立即检测空白路径"}</span>
          </button>
        </section>

        {/* Setup Wizard, Offline Diagnostics, Safe Package Update & Backup */}
        <section className="glass-card space-y-4 rounded-2xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                向导、离线诊断、安全更新与系统备份
              </h2>
              <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                环境初始化、8 项离线排障、受保护包更新、自定义修复器、配置文件备份及系统自启动
              </p>
            </div>
            <button
              type="button"
              disabled={autostartBusy}
              onClick={() => void handleToggleAutostart()}
              className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors ${
                autostartEnabled
                  ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              <Rocket className="h-3.5 w-3.5" />
              <span>{autostartEnabled ? "开机自启动：已开启" : "开机自启动：已关闭"}</span>
            </button>
          </div>

          {/* 4-step wizard, diagnostics, organize, fixer shortcuts */}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSetupWizardOpen(true)}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-[var(--accent-fill)] px-3.5 py-2 text-xs font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-fill-hover)]"
            >
              <Wand2 className="h-3.5 w-3.5" />
              <span>打开 4 步初始化向导</span>
            </button>
            <button
              type="button"
              onClick={() => setDiagnosticsOpen(true)}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-[var(--border-strong)] bg-[var(--accent-soft)] px-3.5 py-2 text-xs font-semibold text-[var(--accent)] hover:bg-[var(--accent-fill)] hover:text-[var(--accent-contrast)]"
            >
              <Activity className="h-3.5 w-3.5" />
              <span>8 项离线诊断</span>
            </button>
            <button
              type="button"
              onClick={() => setOrganizeModalOpen(true)}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-2 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--border-strong)]"
            >
              <FolderSync className="h-3.5 w-3.5" />
              <span>目录整理与错放检查</span>
            </button>
            <button
              type="button"
              onClick={() => openFixerModal({ scopeKind: "all" })}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-2 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--border-strong)]"
            >
              <Wrench className="h-3.5 w-3.5" />
              <span>全库 Mod 修复工具</span>
            </button>
          </div>

          {/* Safe package updater & Config JSON backup */}
          <div className="grid grid-cols-1 gap-3 border-t border-[var(--border-subtle)] pt-3.5 sm:grid-cols-2">
            <div className="space-y-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
                <PackageCheck className="h-4 w-4 text-[var(--accent)]" />
                <span>安全本地包升级（自动跳过 Mods / 配置）</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={pkgUpdating}
                  onClick={() => void handleUpdatePackage("xxmi")}
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--border-strong)] disabled:opacity-50"
                >
                  {pkgUpdating ? "更新中..." : "安全更新 XXMI"}
                </button>
                <button
                  type="button"
                  disabled={pkgUpdating}
                  onClick={() => void handleUpdatePackage("efmi")}
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--border-strong)] disabled:opacity-50"
                >
                  {pkgUpdating ? "更新中..." : "安全更新 EFMI"}
                </button>
              </div>
            </div>

            <div className="space-y-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
              <div className="text-xs font-semibold text-[var(--text-primary)]">
                完整配置 JSON 导入 / 导出备份
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={configTransferBusy}
                  onClick={() => void handleExportConfig()}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--border-strong)] disabled:opacity-50"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>导出配置 JSON</span>
                </button>
                <button
                  type="button"
                  disabled={configTransferBusy}
                  onClick={() => void handleImportConfig()}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--border-strong)] disabled:opacity-50"
                >
                  <Upload className="h-3.5 w-3.5" />
                  <span>导入配置 JSON</span>
                </button>
              </div>
            </div>
          </div>

          {/* Custom external fixer path */}
          <div className="border-t border-[var(--border-subtle)] pt-3.5 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-medium text-[var(--text-secondary)]">
                外部 Mod Fixer 可执行文件路径（可选，留空则默认使用内置 INI 规范化引擎）
              </label>
              {customFixerPath.trim() && (
                <button
                  type="button"
                  onClick={() => {
                    setCustomFixerPath("");
                    void handleSaveCustomFixer("");
                  }}
                  className="text-[11px] text-[var(--danger)] hover:underline"
                >
                  清空
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={customFixerPath}
                onChange={(e) => setCustomFixerPath(e.target.value)}
                placeholder="例如：D:\Tools\EFMI_Fixer.exe（留空使用内置修复）"
                className="flex-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 font-mono text-xs text-[var(--text-primary)]"
              />
              <button
                type="button"
                onClick={() => void handleBrowseCustomFixer()}
                className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-primary)] hover:border-[var(--border-strong)]"
              >
                浏览 EXE
              </button>
              <button
                type="button"
                onClick={() => void handleSaveCustomFixer(customFixerPath)}
                className="rounded-xl bg-[var(--accent-fill)] px-3.5 py-2 text-xs font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-fill-hover)]"
              >
                保存
              </button>
            </div>
          </div>
        </section>

        {/* Software Version & GitHub Release Updater */}
        <section className="glass-card space-y-4 rounded-2xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <ArrowUpCircle className="h-4 w-4 text-[var(--accent)]" />
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                  软件版本与 GitHub 更新
                </h2>
                <span className="rounded-full bg-[var(--accent-soft)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--accent)] tabular-nums">
                  当前 v{appVersion}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                仅在您主动点击检查（或开启启动提示）时访问 GitHub Releases；热更新仅替换程序文件，完整保留本地 data / portable 配置。
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleOpenReleasesPage()}
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--border-strong)]"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span>打开 GitHub Releases</span>
              </button>
              <button
                type="button"
                disabled={checkingUpdate || updatingApp}
                onClick={() => void handleCheckUpdates()}
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-[var(--accent-fill)] px-3.5 py-2 text-xs font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-fill-hover)] disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${checkingUpdate ? "animate-spin" : ""}`} />
                <span>{checkingUpdate ? "正在检查..." : "检查更新"}</span>
              </button>
            </div>
          </div>

          {updateError && (
            <div className="flex items-start gap-2 rounded-xl border border-[var(--warning)]/40 bg-[var(--warning-soft)] px-3.5 py-2.5 text-xs text-[var(--warning)]">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="leading-relaxed">{updateError}</span>
            </div>
          )}

          {updateResult && (
            <div
              className={`space-y-3 rounded-2xl border p-4 ${
                updateResult.hasUpdate
                  ? "border-[var(--accent)]/40 bg-[var(--accent-soft)]"
                  : "border-[var(--success)]/35 bg-[var(--success-soft)]"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
                  <CheckCircle2
                    className={`h-4 w-4 shrink-0 ${
                      updateResult.hasUpdate ? "text-[var(--accent)]" : "text-[var(--success)]"
                    }`}
                  />
                  <span>
                    {updateResult.hasUpdate
                      ? `发现可用新版本：v${updateResult.latestVersion}（当前 v${updateResult.currentVersion}）`
                      : `当前已是最新版本 v${updateResult.currentVersion}`}
                  </span>
                </div>
                <span className="text-[11px] text-[var(--text-secondary)]">
                  {updateResult.fileName} · {formatUpdateBytes(updateResult.fileSize)}
                </span>
              </div>

              {updateResult.notes && (
                <pre className="max-h-36 overflow-y-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 text-xs leading-relaxed whitespace-pre-wrap text-[var(--text-primary)]">
                  {updateResult.notes}
                </pre>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--text-secondary)]">
                <span className="truncate font-mono">
                  {updateResult.sha256 ? `SHA-256: ${updateResult.sha256}` : `更新源: ${updateResult.source}`}
                </span>
                {updateResult.hasUpdate && updateResult.canAutoUpdate && (
                  <button
                    type="button"
                    disabled={updatingApp || checkingUpdate}
                    onClick={() => void handleDownloadAndApplyUpdate()}
                    className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-[var(--accent-fill)] px-4 py-2 text-xs font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-fill-hover)] disabled:opacity-50"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>{updatingApp ? "正在下载并更新..." : "立即下载并热更新重启"}</span>
                  </button>
                )}
              </div>

              {updateResult.hasUpdate && !updateResult.canAutoUpdate && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--warning)]/40 bg-[var(--warning-soft)] px-3.5 py-2.5 text-xs text-[var(--warning)]">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span className="leading-relaxed">
                      当前版本 v{updateResult.currentVersion} 低于热更新最低要求（v
                      {updateResult.minSupportedClientVersion}），请前往 GitHub
                      下载完整便携包或安装包覆盖升级，您的 data / portable 配置不受影响。
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleOpenReleasesPage()}
                    className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl bg-[var(--accent-fill)] px-3.5 py-2 text-xs font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-fill-hover)]"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span>前往 GitHub 下载完整版</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {updateProgress && (updatingApp || updateProgress.stage === "restarting") && (
            <div className="space-y-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-[var(--text-primary)]">{updateProgress.message}</span>
                <span className="font-mono text-[11px] text-[var(--text-secondary)] tabular-nums">
                  {updateProgress.totalBytes > 0
                    ? `${updateProgress.percent.toFixed(1)}% (${formatUpdateBytes(updateProgress.downloadedBytes)} / ${formatUpdateBytes(updateProgress.totalBytes)})`
                    : formatUpdateBytes(updateProgress.downloadedBytes)}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--bg-surface)]">
                <div
                  className="h-full rounded-full bg-[var(--accent-fill)] transition-[width] duration-150"
                  style={{ width: `${Math.min(100, Math.max(4, updateProgress.percent))}%` }}
                />
              </div>
            </div>
          )}

          <div className="border-t border-[var(--border-subtle)] pt-3">
            <button
              type="button"
              onClick={() => setUpdateAdvancedOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              {updateAdvancedOpen ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
              <span>更新源与高级设置</span>
            </button>

            {updateAdvancedOpen && (
              <div className="mt-3 space-y-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3.5">
                <label className="flex cursor-pointer items-center justify-between gap-3 text-xs">
                  <span className="text-[var(--text-primary)]">
                    启动时自动检查 GitHub 新版本提示（默认关闭，保持纯离线体验）
                  </span>
                  <input
                    type="checkbox"
                    checked={Boolean(config?.autoCheckUpdates)}
                    onChange={(e) => void updateConfigPatch({ autoCheckUpdates: e.target.checked })}
                    className="h-4 w-4 accent-[var(--accent)]"
                  />
                </label>

                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-[11px] text-[var(--text-secondary)]">
                      GitHub 仓库（owner/repo）
                    </label>
                    <input
                      type="text"
                      value={updateRepoDraft}
                      onChange={(e) => setUpdateRepoDraft(e.target.value)}
                      placeholder="carrotluo5/EndfieldModManager"
                      className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 font-mono text-xs text-[var(--text-primary)]"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] text-[var(--text-secondary)]">
                      下载加速镜像前缀（可选，私有仓库使用 Token 时忽略）
                    </label>
                    <input
                      type="text"
                      value={updateMirrorDraft}
                      onChange={(e) => setUpdateMirrorDraft(e.target.value)}
                      placeholder="例如：https://ghproxy.net/"
                      className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 font-mono text-xs text-[var(--text-primary)]"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-[220px] flex-1">
                    <label className="mb-1 block text-[11px] text-[var(--text-secondary)]">
                      GitHub Token（可选，用于私有仓库 Release 访问，明文保存在本地配置）
                    </label>
                    <input
                      type="password"
                      value={updateTokenDraft}
                      onChange={(e) => setUpdateTokenDraft(e.target.value)}
                      placeholder="ghp_... / github_pat_...（公开仓库留空即可）"
                      className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 font-mono text-xs text-[var(--text-primary)]"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleSaveUpdateSettings()}
                    className="rounded-xl bg-[var(--accent-fill)] px-3.5 py-2 text-xs font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-fill-hover)]"
                  >
                    保存更新设置
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Path configuration */}
        <section className="glass-card space-y-4 rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">核心路径配置</h2>
            <button
              type="button"
              onClick={() => savePaths({ modsPath, gamePath, xxmiPath })}
              className="rounded-xl bg-[var(--accent-fill)] px-3.5 py-1.5 text-xs font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-fill-hover)]"
            >
              保存路径更改
            </button>
          </div>

          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
                EFMI Mods 目录（例如 D:\MOD\XXMI\EFMI\Mods）
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={modsPath}
                  onChange={(e) => setModsPath(e.target.value)}
                  placeholder="请选择包含各角色子文件夹的 Mods 目录"
                  className="flex-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-primary)]"
                />
                <button
                  type="button"
                  onClick={() => handleBrowseDir("modsPath", "选择 EFMI Mods 目录", modsPath)}
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--border-strong)]"
                >
                  浏览
                </button>
                <button
                  type="button"
                  onClick={() => handleOpenFolder(modsPath)}
                  disabled={!modsPath.trim()}
                  title="在资源管理器中打开"
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40"
                >
                  <FolderOpen className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
                终末地游戏主程序（Endfield.exe，用于原版启动）
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={gamePath}
                  onChange={(e) => setGamePath(e.target.value)}
                  placeholder="例如 ...\Arknights Endfield Game\Endfield.exe"
                  className="flex-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-primary)]"
                />
                <button
                  type="button"
                  onClick={() => handleBrowseExe("gamePath", "选择 Endfield.exe", gamePath)}
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--border-strong)]"
                >
                  浏览
                </button>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
                XXMI 启动器程序（XXMI Launcher.exe，用于 EFMI / XXMI 注入启动）
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={xxmiPath}
                  onChange={(e) => setXxmiPath(e.target.value)}
                  placeholder="例如 D:\MOD\XXMI\Resources\Bin\XXMI Launcher.exe"
                  className="flex-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-primary)]"
                />
                <button
                  type="button"
                  onClick={() => handleBrowseExe("xxmiPath", "选择 XXMI Launcher.exe", xxmiPath)}
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--border-strong)]"
                >
                  浏览
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* XXMI/EFMI Consistency Check */}
        <section className="glass-card rounded-2xl p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {consistency?.consistent ? (
                <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-[var(--warning)]" />
              )}
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                XXMI / EFMI 路径一致性检查
              </h2>
            </div>
            <button
              type="button"
              onClick={runCheckConsistency}
              disabled={checkingConsistency}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--border-strong)]"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${checkingConsistency ? "animate-spin" : ""}`}
              />
              <span>重新检查</span>
            </button>
          </div>

          {consistency ? (
            <div className="mt-3 space-y-2 text-xs">
              <p
                className={`rounded-xl px-3 py-2 font-medium ${
                  consistency.consistent
                    ? "bg-[var(--success-soft)] text-[var(--success)]"
                    : "bg-[var(--warning-soft)] text-[var(--warning)]"
                }`}
              >
                {consistency.message}
              </p>
              <div className="grid grid-cols-1 gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 text-[11px] sm:grid-cols-2">
                <div>
                  <span className="text-[var(--text-muted)]">Mods 父级 EFMI 目录：</span>
                  <div className="mt-0.5 truncate font-mono text-[var(--text-primary)]">
                    {consistency.modsParentPath || "未配置"}
                  </div>
                </div>
                <div>
                  <span className="text-[var(--text-muted)]">XXMI 实际指向 EFMI 目录：</span>
                  <div className="mt-0.5 truncate font-mono text-[var(--text-primary)]">
                    {consistency.xxmiConfigFound
                      ? consistency.xxmiEfmiPath || "默认相对路径"
                      : "未读取到 XXMI Launcher Config.json"}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <p className="mt-2 text-xs text-[var(--text-muted)]">正在检查路径一致性...</p>
          )}
        </section>

        {/* Launch & Window Behavior */}
        <section className="glass-card grid grid-cols-1 gap-5 rounded-2xl p-5 sm:grid-cols-2">
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">启动参数与模式</h2>
            <div>
              <label className="mb-1.5 block text-xs text-[var(--text-secondary)]">默认启动方式</label>
              <div className="grid grid-cols-3 gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-1">
                {(
                  [
                    { value: "EFMI", label: "EFMI 注入" },
                    { value: "XXMI", label: "XXMI 启动" },
                    { value: "VANILLA", label: "原版直启" },
                  ] as Array<{ value: LaunchMode; label: string }>
                ).map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => updateConfigPatch({ launchMode: item.value })}
                    className={`rounded-lg py-1.5 text-xs font-medium transition-colors ${
                      config?.launchMode === item.value
                        ? "bg-[var(--accent-fill)] text-[var(--accent-contrast)]"
                        : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs text-[var(--text-secondary)]">
                附加启动参数（留空即默认）
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={launchArgs}
                  onChange={(e) => setLaunchArgs(e.target.value)}
                  placeholder="例如 -popupwindow"
                  className="flex-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-primary)]"
                />
                <button
                  type="button"
                  onClick={() => updateConfigPatch({ launchArgs: launchArgs.trim() })}
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--border-strong)]"
                >
                  应用
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">关闭主窗口行为</h2>
            <p className="text-xs text-[var(--text-secondary)]">
              设置点击右上角关闭按钮时的默认动作：
            </p>
            <div className="space-y-1.5">
              {(
                [
                  { value: "ask", label: "每次询问（推荐）" },
                  { value: "minimize", label: "直接最小化到系统托盘" },
                  { value: "quit", label: "直接彻底退出程序" },
                ] as Array<{ value: CloseBehavior; label: string }>
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => updateConfigPatch({ closeBehavior: opt.value })}
                  className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${
                    config?.closeBehavior === opt.value
                      ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                      : "border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-primary)] hover:border-[var(--border-strong)]"
                  }`}
                >
                  <span>{opt.label}</span>
                  {config?.closeBehavior === opt.value && (
                    <span className="h-2 w-2 rounded-full bg-[var(--accent-fill)]" />
                  )}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* 局内快捷浮窗 (Overlay) 与原生按键注入 */}
        <section className="glass-card space-y-4 rounded-2xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Keyboard className="h-4 w-4 text-[var(--accent)]" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                局内快捷浮窗 (Overlay) 与原生 Win32 按键注入
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void loadGameRuntime()}
                className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--border-strong)]"
              >
                检测游戏权限
              </button>
              <button
                type="button"
                onClick={() =>
                  void api.showOverlay().catch((err) => addToast("error", String(err)))
                }
                className="rounded-xl bg-[var(--accent-fill)] px-3.5 py-1.5 text-xs font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-fill-hover)]"
              >
                立即测试呼出浮窗
              </button>
            </div>
          </div>

          {gameRuntime && (
            <div
              className={`flex flex-wrap items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 text-xs ${
                gameRuntime.uipiBlocked
                  ? "border border-[var(--danger)]/40 bg-[var(--danger-soft)] text-[var(--danger)]"
                  : "border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)]"
              }`}
            >
              <div className="flex items-center gap-2">
                {gameRuntime.uipiBlocked ? (
                  <ShieldAlert className="h-4 w-4 shrink-0" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--success)]" />
                )}
                <span>{gameRuntime.message}</span>
              </div>
              {gameRuntime.uipiBlocked && (
                <button
                  type="button"
                  onClick={() => void api.relaunchAsAdmin()}
                  className="rounded-lg bg-[var(--danger)] px-3 py-1 text-xs font-semibold text-white hover:opacity-90"
                >
                  以管理员权限重启
                </button>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
                  全局呼出快捷键（默认 Alt+F）
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={hotkeyDraft}
                    onChange={(e) => setHotkeyDraft(e.target.value)}
                    placeholder="例如 Alt+F / Ctrl+Shift+F"
                    className="flex-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 font-mono text-xs text-[var(--text-primary)]"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const saved = await api.setOverlayHotkey(hotkeyDraft);
                        setHotkeyRegistered(true);
                        addToast("success", `局内呼出快捷键已更新为 ${saved.overlayHotkey}`);
                      } catch (err) {
                        addToast("error", String(err));
                      }
                    }}
                    className="rounded-xl border border-[var(--border-strong)] bg-[var(--accent-soft)] px-3.5 py-2 text-xs font-semibold text-[var(--accent)] hover:bg-[var(--accent-fill)] hover:text-[var(--accent-contrast)]"
                  >
                    注册生效
                  </button>
                </div>
                {hotkeyRegistered === false && (
                  <p role="status" className="mt-1.5 text-[11px] text-[var(--warning)]">
                    {config?.overlayHotkey} 当前未注册。若快捷键已被其他应用占用，可换一个组合后注册。
                  </p>
                )}
              </div>

              <label className="block space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-[var(--text-secondary)]">浮窗缩放比例（85%–145%）</span>
                  <span className="font-semibold tabular-nums">
                    {Math.round(overlayScaleDraft * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0.85}
                  max={1.45}
                  step={0.05}
                  value={overlayScaleDraft}
                  onChange={(e) => setOverlayScaleDraft(Number(e.target.value))}
                  onPointerUp={() => void api.setOverlayScale(overlayScaleDraft)}
                  onKeyUp={() => void api.setOverlayScale(overlayScaleDraft)}
                  className="w-full accent-[var(--accent)]"
                />
              </label>

              <label className="block space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-[var(--text-secondary)]">浮窗背景不透明度（20%–100%）</span>
                  <span className="font-semibold tabular-nums">{overlayOpacityDraft}%</span>
                </div>
                <input
                  type="range"
                  min={20}
                  max={100}
                  step={2}
                  value={overlayOpacityDraft}
                  onChange={(e) => setOverlayOpacityDraft(Number(e.target.value))}
                  onPointerUp={() => void updateConfigPatch({ overlayOpacity: overlayOpacityDraft })}
                  onKeyUp={() => void updateConfigPatch({ overlayOpacity: overlayOpacityDraft })}
                  className="w-full accent-[var(--accent)]"
                />
              </label>
            </div>

            <div className="space-y-2 text-xs">
              {(
                [
                  {
                    key: "overlayAutoReload" as const,
                    label: "浮窗内切换 Mod 后自动向游戏发送 F10",
                    val: config?.overlayAutoReload ?? true,
                  },
                  {
                    key: "overlayPresetAutoReload" as const,
                    label: "浮窗内应用预设后自动发送 F10",
                    val: config?.overlayPresetAutoReload ?? true,
                  },
                  {
                    key: "overlayClickableHotkeys" as const,
                    label: "允许在浮窗 Mod 详情页点击快捷键直发游戏",
                    val: config?.overlayClickableHotkeys ?? true,
                  },
                  {
                    key: "overlayAutoMinimizeMain" as const,
                    label: "呼出局内浮窗时自动最小化主窗口防遮挡",
                    val: config?.overlayAutoMinimizeMain ?? true,
                  },
                ] as const
              ).map((sw) => (
                <label
                  key={sw.key}
                  className="flex cursor-pointer items-center justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2.5 text-[var(--text-primary)]"
                >
                  <span>{sw.label}</span>
                  <input
                    type="checkbox"
                    checked={sw.val}
                    onChange={(e) => void updateConfigPatch({ [sw.key]: e.target.checked })}
                    className="h-4 w-4 accent-[var(--accent)]"
                  />
                </label>
              ))}
            </div>
          </div>
        </section>

        {/* Persist Bridge 状态持久化桥接 */}
        <section className="glass-card space-y-4 rounded-2xl p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 text-[var(--accent)]" />
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                  Persist Bridge 状态持久化
                </h2>
              </div>
              <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
                Mod 的 <code className="rounded bg-[var(--bg-elevated)] px-1">global persist</code> 变量通过{" "}
                <code className="rounded bg-[var(--bg-elevated)] px-1">efmm\cache\</code> 保存，以便切换 Mod 后恢复服装搭配和滑块状态。
                切换总开关后需重启游戏。关闭时使用 <code className="rounded bg-[var(--bg-elevated)] px-1">.efmm-persistbak</code> 还原原始 INI。
              </p>
              {pbStatus?.legacyConflict && (
                <p className="text-xs leading-relaxed text-[var(--warning)]" role="status">
                  此 Mod 库仍有旧版状态持久化。请先在原管理器中关闭该功能并还原 INI。
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={() => void handleTogglePersistBridge()}
              disabled={pbBusy || !config?.modsPath.trim()}
              className={`shrink-0 rounded-xl px-4 py-2 text-xs font-semibold transition-colors disabled:opacity-50 ${
                config?.persistBridgeEnabled
                  ? "border border-[var(--border-strong)] bg-[var(--accent-soft)] text-[var(--accent)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
                  : "bg-[var(--accent-fill)] text-[var(--accent-contrast)] hover:bg-[var(--accent-fill-hover)]"
              }`}
            >
              {pbBusy
                ? "处理中..."
                : config?.persistBridgeEnabled
                  ? "已开启（点击关闭并还原）"
                  : "开启 Persist Bridge"}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-xs">
              <div className="text-[10px] text-[var(--text-muted)]">EFMM 挂载</div>
              <div
                className={`mt-0.5 font-semibold ${
                  pbStatus?.d3dxMounted && pbStatus.enabled ? "text-[var(--success)]" : "text-[var(--text-secondary)]"
                }`}
              >
                {pbStatus?.d3dxMounted
                  ? pbStatus.enabled ? "状态持久化已挂载" : "仅挂载快捷键设置"
                  : "未挂载"}
              </div>
            </div>
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-xs">
              <div className="text-[10px] text-[var(--text-muted)]">活跃桥接状态</div>
              <div className="mt-0.5 font-semibold tabular-nums text-[var(--text-primary)]">
                {pbStatus?.activeStateCount ?? 0} 个
              </div>
            </div>
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-xs">
              <div className="text-[10px] text-[var(--text-muted)]">cache 状态文件</div>
              <div className="mt-0.5 font-semibold tabular-nums text-[var(--text-primary)]">
                {pbStatus?.cacheFileCount ?? 0} 个
              </div>
            </div>
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-xs">
              <div className="text-[10px] text-[var(--text-muted)]">原始 INI 备份</div>
              <div className="mt-0.5 font-semibold tabular-nums text-[var(--text-primary)]">
                {pbStatus?.backupFileCount ?? 0} 个
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[var(--border-subtle)] pt-3">
            <label className="flex min-w-[240px] flex-1 items-center gap-3 text-xs">
              <span className="shrink-0 text-[var(--text-secondary)]">
                最近禁用缓存槽位数（0–30）：
              </span>
              <input
                type="range"
                min={0}
                max={30}
                step={1}
                value={pbCacheSizeDraft}
                onChange={(e) => setPbCacheSizeDraft(Number(e.target.value))}
                onPointerUp={() => void handleCommitCacheSize(pbCacheSizeDraft)}
                onKeyUp={() => void handleCommitCacheSize(pbCacheSizeDraft)}
                className="flex-1 accent-[var(--accent)]"
              />
              <span className="w-8 text-right font-semibold tabular-nums text-[var(--text-primary)]">
                {pbCacheSizeDraft}
              </span>
            </label>

            <button
              type="button"
              onClick={() => void handleClearPersistCache()}
              disabled={pbBusy || !pbStatus || pbStatus.cacheFileCount === 0}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--danger)] hover:text-[var(--danger)] disabled:opacity-45"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>清理未使用缓存</span>
            </button>
          </div>
        </section>

        {/* RabbitFX global status */}
        <section className="glass-card rounded-2xl p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Wrench className="h-4 w-4 text-[var(--accent)]" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                RabbitFX 全局状态（单实例防崩溃）
              </h2>
            </div>
            <button
              type="button"
              onClick={() => void refreshRabbitFxStatus()}
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--border-strong)]"
            >
              刷新扫描
            </button>
          </div>

          <p className="mt-1.5 text-xs text-[var(--text-secondary)]">
            EFMI 环境下同时启用多份 RabbitFX.ini 会导致游戏崩溃；建议全局仅保留 1 份最新版本处于启用状态。
          </p>

          {rabbitFxStatus && rabbitFxStatus.allMods.length > 0 ? (
            <div className="mt-3 space-y-1.5">
              {rabbitFxStatus.allMods.map((entry) => (
                <div
                  key={entry.path}
                  className="flex items-center justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-xs"
                >
                  <div className="min-w-0">
                    <span className="font-medium text-[var(--text-primary)]">
                      {entry.characterName} / {entry.modName}
                    </span>
                    <div className="truncate font-mono text-[10px] text-[var(--text-muted)]">
                      {entry.path}
                    </div>
                  </div>
                  <span
                    className={`ml-3 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      entry.enabled
                        ? "bg-[var(--success-soft)] text-[var(--success)]"
                        : "bg-[var(--bg-surface)] text-[var(--text-muted)]"
                    }`}
                  >
                    {entry.enabled ? "已启用" : "已禁用"}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-xs text-[var(--text-muted)]">
              当前 Mods 目录下未扫描到 RabbitFX 插件。
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
