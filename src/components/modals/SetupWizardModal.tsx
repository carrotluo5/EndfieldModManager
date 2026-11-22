import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Activity, Archive, CheckCircle2, FolderOpen, PackageCheck, Search, ShieldCheck } from "lucide-react";
import { api } from "../../lib/tauri";
import { useAppStore } from "../../store/useAppStore";
import type { AppConfig, LaunchMode, XxmiConsistency } from "../../types/mod";
import { Modal } from "../ui/Modal";
import { SelectMenu } from "../ui/SelectMenu";

interface SetupWizardModalProps {
  open: boolean;
  onClose: () => void;
}

type SetupPaths = Pick<AppConfig, "xxmiPath" | "modsPath" | "gamePath" | "launchMode">;
type PathField = "xxmiPath" | "modsPath" | "gamePath";
type PackageKind = "xxmi" | "efmi";

interface PackageSelection {
  kind: PackageKind;
  source: string;
  destination: string;
}

const STEP_LABELS = ["使用须知", "XXMI 启动器", "EFMI 与游戏路径", "确认配置"];
const LAUNCH_MODES: Record<LaunchMode, string> = {
  EFMI: "通过 XXMI 静默启动 EFMI",
  XXMI: "打开 XXMI 启动器",
  VANILLA: "原版直连启动",
};
const PATH_LABELS: Record<PathField, string> = {
  xxmiPath: "XXMI Launcher.exe",
  modsPath: "EFMI Mods 文件夹",
  gamePath: "Endfield.exe",
};
const INITIAL_PATHS: SetupPaths = { xxmiPath: "", modsPath: "", gamePath: "", launchMode: "EFMI" };
const SECONDARY_BUTTON = "rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-2 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--border-strong)] disabled:opacity-50";
const PRIMARY_BUTTON = "rounded-xl bg-[var(--accent-fill)] px-4 py-2 text-xs font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-fill-hover)] disabled:opacity-50";
const CARD = "rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3.5";
const QUIET = "text-xs leading-relaxed text-[var(--text-secondary)]";

function parentFolder(path: string) {
  const clean = path.trim().replace(/[\\/]+$/, "");
  const separator = Math.max(clean.lastIndexOf("\\"), clean.lastIndexOf("/"));
  if (separator < 0) return undefined;
  return separator === 2 && clean[1] === ":" ? clean.slice(0, 3) : clean.slice(0, separator);
}

function packageDestination(kind: PackageKind, paths: SetupPaths) {
  if (kind === "efmi") return parentFolder(paths.modsPath);
  const launcherFolder = parentFolder(paths.xxmiPath);
  return launcherFolder?.replace(/[\\/]Resources[\\/]Bin$/i, "");
}

function PathSummary({ paths }: { paths: SetupPaths }) {
  return (
    <dl className={CARD + " space-y-2 text-xs"}>
      {(["modsPath", "xxmiPath", "gamePath"] as const).map((field) => (
        <div key={field} className="grid grid-cols-[8rem_minmax(0,1fr)] gap-2">
          <dt className="font-medium text-[var(--text-secondary)]">{PATH_LABELS[field]}</dt>
          <dd className="min-w-0 break-all font-mono text-[var(--text-primary)]">{paths[field] || "未配置"}</dd>
        </div>
      ))}
      <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-2">
        <dt className="font-medium text-[var(--text-secondary)]">默认启动方式</dt>
        <dd className="text-[var(--text-primary)]">{LAUNCH_MODES[paths.launchMode] ?? paths.launchMode}</dd>
      </div>
    </dl>
  );
}

export function SetupWizardModal({ open, onClose }: SetupWizardModalProps) {
  const {
    updateConfigPatch, refreshRabbitFxStatus, bumpCharactersTick,
    openImportWizard, setDiagnosticsOpen, addToast,
  } = useAppStore.getState();

  const [step, setStep] = useState(1);
  const [paths, setPaths] = useState<SetupPaths>(INITIAL_PATHS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [consistency, setConsistency] = useState<XxmiConsistency | null>(null);
  const [completed, setCompleted] = useState<SetupPaths | null>(null);
  const [packageSelection, setPackageSelection] = useState<PackageSelection | null>(null);
  const [updatedPackages, setUpdatedPackages] = useState<Partial<Record<PackageKind, string>>>({});

  useEffect(() => {
    if (!open) return;
    const cfg = useAppStore.getState().config;
    setStep(1);
    setPaths(cfg ? {
      xxmiPath: cfg.xxmiPath,
      modsPath: cfg.modsPath,
      gamePath: cfg.gamePath,
      launchMode: cfg.launchMode,
    } : INITIAL_PATHS);
    setError("");
    setConsistency(null);
    setCompleted(null);
    setPackageSelection(null);
    setUpdatedPackages({});
  }, [open]);

  const closeWizard = () => {
    if (!busy) onClose();
  };

  const setPath = (field: PathField, path: string) => {
    setPaths((current) => ({ ...current, [field]: path }));
    setConsistency(null);
    setError("");
  };

  const handleAutoDetect = async () => {
    setBusy(true);
    setError("");
    try {
      const detected = await api.autoDetectPaths();
      setPaths((current) => ({
        ...current,
        xxmiPath: current.xxmiPath.trim() ? current.xxmiPath : detected.xxmiPath ?? "",
        modsPath: current.modsPath.trim() ? current.modsPath : detected.modsPath ?? "",
        gamePath: current.gamePath.trim() ? current.gamePath : detected.gamePath ?? "",
      }));
      setConsistency(null);
      const filled = (Object.keys(PATH_LABELS) as PathField[])
        .filter((field) => !paths[field].trim() && detected[field]);
      if (filled.length > 0) {
        addToast("success", "已填入" + filled.map((field) => PATH_LABELS[field]).join("、"));
      } else if (Object.values(detected).some(Boolean)) {
        addToast("info", "保留已填写的路径");
      } else {
        addToast("warning", "未自动找到路径，请手动浏览选择");
      }
    } catch (err) {
      setError("自动探测失败：" + String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleBrowse = async (field: PathField) => {
    setBusy(true);
    setError("");
    const directory = field === "modsPath";
    const suggestedRoot = updatedPackages[directory ? "efmi" : "xxmi"];
    try {
      const selected = await openDialog({
        title: "选择" + PATH_LABELS[field],
        directory,
        defaultPath: field !== "gamePath" && suggestedRoot
          ? suggestedRoot
          : directory ? paths[field].trim() || undefined : parentFolder(paths[field]),
        filters: directory ? undefined : [{ name: "可执行文件", extensions: ["exe"] }],
      });
      if (typeof selected === "string") setPath(field, selected);
    } catch (err) {
      setError("打开文件选择器失败：" + String(err));
    } finally {
      setBusy(false);
    }
  };

  const pickPackage = async (kind: PackageKind, fromFolder: boolean) => {
    setBusy(true);
    setError("");
    const packageName = kind.toUpperCase();
    try {
      const source = await openDialog({
        title: "选择本地 " + packageName + (fromFolder ? " 解压目录" : " 压缩包"),
        directory: fromFolder,
        filters: fromFolder ? undefined : [{ name: "本地压缩包", extensions: ["zip", "7z", "rar"] }],
      });
      if (typeof source !== "string") return;
      const destination = await openDialog({
        title: "选择 " + packageName + " 安装目标目录",
        directory: true,
        defaultPath: updatedPackages[kind] ?? packageDestination(kind, paths),
      });
      if (typeof destination === "string") setPackageSelection({ kind, source, destination });
    } catch (err) {
      setError("无法选择安装来源或目标：" + String(err));
    } finally {
      setBusy(false);
    }
  };

  const updatePackage = async () => {
    if (!packageSelection || busy) return;
    const { kind, source, destination } = packageSelection;
    setBusy(true);
    setError("");
    try {
      const result = await api.updateXxmiOrEfmiPackage(kind, source, destination);
      addToast("success", result.message);
      setUpdatedPackages((installed) => ({ ...installed, [kind]: destination }));
      setConsistency(null);
      setPackageSelection(null);
    } catch (err) {
      setPackageSelection(null);
      setError("本地文件更新失败：" + String(err));
    } finally {
      setBusy(false);
    }
  };

  const checkDraft = async (advance: boolean) => {
    setBusy(true);
    setError("");
    setConsistency(null);
    try {
      const result = await api.checkXxmiConsistency({ modsPath: paths.modsPath, xxmiPath: paths.xxmiPath });
      setConsistency(result);
      if (advance) setStep(4);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const saveSetup = async () => {
    setBusy(true);
    setError("");
    const draft = {
      ...paths,
      xxmiPath: paths.xxmiPath.trim(),
      modsPath: paths.modsPath.trim(),
      gamePath: paths.gamePath.trim(),
    };
    try {
      const check = await api.checkXxmiConsistency({ modsPath: draft.modsPath, xxmiPath: draft.xxmiPath });
      setConsistency(check);
      const saved = await updateConfigPatch({ ...draft, disclaimerDismissed: true });
      bumpCharactersTick();
      void refreshRabbitFxStatus();
      setCompleted(saved);
    } catch (err) {
      setError("保存配置失败：" + String(err));
    } finally {
      setBusy(false);
    }
  };

  const pathInput = (field: PathField, placeholder: string, optional = false) => (
    <div className={CARD + " space-y-2"}>
      <label htmlFor={"setup-" + field} className="block text-xs font-semibold text-[var(--text-primary)]">
        {PATH_LABELS[field]}{optional && "（可选）"}
      </label>
      <div className="flex gap-2">
        <input
          id={"setup-" + field}
          type="text"
          disabled={busy}
          value={paths[field]}
          onChange={(event) => setPath(field, event.target.value)}
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 font-mono text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
        />
        <button type="button" disabled={busy} onClick={() => void handleBrowse(field)}
          className={SECONDARY_BUTTON + " inline-flex shrink-0 items-center gap-1.5"}>
          <FolderOpen className="h-3.5 w-3.5" />
          浏览
        </button>
      </div>
    </div>
  );

  const packageActions = (kind: PackageKind) => {
    const packageName = kind.toUpperCase();
    const updated = updatedPackages[kind];
    return (
      <section className={CARD + " space-y-2.5"}>
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
          <PackageCheck className="h-4 w-4 text-[var(--accent)]" />
          {packageName} 本地安装或更新
        </h3>
        <p className={QUIET}>
          已经配置 {packageName} 可直接继续。选择本地压缩包或已解压目录时，向导会在更新前确认目标。
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => void pickPackage(kind, false)} className={SECONDARY_BUTTON}>
            选择压缩包
          </button>
          <button type="button" disabled={busy} onClick={() => void pickPackage(kind, true)} className={SECONDARY_BUTTON}>
            选择解压目录
          </button>
        </div>
        {updated && (
          <p className={QUIET + " break-all"}>
            已更新 {updated}。如果这是新的安装位置，请在上方浏览并选择
            {kind === "xxmi" ? "其中的启动器。" : "对应 Mods 文件夹。"}
          </p>
        )}
      </section>
    );
  };

  const consistencyResult = consistency && (
    <p role="status" className={"rounded-xl border p-3 text-xs " + (
      consistency.consistent
        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
        : "border-amber-500/30 bg-amber-500/10 text-amber-500"
    )}>
      {consistency.message}
    </p>
  );

  return (
    <>
      <Modal
        open={open}
        onClose={closeWizard}
        closeOnBackdrop={false}
        title={completed ? "环境配置摘要" : "环境配置与入门向导"}
        maxWidthClass="max-w-2xl"
        footer={completed ? (
          <button type="button" onClick={closeWizard} className={PRIMARY_BUTTON}>完成</button>
        ) : (
          <>
            <button type="button" onClick={closeWizard} disabled={busy} className={SECONDARY_BUTTON + " mr-auto"}>
              取消
            </button>
            {step > 1 && (
              <button type="button" disabled={busy} className={SECONDARY_BUTTON} onClick={() => {
                setError("");
                setStep(step - 1);
              }}>
                上一步
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              className={PRIMARY_BUTTON}
              onClick={() => {
                setError("");
                if (step < 3) setStep(step + 1);
                else if (step === 3) void checkDraft(true);
                else void saveSetup();
              }}
            >
              {busy ? "处理中…" : step === 4 ? "保存并查看摘要" : "下一步"}
            </button>
          </>
        )}
      >
        <div className="space-y-4">
          {!completed && (
            <ol className="grid grid-cols-4 gap-2 text-xs">
              {STEP_LABELS.map((label, index) => (
                <li key={label} aria-current={step === index + 1 ? "step" : undefined}
                  className={"rounded-xl px-2.5 py-2 font-medium " + (
                    step === index + 1
                      ? "bg-[var(--accent-fill)] text-[var(--accent-contrast)]"
                      : "bg-[var(--bg-elevated)] text-[var(--text-secondary)]"
                  )}>
                  {label}
                </li>
              ))}
            </ol>
          )}
          {error && (
            <p role="alert" className="rounded-xl bg-rose-500/10 p-3 text-xs text-rose-500">{error}</p>
          )}

          {!completed && step === 1 && (
            <section className={CARD + " space-y-2"}>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                <ShieldCheck className="h-4 w-4 text-[var(--accent)]" />
                本地配置 EFMI / XXMI
              </h3>
              <p className={QUIET}>可连接已安装的启动器和 Mods 目录，也可用本地文件包安装或更新。</p>
              <p className={QUIET}>配置、标签、预设与背景保存在本机。管理器通过 EFMI 的 Mods 目录和 3DMigoto 脚本工作，游戏本体文件保持原样。</p>
            </section>
          )}

          {!completed && step === 2 && (
            <>
              <div className={CARD + " flex flex-wrap items-center justify-between gap-2"}>
                <p className={QUIET}>从常见目录和 Windows 注册表查找启动器、游戏及 Mods。</p>
                <button type="button" disabled={busy} onClick={() => void handleAutoDetect()}
                  className={SECONDARY_BUTTON + " inline-flex items-center gap-1.5"}>
                  <Search className="h-3.5 w-3.5" />
                  自动探测
                </button>
              </div>
              {pathInput("xxmiPath", "例如 D:\\MOD\\XXMI\\Resources\\Bin\\XXMI Launcher.exe", true)}
              {packageActions("xxmi")}
            </>
          )}

          {!completed && step === 3 && (
            <>
              {pathInput("modsPath", "例如 D:\\MOD\\XXMI\\EFMI\\Mods")}
              {pathInput("gamePath", "例如 D:\\Games\\Arknights Endfield\\Endfield.exe", true)}
              <div className={CARD + " flex flex-wrap items-end justify-between gap-2"}>
                <div className="grid min-w-0 gap-2 text-xs font-semibold text-[var(--text-primary)]">
                  <label id="setup-launch-mode-label" htmlFor="setup-launch-mode">默认启动方式</label>
                  <SelectMenu<LaunchMode>
                    id="setup-launch-mode"
                    aria-labelledby="setup-launch-mode-label"
                    value={paths.launchMode}
                    disabled={busy}
                    onChange={(launchMode) => setPaths((current) => ({ ...current, launchMode }))}
                    options={(Object.keys(LAUNCH_MODES) as LaunchMode[]).map((value) => ({ value, label: LAUNCH_MODES[value] }))}
                  />
                </div>
                <button type="button" disabled={busy} onClick={() => void checkDraft(false)} className={SECONDARY_BUTTON}>
                  校验路径
                </button>
              </div>
              {consistencyResult}
              {packageActions("efmi")}
            </>
          )}

          {!completed && step === 4 && (
            <>
              <PathSummary paths={paths} />
              {consistencyResult}
              {Object.keys(updatedPackages).length > 0 && (
                <p className={QUIET}>取消会放弃尚未保存的路径。已完成的本地文件更新会保留。</p>
              )}
            </>
          )}

          {completed && (
            <>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-emerald-500">
                <CheckCircle2 className="h-4 w-4" />
                路径与启动方式已保存
              </h3>
              <PathSummary paths={completed} />
              {consistencyResult}
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => {
                  onClose();
                  openImportWizard();
                }} className={SECONDARY_BUTTON + " inline-flex items-center gap-1.5"}>
                  <Archive className="h-3.5 w-3.5" />
                  导入首批 Mod
                </button>
                <button type="button" onClick={() => {
                  onClose();
                  setDiagnosticsOpen(true);
                }} className={SECONDARY_BUTTON + " inline-flex items-center gap-1.5"}>
                  <Activity className="h-3.5 w-3.5" />
                  运行离线诊断
                </button>
              </div>
            </>
          )}
        </div>
      </Modal>

      <Modal
        open={open && Boolean(packageSelection)}
        title={"确认更新 " + (packageSelection?.kind.toUpperCase() ?? "")}
        onClose={() => { if (!busy) setPackageSelection(null); }}
        closeOnBackdrop={!busy}
        footer={
          <>
            <button type="button" disabled={busy} onClick={() => setPackageSelection(null)} className={SECONDARY_BUTTON}>
              取消
            </button>
            <button type="button" disabled={busy} onClick={() => void updatePackage()} className={PRIMARY_BUTTON}>
              {busy ? "正在更新…" : "确认更新"}
            </button>
          </>
        }
      >
        {packageSelection && (
          <div className="space-y-3 text-xs">
            <dl className={CARD + " space-y-2 break-all text-[var(--text-primary)]"}>
              <div><dt className="font-semibold">来源</dt><dd>{packageSelection.source}</dd></div>
              <div><dt className="font-semibold">目标</dt><dd>{packageSelection.destination}</dd></div>
            </dl>
            <p className={QUIET}>更新会覆盖目标中的同名核心文件，保留 Mods、d3dx_user.ini、启动器配置和 Persist Bridge 状态目录。</p>
          </div>
        )}
      </Modal>
    </>
  );
}
