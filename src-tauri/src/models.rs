use serde::{Deserialize, Serialize};
use std::collections::HashMap;

fn default_launch_mode() -> String {
    "EFMI".to_string()
}
fn default_theme() -> String {
    "rose-light".to_string()
}
fn default_bg_overlay() -> u32 {
    30
}
fn default_bg_opacity() -> u32 {
    92
}
fn default_sidebar_zoom() -> u32 {
    100
}
fn default_close_behavior() -> String {
    "ask".to_string()
}
fn default_overlay_hotkey() -> String {
    "Alt+F".to_string()
}
fn default_overlay_scale() -> f64 {
    1.0
}
fn default_overlay_opacity() -> u32 {
    90
}
fn default_true() -> bool {
    true
}
fn default_persist_cache_size() -> u32 {
    12
}
fn default_update_repo() -> String {
    "carrotluo5/EndfieldModManager".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceSectionConfig {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub name_en: String,
    #[serde(default)]
    pub cover_path: String,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    #[serde(default)]
    pub mods_path: String,
    #[serde(default)]
    pub game_path: String,
    #[serde(default)]
    pub xxmi_path: String,
    #[serde(default = "default_launch_mode")]
    pub launch_mode: String,
    #[serde(default)]
    pub launch_args: String,

    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default)]
    pub custom_accent: String,
    #[serde(default)]
    pub bg_images: Vec<String>,
    #[serde(default)]
    pub active_bg_image: String,
    #[serde(default)]
    pub bg_blur: u32,
    #[serde(default = "default_bg_overlay")]
    pub bg_overlay: u32,
    #[serde(default = "default_bg_opacity")]
    pub bg_opacity: u32,
    #[serde(default = "default_sidebar_zoom")]
    pub sidebar_zoom: u32,
    #[serde(default)]
    pub sidebar_collapsed: bool,
    #[serde(default)]
    pub compat_level: u8,
    #[serde(default = "default_close_behavior")]
    pub close_behavior: String,
    #[serde(default)]
    pub disclaimer_dismissed: bool,

    #[serde(default)]
    pub character_order: Vec<String>,
    #[serde(default)]
    pub pinned_characters: Vec<String>,
    #[serde(default)]
    pub pinned_mods: HashMap<String, Vec<String>>,
    #[serde(default)]
    pub mod_orders: HashMap<String, Vec<String>>,
    #[serde(default)]
    pub character_sections: HashMap<String, Vec<AppearanceSectionConfig>>,
    #[serde(default)]
    pub exclusive_by_category: HashMap<String, bool>,
    #[serde(default)]
    pub mod_added_at: HashMap<String, i64>,
    #[serde(default)]
    pub show_all_characters: bool,

    #[serde(default = "default_overlay_hotkey")]
    pub overlay_hotkey: String,
    #[serde(default = "default_overlay_scale")]
    pub overlay_scale: f64,
    #[serde(default = "default_overlay_opacity")]
    pub overlay_opacity: u32,
    #[serde(default = "default_true")]
    pub overlay_auto_reload: bool,
    #[serde(default = "default_true")]
    pub overlay_preset_auto_reload: bool,
    #[serde(default = "default_true")]
    pub overlay_clickable_hotkeys: bool,
    #[serde(default = "default_true")]
    pub overlay_auto_minimize_main: bool,
    #[serde(default)]
    pub persist_bridge_enabled: bool,
    #[serde(default = "default_persist_cache_size")]
    pub persist_bridge_cache_size: u32,
    #[serde(default)]
    pub persist_bridge_recent: Vec<String>,
    #[serde(default)]
    pub custom_fixer_path: String,
    #[serde(default = "default_update_repo")]
    pub update_repo: String,
    #[serde(default)]
    pub update_mirror_prefix: String,
    #[serde(default)]
    pub update_github_token: String,
    #[serde(default)]
    pub auto_check_updates: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            mods_path: String::new(),
            game_path: String::new(),
            xxmi_path: String::new(),
            launch_mode: default_launch_mode(),
            launch_args: String::new(),
            theme: default_theme(),
            custom_accent: String::new(),
            bg_images: Vec::new(),
            active_bg_image: String::new(),
            bg_blur: 0,
            bg_overlay: default_bg_overlay(),
            bg_opacity: default_bg_opacity(),
            sidebar_zoom: default_sidebar_zoom(),
            sidebar_collapsed: false,
            compat_level: 0,
            close_behavior: default_close_behavior(),
            disclaimer_dismissed: false,
            character_order: Vec::new(),
            pinned_characters: Vec::new(),
            pinned_mods: HashMap::new(),
            mod_orders: HashMap::new(),
            character_sections: HashMap::new(),
            exclusive_by_category: HashMap::new(),
            mod_added_at: HashMap::new(),
            show_all_characters: false,
            overlay_hotkey: default_overlay_hotkey(),
            overlay_scale: default_overlay_scale(),
            overlay_opacity: default_overlay_opacity(),
            overlay_auto_reload: true,
            overlay_preset_auto_reload: true,
            overlay_clickable_hotkeys: true,
            overlay_auto_minimize_main: true,
            persist_bridge_enabled: false,
            persist_bridge_cache_size: default_persist_cache_size(),
            persist_bridge_recent: Vec::new(),
            custom_fixer_path: String::new(),
            update_repo: default_update_repo(),
            update_mirror_prefix: String::new(),
            update_github_token: String::new(),
            auto_check_updates: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterItem {
    pub name: String,
    pub path: String,
    pub cover_path: Option<String>,
    pub cover_mtime: u64,
    pub mod_count: usize,
    pub enabled_count: usize,
    pub pinned: bool,
    pub aliases: Vec<String>,
    pub is_non_character_category: bool,
    pub section_count: usize,
    pub exists_on_disk: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceSection {
    pub id: String,
    pub name: String,
    pub name_en: String,
    pub cover_path: Option<String>,
    pub cover_mtime: u64,
    pub is_base: bool,
    pub mod_count: usize,
    pub enabled_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModItem {
    pub name: String,
    pub dir_name: String,
    pub path: String,
    pub character_name: String,
    pub enabled: bool,
    pub pinned: bool,
    pub pinned_index: Option<usize>,
    pub marked: bool,
    pub preview_path: Option<String>,
    pub preview_mtime: u64,
    pub section_id: String,
    pub tags: Vec<String>,
    pub notes: String,
    pub added_at_ms: i64,
    pub requires_rabbit_fx: bool,
    pub is_rabbit_fx: bool,
    pub is_eff_mod: bool,
    pub has_conflict: bool,
    pub conflict_with: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModListResponse {
    pub character_name: String,
    pub character_aliases: Vec<String>,
    pub mods: Vec<ModItem>,
    pub conflicts: Vec<ConflictGroup>,
    pub is_non_character_category: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyAlternative {
    pub original: String,
    pub display_keys: Vec<String>,
    pub label: String,
    pub can_apply: bool,
    pub is_preferred: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyItem {
    pub section: String,
    pub description: String,
    pub alias: Option<String>,
    pub keys: Vec<String>,
    pub raw_keys: Vec<String>,
    pub alternatives: Vec<HotkeyAlternative>,
    pub is_menu: bool,
    pub can_apply: bool,
    pub ini_rel_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModDetails {
    pub mod_item: ModItem,
    pub hotkeys: Vec<HotkeyItem>,
    pub readme_text: String,
    pub ini_files: Vec<String>,
    pub has_persist_backup: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictGroup {
    pub hash: String,
    pub mods: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RabbitFxModEntry {
    pub character_name: String,
    pub mod_name: String,
    pub dir_name: String,
    pub path: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RabbitFxStatus {
    pub enabled_count: usize,
    pub enabled_mods: Vec<RabbitFxModEntry>,
    pub all_mods: Vec<RabbitFxModEntry>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToggleModResult {
    pub success: bool,
    pub enabled: bool,
    pub requires_rabbit_fx_confirm: bool,
    pub active_rabbit_fx: Vec<RabbitFxModEntry>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct XxmiConsistency {
    pub xxmi_config_found: bool,
    pub xxmi_efmi_path: String,
    pub mods_parent_path: String,
    pub consistent: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoDetectedPaths {
    pub mods_path: Option<String>,
    pub game_path: Option<String>,
    pub xxmi_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetModEntry {
    pub character_name: String,
    pub mod_name: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModPreset {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub mods: Vec<PresetModEntry>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetStore {
    #[serde(default)]
    pub active_preset_id: Option<String>,
    #[serde(default)]
    pub presets: Vec<ModPreset>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagPoolItem {
    pub id: String,
    pub name: String,
    pub color: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagsPoolStore {
    #[serde(default)]
    pub tags: Vec<TagPoolItem>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModTagsFile {
    #[serde(default)]
    pub qaqm: Option<serde_json::Value>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub marked: bool,
    #[serde(default)]
    pub hotkey_aliases: HashMap<String, String>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistBridgeStatus {
    pub enabled: bool,
    pub legacy_conflict: bool,
    pub cache_size: u32,
    pub d3dx_mounted: bool,
    pub active_state_count: usize,
    pub cache_file_count: usize,
    pub backup_file_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogModEntry {
    pub name: String,
    pub enabled: bool,
    pub is_rabbit_fx: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterModsCatalog {
    pub character_name: String,
    pub is_non_character_category: bool,
    pub mods: Vec<CatalogModEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetItemView {
    pub id: String,
    pub name: String,
    pub description: String,
    pub mods: Vec<PresetModEntry>,
    pub created_at: String,
    pub updated_at: String,
    pub mod_count: usize,
    pub character_count: usize,
    pub missing_count: usize,
    pub missing_keys: Vec<String>,
    pub rabbit_fx_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetListResponse {
    pub active_preset_id: Option<String>,
    pub builtin_no_mod_active: bool,
    pub presets: Vec<PresetItemView>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyPresetResult {
    pub success: bool,
    pub enabled_count: usize,
    pub disabled_count: usize,
    pub missing_mods: Vec<String>,
    pub requires_rabbit_fx_confirm: bool,
    pub conflict_rabbit_fx: Vec<RabbitFxModEntry>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetImportResult {
    pub imported_count: usize,
    pub skipped_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoDelta {
    pub character_name: String,
    pub mod_name: String,
    pub prev_enabled: bool,
    pub new_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoEntrySummary {
    pub id: String,
    pub label: String,
    pub change_count: usize,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoResult {
    pub undone: bool,
    pub label: String,
    pub reverted_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameRuntimeStatus {
    pub game_running: bool,
    pub game_pid: Option<u32>,
    pub game_title: String,
    pub game_elevated: bool,
    pub manager_elevated: bool,
    pub uipi_blocked: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayStateSnapshot {
    pub visible: bool,
    pub pinned: bool,
    pub side_mode: String,
    pub side_detail_width: f64,
    pub selected_character: Option<String>,
    pub selected_mod_name: Option<String>,
    pub overlay_hotkey: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NavigateToModPayload {
    pub character_name: String,
    pub mod_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportAnalyzedItem {
    pub item_id: String,
    pub original_path: String,
    pub staged_path: String,
    pub display_name: String,
    pub import_kind: String,
    pub suggested_character: Option<String>,
    pub match_confidence: String,
    pub suggested_mod_name: String,
    pub install_disabled: bool,
    pub is_eff_mod: bool,
    pub is_disguised_mp4: bool,
    pub is_large_archive: bool,
    pub file_size_bytes: u64,
    pub warning: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportAnalysisResponse {
    pub session_id: String,
    pub items: Vec<ImportAnalyzedItem>,
    pub skipped_messages: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPlanItem {
    pub item_id: String,
    pub target_character: String,
    pub target_mod_name: String,
    pub target_section_id: String,
    pub import_kind: String,
    pub skip: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportItemResult {
    pub item_id: String,
    pub mod_name: String,
    pub target_character: String,
    pub success: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportExecutionSummary {
    pub installed_count: usize,
    pub skipped_count: usize,
    pub failed_count: usize,
    pub results: Vec<ImportItemResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyMigrationItem {
    pub legacy_name: String,
    pub target_name: String,
    pub mod_count: usize,
    pub legacy_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MisplacedModItem {
    pub source_character: String,
    pub mod_name: String,
    pub dir_name: String,
    pub suggested_character: String,
    pub reason: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirtyItem {
    pub kind: String,
    pub name: String,
    pub path: String,
    pub parent_character: Option<String>,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizeScanReport {
    pub missing_default_characters: Vec<String>,
    pub legacy_migrations: Vec<LegacyMigrationItem>,
    pub misplaced_mods: Vec<MisplacedModItem>,
    pub dirty_items: Vec<DirtyItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizeApplyResult {
    pub moved_count: usize,
    pub quarantined_count: usize,
    pub migrated_dirs: usize,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FixBackupEntry {
    pub id: String,
    pub created_at: String,
    pub fixer_name: String,
    pub file_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FixerRunReport {
    pub backup_count: usize,
    pub processed_mods: usize,
    pub modified_files: usize,
    pub log_output: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticCheckItem {
    pub id: String,
    pub title: String,
    pub status: String,
    pub summary: String,
    pub detail: String,
    pub fixable: bool,
    pub action_hint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsReport {
    pub checked_at: String,
    pub ok_count: usize,
    pub warn_count: usize,
    pub error_count: usize,
    pub checks: Vec<DiagnosticCheckItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageUpdateResult {
    pub target_kind: String,
    pub copied_files: usize,
    pub skipped_protected_paths: Vec<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub current_version: String,
    pub latest_version: String,
    pub has_update: bool,
    pub can_auto_update: bool,
    pub min_supported_client_version: String,
    pub pub_date: String,
    pub notes: String,
    pub release_url: String,
    pub download_url: String,
    pub file_name: String,
    pub file_size: u64,
    pub sha256: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgressEvent {
    pub stage: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub percent: f64,
    pub message: String,
}
