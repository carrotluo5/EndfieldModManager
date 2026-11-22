import { useState } from "react";
import { Minimize2, Power } from "lucide-react";
import { api } from "../../lib/tauri";
import { useAppStore } from "../../store/useAppStore";
import { Modal } from "../ui/Modal";

export function CloseConfirmModal() {
  const open = useAppStore((s) => s.closeModalOpen);
  const setCloseModalOpen = useAppStore((s) => s.setCloseModalOpen);
  const updateConfigPatch = useAppStore((s) => s.updateConfigPatch);
  const addToast = useAppStore((s) => s.addToast);

  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleClose = () => {
    if (busy) return;
    setCloseModalOpen(false);
  };

  const handleMinimize = async () => {
    setBusy(true);
    try {
      if (remember) {
        await updateConfigPatch({ closeBehavior: "minimize" });
      }
      setCloseModalOpen(false);
      await api.minimizeToTray();
    } catch (err) {
      addToast("error", String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleQuit = async () => {
    setBusy(true);
    try {
      if (remember) {
        await updateConfigPatch({ closeBehavior: "quit" });
      }
      setCloseModalOpen(false);
      await api.quitApp();
    } catch (err) {
      addToast("error", String(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="关闭窗口确认"
      subtitle="选择关闭主窗口后的处理方式（后续可在「设置」中修改）"
      maxWidthClass="max-w-md"
      footer={
        <>
          <button
            type="button"
            onClick={handleClose}
            disabled={busy}
            className="rounded-xl border border-[var(--border-subtle)] px-3.5 py-2 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleMinimize}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-strong)] bg-[var(--accent-soft)] px-4 py-2 text-xs font-semibold text-[var(--accent)] hover:bg-[var(--accent-fill)] hover:text-[var(--accent-contrast)]"
          >
            <Minimize2 className="h-3.5 w-3.5" />
            <span>最小化到托盘</span>
          </button>
          <button
            type="button"
            onClick={handleQuit}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--danger)] px-4 py-2 text-xs font-semibold text-white hover:opacity-90"
          >
            <Power className="h-3.5 w-3.5" />
            <span>彻底退出</span>
          </button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-[var(--text-secondary)]">
        <p className="leading-relaxed">
          最小化到系统托盘后，程序会保持低占用在后台待命；双击托盘图标可随时恢复窗口。
        </p>
        <label className="flex items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2.5 text-xs text-[var(--text-primary)]">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="h-3.5 w-3.5 accent-[var(--accent)]"
          />
          <span>记住我的选择，下次不再询问</span>
        </label>
      </div>
    </Modal>
  );
}
