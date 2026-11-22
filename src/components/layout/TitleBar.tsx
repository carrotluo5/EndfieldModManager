import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";

const appIcon = new URL("../../../src-tauri/icons/32x32.png", import.meta.url).href;

export function TitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    try {
      const win = getCurrentWindow();
      void win
        .isMaximized()
        .then(setMaximized)
        .catch(() => {});
      void win
        .onResized(() => {
          void win
            .isMaximized()
            .then(setMaximized)
            .catch(() => {});
        })
        .then((fn) => {
          unlisten = fn;
        })
        .catch(() => {});
    } catch {
      // Browser preview fallback
    }
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const handleMinimize = () => {
    try {
      void getCurrentWindow().minimize();
    } catch {
      // Ignore outside Tauri
    }
  };

  const handleToggleMaximize = () => {
    try {
      void getCurrentWindow().toggleMaximize();
    } catch {
      // Ignore outside Tauri
    }
  };

  const handleClose = () => {
    try {
      void getCurrentWindow().close();
    } catch {
      // Ignore outside Tauri
    }
  };

  return (
    <header
      data-tauri-drag-region
      onDoubleClick={handleToggleMaximize}
      className="glass-surface-strong relative z-30 flex h-9 shrink-0 items-center justify-between border-x-0 border-t-0 px-3"
    >
      <div
        data-tauri-drag-region
        className="pointer-events-none flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]"
      >
        <img src={appIcon} alt="" className="h-5 w-5 rounded-md" />
        <span className="tracking-tight">Endfield Mod Manager</span>
        <span className="rounded-md bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-[var(--accent)]">
          EFMI
        </span>
      </div>

      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={handleMinimize}
          aria-label="最小化"
          title="最小化"
          className="flex h-7 w-9 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--text-primary)]"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={handleToggleMaximize}
          aria-label={maximized ? "还原窗口" : "最大化窗口"}
          title={maximized ? "还原窗口" : "最大化窗口"}
          className="flex h-7 w-9 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--text-primary)]"
        >
          {maximized ? <Copy className="h-3 w-3" /> : <Square className="h-3 w-3" />}
        </button>
        <button
          type="button"
          onClick={handleClose}
          aria-label="关闭窗口"
          title="关闭"
          className="flex h-7 w-9 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-[var(--danger)] hover:text-white"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </header>
  );
}
