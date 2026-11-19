import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FolderSync,
  RefreshCw,
  Settings2,
  Shield,
  Sparkles,
  Wrench,
  XCircle,
} from "lucide-react";
import { api } from "../../lib/tauri";
import { useAppStore } from "../../store/useAppStore";
import type { DiagnosticsReport } from "../../types/mod";
import { Modal } from "../ui/Modal";

interface DiagnosticsModalProps {
  open: boolean;
  onClose: () => void;
}

export function DiagnosticsModal({ open, onClose }: DiagnosticsModalProps) {
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const setSelectedCharacter = useAppStore((s) => s.setSelectedCharacter);
  const setOrganizeModalOpen = useAppStore((s) => s.setOrganizeModalOpen);
  const bumpCharactersTick = useAppStore((s) => s.bumpCharactersTick);
  const bumpModsTick = useAppStore((s) => s.bumpModsTick);
  const addToast = useAppStore((s) => s.addToast);

  const [loading, setLoading] = useState(false);
  const [fixingId, setFixingId] = useState<string | null>(null);
  const [report, setReport] = useState<DiagnosticsReport | null>(null);

  const runDiagnostics = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.runOfflineDiagnostics();
      setReport(res);
    } catch (err) {
      addToast("error", `执行离线诊断失败：${String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    if (open) {
      void runDiagnostics();
    }
  }, [open, runDiagnostics]);

  const handleFixItem = async (checkId: string) => {
    setFixingId(checkId);
    try {
      const msg = await api.fixDiagnosticItem(checkId);
      addToast("success", msg || "已完成修复");
      bumpCharactersTick();
      bumpModsTick();
      await runDiagnostics();
    } catch (err) {
      addToast("error", `修复失败：${String(err)}`);
    } finally {
      setFixingId(null);
    }
  };

  const handleActionHint = async (hint: string) => {
    if (hint === "settings") {
      onClose();
      setActiveTab("settings");
    } else if (hint === "rabbitfx") {
      onClose();
      setActiveTab("characters");
      setSelectedCharacter("功能");
    } else if (hint === "organize") {
      onClose();
      setOrganizeModalOpen(true);
    } else if (hint === "admin") {
      try {
        await api.relaunchAsAdmin();
      } catch (err) {
        addToast("error", String(err));
      }
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="8 项离线环境与 Mod 冲突诊断"
      subtitle="纯本地检查 XXMI 对齐、d3dx.ini 挂载、RabbitFX 单实例、Hash 冲突、EFF 误放与 UIPI 权限"
      maxWidthClass="max-w-3xl"
      footer={
        <>
          <button
            type="button"
            onClick={() => void runDiagnostics()}
            disabled={loading || Boolean(fixingId)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>{loading ? "体检扫描中..." : "重新执行全面诊断"}</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-[var(--border-subtle)] px-4 py-2 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]"
          >
            关闭
          </button>
        </>
      }
    >
      {loading && !report ? (
        <div className="flex flex-col items-center justify-center py-12 text-xs text-[var(--text-secondary)]">
          <RefreshCw className="h-6 w-6 animate-spin text-[var(--accent)]" />
          <p className="mt-3">正在运行 8 项纯本地诊断...</p>
        </div>
      ) : report ? (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-center">
              <div className="text-lg font-bold text-emerald-500">{report.okCount}</div>
              <div className="text-[11px] text-[var(--text-secondary)]">正常通过</div>
            </div>
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-center">
              <div className="text-lg font-bold text-amber-500">{report.warnCount}</div>
              <div className="text-[11px] text-[var(--text-secondary)]">告警提醒</div>
            </div>
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-center">
              <div className="text-lg font-bold text-rose-500">{report.errorCount}</div>
              <div className="text-[11px] text-[var(--text-secondary)]">阻塞异常</div>
            </div>
          </div>

          <div className="text-right text-[11px] text-[var(--text-muted)]">
            最近检查时间：{report.checkedAt}
          </div>

          <div className="space-y-2.5">
            {report.checks.map((item) => {
              const borderCls =
                item.status === "ok"
                  ? "border-[var(--border-subtle)] bg-[var(--bg-elevated)]"
                  : item.status === "warn"
                  ? "border-amber-500/35 bg-amber-500/5"
                  : "border-rose-500/35 bg-rose-500/5";

              return (
                <div
                  key={item.id}
                  className={`flex flex-wrap items-start justify-between gap-3 rounded-2xl border p-3.5 ${borderCls}`}
                >
                  <div className="flex min-w-0 flex-1 items-start gap-2.5">
                    {item.status === "ok" ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                    ) : item.status === "warn" ? (
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                    ) : (
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-[var(--text-primary)]">
                        {item.title}
                      </div>
                      <div className="mt-0.5 text-xs text-[var(--text-primary)]">
                        {item.summary}
                      </div>
                      {item.detail && (
                        <div className="mt-1 text-[11px] leading-relaxed text-[var(--text-secondary)]">
                          {item.detail}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {item.fixable && item.status !== "ok" && (
                      <button
                        type="button"
                        disabled={Boolean(fixingId)}
                        onClick={() => void handleFixItem(item.id)}
                        className="inline-flex items-center gap-1 rounded-xl bg-[var(--accent)] px-3 py-1.5 text-[11px] font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] disabled:opacity-50"
                      >
                        <Wrench className="h-3 w-3" />
                        <span>{fixingId === item.id ? "修复中..." : "一键修复"}</span>
                      </button>
                    )}

                    {item.actionHint === "settings" && (
                      <button
                        type="button"
                        onClick={() => void handleActionHint("settings")}
                        className="inline-flex items-center gap-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-[11px] font-medium text-[var(--text-primary)] hover:border-[var(--border-strong)]"
                      >
                        <Settings2 className="h-3 w-3" />
                        <span>前往设置</span>
                      </button>
                    )}

                    {item.actionHint === "rabbitfx" && (
                      <button
                        type="button"
                        onClick={() => void handleActionHint("rabbitfx")}
                        className="inline-flex items-center gap-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-[11px] font-medium text-[var(--text-primary)] hover:border-[var(--border-strong)]"
                      >
                        <Sparkles className="h-3 w-3" />
                        <span>查看「功能」分类</span>
                      </button>
                    )}

                    {item.actionHint === "organize" && (
                      <button
                        type="button"
                        onClick={() => void handleActionHint("organize")}
                        className="inline-flex items-center gap-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-[11px] font-medium text-[var(--text-primary)] hover:border-[var(--border-strong)]"
                      >
                        <FolderSync className="h-3 w-3" />
                        <span>打开整理体检</span>
                      </button>
                    )}

                    {item.actionHint === "admin" && (
                      <button
                        type="button"
                        onClick={() => void handleActionHint("admin")}
                        className="inline-flex items-center gap-1 rounded-xl bg-rose-500 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-rose-600"
                      >
                        <Shield className="h-3 w-3" />
                        <span>以管理员重启</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
