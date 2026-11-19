import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { RotateCcw, X, ZoomIn, ZoomOut } from "lucide-react";

interface LightboxModalProps {
  open: boolean;
  src: string | null;
  title?: string;
  onClose: () => void;
}

export function LightboxModal({ open, src, title, onClose }: LightboxModalProps) {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    if (!open) return;
    setScale(1);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !src) return null;

  return createPortal(
    <div
      onMouseDown={onClose}
      onWheel={(e) => {
        e.preventDefault();
        setScale((prev) => {
          const next = e.deltaY < 0 ? prev + 0.15 : prev - 0.15;
          return Math.min(3.5, Math.max(0.5, Number(next.toFixed(2))));
        });
      }}
      className="fixed inset-0 z-[75] flex flex-col bg-black/82 backdrop-blur-md"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="flex items-center justify-between px-5 py-3 text-white"
      >
        <div className="truncate text-sm font-medium opacity-90">{title || "图片预览"}</div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setScale((s) => Math.max(0.5, Number((s - 0.25).toFixed(2))))}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20"
            title="缩小"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="w-12 text-center text-xs tabular-nums">
            {Math.round(scale * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setScale((s) => Math.min(3.5, Number((s + 0.25).toFixed(2))))}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20"
            title="放大"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setScale(1)}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20"
            title="重置比例"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="ml-1 flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 hover:bg-rose-500/80"
            title="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center overflow-hidden p-6">
        <img
          src={src}
          alt={title || "预览图"}
          onMouseDown={(e) => e.stopPropagation()}
          style={{ transform: `scale(${scale})` }}
          className="max-h-full max-w-full rounded-lg object-contain shadow-2xl transition-transform duration-150"
        />
      </div>
    </div>,
    document.body
  );
}
