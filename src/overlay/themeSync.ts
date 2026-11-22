import type { AppConfig, ThemeId } from "../types/mod";

function accentChannels(hex: string | undefined): number[] | null {
  const value = hex?.trim().replace(/^#/, "") ?? "";
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return null;
  return [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16));
}

export function isDarkTheme(theme: ThemeId | undefined): boolean {
  return theme === "midnight-dark" || theme === "endfield-dark";
}

export function applyThemeToDocument(config: AppConfig | null) {
  const root = document.documentElement;
  root.dataset.theme = config?.theme || "rose-light";
  root.dataset.compatLevel = String(config?.compatLevel ?? 0);
  const channels = accentChannels(config?.customAccent);
  if (channels) {
    const accent = `rgb(${channels.join(", ")})`;
    const [red, green, blue] = channels.map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    root.style.setProperty("--accent", accent);
    root.style.setProperty("--accent-hover", accent);
    root.style.setProperty("--custom-accent", accent);
    root.style.setProperty("--accent-soft", `rgba(${channels.join(", ")}, 0.16)`);
    root.style.setProperty("--accent-contrast", luminance > 0.179 ? "#161016" : "#ffffff");
  } else {
    root.style.removeProperty("--accent");
    root.style.removeProperty("--accent-hover");
    root.style.removeProperty("--custom-accent");
    root.style.removeProperty("--accent-soft");
    root.style.removeProperty("--accent-contrast");
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
  return `rgba(251, 248, 249, ${opacity})`;
}
