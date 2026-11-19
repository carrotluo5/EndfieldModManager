import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  Activity,
  Archive,
  CheckCircle2,
  FolderOpen,
  HardDriveDownload,
  PackageCheck,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { api } from "../../lib/tauri";
import { useAppStore } from "../../store/useAppStore";
import type { LaunchMode, QaqmImportSummary, XxmiConsistency } from "../../types/mod";
import { Modal } from "../ui/Modal";

interface SetupWizardModalProps {
  open: boolean;
  onClose: () => void;
}

const STEP_LABELS = [
  "1. 安全与离线声明",
  "2. XXMI Launcher",
  "3. EFMI 与游戏路径",
  "4. 迁移与首批导入",
];

export function SetupWizardModal({ open, onClose }: SetupWizardModalProps) {
  const updateConfigPatch = useAppStore((s) => s.updateConfigPatch);
  const refreshPresetCount = useAppStore((s) => s.refreshPresetCount);
  const refreshRabbitFxStatus = useAppStore((s) => s.refreshRabbitFxStatus);
  const bumpCharactersTick = useAppStore((s) => s.bumpCharactersTick);
  const openImportWizard = useAppStore((s) => s.openImportWizard);
  const setDiagnosticsOpen = useAppStore((s) => s.setDiagnosticsOpen);
  const addToast = useAppStore((s) => s.addToast);

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [xxmiPath, setXxmiPath] = useState("");
  const [modsPath, setModsPath] = useState("");
  const [gamePath, setGamePath] = useState("");
  const [launchMode, setLaunchMode] = useState<LaunchMode>("EFMI");

  const [busy, setBusy] = useState(false);
  const [pkgUpdating, setPkgUpdating] = useState(false);
  const [consistency, setConsistency] = useState<XxmiConsistency | null>(null);
  const [qaqmResult, setQaqmResult] = useState<QaqmImportSummary | null>(null);

  useEffect(() => {
    if (!open) return;
    const cfg = useAppStore.getState().config;
    setStep(1);
    setConsistency(null);
    setQaqmResult(null);
    setXxmiPath(cfg?.xxmiPath ?? "");
    setModsPath(cfg?.modsPath ?? "");
    setGamePath(cfg?.gamePath ?? "");
    setLaunchMode(cfg?.launchMode ?? "EFMI");
  }, [open]);

  const handleAutoDetect = async () => {
    setBusy(true);
    try {
      const detected = await api.autoDetectPaths();
      if (detected.xxmiPath) setXxmiPath(detected.xxmiPath);
      if (detected.modsPath) setModsPath(detected.modsPath);
      if (detected.gamePath) setGamePath(detected.gamePath);
      if (detected.modsPath || detected.xxmiPath || detected.gamePath) {
        addToast("success", "已自动填充本机扫描与注册表探测结果");
      } else {
        addToast("warning", "未能自动识别，请手动选择对应文件夹或可执行文件");
      }
    } catch (err) {
      addToast("error", String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleInstallOrUpdatePackage = async (
    targetKind: "xxmi" | "efmi",
    fromFolder: boolean
  ) => {
    try {
      const source = await openDialog({
        title:
          targetKind === "xxmi"
            ? fromFolder
              ? "选择本地 XXMI Launcher 解压目录"
              : "选择本地 XXMI Launcher 安装包"
            : fromFolder
            ? "选择本地 EFMI 解压目录"
            : "选择本地 EFMI 核心安装包",
        directory: fromFolder,
        filters: fromFolder
          ? undefined
          : [{ name: "本地压缩包 (*.zip, *.7z, *.rar)", extensions: ["zip", "7z", "rar"] }],
      });
      if (typeof source !== "string" || !source.trim()) return;

      let customDestDir: string | null = null;
      if (targetKind === "xxmi" && !xxmiPath.trim()) {
        const pickedDest = await openDialog({
          title: "选择 XXMI 安装目标目录",
          directory: true,
        });
        if (typeof pickedDest !== "string" || !pickedDest.trim()) return;
        customDestDir = pickedDest;
      } else if (targetKind === "efmi" && !modsPath.trim()) {
        const pickedDest = await openDialog({
          title: "选择 EFMI 游戏包存放目录",
          directory: true,
        });
        if (typeof pickedDest !== "string" || !pickedDest.trim()) return;
        customDestDir = pickedDest;
      }

      setPkgUpdating(true);
      const res = await api.updateXxmiOrEfmiPackage(targetKind, source, customDestDir);
      addToast("success", res.message);

      const detected = await api.autoDetectPaths().catch(() => null);
      if (targetKind === "xxmi") {
        if (detected?.xxmiPath) {
          setXxmiPath(detected.xxmiPath);
        } else if (customDestDir && !xxmiPath.trim()) {
          setXxmiPath(`${customDestDir.replace(/[\\/]+$/, "")}\\XXMI Launcher.exe`);
        }
      }
      if (detected?.modsPath && !modsPath.trim()) setModsPath(detected.modsPath);
    } catch (err) {
      addToast("error", `安全更新失败：${String(err)}`);
    } finally {
      setPkgUpdating(false);
    }
  };

  const handleSaveStep3AndNext = async () => {
    setBusy(true);
    try {
      await updateConfigPatch({
        xxmiPath: xxmiPath.trim(),
        modsPath: modsPath.trim(),
        gamePath: gamePath.trim(),
        launchMode,
        disclaimerDismissed: true,
      });
      bumpCharactersTick();
      void refreshRabbitFxStatus();
      const check = await api.checkXxmiConsistency().catch(() => null);
      setConsistency(check);
      setStep(4);
    } catch (err) {
      addToast("error", String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRunConsistencyCheck = async () => {
    setBusy(true);
    try {
      await updateConfigPatch({
        xxmiPath: xxmiPath.trim(),
        modsPath: modsPath.trim(),
        gamePath: gamePath.trim(),
        launchMode,
      });
      const check = await api.checkXxmiConsistency();
      setConsistency(check);
      addToast(check.consistent ? "success" : "warning", check.message);
    } catch (err) {
      addToast("error", String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleImportQaqm = async () => {
    setBusy(true);
    try {
      const summary = await api.importFromQaqmanager();
      setQaqmResult(summary);
      await refreshPresetCount();
      await refreshRabbitFxStatus();
      bumpCharactersTick();
      const latestCfg = await api.getConfig();
      setXxmiPath(latestCfg.xxmiPath);
      setModsPath(latestCfg.modsPath);
      setGamePath(latestCfg.gamePath);
      addToast("success", "已完成 QAQManager 本地数据只读迁移");
    } catch (err) {
      addToast("error", String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleFinish = async () => {
    try {
      await updateConfigPatch({
        xxmiPath: xxmiPath.trim(),
        modsPath: modsPath.trim(),
        gamePath: gamePath.trim(),
        launchMode,
        disclaimerDismissed: true,
      });
      bumpCharactersTick();
    } catch {
      // ignore minor errors
    }
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="4 步环境配置与入门向导"
      subtitle="专为《明日方舟：终末地》EFMI / XXMI 设计的纯本地零门槛初始化引导"
      maxWidthClass="max-w-2xl"
      footer={
        <>
          {step > 1 && (
            <button
              type="button"
              disabled={busy || pkgUpdating}
              onClick={() => setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3 | 4) : s))}
              className="rounded-xl border border-[var(--border-subtle)] px-4 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface)] disabled:opacity-50"
            >
              上一步
            </button>
          )}

          {step < 3 && (
            <button
              type="button"
              disabled={busy || pkgUpdating}
              onClick={() => {
                if (step === 1) {
                  void updateConfigPatch({ disclaimerDismissed: true }).catch(() => {});
                }
                setStep((s) => ((s + 1) as 1 | 2 | 3 | 4));
              }}
              className="rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] disabled:opacity-50"
            >
              下一步
            </button>
          )}

          {step === 3 && (
            <button
              type="button"
              disabled={busy || pkgUpdating}
              onClick={() => void handleSaveStep3AndNext()}
              className="rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] disabled:opacity-50"
            >
              保存路径并进入第 4 步
            </button>
          )}

          {step === 4 && (
            <button
              type="button"
              onClick={() => void handleFinish()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>完成设置并进入管理</span>
            </button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {/* Stepper */}
        <div className="grid grid-cols-4 gap-2">
          {STEP_LABELS.map((label, idx) => {
            const n = (idx + 1) as 1 | 2 | 3 | 4;
            return (
              <button
                key={label}
                type="button"
                onClick={() => setStep(n)}
                className={`truncate rounded-xl px-2.5 py-2 text-[11px] font-medium transition-colors ${
                  step === n
                    ? "bg-[var(--accent)] text-[var(--accent-contrast)]"
                    : step > n
                    ? "bg-emerald-500/15 text-emerald-500"
                    : "bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Step 1: Safety notice */}
        {step === 1 && (
          <div className="space-y-3">
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-emerald-500">
                <ShieldCheck className="h-4 w-4" />
                <span>100% 纯本地离线隐私承诺</span>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-[var(--text-primary)]">
                Endfield Mod Manager 不设账号体系、不收集设备信息、不连接任何云端后台或广告接口。所有配置、自定义标签、外观分区、预设方案与局部背景图片均完全保存在您的本地磁盘中。
              </p>
            </div>

            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 text-xs leading-relaxed text-[var(--text-secondary)] space-y-2">
              <div className="font-semibold text-[var(--text-primary)]">
                关于 XXMI / EFMI 使用原则
              </div>
              <ul className="list-inside list-disc space-y-1">
                <li>外观 Mod 仅作用于本地着色器与网格替换，请勿在官方渠道晒图或讨论相关文件。</li>
                <li>本工具仅通过标准化文件重命名（<code className="rounded bg-[var(--bg-surface)] px-1">DISABLED_</code>）与 3DMigoto <code className="rounded bg-[var(--bg-surface)] px-1">qaqm_includer.ini</code> 机制工作，绝不篡改 <code className="rounded bg-[var(--bg-surface)] px-1">Endfield.exe</code> 本体。</li>
                <li>如游戏以管理员权限运行，请通过管理器顶栏切换为管理员重启以保障游戏内快捷键与热重载生效。</li>
              </ul>
            </div>
          </div>
        )}

        {/* Step 2: XXMI detect & safe update */}
        {step === 2 && (
          <div className="space-y-3.5">
            <div className="flex items-center justify-between rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3.5">
              <div>
                <div className="text-xs font-semibold text-[var(--text-primary)]">
                  自动探测本机路径与 Windows 注册表
                </div>
                <div className="text-[11px] text-[var(--text-secondary)]">
                  一键扫描常见盘符目录、注册表卸载项以及现有 EFMI 环境
                </div>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleAutoDetect()}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] disabled:opacity-50"
              >
                <Search className="h-3.5 w-3.5" />
                <span>{busy ? "探测中..." : "一键智能扫描"}</span>
              </button>
            </div>

            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3.5 space-y-2">
              <label className="block text-xs font-semibold text-[var(--text-primary)]">
                XXMI Launcher.exe 可执行文件路径
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={xxmiPath}
                  onChange={(e) => setXxmiPath(e.target.value)}
                  placeholder="例如：D:\MOD\XXMI\XXMI Launcher.exe"
                  className="flex-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 font-mono text-[11px] text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={async () => {
                    const p = await openDialog({
                      title: "选择 XXMI Launcher.exe",
                      directory: false,
                      filters: [{ name: "可执行文件", extensions: ["exe"] }],
                    });
                    if (typeof p === "string") setXxmiPath(p);
                  }}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-primary)] hover:border-[var(--border-strong)]"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  <span>浏览</span>
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3.5 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
                <PackageCheck className="h-4 w-4 text-[var(--accent)]" />
                <span>从本地文件包安全安装 / 升级 XXMI（可选）</span>
              </div>
              <p className="text-[11px] text-[var(--text-secondary)]">
                自动跳过 <code className="rounded bg-[var(--bg-surface)] px-1">Mods</code>、<code className="rounded bg-[var(--bg-surface)] px-1">d3dx_user.ini</code>、<code className="rounded bg-[var(--bg-surface)] px-1">XXMI Launcher Config.json</code> 与 <code className="rounded bg-[var(--bg-surface)] px-1">qaqm</code> 缓存目录。
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={pkgUpdating}
                  onClick={() => void handleInstallOrUpdatePackage("xxmi", false)}
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--border-strong)] disabled:opacity-50"
                >
                  {pkgUpdating ? "覆盖更新中..." : "选择本地 XXMI 压缩包"}
                </button>
                <button
                  type="button"
                  disabled={pkgUpdating}
                  onClick={() => void handleInstallOrUpdatePackage("xxmi", true)}
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--border-strong)] disabled:opacity-50"
                >
                  选择本地 XXMI 文件夹
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: EFMI Mods & Endfield.exe */}
        {step === 3 && (
          <div className="space-y-3.5">
            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3.5 space-y-2">
              <label className="block text-xs font-semibold text-[var(--text-primary)]">
                EFMI Mods 根目录 *
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={modsPath}
                  onChange={(e) => setModsPath(e.target.value)}
                  placeholder="例如：D:\MOD\XXMI\EFMI\Mods"
                  className="flex-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 font-mono text-[11px] text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={async () => {
                    const p = await openDialog({ title: "选择 EFMI\\Mods 文件夹", directory: true });
                    if (typeof p === "string") setModsPath(p);
                  }}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-primary)] hover:border-[var(--border-strong)]"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  <span>浏览</span>
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3.5 space-y-2">
              <label className="block text-xs font-semibold text-[var(--text-primary)]">
                游戏本体路径（Endfield.exe，直连/启动用，可选）
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={gamePath}
                  onChange={(e) => setGamePath(e.target.value)}
                  placeholder="例如：...\Endfield Game\Endfield.exe"
                  className="flex-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 font-mono text-[11px] text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={async () => {
                    const p = await openDialog({
                      title: "选择 Endfield.exe",
                      filters: [{ name: "可执行文件", extensions: ["exe"] }],
                    });
                    if (typeof p === "string") setGamePath(p);
                  }}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-primary)] hover:border-[var(--border-strong)]"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  <span>浏览</span>
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3.5">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold text-[var(--text-primary)]">默认启动方式：</span>
                {(
                  [
                    { value: "EFMI", label: "通过 XXMI 静默启动 EFMI" },
                    { value: "XXMI", label: "打开 XXMI 启动器" },
                    { value: "VANILLA", label: "原版直连启动" },
                  ] as Array<{ value: LaunchMode; label: string }>
                ).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setLaunchMode(opt.value)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                      launchMode === opt.value
                        ? "bg-[var(--accent)] text-[var(--accent-contrast)]"
                        : "bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                disabled={busy}
                onClick={() => void handleRunConsistencyCheck()}
                className="rounded-xl border border-[var(--border-strong)] bg-[var(--accent-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--accent)] hover:bg-[var(--accent)] hover:text-[var(--accent-contrast)]"
              >
                一致性校验
              </button>
            </div>

            {consistency && (
              <div
                className={`rounded-xl border p-3 text-xs ${
                  consistency.consistent
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-500"
                }`}
              >
                {consistency.message}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3.5 text-xs">
              <span className="text-[var(--text-secondary)]">
                需要更新或初次部署 EFMI 核心文件？
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={pkgUpdating}
                  onClick={() => void handleInstallOrUpdatePackage("efmi", false)}
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 font-medium text-[var(--text-primary)] hover:border-[var(--border-strong)]"
                >
                  本地 EFMI 压缩包更新
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Migration, Import & Diagnostics */}
        {step === 4 && (
          <div className="space-y-3.5">
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-xs text-emerald-500">
              <div className="flex items-center gap-1.5 font-semibold">
                <Sparkles className="h-4 w-4" />
                <span>核心环境配置已保存！您可以选做以下收尾操作：</span>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleImportQaqm()}
                className="flex flex-col items-start gap-2 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 text-left transition-colors hover:border-[var(--accent)]"
              >
                <HardDriveDownload className="h-5 w-5 text-[var(--accent)]" />
                <div className="text-xs font-semibold text-[var(--text-primary)]">
                  从 QAQManager v4 迁移
                </div>
                <div className="text-[11px] text-[var(--text-secondary)]">
                  只读同步旧版目录路径、角色排序与 Mod 预设方案。
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  void handleFinish();
                  openImportWizard([], null);
                }}
                className="flex flex-col items-start gap-2 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 text-left transition-colors hover:border-[var(--accent)]"
              >
                <Archive className="h-5 w-5 text-[var(--accent)]" />
                <div className="text-xs font-semibold text-[var(--text-primary)]">
                  导入首批 Mod 压缩包
                </div>
                <div className="text-[11px] text-[var(--text-secondary)]">
                  支持 ZIP / 7z / RAR / QAQM MP4 与多角色自动匹配。
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  void handleFinish();
                  setDiagnosticsOpen(true);
                }}
                className="flex flex-col items-start gap-2 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 text-left transition-colors hover:border-[var(--accent)]"
              >
                <Activity className="h-5 w-5 text-[var(--accent)]" />
                <div className="text-xs font-semibold text-[var(--text-primary)]">
                  运行 8 项离线体检
                </div>
                <div className="text-[11px] text-[var(--text-secondary)]">
                  核查 d3dx.ini 规则、RabbitFX 防崩与权限配置。
                </div>
              </button>
            </div>

            {qaqmResult && (
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 text-xs text-[var(--text-secondary)]">
                迁移结果：已读取路径={qaqmResult.importedPaths ? "是" : "否"}，同步排序{" "}
                {qaqmResult.importedOrderCount} 项，导入预设 {qaqmResult.importedPresetCount} 套。
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
