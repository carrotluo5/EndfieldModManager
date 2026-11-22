import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Window } from "@tauri-apps/api/window";
import {
  AlertTriangle,
  Bookmark,
  Check,
  Image as ImageIcon,
  Keyboard,
  Minus,
  Plus,
  Power,
  ShieldAlert,
  X,
} from "lucide-react";
import { Modal } from "../components/ui/Modal";
import { api, buildMediaUrl } from "../lib/tauri";
import type { AppConfig, CharacterItem, ModDetails, OverlayStateSnapshot, RabbitFxModEntry } from "../types/mod";
import { applyThemeToDocument, getOverlayPanelBg } from "./themeSync";

interface ToggleTarget {
  characterName: string;
  modName: string;
  enable: boolean;
  exclusive: boolean;
}

interface RabbitFxConfirmation {
  target: ToggleTarget;
  conflicts: RabbitFxModEntry[];
  error: string | null;
}

export function SidePanelApp() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [overlayState, setOverlayState] = useState<OverlayStateSnapshot | null>(null);
  const [characters, setCharacters] = useState<CharacterItem[]>([]);
  const [details, setDetails] = useState<ModDetails | null>(null);
  const [sentSection, setSentSection] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [togglePending, setTogglePending] = useState(false);
  const [rabbitFxConfirm, setRabbitFxConfirm] = useState<RabbitFxConfirmation | null>(null);
  const snapshotRef = useRef<OverlayStateSnapshot | null>(null);
  const detailRequest = useRef(0);

  const loadDetails = useCallback(async (snapshot: OverlayStateSnapshot | null) => {
    const request = ++detailRequest.current;
    if (snapshot?.sideMode !== "detail" || !snapshot.selectedCharacter || !snapshot.selectedModName) {
      setDetails(null);
      return;
    }
    try {
      const next = await api.getModDetails(snapshot.selectedCharacter, snapshot.selectedModName);
      if (request === detailRequest.current) setDetails(next);
    } catch {
      if (request === detailRequest.current) setDetails(null);
    }
  }, []);

  const applySnapshot = useCallback((snapshot: OverlayStateSnapshot) => {
    snapshotRef.current = snapshot;
    setOverlayState(snapshot);
    void loadDetails(snapshot);
  }, [loadDetails]);

  const loadSnapshotAndData = useCallback(async () => {
    try {
      const [cfg, ov, chars] = await Promise.all([
        api.getConfig(),
        api.getOverlayState(),
        api.listCharacters(true),
      ]);
      setConfig(cfg);
      applyThemeToDocument(cfg);
      setCharacters(chars);
      if (!snapshotRef.current) applySnapshot(ov);
    } catch {
      // Ignore transient unavailable errors
    }
  }, [applySnapshot]);

  useEffect(() => {
    void loadSnapshotAndData();
  }, [loadSnapshotAndData]);

  useEffect(() => {
    const cleanups: Array<() => void> = [];
    let cancelled = false;

    const setup = async () => {
      const un1 = await listen<AppConfig>("settings-changed", (ev) => {
        if (ev.payload) {
          setConfig(ev.payload);
          applyThemeToDocument(ev.payload);
        }
      });
      if (cancelled) un1();
      else cleanups.push(un1);

      const un2 = await listen<OverlayStateSnapshot>("overlay-state-changed", (ev) => {
        if (ev.payload) applySnapshot(ev.payload);
      });
      if (cancelled) un2();
      else cleanups.push(un2);

      const un3 = await listen("characters-changed", () => {
        void api.listCharacters(true).then(setCharacters).catch(() => {});
      });
      if (cancelled) un3();
      else cleanups.push(un3);

      const un4 = await listen("mods-changed", () => {
        void loadDetails(snapshotRef.current);
      });
      if (cancelled) un4();
      else cleanups.push(un4);
    };

    void setup();
    return () => {
      cancelled = true;
      detailRequest.current += 1;
      for (const fn of cleanups) fn();
    };
  }, [applySnapshot, loadDetails]);

  const closeSidePanel = useCallback(async () => {
    await Window.getByLabel("overlay")
      .then((overlay) => overlay?.setFocus())
      .catch(() => {});
    try {
      applySnapshot(await api.openOverlaySidePanel("closed"));
    } catch (err) {
      setStatusNote(String(err));
    }
  }, [applySnapshot]);

  const sideMode = overlayState?.sideMode ?? "closed";
  useEffect(() => {
    if (sideMode !== "detail") setRabbitFxConfirm(null);
  }, [sideMode]);

  useEffect(() => {
    if (sideMode === "closed" || rabbitFxConfirm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || e.isComposing || e.repeat) return;
      e.preventDefault();
      void closeSidePanel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeSidePanel, rabbitFxConfirm, sideMode]);

  const handleSendHotkey = async (key: string, rawExpr: string) => {
    if (config?.overlayClickableHotkeys === false) return;
    try {
      await api.sendModHotkey(rawExpr);
      setSentSection(key);
      setStatusNote(`已向游戏发送 ${rawExpr}`);
      window.setTimeout(() => {
        setSentSection((cur) => (cur === key ? null : cur));
        setStatusNote(null);
      }, 1600);
    } catch (err) {
      setStatusNote(String(err));
      window.setTimeout(() => setStatusNote(null), 2600);
    }
  };

  const toggleDetailMod = async (target: ToggleTarget, replaceRabbitFx = false) => {
    if (togglePending) return;
    const { characterName, modName, enable, exclusive } = target;
    setTogglePending(true);
    setStatusNote(null);
    setRabbitFxConfirm((current) => current && { ...current, error: null });
    try {
      const res = await api.toggleMod(characterName, modName, enable, exclusive, replaceRabbitFx);
      if (res.requiresRabbitFxConfirm) {
        setRabbitFxConfirm({ target, conflicts: res.activeRabbitFx, error: null });
        return;
      }
      if (!res.success) throw new Error(res.message ?? "无法切换 Mod");
      setRabbitFxConfirm(null);
      if (config?.overlayAutoReload) {
        void api.sendF10Reload().catch(() => {});
      }
    } catch (err) {
      const message = String(err);
      if (replaceRabbitFx) {
        setRabbitFxConfirm((current) => current && { ...current, error: message });
      } else {
        setStatusNote(message);
      }
    } finally {
      setTogglePending(false);
    }
  };

  const detailMod = details &&
    details.modItem.characterName === overlayState?.selectedCharacter &&
    details.modItem.name === overlayState.selectedModName
      ? details.modItem
      : null;
  const previewUrl = detailMod
    ? buildMediaUrl(detailMod.previewPath, detailMod.previewMtime)
    : null;

  return (
    <div
      style={{ backgroundColor: getOverlayPanelBg(config) }}
      className="flex h-screen w-screen flex-col overflow-hidden rounded-2xl border border-[var(--border-strong)] text-[var(--text-primary)] shadow-2xl"
    >
      {/* Header */}
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-3">
        <span className="truncate text-xs font-bold">
          {sideMode === "bubbles" ? "选择干员分类" : "Mod 详情与快捷键"}
        </span>

        <div className="flex items-center gap-1">
          {sideMode === "detail" && (
            <>
              <button
                type="button"
                title="收窄侧边窗"
                onClick={() => void api.adjustOverlaySideWidth(-36)}
                className="rounded-lg p-1 text-[var(--text-secondary)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                title="加宽侧边窗"
                onClick={() => void api.adjustOverlaySideWidth(36)}
                className="rounded-lg p-1 text-[var(--text-secondary)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </>
          )}
          <button
            type="button"
            title="收起侧边窗"
            onClick={() => void closeSidePanel()}
            className="rounded-lg p-1 text-[var(--text-secondary)] hover:bg-[var(--danger)] hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      {/* Body */}
      {sideMode === "bubbles" ? (
        <div className="flex-1 overflow-y-auto p-3">
          <div className="grid grid-cols-3 gap-2.5">
            {characters
              .filter((c) => c.modCount > 0 || c.pinned)
              .map((c) => {
                const cov = buildMediaUrl(c.coverPath, c.coverMtime);
                const selected = overlayState?.selectedCharacter === c.name;
                return (
                  <button
                    key={c.name}
                    type="button"
                    onClick={() => void api.selectOverlayCharacter(c.name)}
                    className={`flex flex-col items-center gap-1.5 rounded-xl p-1.5 transition-all hover:bg-[var(--accent-soft)] ${
                      selected ? "ring-2 ring-[var(--accent)] bg-[var(--accent-soft)]" : ""
                    }`}
                  >
                    <div className="relative h-13 w-13 overflow-hidden rounded-full border border-[var(--border-strong)] bg-[var(--bg-elevated)]">
                      {cov ? (
                        <img
                          src={cov}
                          alt={c.name}
                          className="h-full w-full object-cover object-top"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-sm font-bold text-[var(--accent)]">
                          {c.name.slice(0, 1)}
                        </div>
                      )}
                      {c.enabledCount > 0 && (
                        <span className="absolute right-0.5 bottom-0.5 h-2.5 w-2.5 rounded-full border border-white bg-[var(--success)]" />
                      )}
                    </div>
                    <span className="w-full truncate text-center text-[11px] font-semibold leading-tight text-[var(--text-primary)]">
                      {c.name}
                    </span>
                  </button>
                );
              })}
          </div>
        </div>
      ) : detailMod ? (
        <>
          <div className="flex-1 space-y-3 overflow-y-auto p-3 text-xs">
            <div className="aspect-[16/10] w-full overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt={detailMod.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-[var(--text-muted)]">
                  <ImageIcon className="h-6 w-6 opacity-45" />
                </div>
              )}
            </div>

            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="break-all text-sm font-bold text-[var(--text-primary)]">
                  {detailMod.name}
                </div>
                <div className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
                  分类：{detailMod.characterName}
                </div>
              </div>
              <button
                type="button"
                title={detailMod.marked ? "取消收藏" : "收藏此 Mod"}
                onClick={async () => {
                  await api.setModMarked(detailMod.characterName, detailMod.name, !detailMod.marked);
                  const d = await api.getModDetails(detailMod.characterName, detailMod.name);
                  setDetails(d);
                }}
                className={`rounded-lg p-1.5 ${
                  detailMod.marked
                    ? "bg-amber-500/15 text-amber-500"
                    : "text-[var(--text-muted)] hover:bg-[var(--bg-elevated)]"
                }`}
              >
                <Bookmark className={`h-4 w-4 ${detailMod.marked ? "fill-current" : ""}`} />
              </button>
            </div>

            {detailMod.isEffMod && (
              <div className="flex items-start gap-1.5 rounded-xl bg-[var(--warning-soft)] p-2.5 text-[11px] text-[var(--warning)]">
                <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>EFF 框架 Mod 不应放入 EFMI\Mods</span>
              </div>
            )}

            {detailMod.hasConflict && (
              <div className="flex items-start gap-1.5 rounded-xl bg-[var(--danger-soft)] p-2.5 text-[11px] text-[var(--danger)]">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>与 {detailMod.conflictWith.join("、")} 存在 Hash 冲突</span>
              </div>
            )}

            {/* Clickable Hotkeys */}
            <div className="space-y-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-2.5">
              <div className="flex items-center justify-between text-[11px] font-semibold">
                <span className="inline-flex items-center gap-1.5">
                  <Keyboard className="h-3.5 w-3.5 text-[var(--accent)]" />
                  <span>局内快捷键（点击直发）</span>
                </span>
              </div>

              {details && details.hotkeys.length > 0 ? (
                <div className="space-y-1.5">
                  {details.hotkeys.map((hk) => {
                    const interactive = hk.canApply && (config?.overlayClickableHotkeys ?? true);
                    const key = `${hk.iniRelPath}:${hk.section}`;
                    const wasSent = sentSection === key;
                    const primaryRaw = hk.rawKeys[0] ?? "";
                    return (
                      <div key={`${hk.iniRelPath}-${hk.section}`}>
                        <button
                          type="button"
                          disabled={!interactive}
                          onClick={() => void handleSendHotkey(key, primaryRaw)}
                          className={`flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                            interactive
                              ? "border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]"
                              : "cursor-not-allowed border-[var(--border-subtle)] bg-[var(--bg-surface)]/70 opacity-75"
                          }`}
                        >
                          <span className="truncate font-medium">{hk.alias || hk.description}</span>
                          <span className="flex shrink-0 items-center gap-1">
                            {wasSent && (
                              <span className="inline-flex items-center gap-0.5 rounded bg-[var(--success-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--success)]">
                                <Check className="h-3 w-3" />
                                <span>已发</span>
                              </span>
                            )}
                            {hk.keys.map((k, idx) => (
                              <kbd
                                key={`${k}-${idx}`}
                                className="rounded border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[var(--accent)]"
                              >
                                {k}
                              </kbd>
                            ))}
                          </span>
                        </button>
                        {!hk.canApply && (
                          <p className="mt-0.5 px-1 text-[10px] text-[var(--warning)]">
                            鼠标/手柄按键需在游戏内手动按下
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-[11px] text-[var(--text-muted)]">无可用快捷键</p>
              )}
            </div>

            {statusNote && (
              <div className="rounded-lg bg-[var(--accent-soft)] px-2.5 py-1.5 text-[11px] text-[var(--accent)]">
                {statusNote}
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-[var(--border-subtle)] p-3">
            <button
              type="button"
              disabled={togglePending}
              onClick={() => {
                const category = characters.find((c) => c.name === detailMod.characterName);
                void toggleDetailMod({
                  characterName: detailMod.characterName,
                  modName: detailMod.name,
                  enable: !detailMod.enabled,
                  exclusive: config?.exclusiveByCategory?.[detailMod.characterName] ?? !category?.isNonCharacterCategory,
                });
              }}
              className={`flex w-full items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-semibold ${
                detailMod.enabled
                  ? "border border-[var(--border-strong)] bg-[var(--bg-elevated)] text-[var(--text-primary)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
                  : "bg-[var(--accent-fill)] text-[var(--accent-contrast)] hover:bg-[var(--accent-fill-hover)]"
              }`}
            >
              <Power className="h-3.5 w-3.5" />
              <span>{detailMod.enabled ? "禁用此 Mod" : "启用此 Mod"}</span>
            </button>
          </div>
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center p-4 text-xs text-[var(--text-muted)]">
          点击左侧任意 Mod 卡片查看详情
        </div>
      )}

      <Modal
        open={sideMode === "detail" && rabbitFxConfirm !== null}
        onClose={() => {
          if (!togglePending) setRabbitFxConfirm(null);
        }}
        title="替换 RabbitFX"
        closeOnBackdrop={!togglePending}
        footer={rabbitFxConfirm && (
          <>
            <button
              type="button"
              disabled={togglePending}
              onClick={() => setRabbitFxConfirm(null)}
              className="rounded-lg border border-[var(--border-subtle)] px-3 py-1.5 text-xs text-[var(--text-secondary)] disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="button"
              disabled={togglePending}
              onClick={() => void toggleDetailMod(rabbitFxConfirm.target, true)}
              className="rounded-lg bg-[var(--accent-fill)] px-3 py-1.5 text-xs font-semibold text-[var(--accent-contrast)] disabled:opacity-50"
            >
              {togglePending ? "正在替换…" : "替换并启用"}
            </button>
          </>
        )}
      >
        {rabbitFxConfirm && (
          <div className="space-y-3 text-xs">
            <p className="break-all">
              启用「{rabbitFxConfirm.target.modName}」前需停用以下 RabbitFX，避免游戏崩溃。
            </p>
            <ul className="space-y-1 rounded-lg bg-[var(--bg-elevated)] p-2 text-[var(--text-secondary)]">
              {rabbitFxConfirm.conflicts.map((mod) => (
                <li className="break-all" key={mod.path}>{mod.characterName} / {mod.modName}</li>
              ))}
            </ul>
            {rabbitFxConfirm.error && (
              <p role="alert" className="break-all text-[var(--danger)]">{rabbitFxConfirm.error}</p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
