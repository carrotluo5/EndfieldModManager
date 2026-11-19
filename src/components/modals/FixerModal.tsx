import { useCallback, useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  CheckCircle2,
  FolderOpen,
  History,
  RotateCcw,
  ShieldCheck,
  Terminal,
  Wrench,
} from "lucide-react";
import { api } from "../../lib/tauri";
import { useAppStore } from "../../store/useAppStore";
import type { FixBackupEntry, FixerRunReport } from "../../types/mod";
import { Modal } from "../ui/Modal";

interface FixerModalProps {
  open: boolean;
  scopeKind: "mod" | "character" | "all";
  characterName?: string | null;
  modName?: string | null;
  onClose: () => void;
}

export function FixerModal({
  open,
  scopeKind,
  characterName = null,
  modName = null,
  onClose,
}: FixerModalProps) {
  const bumpModsTick = useAppStore((s) => s.bumpModsTick);
  const addToast = useAppStore((s) => s.addToast);

  const [fixerExePath, setFixerExePath] = useState("");
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<FixerRunReport | null>(null);

  useEffect(() => {
    if (open) {
      setFixerExePath(useAppStore.getState().config?.customFixerPath ?? "");
      setReport(null);
    }
  }, [open, scopeKind, characterName, modName]);

  const scopeTitle =
    scopeKind === "mod"
      ? `单个 Mod：${characterName ?? ""} / ${modName ?? ""}`
      : scopeKind === "character"
      ? `角色全部分类 Mod：${characterName ?? ""}`
      : "全库所有角色的 Mod";

  const handleBrowseFixer = async () => {
    try {
      const selected = await openDialog({
        title: "选择外部修复工具 (Fixer.exe)",
        filters: [{ name: "可执行文件", extensions: ["exe", "bat", "cmd"] }],
      });
      if (typeof selected === "string" && selected.trim()) {
        setFixerExePath(selected);
      }
    } catch (err) {
      addToast("error", String(err));
    }
  };

  const handleRunFixer = async () => {
    setRunning(true);
    try {
      const res = await api.runModFixer(
        scopeKind,
        characterName,
        modName,
        fixerExePath.trim() || null
      );
      setReport(res);
      bumpModsTick();
      addToast(
        "success",
        `修复完成：已备份 ${res.backupCount} 个 Mod，更新 ${res.modifiedFiles} 个 INI`
      );
    } catch (err) {
      addToast("error", `修复失败：${String(err)}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => !running && onClose()}
      title="Mod 修复工具（带时间线备份与无损回滚）"
      subtitle={scopeTitle}
      maxWidthClass="max-w-2xl"
      closeOnBackdrop={!running}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={running}
            className="rounded-xl border border-[var(--border-subtle)] px-4 py-2 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] disabled:opacity-50"
          >
            关闭
          </button>
          <button
            type="button"
            onClick={() => void handleRunFixer()}
            disabled={running}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] disabled:opacity-50"
          >
            <Wrench className="h-3.5 w-3.5" />
            <span>{running ? "正在备份并执行修复..." : "立即创建备份并执行修复"}</span>
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-start gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-500">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="leading-relaxed">
            运行前会自动为目标 Mod 内所有 <code className="rounded bg-black/15 px-1">.ini</code>（含{" "}
            <code className="rounded bg-black/15 px-1">DISABLED*</code> 子目录）生成独立时间戳备份至{" "}
            <code className="rounded bg-black/15 px-1">.efmm-backups/</code>，可随时在 Mod 右键菜单无损回滚。
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3.5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs font-semibold text-[var(--text-primary)]">
              修复引擎选择
            </label>
            {fixerExePath.trim() && (
              <button
                type="button"
                onClick={() => setFixerExePath("")}
                className="text-[11px] text-[var(--accent)] hover:underline"
              >
                切回内置规范化引擎
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={fixerExePath}
              onChange={(e) => setFixerExePath(e.target.value)}
              placeholder="留空则使用内置 INI 规范化修复（清理 BOM、多余空行）；也可指定外部 Fixer.exe"
              className="flex-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 font-mono text-[11px] text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void handleBrowseFixer()}
              disabled={running}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--border-strong)]"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              <span>浏览 EXE</span>
            </button>
          </div>
          <p className="text-[11px] text-[var(--text-muted)]">
            使用外部 Fixer 时将自动向标准输入注入确认回车并设置 20 秒超时保护，防止子进程永久卡死。
          </p>
        </div>

        {report && (
          <div className="space-y-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <span>本次修复执行报告</span>
            </div>
            <div className="grid grid-cols-3 gap-2.5 text-center">
              <div className="rounded-xl bg-[var(--bg-surface)] p-2.5">
                <div className="text-base font-bold text-[var(--text-primary)]">
                  {report.backupCount}
                </div>
                <div className="text-[11px] text-[var(--text-secondary)]">新建时间戳备份</div>
              </div>
              <div className="rounded-xl bg-[var(--bg-surface)] p-2.5">
                <div className="text-base font-bold text-[var(--text-primary)]">
                  {report.processedMods}
                </div>
                <div className="text-[11px] text-[var(--text-secondary)]">扫描处理 Mod</div>
              </div>
              <div className="rounded-xl bg-[var(--bg-surface)] p-2.5">
                <div className="text-base font-bold text-[var(--accent)]">
                  {report.modifiedFiles}
                </div>
                <div className="text-[11px] text-[var(--text-secondary)]">改写 INI 文件</div>
              </div>
            </div>
            <div>
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-secondary)]">
                <Terminal className="h-3.5 w-3.5" />
                <span>执行日志输出</span>
              </div>
              <pre className="max-h-40 overflow-auto rounded-xl border border-[var(--border-subtle)] bg-black/25 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-[var(--text-primary)]">
                {report.logOutput}
              </pre>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

interface BackupRollbackModalProps {
  open: boolean;
  characterName: string;
  modName: string;
  onClose: () => void;
}

export function BackupRollbackModal({
  open,
  characterName,
  modName,
  onClose,
}: BackupRollbackModalProps) {
  const bumpModsTick = useAppStore((s) => s.bumpModsTick);
  const addToast = useAppStore((s) => s.addToast);

  const [loading, setLoading] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [entries, setEntries] = useState<FixBackupEntry[]>([]);

  const loadBackups = useCallback(async () => {
    if (!characterName || !modName) return;
    setLoading(true);
    try {
      const list = await api.listModFixBackups(characterName, modName);
      setEntries(list);
    } catch (err) {
      addToast("error", String(err));
    } finally {
      setLoading(false);
    }
  }, [characterName, modName, addToast]);

  useEffect(() => {
    if (open) {
      void loadBackups();
    }
  }, [open, loadBackups]);

  const handleRollback = async (backupId: string) => {
    setRestoringId(backupId);
    try {
      const count = await api.rollbackModFixBackup(characterName, modName, backupId);
      addToast("success", `已从备份「${backupId}」无损还原 ${count} 个 .ini 文件`);
      bumpModsTick();
      onClose();
    } catch (err) {
      addToast("error", `回滚失败：${String(err)}`);
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => !restoringId && onClose()}
      title="修复备份历史与无损回滚"
      subtitle={`${characterName} / ${modName}（来自 .efmm-backups）`}
      maxWidthClass="max-w-xl"
      footer={
        <button
          type="button"
          onClick={onClose}
          disabled={Boolean(restoringId)}
          className="rounded-xl border border-[var(--border-subtle)] px-4 py-2 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]"
        >
          关闭
        </button>
      }
    >
      {loading ? (
        <div className="py-10 text-center text-xs text-[var(--text-secondary)]">
          正在读取备份记录...
        </div>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] py-10 text-center">
          <History className="h-8 w-8 text-[var(--text-muted)]" />
          <div className="mt-2.5 text-xs font-semibold text-[var(--text-primary)]">
            暂无修复备份记录
          </div>
          <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
            每当对该 Mod 运行修复工具时，均会自动生成一次可回滚快照。
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 py-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-[var(--text-primary)]">
                    {entry.id}
                  </span>
                  <span className="rounded-md bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent)]">
                    {entry.fixerName}
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-[var(--text-secondary)]">
                  创建时间：{entry.createdAt} · 包含 {entry.fileCount} 个 .ini 文件
                </div>
              </div>
              <button
                type="button"
                disabled={Boolean(restoringId)}
                onClick={() => void handleRollback(entry.id)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] disabled:opacity-50"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>{restoringId === entry.id ? "还原中..." : "回滚此备份"}</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
