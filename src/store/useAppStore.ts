import { create } from "zustand";
import { api } from "../lib/tauri";
import type { AppConfig, NavTab, RabbitFxStatus, UndoEntrySummary } from "../types/mod";

export interface ToastItem {
  id: string;
  type: "success" | "error" | "info" | "warning";
  message: string;
}

export interface MovingModState {
  sourceCharacter: string;
  modName: string;
}

export interface PendingFocusModState {
  characterName: string;
  modName: string;
}

export interface ImportWizardRequest {
  sourcePaths: string[];
  lockedCharacter: string | null;
}

export interface FixerModalRequest {
  scopeKind: "mod" | "character" | "all";
  characterName?: string | null;
  modName?: string | null;
}

interface AppStoreState {
  config: AppConfig | null;
  activeTab: NavTab;
  selectedCharacter: string | null;
  movingMod: MovingModState | null;
  pendingFocusMod: PendingFocusModState | null;
  rabbitFxStatus: RabbitFxStatus | null;
  presetCount: number;
  undoStack: UndoEntrySummary[];
  toasts: ToastItem[];
  closeModalOpen: boolean;
  setupWizardOpen: boolean;
  diagnosticsOpen: boolean;
  organizeModalOpen: boolean;
  importWizardRequest: ImportWizardRequest | null;
  fixerModalRequest: FixerModalRequest | null;
  charactersTick: number;
  modsTick: number;
  presetsTick: number;

  initApp: () => Promise<void>;
  setActiveTab: (tab: NavTab) => void;
  setSelectedCharacter: (charName: string | null) => void;
  setMovingMod: (moving: MovingModState | null) => void;
  setPendingFocusMod: (target: PendingFocusModState | null) => void;
  setCloseModalOpen: (open: boolean) => void;
  setSetupWizardOpen: (open: boolean) => void;
  setDiagnosticsOpen: (open: boolean) => void;
  setOrganizeModalOpen: (open: boolean) => void;
  openImportWizard: (sourcePaths?: string[], lockedCharacter?: string | null) => void;
  closeImportWizard: () => void;
  openFixerModal: (req: FixerModalRequest | null) => void;
  updateConfigPatch: (patch: Partial<AppConfig>) => Promise<AppConfig>;
  refreshRabbitFxStatus: () => Promise<void>;
  refreshPresetCount: () => Promise<void>;
  refreshUndoStack: () => Promise<void>;
  bumpCharactersTick: () => void;
  bumpModsTick: () => void;
  bumpPresetsTick: () => void;
  addToast: (type: ToastItem["type"], message: string) => void;
  removeToast: (id: string) => void;
}

export const useAppStore = create<AppStoreState>((set, get) => ({
  config: null,
  activeTab: "characters",
  selectedCharacter: null,
  movingMod: null,
  pendingFocusMod: null,
  rabbitFxStatus: null,
  presetCount: 0,
  undoStack: [],
  toasts: [],
  closeModalOpen: false,
  setupWizardOpen: false,
  diagnosticsOpen: false,
  organizeModalOpen: false,
  importWizardRequest: null,
  fixerModalRequest: null,
  charactersTick: 0,
  modsTick: 0,
  presetsTick: 0,

  initApp: async () => {
    const [cfg, rfx, presetCnt, undoList] = await Promise.all([
      api.getConfig(),
      api.getRabbitFxStatus().catch(() => null),
      api.getPresetCount().catch(() => 0),
      api.getUndoStack().catch(() => [] as UndoEntrySummary[]),
    ]);
    set({
      config: cfg,
      rabbitFxStatus: rfx,
      presetCount: presetCnt,
      undoStack: undoList,
    });
  },

  setActiveTab: (tab) => set({ activeTab: tab }),
  setSelectedCharacter: (charName) => set({ selectedCharacter: charName }),
  setMovingMod: (moving) => set({ movingMod: moving }),
  setPendingFocusMod: (target) => set({ pendingFocusMod: target }),
  setCloseModalOpen: (open) => set({ closeModalOpen: open }),
  setSetupWizardOpen: (open) => set({ setupWizardOpen: open }),
  setDiagnosticsOpen: (open) => set({ diagnosticsOpen: open }),
  setOrganizeModalOpen: (open) => set({ organizeModalOpen: open }),
  openImportWizard: (sourcePaths = [], lockedCharacter = null) =>
    set({ importWizardRequest: { sourcePaths, lockedCharacter } }),
  closeImportWizard: () => set({ importWizardRequest: null }),
  openFixerModal: (req) => set({ fixerModalRequest: req }),

  updateConfigPatch: async (patch) => {
    const next = await api.updateConfig(patch);
    set({ config: next });
    if ("modsPath" in patch) {
      void get().refreshRabbitFxStatus();
    }
    return next;
  },

  refreshRabbitFxStatus: async () => {
    try {
      const rfx = await api.getRabbitFxStatus();
      set({ rabbitFxStatus: rfx });
    } catch {
      // Ignore if modsPath unset
    }
  },

  refreshPresetCount: async () => {
    try {
      const cnt = await api.getPresetCount();
      set({ presetCount: cnt });
    } catch {
      // Ignore
    }
  },

  refreshUndoStack: async () => {
    try {
      const undoStack = await api.getUndoStack();
      set({ undoStack });
    } catch {
      // Ignore
    }
  },

  bumpCharactersTick: () => set((s) => ({ charactersTick: s.charactersTick + 1 })),
  bumpModsTick: () => set((s) => ({ modsTick: s.modsTick + 1 })),
  bumpPresetsTick: () => set((s) => ({ presetsTick: s.presetsTick + 1 })),

  addToast: (type, message) => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    set((s) => ({ toasts: [...s.toasts.slice(-4), { id, type, message }] }));
    window.setTimeout(() => {
      get().removeToast(id);
    }, 3200);
  },

  removeToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
