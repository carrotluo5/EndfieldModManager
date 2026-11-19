export type ThemeId = "rose-light" | "midnight-dark" | "endfield-dark" | "clean-light";
export type LaunchMode = "EFMI" | "XXMI" | "VANILLA";
export type CloseBehavior = "ask" | "minimize" | "quit";
export type NavTab = "characters" | "presets" | "personalization" | "settings";

export interface AppearanceSectionConfig {
  id: string;
  name: string;
  nameEn: string;
  coverPath: string;
  createdAt: string;
  updatedAt: string;
}

export interface AppConfig {
  modsPath: string;
  gamePath: string;
  xxmiPath: string;
  launchMode: LaunchMode;
  launchArgs: string;
  theme: ThemeId;
  customAccent: string;
  bgImages: string[];
  activeBgImage: string;
  bgBlur: number;
  bgOverlay: number;
  bgOpacity: number;
  sidebarZoom: number;
  sidebarCollapsed: boolean;
  compatLevel: number;
  closeBehavior: CloseBehavior;
  disclaimerDismissed: boolean;
  characterOrder: string[];
  pinnedCharacters: string[];
  pinnedMods: Record<string, string[]>;
  modOrders: Record<string, string[]>;
  characterSections: Record<string, AppearanceSectionConfig[]>;
  exclusiveByCategory: Record<string, boolean>;
  modAddedAt: Record<string, number>;
  showAllCharacters: boolean;
  overlayHotkey: string;
  overlayScale: number;
  overlayOpacity: number;
  overlayAutoReload: boolean;
  overlayPresetAutoReload: boolean;
  overlayClickableHotkeys: boolean;
  overlayAutoMinimizeMain: boolean;
  persistBridgeEnabled: boolean;
  persistBridgeCacheSize: number;
  persistBridgeRecent: string[];
  customFixerPath: string;
}

export interface CharacterItem {
  name: string;
  path: string;
  coverPath: string | null;
  coverMtime: number;
  modCount: number;
  enabledCount: number;
  pinned: boolean;
  aliases: string[];
  isNonCharacterCategory: boolean;
  sectionCount: number;
  existsOnDisk: boolean;
}

export interface AppearanceSection {
  id: string;
  name: string;
  nameEn: string;
  coverPath: string | null;
  coverMtime: number;
  isBase: boolean;
  modCount: number;
  enabledCount: number;
}

export interface ModItem {
  name: string;
  dirName: string;
  path: string;
  characterName: string;
  enabled: boolean;
  pinned: boolean;
  pinnedIndex: number | null;
  marked: boolean;
  previewPath: string | null;
  previewMtime: number;
  sectionId: string;
  tags: string[];
  notes: string;
  addedAtMs: number;
  requiresRabbitFx: boolean;
  isRabbitFx: boolean;
  isEffMod: boolean;
  hasConflict: boolean;
  conflictWith: string[];
}

export interface ConflictGroup {
  hash: string;
  mods: string[];
}

export interface ModListResponse {
  characterName: string;
  characterAliases: string[];
  mods: ModItem[];
  conflicts: ConflictGroup[];
  isNonCharacterCategory: boolean;
}

export interface HotkeyAlternative {
  original: string;
  displayKeys: string[];
  label: string;
  canApply: boolean;
  isPreferred: boolean;
}

export interface HotkeyItem {
  section: string;
  description: string;
  alias: string | null;
  keys: string[];
  rawKeys: string[];
  alternatives: HotkeyAlternative[];
  isMenu: boolean;
  canApply: boolean;
  iniRelPath: string;
}

export interface ModDetails {
  modItem: ModItem;
  hotkeys: HotkeyItem[];
  readmeText: string;
  iniFiles: string[];
  hasPersistBackup: boolean;
}

export interface RabbitFxModEntry {
  characterName: string;
  modName: string;
  dirName: string;
  path: string;
  enabled: boolean;
}

export interface RabbitFxStatus {
  enabledCount: number;
  enabledMods: RabbitFxModEntry[];
  allMods: RabbitFxModEntry[];
  status: "ok" | "missing" | "multiple";
}

export interface ToggleModResult {
  success: boolean;
  enabled: boolean;
  requiresRabbitFxConfirm: boolean;
  activeRabbitFx: RabbitFxModEntry[];
  message: string | null;
}

export interface XxmiConsistency {
  xxmiConfigFound: boolean;
  xxmiEfmiPath: string;
  modsParentPath: string;
  consistent: boolean;
  message: string;
}

export interface AutoDetectedPaths {
  modsPath: string | null;
  gamePath: string | null;
  xxmiPath: string | null;
}

export interface QaqmImportSummary {
  importedPaths: boolean;
  importedOrderCount: number;
  importedPresetCount: number;
  warnings: string[];
}

export interface TagPoolItem {
  id: string;
  name: string;
  color: string;
}

export interface TagsPoolStore {
  tags: TagPoolItem[];
}

export interface PersistBridgeStatus {
  enabled: boolean;
  cacheSize: number;
  d3dxMounted: boolean;
  activeStateCount: number;
  cacheFileCount: number;
  backupFileCount: number;
}

export interface PresetModEntry {
  characterName: string;
  modName: string;
  enabled: boolean;
}

export interface CatalogModEntry {
  name: string;
  enabled: boolean;
  isRabbitFx: boolean;
}

export interface CharacterModsCatalog {
  characterName: string;
  isNonCharacterCategory: boolean;
  mods: CatalogModEntry[];
}

export interface PresetItemView {
  id: string;
  name: string;
  description: string;
  mods: PresetModEntry[];
  createdAt: string;
  updatedAt: string;
  modCount: number;
  characterCount: number;
  missingCount: number;
  missingKeys: string[];
  rabbitFxCount: number;
}

export interface PresetListResponse {
  activePresetId: string | null;
  builtinNoModActive: boolean;
  presets: PresetItemView[];
}

export interface ModPreset {
  id: string;
  name: string;
  description: string;
  mods: PresetModEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface ApplyPresetResult {
  success: boolean;
  enabledCount: number;
  disabledCount: number;
  missingMods: string[];
  requiresRabbitFxConfirm: boolean;
  conflictRabbitFx: RabbitFxModEntry[];
  message: string;
}

export interface PresetImportResult {
  importedCount: number;
  skippedCount: number;
}

export interface UndoEntrySummary {
  id: string;
  label: string;
  changeCount: number;
  createdAt: string;
}

export interface UndoResult {
  undone: boolean;
  label: string;
  revertedCount: number;
}

export interface GameRuntimeStatus {
  gameRunning: boolean;
  gamePid: number | null;
  gameTitle: string;
  gameElevated: boolean;
  managerElevated: boolean;
  uipiBlocked: boolean;
  message: string;
}

export interface OverlayStateSnapshot {
  visible: boolean;
  pinned: boolean;
  sideMode: string;
  sideDetailWidth: number;
  selectedCharacter: string | null;
  selectedModName: string | null;
  overlayHotkey: string;
}

export interface NavigateToModPayload {
  characterName: string;
  modName: string;
}

export interface ImportAnalyzedItem {
  itemId: string;
  originalPath: string;
  stagedPath: string;
  displayName: string;
  importKind: string;
  suggestedCharacter: string | null;
  matchConfidence: string;
  suggestedModName: string;
  isEffMod: boolean;
  isDisguisedMp4: boolean;
  isLargeArchive: boolean;
  fileSizeBytes: number;
  warning: string | null;
}

export interface ImportAnalysisResponse {
  sessionId: string;
  items: ImportAnalyzedItem[];
  skippedMessages: string[];
}

export interface ImportPlanItem {
  itemId: string;
  targetCharacter: string;
  targetModName: string;
  targetSectionId: string;
  importKind: string;
  skip: boolean;
}

export interface ImportItemResult {
  itemId: string;
  modName: string;
  targetCharacter: string;
  success: boolean;
  message: string;
}

export interface ImportExecutionSummary {
  installedCount: number;
  skippedCount: number;
  failedCount: number;
  results: ImportItemResult[];
}

export interface LegacyMigrationItem {
  legacyName: string;
  targetName: string;
  modCount: number;
  legacyPath: string;
}

export interface MisplacedModItem {
  sourceCharacter: string;
  modName: string;
  dirName: string;
  suggestedCharacter: string;
  reason: string;
  path: string;
}

export interface DirtyItem {
  kind: string;
  name: string;
  path: string;
  parentCharacter: string | null;
  reason: string;
}

export interface OrganizeScanReport {
  missingDefaultCharacters: string[];
  legacyMigrations: LegacyMigrationItem[];
  misplacedMods: MisplacedModItem[];
  dirtyItems: DirtyItem[];
}

export interface OrganizeApplyResult {
  movedCount: number;
  quarantinedCount: number;
  migratedDirs: number;
  warnings: string[];
}

export interface FixBackupEntry {
  id: string;
  createdAt: string;
  fixerName: string;
  fileCount: number;
}

export interface FixerRunReport {
  backupCount: number;
  processedMods: number;
  modifiedFiles: number;
  logOutput: string;
}

export interface DiagnosticCheckItem {
  id: string;
  title: string;
  status: "ok" | "warn" | "error";
  summary: string;
  detail: string;
  fixable: boolean;
  actionHint: string;
}

export interface DiagnosticsReport {
  checkedAt: string;
  okCount: number;
  warnCount: number;
  errorCount: number;
  checks: DiagnosticCheckItem[];
}

export interface PackageUpdateResult {
  targetKind: string;
  copiedFiles: number;
  skippedProtectedPaths: string[];
  message: string;
}
