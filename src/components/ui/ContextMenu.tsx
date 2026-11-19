import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";

export type ContextMenuItem =
  | {
      divider: true;
      key?: string;
    }
  | {
      divider?: false;
      key: string;
      label: string;
      icon?: ReactNode;
      shortcut?: string;
      danger?: boolean;
      disabled?: boolean;
      onClick: () => void;
    };

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

interface ContextMenuProps {
  menu: ContextMenuState | null;
  onClose: () => void;
}

export function ContextMenu({ menu, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });

  useEffect(() => {
    if (!menu) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const estWidth = menuRef.current?.offsetWidth ?? 228;
    const estHeight = menuRef.current?.offsetHeight ?? Math.min(420, menu.items.length * 36 + 16);

    const left = Math.max(8, Math.min(menu.x, vw - estWidth - 8));
    const top = Math.max(8, Math.min(menu.y, vh - estHeight - 8));
    setPos({ left, top });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;

    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const handleDismiss = () => onClose();

    window.addEventListener("mousedown", handleMouseDown, true);
    window.addEventListener("keydown", handleKey);
    window.addEventListener("resize", handleDismiss);
    window.addEventListener("scroll", handleDismiss, true);
    return () => {
      window.removeEventListener("mousedown", handleMouseDown, true);
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("resize", handleDismiss);
      window.removeEventListener("scroll", handleDismiss, true);
    };
  }, [menu, onClose]);

  return createPortal(
    <AnimatePresence>
      {menu && (
        <motion.div
          key="ctx-menu-panel"
          ref={menuRef}
          initial={{ opacity: 0, scale: 0.96, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.12, ease: "easeOut" }}
          style={{ left: pos.left, top: pos.top }}
          onContextMenu={(e) => e.preventDefault()}
          className="glass-surface-strong fixed z-[70] min-w-[216px] max-w-[300px] rounded-xl p-1.5 shadow-[var(--shadow-floating)]"
        >
          {menu.items.map((item, idx) => {
            if (item.divider) {
              return (
                <div
                  key={item.key ?? `div-${idx}`}
                  className="my-1 border-t border-[var(--border-subtle)]"
                />
              );
            }
            return (
              <button
                key={item.key}
                type="button"
                disabled={item.disabled}
                onClick={() => {
                  if (item.disabled) return;
                  onClose();
                  item.onClick();
                }}
                className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-xs font-medium whitespace-nowrap transition-colors ${
                  item.disabled
                    ? "cursor-not-allowed opacity-45"
                    : item.danger
                      ? "text-[var(--danger)] hover:bg-[var(--danger-soft)]"
                      : "text-[var(--text-primary)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
                }`}
              >
                <span className="flex items-center gap-2 whitespace-nowrap">
                  {item.icon && <span className="shrink-0 opacity-85">{item.icon}</span>}
                  <span className="whitespace-nowrap">{item.label}</span>
                </span>
                {item.shortcut && (
                  <span className="shrink-0 text-[10px] text-[var(--text-muted)]">
                    {item.shortcut}
                  </span>
                )}
              </button>
            );
          })}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
