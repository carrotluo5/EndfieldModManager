import type { ModItem } from "../types/mod";

export interface CollectionVariant extends ModItem {
  collectionIdentity: string;
  collectionName: string;
  collectionVariantName: string;
  collectionVersionLabel: string;
  collectionOriginalIndex: number;
}

export interface ModCollectionGroup {
  identity: string;
  name: string;
  variants: CollectionVariant[];
}

export interface DisplayModItem extends ModItem {
  collection?: ModCollectionGroup;
  collectionVariantLabel?: string;
}

function cleanText(val: string | undefined): string {
  return String(val ?? "").trim().replace(/\s+/g, " ");
}

function normalizeKey(val: string | undefined): string {
  return cleanText(val)
    .toLowerCase()
    .replace(/[【】[\]（）(){}<>《》"'`]/g, "")
    .replace(/[\s_\-－–—.:：/\\]+/g, "");
}

function buildPrefixKeys(characterName: string, aliases: string[] = []): string[] {
  return Array.from(new Set([characterName, ...aliases].map(normalizeKey).filter(Boolean)));
}

function splitNameParts(name: string): string[] {
  return cleanText(name)
    .replace(/^DISABLED_/i, "")
    .split(/[-－–—]+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function stripVersion(value: string): { text: string; version: string } {
  const text = cleanText(value);
  if (!text) return { text: "", version: "" };

  const compact = text.match(/^(.*?)(v\s*\d+(?:\.\d+){0,3}[a-z]?)$/i);
  if (compact && cleanText(compact[1])) {
    return {
      text: cleanText(compact[1]).replace(/[-_－–—\s]+$/, ""),
      version: compact[2],
    };
  }

  const separated = text.match(/^(.*?)[\s_\-－–—]+(\d+(?:\.\d+){1,3}[a-z]?)$/i);
  if (separated && cleanText(separated[1])) {
    return {
      text: cleanText(separated[1]).replace(/[-_－–—\s]+$/, ""),
      version: separated[2],
    };
  }

  return { text, version: "" };
}

function normalizeVersionLabel(value: string): string {
  const text = cleanText(value);
  if (!text) return "";
  const collapsed = text.replace(/^v+/i, "v");
  const m = collapsed.match(/^v?\s*(\d+(?:\.\d+){0,3}[a-z]?)$/i);
  if (m) return `V${m[1]}`;
  return text.replace(/^v/i, "V");
}

function parseVersionWeight(value: string) {
  const text = normalizeVersionLabel(value);
  const m = text.match(/^V(\d+(?:\.\d+){0,3})([a-z]?)$/i);
  if (!m) return { parts: [0], suffix: "", hasVersion: false };
  const rawParts = m[1].split(".");
  const parts =
    rawParts.length === 2 && /^\d{2}$/.test(rawParts[1])
      ? [rawParts[0], rawParts[1][0], rawParts[1][1]]
      : rawParts;
  return {
    parts: parts.map((p) => Number(p) || 0),
    suffix: m[2] || "",
    hasVersion: true,
  };
}

function compareVersions(left: string, right: string): number {
  const a = parseVersionWeight(left);
  const b = parseVersionWeight(right);
  if (a.hasVersion !== b.hasVersion) return a.hasVersion ? -1 : 1;
  const max = Math.max(a.parts.length, b.parts.length);
  for (let i = 0; i < max; i += 1) {
    const diff = (b.parts[i] || 0) - (a.parts[i] || 0);
    if (diff !== 0) return diff;
  }
  return a.suffix.localeCompare(b.suffix, "zh-CN");
}

export function getCollectionVariantLabel(variant: {
  collectionVersionLabel?: string;
  collectionVariantName?: string;
}): string {
  const ver = cleanText(variant.collectionVersionLabel);
  const name = cleanText(variant.collectionVariantName);
  if (ver && name) return `${ver} · ${name}`;
  return ver || name || "V1.0";
}

function parseModCollection(mod: ModItem, characterName: string, aliases: string[]) {
  const name = cleanText(mod.name);
  if (!name) return null;
  const parts = splitNameParts(name);
  if (parts.length < 1) return null;

  const charKeys = buildPrefixKeys(characterName, aliases);
  const hasCharPrefix = charKeys.includes(normalizeKey(parts[0]));
  const body = hasCharPrefix ? parts.slice(1) : parts;
  if (!body.length) return null;

  const base = stripVersion(body[0]);
  const collectionName = cleanText(base.text || body[0]);
  if (!collectionName) return null;

  let version = normalizeVersionLabel(base.version);
  const variantParts: string[] = [];
  for (const part of body.slice(1)) {
    const stripped = stripVersion(part);
    const explicitVer = normalizeVersionLabel(stripped.version || part);
    const pureVer = /^v?\s*\d+(?:\.\d+){0,3}[a-z]?$/i.test(cleanText(part));
    if (!version && (stripped.version || pureVer)) {
      version = explicitVer;
    }
    if (stripped.text && !pureVer) {
      variantParts.push(stripped.text);
    }
  }

  return {
    mod,
    collectionName,
    collectionKey: normalizeKey(collectionName),
    variantName: cleanText(variantParts.join("-")),
    variantVersion: version,
  };
}

export function buildModCollectionView(
  sortedMods: ModItem[],
  characterName: string,
  characterAliases: string[],
  selectedVariants: Record<string, string>
): DisplayModItem[] {
  const charIdKey = buildPrefixKeys(characterName, characterAliases)[0] || normalizeKey(characterName);
  const records = sortedMods
    .map((mod, index) => {
      const parsed = parseModCollection(mod, characterName, characterAliases);
      return parsed ? { ...parsed, index } : null;
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const candidateNames = new Map(records.map((r) => [r.collectionKey, r.collectionName]));
  const groups = new Map<
    string,
    { identity: string; name: string; records: typeof records; variants: CollectionVariant[] }
  >();
  const identityByModName = new Map<string, string>();

  for (const rec of records) {
    let collectionKey = rec.collectionKey;
    let collectionName = rec.collectionName;
    for (const [candKey, candName] of candidateNames.entries()) {
      if (!candKey || candKey === collectionKey || candKey.length < 2) continue;
      if (collectionKey.startsWith(candKey)) {
        collectionKey = candKey;
        collectionName = candName;
        break;
      }
    }

    let variantName = rec.variantName;
    if (!variantName && collectionName !== rec.collectionName) {
      const suffix = cleanText(rec.collectionName.slice(collectionName.length));
      if (suffix) variantName = suffix;
    }

    const identity = `${charIdKey}:${collectionKey}`;
    if (!groups.has(identity)) {
      groups.set(identity, { identity, name: collectionName, records: [], variants: [] });
    }
    groups.get(identity)!.records.push({
      ...rec,
      collectionName,
      collectionKey,
      variantName,
    });
    identityByModName.set(rec.mod.name, identity);
  }

  for (const [identity, group] of groups.entries()) {
    const hasV10 = group.records.some(
      (r) => normalizeVersionLabel(r.variantVersion) === "V1.0"
    );
    group.variants = group.records
      .map((r) => {
        const version = normalizeVersionLabel(r.variantVersion) || (hasV10 ? "V0.5" : "V1.0");
        return {
          ...r.mod,
          collectionIdentity: identity,
          collectionName: group.name,
          collectionVariantName: r.variantName,
          collectionVersionLabel: version,
          collectionOriginalIndex: r.index,
        };
      })
      .sort(
        (a, b) =>
          compareVersions(a.collectionVersionLabel, b.collectionVersionLabel) ||
          cleanText(a.collectionVariantName).localeCompare(
            cleanText(b.collectionVariantName),
            "zh-CN"
          ) ||
          a.collectionOriginalIndex - b.collectionOriginalIndex
      );
  }

  const display: DisplayModItem[] = [];
  const displayedIds = new Set<string>();

  for (const mod of sortedMods) {
    const identity = identityByModName.get(mod.name);
    const group = identity ? groups.get(identity) : undefined;
    if (!group || group.variants.length < 2) {
      display.push(mod);
      continue;
    }
    if (displayedIds.has(identity!)) continue;
    displayedIds.add(identity!);

    const chosenName = selectedVariants[identity!];
    const selected =
      group.variants.find((v) => v.name === chosenName) ||
      group.variants.find((v) => v.enabled) ||
      group.variants[0];

    display.push({
      ...selected,
      collection: {
        identity: group.identity,
        name: group.name,
        variants: group.variants,
      },
      collectionVariantLabel: selected.collectionVersionLabel,
    });
  }

  return display;
}
