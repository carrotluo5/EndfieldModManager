import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2, Info, AlertTriangle, X, XCircle } from "lucide-react";
import { useAppStore } from "../../store/useAppStore";

export function ToastHost() {
  const toasts = useAppStore((s) => s.toasts);
  const removeToast = useAppStore((s) => s.removeToast);

  return createPortal(
    <div className="pointer-events-none fixed right-4 bottom-4 z-[80] flex max-w-sm flex-col gap-2">
      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => {
          const toneClass =
            toast.type === "success"
              ? "border-[var(--success)]/40 text-[var(--success)]"
              : toast.type === "error"
                ? "border-[var(--danger)]/45 text-[var(--danger)]"
                : toast.type === "warning"
                  ? "border-[var(--warning)]/45 text-[var(--warning)]"
                  : "border-[var(--accent)]/40 text-[var(--accent)]";

          const Icon =
            toast.type === "success"
              ? CheckCircle2
              : toast.type === "error"
                ? XCircle
                : toast.type === "warning"
                  ? AlertTriangle
                  : Info;

          return (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0, y: 12, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24, scale: 0.96 }}
              transition={{ type: "spring", stiffness: 460, damping: 34 }}
              className={`glass-surface-strong pointer-events-auto flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 shadow-[var(--shadow-floating)] ${toneClass}`}
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="flex-1 text-xs leading-relaxed text-[var(--text-primary)]">
                {toast.message}
              </p>
              <button
                type="button"
                onClick={() => removeToast(toast.id)}
                aria-label="关闭通知"
                className="rounded p-0.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--text-primary)]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>,
    document.body
  );
}
