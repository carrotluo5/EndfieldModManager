import { useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  maxWidthClass?: string;
  closeOnBackdrop?: boolean;
  footer?: ReactNode;
  children: ReactNode;
}

const dialogStack: { panel: HTMLElement; zIndex: number }[] = [];
const focusableSelector =
  'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export function useModalLayer(open: boolean, onClose: () => void) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useLayoutEffect(() => { closeRef.current = onClose; }, [onClose]);

  useLayoutEffect(() => {
    const backdrop = backdropRef.current;
    const panel = panelRef.current;
    if (!open || !backdrop || !panel) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const parent = dialogStack.at(-1);
    const layer = { panel, zIndex: (parent?.zIndex ?? 49) + 1 };
    dialogStack.push(layer);
    if (parent) parent.panel.inert = true;
    backdrop.style.zIndex = String(layer.zIndex);
    backdrop.style.pointerEvents = "";
    if (!panel.contains(previous)) panel.focus({ preventScroll: true });

    const handleKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || dialogStack.at(-1) !== layer) return;
      if (event.key === "Escape" && !event.isComposing) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!event.repeat) closeRef.current();
      } else if (event.key === "Tab") {
        const focusable = Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector))
          .filter((item) => item.tabIndex >= 0 && item.getClientRects().length > 0);
        const first = focusable[0] ?? panel;
        const last = focusable.at(-1) ?? panel;
        const focused = document.activeElement;
        if (!panel.contains(focused) || focused === panel || focused === (event.shiftKey ? first : last)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus({ preventScroll: true });
        }
      }
    };
    window.addEventListener("keydown", handleKey);

    return () => {
      window.removeEventListener("keydown", handleKey);
      const wasTop = dialogStack.at(-1) === layer;
      const index = dialogStack.indexOf(layer);
      if (index >= 0) dialogStack.splice(index, 1);
      backdrop.style.pointerEvents = "none";
      panel.inert = false;
      if (!wasTop) return;
      const next = dialogStack.at(-1);
      if (next) next.panel.inert = false;
      if (document.activeElement !== document.body && !panel.contains(document.activeElement)) return;
      if (previous?.isConnected && !panel.contains(previous) && (!next || next.panel.contains(previous))) {
        previous.focus({ preventScroll: true });
      } else {
        next?.panel.focus({ preventScroll: true });
      }
    };
  }, [open]);

  return { backdropRef, panelRef };
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  maxWidthClass = "max-w-lg",
  closeOnBackdrop = true,
  footer,
  children,
}: ModalProps) {
  const titleId = useId();
  const { backdropRef, panelRef } = useModalLayer(open, onClose);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="modal-backdrop"
          ref={backdropRef}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onMouseDown={(e) => {
            if (closeOnBackdrop && e.target === e.currentTarget) {
              onClose();
            }
          }}
          className="modal-backdrop-blur fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <motion.div
            key="modal-panel"
            ref={panelRef}
            role="dialog"
            aria-modal={open || undefined}
            aria-labelledby={titleId}
            tabIndex={-1}
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 6 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            onMouseDown={(e) => e.stopPropagation()}
            className={`glass-surface-strong flex max-h-[88vh] w-full flex-col overflow-hidden rounded-2xl shadow-[var(--shadow-floating)] outline-none ${maxWidthClass}`}
          >
            <div className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] px-5 py-4">
              <div className="min-w-0">
                <h2 id={titleId} className="truncate text-base font-semibold text-[var(--text-primary)]">
                  {title}
                </h2>
                {subtitle && (
                  <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{subtitle}</p>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="关闭弹窗"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--text-primary)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

            {footer && (
              <div className="flex items-center justify-end gap-2.5 border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-5 py-3.5">
                {footer}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
