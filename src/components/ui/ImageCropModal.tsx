import { useCallback, useEffect, useRef, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import "react-easy-crop/react-easy-crop.css";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ImagePlus, Upload } from "lucide-react";
import { buildMediaUrl } from "../../lib/tauri";
import { Modal } from "./Modal";

interface ImageCropModalProps {
  open: boolean;
  title: string;
  aspect?: number;
  initialImageUrl?: string | null;
  onClose: () => void;
  onConfirm: (dataUrl: string) => Promise<void> | void;
}

async function createImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!src.startsWith("data:") && !src.startsWith("blob:")) {
      img.crossOrigin = "anonymous";
    }
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片加载失败，无法进行裁剪"));
    img.src = src;
  });
}

async function getCroppedPngDataUrl(src: string, cropPixels: Area): Promise<string> {
  const image = await createImageElement(src);
  const maxOutputWidth = 640;
  const scale = cropPixels.width > maxOutputWidth ? maxOutputWidth / cropPixels.width : 1;
  const targetWidth = Math.max(1, Math.round(cropPixels.width * scale));
  const targetHeight = Math.max(1, Math.round(cropPixels.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("无法创建绘图上下文");
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    image,
    cropPixels.x,
    cropPixels.y,
    cropPixels.width,
    cropPixels.height,
    0,
    0,
    targetWidth,
    targetHeight
  );

  return canvas.toDataURL("image/png");
}

export function ImageCropModal({
  open,
  title,
  aspect = 303 / 386,
  initialImageUrl = null,
  onClose,
  onConfirm,
}: ImageCropModalProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [imageSrc, setImageSrc] = useState<string | null>(initialImageUrl);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setImageSrc(initialImageUrl);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedAreaPixels(null);
    setErrorMsg(null);
    setSaving(false);
  }, [open, initialImageUrl]);

  const handleCropComplete = useCallback((_area: Area, pixels: Area) => {
    setCroppedAreaPixels(pixels);
  }, []);

  const handlePickNativeFile = async () => {
    setErrorMsg(null);
    try {
      const selected = await openDialog({
        title: "选择图片文件",
        multiple: false,
        filters: [
          {
            name: "图片文件",
            extensions: ["png", "jpg", "jpeg", "webp", "bmp"],
          },
        ],
      });
      if (typeof selected === "string" && selected) {
        const mediaUrl = buildMediaUrl(selected, Date.now());
        if (mediaUrl) {
          setImageSrc(mediaUrl);
          setCrop({ x: 0, y: 0 });
          setZoom(1);
        }
      }
    } catch {
      fileInputRef.current?.click();
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setImageSrc(reader.result);
        setCrop({ x: 0, y: 0 });
        setZoom(1);
        setErrorMsg(null);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleConfirm = async () => {
    if (!imageSrc || !croppedAreaPixels) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      const dataUrl = await getCroppedPngDataUrl(imageSrc, croppedAreaPixels);
      await onConfirm(dataUrl);
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => { if (!saving) onClose(); }}
      title={title}
      subtitle="拖动调整裁剪区域，滚轮或滑条控制缩放"
      maxWidthClass="max-w-xl"
      footer={
        <>
          <button
            type="button"
            onClick={handlePickNativeFile}
            className="mr-auto inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-2 text-xs font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--accent-soft)]"
          >
            <Upload className="h-3.5 w-3.5" />
            <span>{imageSrc ? "重新选图" : "选择图片"}</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-xl border border-[var(--border-subtle)] px-4 py-2 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)]"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!imageSrc || !croppedAreaPixels || saving}
            className="rounded-xl bg-[var(--accent-fill)] px-4 py-2 text-xs font-semibold text-[var(--accent-contrast)] transition-colors hover:bg-[var(--accent-fill-hover)] disabled:cursor-not-allowed disabled:opacity-45"
          >
            {saving ? "保存中..." : "保存裁剪"}
          </button>
        </>
      }
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/bmp"
        onChange={handleFileInputChange}
        className="hidden"
      />

      {imageSrc ? (
        <div className="space-y-4">
          <div className="relative h-80 w-full overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-black/75">
            <Cropper
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              aspect={aspect}
              minZoom={1}
              maxZoom={3}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={handleCropComplete}
              mediaProps={{ crossOrigin: "anonymous" }}
            />
          </div>

          <div className="flex items-center gap-3 px-1">
            <span className="shrink-0 text-xs text-[var(--text-secondary)]">缩放比例</span>
            <input
              type="range"
              min={1}
              max={3}
              step={0.05}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="h-1.5 flex-1 accent-[var(--accent)]"
            />
            <span className="w-12 text-right text-xs font-medium tabular-nums text-[var(--text-primary)]">
              {zoom.toFixed(2)}x
            </span>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={handlePickNativeFile}
          className="flex h-64 w-full flex-col items-center justify-center gap-2.5 rounded-xl border-2 border-dashed border-[var(--border-strong)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
        >
          <ImagePlus className="h-9 w-9 opacity-80" />
          <span className="text-sm font-medium">点击选择本地图片进行裁剪</span>
          <span className="text-xs text-[var(--text-muted)]">支持 PNG / JPG / WEBP / BMP</span>
        </button>
      )}

      {errorMsg && (
        <p className="mt-3 rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-xs text-[var(--danger)]">
          {errorMsg}
        </p>
      )}
    </Modal>
  );
}
