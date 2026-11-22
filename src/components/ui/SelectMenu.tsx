import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

export interface SelectMenuOption<T extends string = string> {
  value: T;
  label: string;
  disabled?: boolean;
}

interface SelectMenuProps<T extends string> {
  value: T;
  options: readonly SelectMenuOption<T>[];
  onChange: (value: T) => void;
  id?: string;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
  size?: "default" | "compact";
  "aria-label"?: string;
  "aria-labelledby"?: string;
}

interface MenuPosition {
  host: HTMLElement;
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  above: boolean;
}

const VIEWPORT_MARGIN = 8;
const MENU_GAP = 6;

export function SelectMenu<T extends string>({
  value,
  options,
  onChange,
  id,
  className = "",
  disabled = false,
  placeholder = "请选择",
  size = "default",
  "aria-label": label,
  "aria-labelledby": labelledBy,
}: SelectMenuProps<T>) {
  const menuId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const search = useRef({ text: "", time: 0 });
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const reducedMotion = useReducedMotion();
  const selectedIndex = options.findIndex((option) => option.value === value);
  const enabledIndices = options.flatMap((option, index) => option.disabled ? [] : [index]);
  const compact = size === "compact";
  const open = position !== null && !disabled && enabledIndices.length > 0;

  const close = () => {
    search.current.text = "";
    setPosition(null);
  };

  const openMenu = (index: number) => {
    const node = trigger.current;
    if (!node || disabled || enabledIndices.length === 0) return;
    const rect = node.getBoundingClientRect();
    const host = node.closest('[role="dialog"]')?.parentElement ?? document.body;
    const availableBelow = window.innerHeight - rect.bottom - MENU_GAP - VIEWPORT_MARGIN;
    const availableAbove = rect.top - MENU_GAP - VIEWPORT_MARGIN;
    const naturalHeight = Math.min(272, options.length * (compact ? 32 : 38) + 10);
    const above = availableBelow < naturalHeight && availableAbove > availableBelow;
    const width = Math.min(window.innerWidth - VIEWPORT_MARGIN * 2, Math.max(rect.width, compact ? 132 : 168));
    setActiveIndex(index);
    setPosition({
      host,
      left: Math.max(VIEWPORT_MARGIN, Math.min(rect.left, window.innerWidth - width - VIEWPORT_MARGIN)),
      top: above ? rect.top - MENU_GAP : rect.bottom + MENU_GAP,
      width,
      maxHeight: Math.max(0, Math.min(naturalHeight, above ? availableAbove : availableBelow)),
      above,
    });
  };

  const select = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    close();
    if (option.value !== value) onChange(option.value);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const { key } = event;
    if (disabled || event.nativeEvent.isComposing || enabledIndices.length === 0) return;
    if (key === "Tab") {
      close();
      return;
    }
    if (key === "Escape" && !open) return;
    const printable =
      Array.from(key).length === 1 && key !== " " && !event.altKey && !event.ctrlKey && !event.metaKey;
    if (!printable && !["ArrowDown", "ArrowUp", "Home", "End", "Enter", " ", "Escape"].includes(key)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (key === "Escape") {
      if (!event.repeat) close();
      return;
    }
    if (key === "Enter" || key === " ") {
      if (open) select(activeIndex);
      else openMenu(enabledIndices.includes(selectedIndex) ? selectedIndex : enabledIndices[0]);
      return;
    }
    if (printable) {
      const now = Date.now();
      const char = key.toLocaleLowerCase();
      const previous = now - search.current.time < 650 ? search.current.text : "";
      const prefix = previous === char ? char : previous + char;
      search.current = { text: prefix, time: now };
      const current = enabledIndices.indexOf(open ? activeIndex : selectedIndex);
      const start = prefix.length === 1 ? current + 1 : Math.max(0, current);
      const ordered = [...enabledIndices.slice(start), ...enabledIndices.slice(0, start)];
      const match = ordered.find((index) => options[index].label.toLocaleLowerCase().startsWith(prefix));
      if (match === undefined) return;
      if (open) setActiveIndex(match);
      else openMenu(match);
      return;
    }
    if (key === "Home" || key === "End") {
      const next = key === "Home" ? enabledIndices[0] : enabledIndices[enabledIndices.length - 1];
      if (open) setActiveIndex(next);
      else openMenu(next);
      return;
    }
    const direction = key === "ArrowUp" ? -1 : 1;
    if (!open) {
      openMenu(enabledIndices.includes(selectedIndex)
        ? selectedIndex
        : enabledIndices[direction > 0 ? 0 : enabledIndices.length - 1]);
      return;
    }
    const index = enabledIndices.indexOf(activeIndex);
    setActiveIndex(enabledIndices[Math.max(0, Math.min(enabledIndices.length - 1, index + direction))]);
  };

  useLayoutEffect(() => {
    const list = menu.current;
    const active = list?.querySelector<HTMLElement>('[data-active="true"]');
    if (!open || !list || !active) return;
    const bottom = active.offsetTop + active.offsetHeight;
    if (active.offsetTop < list.scrollTop) list.scrollTop = active.offsetTop;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }, [activeIndex, open]);

  useEffect(() => {
    if (!open) return;
    const dismissOnOutsidePointer = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!trigger.current?.contains(event.target) && !menu.current?.contains(event.target)) close();
    };
    const dismissOnParentScroll = (event: Event) => {
      if (!(event.target instanceof Node) || !menu.current?.contains(event.target)) close();
    };
    document.addEventListener("pointerdown", dismissOnOutsidePointer, true);
    window.addEventListener("scroll", dismissOnParentScroll, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("pointerdown", dismissOnOutsidePointer, true);
      window.removeEventListener("scroll", dismissOnParentScroll, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) close();
  }, [disabled]);

  const selectedLabel = options[selectedIndex]?.label ?? placeholder;
  const optionId = (index: number) => `${menuId}-${index}`;
  return (
    <>
      <button
        ref={trigger}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        aria-label={label}
        aria-labelledby={labelledBy}
        disabled={disabled || enabledIndices.length === 0}
        data-select-menu-trigger
        onClick={(event) => {
          event.stopPropagation();
          event.currentTarget.focus({ preventScroll: true });
          if (open) close();
          else openMenu(enabledIndices.includes(selectedIndex) ? selectedIndex : enabledIndices[0]);
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onBlur={close}
        onKeyDown={handleKeyDown}
        className={`inline-flex min-w-0 items-center justify-between gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-left font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] aria-expanded:border-[var(--accent)] disabled:opacity-55 ${compact ? "min-h-7 px-2 text-[11px]" : "min-h-9 px-3 text-xs"} ${className}`}
      >
        <span className="min-w-0 truncate" title={selectedLabel}>{selectedLabel}</span>
        <ChevronDown aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 text-[var(--text-secondary)] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && position && createPortal(
        <div
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          className="fixed z-[65]"
          style={{
            left: position.left,
            top: position.top,
            width: position.width,
            transform: position.above ? "translateY(-100%)" : undefined,
          }}
        >
          <motion.div
            ref={menu}
            id={menuId}
            role="listbox"
            aria-label={label}
            aria-labelledby={labelledBy}
            initial={reducedMotion ? false : { opacity: 0, scale: 0.98, y: position.above ? 3 : -3 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.13 }}
            className="glass-surface-strong relative overflow-y-auto overscroll-contain rounded-xl p-1 shadow-[var(--shadow-floating)]"
            style={{ maxHeight: position.maxHeight, transformOrigin: position.above ? "bottom" : "top" }}
          >
            {options.map((option, index) => (
              <div
                key={option.value}
                id={optionId(index)}
                role="option"
                aria-selected={index === selectedIndex}
                aria-disabled={option.disabled || undefined}
                data-active={index === activeIndex}
                onPointerMove={() => { if (!option.disabled) setActiveIndex(index); }}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => select(index)}
                className={`flex items-center gap-2 rounded-lg px-2.5 leading-snug text-[var(--text-primary)] transition-colors aria-selected:font-semibold data-[active=true]:bg-[var(--accent-soft)] aria-disabled:cursor-not-allowed aria-disabled:opacity-50 ${compact ? "min-h-8 text-[11px]" : "min-h-9 text-xs"} ${option.disabled ? "" : "cursor-pointer"}`}
              >
                <span className="min-w-0 flex-1 break-words">{option.label}</span>
                {index === selectedIndex && <Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />}
              </div>
            ))}
          </motion.div>
        </div>,
        position.host,
      )}
    </>
  );
}
