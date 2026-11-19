/**
 * Generates an offscreen-canvas pre-blurred Blob URL for a wallpaper image so
 * WebView2 does not re-evaluate expensive fullscreen CSS `filter: blur(...)` on
 * every animation frame.
 */
export async function createPreblurredBackgroundUrl(
  imageUrl: string,
  blurPx: number,
  maxWidth = 1920
): Promise<string | null> {
  if (!imageUrl || !Number.isFinite(blurPx) || blurPx <= 0.2) {
    return null;
  }

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.crossOrigin = "anonymous";
    el.decoding = "async";
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Failed to load background image for pre-blur"));
    el.src = imageUrl;
  });

  const naturalWidth = Math.max(1, img.naturalWidth || img.width || 1);
  const naturalHeight = Math.max(1, img.naturalHeight || img.height || 1);
  const scale = Math.min(1, maxWidth / naturalWidth);
  const targetWidth = Math.max(1, Math.round(naturalWidth * scale));
  const targetHeight = Math.max(1, Math.round(naturalHeight * scale));

  const viewportRef =
    typeof window !== "undefined" && window.innerWidth > 0 ? window.innerWidth : 1920;
  const effectiveBlur = Math.max(0.5, Math.min(64, blurPx * (targetWidth / viewportRef)));
  const overscan = Math.ceil(effectiveBlur * 2.5);

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) {
    return null;
  }

  ctx.fillStyle = "#090b10";
  ctx.fillRect(0, 0, targetWidth, targetHeight);
  ctx.filter = `blur(${effectiveBlur.toFixed(2)}px)`;
  // Overscan beyond the canvas frame so edge pixels blur with real image content instead of darkening.
  ctx.drawImage(
    img,
    -overscan,
    -overscan,
    targetWidth + overscan * 2,
    targetHeight + overscan * 2
  );
  ctx.filter = "none";

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((result) => resolve(result), "image/webp", 0.92);
  });

  if (!blob) {
    return null;
  }

  return URL.createObjectURL(blob);
}
