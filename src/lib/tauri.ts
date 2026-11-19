import { invoke } from "@tauri-apps/api/core";
import type {
  AppConfig,
  AppearanceSection,
  AppearanceSectionConfig,
  ApplyPresetResult,
  AutoDetectedPaths,
  CharacterItem,
  CharacterModsCatalog,
  DiagnosticsReport,
  FixBackupEntry,
  FixerRunReport,
  GameRuntimeStatus,
  ImportAnalysisResponse,
  ImportExecutionSummary,
  ImportPlanItem,
  ModDetails,
  ModListResponse,
  ModPreset,
  OrganizeApplyResult,
  OrganizeScanReport,
  OverlayStateSnapshot,
  PackageUpdateResult,
  PersistBridgeStatus,
  PresetImportResult,
  PresetListResponse,
  PresetModEntry,
  QaqmImportSummary,
  RabbitFxStatus,
  TagsPoolStore,
  ToggleModResult,
  UndoEntrySummary,
  UndoResult,
  XxmiConsistency,
} from "../types/mod";

export function buildMediaUrl(path?: string | null, mtime?: number): string | null {
  if (!path || !path.trim()) return null;
  const v = mtime && mtime > 0 ? mtime : 0;
  return `http://efmm-media.localhost/?path=${encodeURIComponent(path)}&v=${v}`;
}

export const api = {
  getConfig: () => invoke<AppConfig>("get_config"),
  updateConfig: (patch: Partial<AppConfig>) => invoke<AppConfig>("update_config", { patch }),
  importFromQaqmanager: () => invoke<QaqmImportSummary>("import_from_qaqmanager"),
  getPresetCount: () => invoke<number>("get_preset_count"),
  getTagsPool: () => invoke<TagsPoolStore>("get_tags_pool"),
  saveTagsPool: (store: TagsPoolStore) => invoke<void>("save_tags_pool", { store }),

  autoDetectPaths: () => invoke<AutoDetectedPaths>("auto_detect_paths"),
  checkXxmiConsistency: () => invoke<XxmiConsistency>("check_xxmi_consistency"),
  launchGame: (mode?: string) => invoke<void>("launch_game", { mode: mode ?? null }),
  openPathInExplorer: (path: string) => invoke<void>("open_path_in_explorer", { path }),

  listCharacters: () => invoke<CharacterItem[]>("list_characters"),
  addCharacter: (name: string, coverDataUrl?: string | null) =>
    invoke<CharacterItem>("add_character", { name, coverDataUrl: coverDataUrl ?? null }),
  renameCharacter: (oldName: string, newName: string) =>
    invoke<void>("rename_character", { oldName, newName }),
  deleteCharacter: (characterName: string) =>
    invoke<void>("delete_character", { characterName }),
  setCharacterCoverData: (characterName: string, dataUrl: string) =>
    invoke<[string, number]>("set_character_cover_data", { characterName, dataUrl }),
  setCharacterCoverFile: (characterName: string, filePath: string) =>
    invoke<[string, number]>("set_character_cover_file", { characterName, filePath }),
  saveCharacterOrder: (order: string[]) => invoke<void>("save_character_order", { order }),
  togglePinCharacter: (characterName: string, pinned: boolean) =>
    invoke<void>("toggle_pin_character", { characterName, pinned }),

  listAppearanceSections: (characterName: string) =>
    invoke<AppearanceSection[]>("list_appearance_sections", { characterName }),
  createAppearanceSection: (
    characterName: string,
    name: string,
    nameEn: string,
    coverDataUrl?: string | null
  ) =>
    invoke<AppearanceSectionConfig>("create_appearance_section", {
      characterName,
      name,
      nameEn,
      coverDataUrl: coverDataUrl ?? null,
    }),
  updateAppearanceSection: (
    characterName: string,
    sectionId: string,
    name: string,
    nameEn: string,
    coverDataUrl?: string | null,
    clearCover = false
  ) =>
    invoke<void>("update_appearance_section", {
      characterName,
      sectionId,
      name,
      nameEn,
      coverDataUrl: coverDataUrl ?? null,
      clearCover,
    }),
  deleteAppearanceSection: (characterName: string, sectionId: string) =>
    invoke<number>("delete_appearance_section", { characterName, sectionId }),

  listMods: (characterName: string) => invoke<ModListResponse>("list_mods", { characterName }),
  toggleMod: (
    characterName: string,
    modName: string,
    enable: boolean,
    exclusive: boolean,
    forceReplaceRabbitFx = false
  ) =>
    invoke<ToggleModResult>("toggle_mod", {
      characterName,
      modName,
      enable,
      exclusive,
      forceReplaceRabbitFx,
    }),
  getModDetails: (characterName: string, modName: string) =>
    invoke<ModDetails>("get_mod_details", { characterName, modName }),
  renameMod: (characterName: string, oldName: string, newName: string) =>
    invoke<void>("rename_mod", { characterName, oldName, newName }),
  deleteMod: (characterName: string, modName: string) =>
    invoke<void>("delete_mod", { characterName, modName }),
  moveModToCharacter: (sourceCharacter: string, modName: string, targetCharacter: string) =>
    invoke<void>("move_mod_to_character", { sourceCharacter, modName, targetCharacter }),
  assignModSection: (characterName: string, modName: string, sectionId: string) =>
    invoke<void>("assign_mod_section", { characterName, modName, sectionId }),
  pinMod: (characterName: string, modName: string, pinned: boolean) =>
    invoke<void>("pin_mod", { characterName, modName, pinned }),
  setModMarked: (characterName: string, modName: string, marked: boolean) =>
    invoke<void>("set_mod_marked", { characterName, modName, marked }),
  saveModOrder: (characterName: string, order: string[]) =>
    invoke<void>("save_mod_order", { characterName, order }),
  setModPreviewFile: (characterName: string, modName: string, filePath: string) =>
    invoke<[string, number]>("set_mod_preview_file", { characterName, modName, filePath }),
  setModPreviewData: (characterName: string, modName: string, dataUrl: string) =>
    invoke<[string, number]>("set_mod_preview_data", { characterName, modName, dataUrl }),
  updateModMeta: (
    characterName: string,
    modName: string,
    payload: {
      notes?: string;
      tags?: string[];
      hotkeyAliases?: Record<string, string>;
    }
  ) =>
    invoke<void>("update_mod_meta", {
      characterName,
      modName,
      notes: payload.notes ?? null,
      tags: payload.tags ?? null,
      hotkeyAliases: payload.hotkeyAliases ?? null,
    }),
  getRabbitFxStatus: () => invoke<RabbitFxStatus>("get_rabbitfx_status"),

  updateModHotkey: (
    characterName: string,
    modName: string,
    iniRelPath: string,
    section: string,
    newKeyExpr: string
  ) =>
    invoke<void>("update_mod_hotkey", {
      characterName,
      modName,
      iniRelPath,
      section,
      newKeyExpr,
    }),

  getPersistBridgeStatus: () => invoke<PersistBridgeStatus>("get_persist_bridge_status"),
  setPersistBridgeEnabled: (enabled: boolean) =>
    invoke<PersistBridgeStatus>("set_persist_bridge_enabled", { enabled }),
  setPersistBridgeCacheSize: (cacheSize: number) =>
    invoke<PersistBridgeStatus>("set_persist_bridge_cache_size", { cacheSize }),
  clearPersistBridgeCache: () => invoke<number>("clear_persist_bridge_cache"),
  resetModIni: (characterName: string, modName: string) =>
    invoke<number>("reset_mod_ini", { characterName, modName }),
  resetCharacterIni: (characterName: string) =>
    invoke<number>("reset_character_ini", { characterName }),

  listAllModsCatalog: () => invoke<CharacterModsCatalog[]>("list_all_mods_catalog"),
  listPresets: () => invoke<PresetListResponse>("list_presets"),
  createPreset: (
    name: string,
    description: string,
    mods: PresetModEntry[] | null,
    snapshotCurrent: boolean
  ) =>
    invoke<ModPreset>("create_preset", {
      name,
      description,
      mods,
      snapshotCurrent,
    }),
  updatePreset: (
    id: string,
    name: string,
    description: string,
    mods: PresetModEntry[] | null
  ) => invoke<ModPreset>("update_preset", { id, name, description, mods }),
  snapshotUpdatePreset: (id: string) => invoke<ModPreset>("snapshot_update_preset", { id }),
  deletePreset: (id: string) => invoke<void>("delete_preset", { id }),
  applyPreset: (id: string, forceAllowMultipleRabbitFx = false) =>
    invoke<ApplyPresetResult>("apply_preset", { id, forceAllowMultipleRabbitFx }),
  exportPresetsFile: (filePath: string) => invoke<number>("export_presets_file", { filePath }),
  importPresetsFile: (filePath: string) =>
    invoke<PresetImportResult>("import_presets_file", { filePath }),

  getUndoStack: () => invoke<UndoEntrySummary[]>("get_undo_stack"),
  undoLastAction: () => invoke<UndoResult>("undo_last_action"),

  getGameRuntimeStatus: () => invoke<GameRuntimeStatus>("get_game_runtime_status"),
  relaunchAsAdmin: () => invoke<void>("relaunch_as_admin"),
  sendF10Reload: () => invoke<void>("send_f10_reload"),
  sendModHotkey: (expr: string) => invoke<void>("send_mod_hotkey", { expr }),

  getOverlayState: () => invoke<OverlayStateSnapshot>("get_overlay_state"),
  showOverlay: () => invoke<void>("show_overlay"),
  hideOverlay: () => invoke<void>("hide_overlay"),
  toggleOverlay: () => invoke<boolean>("toggle_overlay"),
  setOverlayPinned: (pinned: boolean) =>
    invoke<OverlayStateSnapshot>("set_overlay_pinned", { pinned }),
  setOverlayScale: (scale: number) => invoke<AppConfig>("set_overlay_scale", { scale }),
  setOverlayHotkey: (hotkey: string) => invoke<AppConfig>("set_overlay_hotkey", { hotkey }),
  openOverlaySidePanel: (
    mode: "closed" | "bubbles" | "detail",
    characterName?: string | null,
    modName?: string | null
  ) =>
    invoke<OverlayStateSnapshot>("open_overlay_side_panel", {
      mode,
      characterName: characterName ?? null,
      modName: modName ?? null,
    }),
  adjustOverlaySideWidth: (delta: number) =>
    invoke<OverlayStateSnapshot>("adjust_overlay_side_width", { delta }),
  selectOverlayCharacter: (characterName: string) =>
    invoke<OverlayStateSnapshot>("select_overlay_character", { characterName }),
  focusMainWindowOnMod: (characterName: string, modName: string) =>
    invoke<void>("focus_main_window_on_mod", { characterName, modName }),

  analyzeImportSources: (sourcePaths: string[], lockedCharacter?: string | null) =>
    invoke<ImportAnalysisResponse>("analyze_import_sources", {
      sourcePaths,
      lockedCharacter: lockedCharacter ?? null,
    }),
  executeImportPlan: (sessionId: string, plans: ImportPlanItem[]) =>
    invoke<ImportExecutionSummary>("execute_import_plan", { sessionId, plans }),
  cleanupImportSession: (sessionId: string) =>
    invoke<void>("cleanup_import_session", { sessionId }),

  scanModsHealthAndOrganize: () =>
    invoke<OrganizeScanReport>("scan_mods_health_and_organize"),
  createMissingDefaultCharacters: () =>
    invoke<number>("create_missing_default_characters"),
  executeLegacyMigrations: (legacyNames: string[]) =>
    invoke<OrganizeApplyResult>("execute_legacy_migrations", { legacyNames }),
  executeOrganizeActions: (moves: [string, string, string][], quarantinePaths: string[]) =>
    invoke<OrganizeApplyResult>("execute_organize_actions", { moves, quarantinePaths }),

  listModFixBackups: (characterName: string, modName: string) =>
    invoke<FixBackupEntry[]>("list_mod_fix_backups", { characterName, modName }),
  rollbackModFixBackup: (characterName: string, modName: string, backupId: string) =>
    invoke<number>("rollback_mod_fix_backup", { characterName, modName, backupId }),
  runModFixer: (
    scopeKind: "mod" | "character" | "all",
    characterName?: string | null,
    modName?: string | null,
    fixerExePath?: string | null
  ) =>
    invoke<FixerRunReport>("run_mod_fixer", {
      scopeKind,
      characterName: characterName ?? null,
      modName: modName ?? null,
      fixerExePath: fixerExePath ?? null,
    }),

  runOfflineDiagnostics: () => invoke<DiagnosticsReport>("run_offline_diagnostics"),
  fixDiagnosticItem: (checkId: string) =>
    invoke<string>("fix_diagnostic_item", { checkId }),
  updateXxmiOrEfmiPackage: (
    targetKind: "efmi" | "xxmi",
    sourcePath: string,
    customDestDir?: string | null
  ) =>
    invoke<PackageUpdateResult>("update_xxmi_or_efmi_package", {
      targetKind,
      sourcePath,
      customDestDir: customDestDir ?? null,
    }),

  getAutostartEnabled: () => invoke<boolean>("get_autostart_enabled"),
  setAutostartEnabled: (enabled: boolean) =>
    invoke<void>("set_autostart_enabled", { enabled }),
  exportConfigFile: (filePath: string) =>
    invoke<void>("export_config_file", { filePath }),
  importConfigFile: (filePath: string) =>
    invoke<AppConfig>("import_config_file", { filePath }),

  minimizeToTray: () => invoke<void>("minimize_to_tray"),
  quitApp: () => invoke<void>("quit_app"),
};
