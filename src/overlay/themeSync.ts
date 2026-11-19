import type { AppConfig, ThemeId } from "../types/mod";

function hexToRgba(hex: string, alpha: number): string | null {
  const cleaned = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return null;
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function isDarkTheme(theme: ThemeId | undefined): boolean {
  return theme === "midnight-dark" || theme === "endfield-dark";
}

export function applyThemeToDocument(config: AppConfig | null) {
  const root = document.documentElement;
  if (!config) {
    root.dataset.theme = "rose-light";
    root.dataset.compatLevel = "0";
    return;
  }

  root.dataset.theme = config.theme || "rose-light";
  root.dataset.compatLevel = String(config.compatLevel ?? 0);

  const accent = config.customAccent?.trim();
  if (accent) {
    root.style.setProperty("--accent", accent);
    root.style.setProperty("--accent-hover", accent);
    const soft = hexToRgba(accent, 0.16);
    if (soft) root.style.setProperty("--accent-soft", soft);
  } else {
    root.style.removeProperty("--accent");
    root.style.removeProperty("--accent-hover");
    root.style.removeProperty("--accent-soft");
  }
}

export function getOverlayPanelBg(config: AppConfig | null): string {
  const opacity = Math.max(0.2, Math.min(1, (config?.overlayOpacity ?? 90) / 100));
  if (isDarkTheme(config?.theme)) {
    if (config?.theme === "endfield-dark") {
      return `rgba(16, 20, 28, ${opacity})`;
    }
    return `rgba(18, 24, 36, ${opacity})`;
  }
  return `rgba(255, 250, 252, ${opacity})`;
}
