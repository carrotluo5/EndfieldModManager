import { pinyin } from "pinyin-pro";

function normalizeQuery(text: string): string {
  return text.trim().toLowerCase();
}

export function matchesSearch(text: string, aliases: string[], query: string): boolean {
  const q = normalizeQuery(query);
  if (!q) return true;

  const candidates = [text, ...aliases].filter(Boolean);
  for (const cand of candidates) {
    if (cand.toLowerCase().includes(q)) return true;
  }

  if (/^[a-z0-9\s]+$/.test(q)) {
    const compactQ = q.replace(/\s+/g, "");
    try {
      const fullPy = pinyin(text, { toneType: "none", type: "array" })
        .join("")
        .toLowerCase();
      if (fullPy.includes(compactQ)) return true;

      const initials = pinyin(text, { pattern: "first", toneType: "none", type: "array" })
        .join("")
        .toLowerCase();
      if (initials.includes(compactQ)) return true;
    } catch {
      // Fallback safely
    }
  }

  return false;
}
