import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  ChevronDown,
  FileArchive,
  FolderOpen,
  FolderPlus,
  Lock,
  Search,
  Sparkles,
  Unlock,
  XCircle,
} from "lucide-react";
import { matchesSearch } from "../../lib/search";
import { api } from "../../lib/tauri";
import { useAppStore } from "../../store/useAppStore";
import type {
  AppearanceSection,
  CharacterItem,
  ImportAnalyzedItem,
  ImportExecutionSummary,
  ImportPlanItem,
} from "../../types/mod";
import { Modal } from "../ui/Modal";

interface ImportWizardModalProps {
  open: boolean;
  initialSourcePaths?: string[];
  lockedCharacter?: string | null;
  onClose: () => void;
}

interface DraftPlanState {
  targetCharacter: string;
  targetModName: string;
  targetSectionId: string;
  skip: boolean;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let val = bytes;
  let idx = 0;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx += 1;
  }
  return `${val >= 100 || idx === 0 ? val.toFixed(0) : val.toFixed(1)} ${units[idx]}`;
}

function confidenceLabel(conf: string): { label: string; cls: string } {
  switch (conf) {
    case "locked":
      return { label: "已锁定角色", cls: "bg-[var(--accent-soft)] text-[var(--accent)]" };
    case "exact":
      return { label: "精确匹配", cls: "bg-emerald-500/15 text-emerald-500" };
    case "alias":
      return { label: "别名匹配", cls: "bg-sky-500/15 text-sky-500" };
    case "path":
      return { label: "路径线索", cls: "bg-indigo-500/15 text-indigo-400" };
    default:
      return { label: "待确认分类", cls: "bg-amber-500/15 text-amber-500" };
  }
}

interface CharacterSearchPickerProps {
  value: string;
  characters: CharacterItem[];
  disabled?: boolean;
  onChange: (name: string) => void;
}

function CharacterSearchPicker({
  value,
  characters,
  disabled,
  onChange,
}: CharacterSearchPickerProps) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    return characters.filter((c) => matchesSearch(c.name, c.aliases, query));
  }, [characters, query]);

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-1.5 text-left text-xs text-[var(--text-primary)] hover:border-[var(--border-strong)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="truncate font-medium">
          {value || "请选择目标角色 / 分类"}
        </span>
        {!disabled && (
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] transition-transform ${
              expanded ? "rotate-180" : ""
            }`}
          />
        )}
      </button>

      {expanded && !disabled && (
        <div className="rounded-xl border border-[var(--border-strong)] bg-[var(--bg-surface-strong)] p-2 shadow-lg">
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3 w-3 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索角色 / 拼音 / 别名..."
              autoFocus
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] py-1.5 pr-2.5 pl-7 text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
            />
          </div>
          <div className="grid max-h-40 grid-cols-2 gap-1 overflow-y-auto sm:grid-cols-3">
            {filtered.map((ch) => {
              const active = ch.name === value;
              return (
                <button
                  key={ch.name}
                  type="button"
                  onClick={() => {
                    onChange(ch.name);
                    setExpanded(false);
                    setQuery("");
                  }}
                  className={`truncate rounded-lg px-2 py-1 text-left text-[11px] transition-colors ${
                    active
                      ? "bg-[var(--accent)] font-semibold text-[var(--accent-contrast)]"
                      : "text-[var(--text-primary)] hover:bg-[var(--accent-soft)]"
                  }`}
                >
                  {ch.name}
                </button>
              );
            })}
            {filtered.length === 0 && (
              <div className="col-span-full py-2 text-center text-[11px] text-[var(--text-muted)]">
                未找到匹配角色
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function ImportWizardModal({
  open,
  initialSourcePaths = [],
  lockedCharacter = null,
  onClose,
}: ImportWizardModalProps) {
  const bumpCharactersTick = useAppStore((s) => s.bumpCharactersTick);
  const bumpModsTick = useAppStore((s) => s.bumpModsTick);
  const refreshRabbitFxStatus = useAppStore((s) => s.refreshRabbitFxStatus);
  const addToast = useAppStore((s) => s.addToast);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [queuedPaths, setQueuedPaths] = useState<string[]>([]);
  const [characterLockActive, setCharacterLockActive] = useState(Boolean(lockedCharacter));
  const [analyzing, setAnalyzing] = useState(false);
  const [installing, setInstalling] = useState(false);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const [items, setItems] = useState<ImportAnalyzedItem[]>([]);
  const [skippedMessages, setSkippedMessages] = useState<string[]>([]);
  const [plansById, setPlansById] = useState<Record<string, DraftPlanState>>({});
  const [characters, setCharacters] = useState<CharacterItem[]>([]);
  const [sectionsByChar, setSectionsByChar] = useState<Record<string, AppearanceSection[]>>({});
  const [summary, setSummary] = useState<ImportExecutionSummary | null>(null);

  const cleanupSession = useCallback((id: string | null) => {
    if (!id) return;
    void api.cleanupImportSession(id).catch(() => {});
  }, []);

  const ensureSectionsLoaded = useCallback(async (charName: string) => {
    const trimmed = charName.trim();
    if (!trimmed) return;
    setSectionsByChar((prev) => {
      if (trimmed in prev) return prev;
      void api
        .listAppearanceSections(trimmed)
        .then((list) => {
          setSectionsByChar((curr) => ({ ...curr, [trimmed]: list }));
        })
        .catch(() => {
          setSectionsByChar((curr) => ({ ...curr, [trimmed]: [] }));
        });
      return { ...prev, [trimmed]: [] };
    });
  }, []);

  const runAnalysis = useCallback(
    async (paths: string[], lockChar: string | null) => {
      if (paths.length === 0) {
        addToast("warning", "请先选择至少一个 Mod 压缩包或文件夹");
        return;
      }

      if (sessionIdRef.current) {
        cleanupSession(sessionIdRef.current);
        sessionIdRef.current = null;
        setSessionId(null);
      }

      setAnalyzing(true);
      try {
        const resp = await api.analyzeImportSources(paths, lockChar);
        sessionIdRef.current = resp.sessionId;
        setSessionId(resp.sessionId);
        setItems(resp.items);
        setSkippedMessages(resp.skippedMessages);

        const initialPlans: Record<string, DraftPlanState> = {};
        const charsToLoad = new Set<string>();
        for (const item of resp.items) {
          const targetChar = lockChar?.trim() || item.suggestedCharacter || "其他";
          initialPlans[item.itemId] = {
            targetCharacter: targetChar,
            targetModName: item.suggestedModName || item.displayName,
            targetSectionId: "",
            skip: false,
          };
          charsToLoad.add(targetChar);
        }
        setPlansById(initialPlans);
        for (const ch of charsToLoad) {
          void ensureSectionsLoaded(ch);
        }

        if (resp.items.length === 0) {
          addToast(
            "warning",
            resp.skippedMessages[0] || "所选内容中未识别出可导入的 Mod 结构"
          );
          setStep(1);
        } else {
          setStep(2);
        }
      } catch (err) {
        addToast("error", `解析导入源失败：${String(err)}`);
      } finally {
        setAnalyzing(false);
      }
    },
    [addToast, cleanupSession, ensureSectionsLoaded]
  );

  // Reset & initialize whenever modal opens or closes
  useEffect(() => {
    if (!open) {
      if (sessionIdRef.current) {
        cleanupSession(sessionIdRef.current);
        sessionIdRef.current = null;
      }
      setSessionId(null);
      setStep(1);
      setQueuedPaths([]);
      setItems([]);
      setSkippedMessages([]);
      setPlansById({});
      setSummary(null);
      return;
    }

    setCharacterLockActive(Boolean(lockedCharacter));
    setSummary(null);
    setQueuedPaths(initialSourcePaths);

    void api
      .listCharacters()
      .then((list) => setCharacters(list))
      .catch(() => setCharacters([]));

    if (initialSourcePaths.length > 0) {
      void runAnalysis(initialSourcePaths, lockedCharacter);
    } else {
      setStep(1);
    }
  }, [open, initialSourcePaths, lockedCharacter, cleanupSession, runAnalysis]);

  useEffect(() => {
    return () => {
      if (sessionIdRef.current) {
        cleanupSession(sessionIdRef.current);
        sessionIdRef.current = null;
      }
    };
  }, [cleanupSession]);

  const handlePickArchives = async () => {
    try {
      const selected = await openDialog({
        title: "选择 Mod 压缩包或 QAQM MP4 伪装包",
        multiple: true,
        filters: [
          {
            name: "Mod 安装包 (*.zip, *.7z, *.rar, *.mp4)",
            extensions: ["zip", "7z", "rar", "mp4"],
          },
        ],
      });
      if (!selected) return;
      const added = Array.isArray(selected) ? selected : [selected];
      const next = Array.from(new Set([...queuedPaths, ...added]));
      setQueuedPaths(next);
    } catch (err) {
      addToast("error", String(err));
    }
  };

  const handlePickFolders = async () => {
    try {
      const selected = await openDialog({
        title: "选择 Mod 文件夹",
        directory: true,
        multiple: true,
      });
      if (!selected) return;
      const added = Array.isArray(selected) ? selected : [selected];
      const next = Array.from(new Set([...queuedPaths, ...added]));
      setQueuedPaths(next);
    } catch (err) {
      addToast("error", String(err));
    }
  };

  const updateItemPlan = (itemId: string, patch: Partial<DraftPlanState>) => {
    setPlansById((prev) => {
      const curr = prev[itemId];
      if (!curr) return prev;
      const nextChar =
        patch.targetCharacter !== undefined ? patch.targetCharacter : curr.targetCharacter;
      if (patch.targetCharacter !== undefined && patch.targetCharacter !== curr.targetCharacter) {
        void ensureSectionsLoaded(nextChar);
      }
      return {
        ...prev,
        [itemId]: {
          ...curr,
          ...patch,
          targetSectionId:
            patch.targetCharacter !== undefined && patch.targetCharacter !== curr.targetCharacter
              ? ""
              : patch.targetSectionId !== undefined
              ? patch.targetSectionId
              : curr.targetSectionId,
        },
      };
    });
  };

  const activeImportCount = useMemo(() => {
    return items.filter((it) => !plansById[it.itemId]?.skip).length;
  }, [items, plansById]);

  const handleExecuteImport = async () => {
    if (!sessionId || items.length === 0) return;
    setInstalling(true);
    try {
      const plans: ImportPlanItem[] = items.map((it) => {
        const draft = plansById[it.itemId];
        return {
          itemId: it.itemId,
          targetCharacter:
            characterLockActive && lockedCharacter
              ? lockedCharacter
              : draft?.targetCharacter || "其他",
          targetModName: (draft?.targetModName || it.suggestedModName || it.displayName).trim(),
          targetSectionId: draft?.targetSectionId || "",
          importKind: it.importKind,
          skip: Boolean(draft?.skip),
        };
      });

      const res = await api.executeImportPlan(sessionId, plans);
      sessionIdRef.current = null;
      setSessionId(null);
      setSummary(res);
      setStep(3);

      if (res.installedCount > 0) {
        bumpCharactersTick();
        bumpModsTick();
        void refreshRabbitFxStatus();
        addToast("success", `成功导入 ${res.installedCount} 个 Mod`);
      } else if (res.failedCount > 0) {
        addToast("error", `${res.failedCount} 个 Mod 导入失败，请查看详情`);
      }
    } catch (err) {
      addToast("error", `导入执行失败：${String(err)}`);
    } finally {
      setInstalling(false);
    }
  };

  const handleResetWizard = () => {
    if (sessionIdRef.current) {
      cleanupSession(sessionIdRef.current);
      sessionIdRef.current = null;
    }
    setSessionId(null);
    setQueuedPaths([]);
    setItems([]);
    setSkippedMessages([]);
    setPlansById({});
    setSummary(null);
    setStep(1);
  };

  const subtitle =
    step === 1
      ? "第 1 / 3 步：选择 ZIP / 7z / RAR / QAQM MP4 伪装包或 Mod 文件夹"
      : step === 2
      ? `第 2 / 3 步：核对归属角色、Mod 名称与外观分区（共识别 ${items.length} 项）`
      : "第 3 / 3 步：批量导入结果汇总";

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!analyzing && !installing) onClose();
      }}
      title="批量 Mod 导入向导"
      subtitle={subtitle}
      maxWidthClass="max-w-3xl"
      closeOnBackdrop={!analyzing && !installing}
      footer={
        <>
          {step === 1 && (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={analyzing}
                className="rounded-xl border border-[var(--border-subtle)] px-4 py-2 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() =>
                  void runAnalysis(queuedPaths, characterLockActive ? lockedCharacter : null)
                }
                disabled={analyzing || queuedPaths.length === 0}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] disabled:opacity-50"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>{analyzing ? "正在解压与智能分析..." : `下一步：解析 (${queuedPaths.length})`}</span>
              </button>
            </>
          )}

          {step === 2 && (
            <>
              <button
                type="button"
                onClick={handleResetWizard}
                disabled={installing}
                className="rounded-xl border border-[var(--border-subtle)] px-4 py-2 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] disabled:opacity-50"
              >
                返回重选
              </button>
              <button
                type="button"
                onClick={onClose}
                disabled={installing}
                className="rounded-xl border border-[var(--border-subtle)] px-4 py-2 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleExecuteImport()}
                disabled={installing || activeImportCount === 0}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] disabled:opacity-50"
              >
                <Archive className="h-3.5 w-3.5" />
                <span>{installing ? "正在写入 Mods 目录..." : `开始导入 (${activeImportCount} 项)`}</span>
              </button>
            </>
          )}

          {step === 3 && (
            <>
              <button
                type="button"
                onClick={handleResetWizard}
                className="rounded-xl border border-[var(--border-subtle)] px-4 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface)]"
              >
                继续导入其他 Mod
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]"
              >
                完成并关闭
              </button>
            </>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {/* Stepper pills */}
        <div className="flex items-center gap-2 text-[11px]">
          {[
            { num: 1, label: "1. 选择导入源" },
            { num: 2, label: "2. 确认角色与分区" },
            { num: 3, label: "3. 导入结果" },
          ].map((s) => (
            <div
              key={s.num}
              className={`rounded-lg px-2.5 py-1 font-medium ${
                step === s.num
                  ? "bg-[var(--accent)] text-[var(--accent-contrast)]"
                  : step > s.num
                  ? "bg-emerald-500/15 text-emerald-500"
                  : "bg-[var(--bg-elevated)] text-[var(--text-muted)]"
              }`}
            >
              {s.label}
            </div>
          ))}

          {lockedCharacter && (
            <div className="ml-auto flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-1 text-[11px]">
              {characterLockActive ? (
                <Lock className="h-3 w-3 text-[var(--accent)]" />
              ) : (
                <Unlock className="h-3 w-3 text-[var(--text-muted)]" />
              )}
              <span className="text-[var(--text-secondary)]">
                {characterLockActive
                  ? `已锁定角色：${lockedCharacter}`
                  : `原上下文角色：${lockedCharacter}（已解锁）`}
              </span>
              {step === 2 && (
                <button
                  type="button"
                  onClick={() => setCharacterLockActive((v) => !v)}
                  className="ml-1 font-semibold text-[var(--accent)] hover:underline"
                >
                  {characterLockActive ? "解锁改选" : "重新锁定"}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Step 1: Select files or folders */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => void handlePickArchives()}
                disabled={analyzing}
                className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-elevated)] p-6 text-center transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] disabled:opacity-50"
              >
                <FileArchive className="h-7 w-7 text-[var(--accent)]" />
                <div className="text-xs font-semibold text-[var(--text-primary)]">
                  选择 Mod 压缩包 / MP4
                </div>
                <div className="text-[11px] text-[var(--text-secondary)]">
                  支持 ZIP（GBK/UTF-8）、7z、RAR 及 QAQM v2 MP4 伪装包
                </div>
              </button>

              <button
                type="button"
                onClick={() => void handlePickFolders()}
                disabled={analyzing}
                className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-elevated)] p-6 text-center transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] disabled:opacity-50"
              >
                <FolderPlus className="h-7 w-7 text-[var(--accent)]" />
                <div className="text-xs font-semibold text-[var(--text-primary)]">
                  选择已解压 Mod 文件夹
                </div>
                <div className="text-[11px] text-[var(--text-secondary)]">
                  支持多选 Mod 目录，或整套包含子 Mod 的合集包
                </div>
              </button>
            </div>

            {queuedPaths.length > 0 && (
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="font-semibold text-[var(--text-primary)]">
                    待解析列表（{queuedPaths.length} 个来源）
                  </span>
                  <button
                    type="button"
                    onClick={() => setQueuedPaths([])}
                    disabled={analyzing}
                    className="text-[11px] text-[var(--danger)] hover:underline"
                  >
                    清空列表
                  </button>
                </div>
                <div className="max-h-44 space-y-1.5 overflow-y-auto">
                  {queuedPaths.map((p) => (
                    <div
                      key={p}
                      className="flex items-center justify-between gap-2 rounded-lg bg-[var(--bg-surface)] px-2.5 py-1.5 text-[11px]"
                    >
                      <span className="truncate font-mono text-[var(--text-secondary)]">{p}</span>
                      <button
                        type="button"
                        disabled={analyzing}
                        onClick={() => setQueuedPaths((prev) => prev.filter((x) => x !== p))}
                        className="shrink-0 text-[var(--text-muted)] hover:text-[var(--danger)]"
                      >
                        移除
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
              提示：您也可以随时直接将本地压缩包、MP4 伪装包或文件夹拖拽到软件任意界面触发导入；超过 10GB 的超大压缩包会自动弹出提醒；支持自动识别 EFF 特效 Mod 与嵌套多层目录剥离。
            </p>
          </div>
        )}

        {/* Step 2: Configure items */}
        {step === 2 && (
          <div className="space-y-3">
            {skippedMessages.length > 0 && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-500">
                <div className="mb-1 flex items-center gap-1.5 font-semibold">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  <span>部分来源未识别到有效 Mod，已自动跳过：</span>
                </div>
                <ul className="list-inside list-disc space-y-0.5 text-[11px]">
                  {skippedMessages.map((msg, idx) => (
                    <li key={idx}>{msg}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="text-[var(--text-secondary)]">
                将按设置自动处理同名冲突（追加 `(2)`）并同步 Persist Bridge
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setPlansById((prev) => {
                      const next = { ...prev };
                      for (const k of Object.keys(next)) {
                        next[k] = { ...next[k], skip: false };
                      }
                      return next;
                    });
                  }}
                  className="rounded-lg border border-[var(--border-subtle)] px-2.5 py-1 text-[11px] hover:bg-[var(--bg-surface)]"
                >
                  全部纳入
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPlansById((prev) => {
                      const next = { ...prev };
                      for (const k of Object.keys(next)) {
                        next[k] = { ...next[k], skip: true };
                      }
                      return next;
                    });
                  }}
                  className="rounded-lg border border-[var(--border-subtle)] px-2.5 py-1 text-[11px] hover:bg-[var(--bg-surface)]"
                >
                  全部跳过
                </button>
              </div>
            </div>

            <div className="space-y-3">
              {items.map((item) => {
                const draft = plansById[item.itemId] ?? {
                  targetCharacter: lockedCharacter || item.suggestedCharacter || "其他",
                  targetModName: item.suggestedModName || item.displayName,
                  targetSectionId: "",
                  skip: false,
                };
                const effectiveChar =
                  characterLockActive && lockedCharacter ? lockedCharacter : draft.targetCharacter;
                const charSections = sectionsByChar[effectiveChar] ?? [];
                const conf = confidenceLabel(
                  characterLockActive && lockedCharacter ? "locked" : item.matchConfidence
                );

                return (
                  <div
                    key={item.itemId}
                    className={`rounded-2xl border p-3.5 transition-opacity ${
                      draft.skip
                        ? "border-[var(--border-subtle)] bg-[var(--bg-elevated)] opacity-55"
                        : "border-[var(--border-subtle)] bg-[var(--bg-surface)]"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate text-xs font-semibold text-[var(--text-primary)]">
                            {item.displayName}
                          </span>
                          <span className="rounded-md bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                            {formatBytes(item.fileSizeBytes)}
                          </span>
                          <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${conf.cls}`}>
                            {conf.label}
                          </span>
                          {item.isDisguisedMp4 && (
                            <span className="rounded-md bg-purple-500/15 px-1.5 py-0.5 text-[10px] font-medium text-purple-400">
                              MP4 伪装解密
                            </span>
                          )}
                          {item.isEffMod && (
                            <span className="rounded-md bg-cyan-500/15 px-1.5 py-0.5 text-[10px] font-medium text-cyan-400">
                              EFF 特效 Mod
                            </span>
                          )}
                          {item.isLargeArchive && (
                            <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-500">
                              &gt;10GB 大文件警告
                            </span>
                          )}
                        </div>
                        <div className="mt-1 truncate font-mono text-[10px] text-[var(--text-muted)]">
                          {item.originalPath}
                        </div>
                      </div>

                      <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                        <input
                          type="checkbox"
                          checked={!draft.skip}
                          onChange={(e) =>
                            updateItemPlan(item.itemId, { skip: !e.target.checked })
                          }
                          className="accent-[var(--accent)]"
                        />
                        <span>导入此项</span>
                      </label>
                    </div>

                    {item.warning && (
                      <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-500">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        <span>{item.warning}</span>
                      </div>
                    )}

                    {!draft.skip && (
                      <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                        <div>
                          <label className="mb-1 block text-[11px] text-[var(--text-secondary)]">
                            目标角色 / 分类
                          </label>
                          <CharacterSearchPicker
                            value={effectiveChar}
                            characters={characters}
                            disabled={characterLockActive && Boolean(lockedCharacter)}
                            onChange={(name) =>
                              updateItemPlan(item.itemId, { targetCharacter: name })
                            }
                          />
                        </div>

                        <div>
                          <label className="mb-1 block text-[11px] text-[var(--text-secondary)]">
                            Mod 文件夹名称
                          </label>
                          <input
                            type="text"
                            value={draft.targetModName}
                            onChange={(e) =>
                              updateItemPlan(item.itemId, { targetModName: e.target.value })
                            }
                            placeholder="Mod 显示名"
                            className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
                          />
                        </div>

                        <div>
                          <label className="mb-1 block text-[11px] text-[var(--text-secondary)]">
                            外观分区（可选）
                          </label>
                          <select
                            value={draft.targetSectionId}
                            onChange={(e) =>
                              updateItemPlan(item.itemId, { targetSectionId: e.target.value })
                            }
                            className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
                          >
                            <option value="">默认 / 不指定分区</option>
                            {charSections.map((sec) => (
                              <option key={sec.id} value={sec.id}>
                                {sec.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Step 3: Result summary */}
        {step === 3 && summary && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-center">
                <div className="text-lg font-bold text-emerald-500">{summary.installedCount}</div>
                <div className="text-[11px] text-[var(--text-secondary)]">成功导入</div>
              </div>
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 text-center">
                <div className="text-lg font-bold text-[var(--text-primary)]">{summary.skippedCount}</div>
                <div className="text-[11px] text-[var(--text-secondary)]">已跳过</div>
              </div>
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-center">
                <div className="text-lg font-bold text-rose-500">{summary.failedCount}</div>
                <div className="text-[11px] text-[var(--text-secondary)]">失败</div>
              </div>
            </div>

            <div className="max-h-72 space-y-2 overflow-y-auto">
              {summary.results.map((r) => (
                <div
                  key={r.itemId}
                  className="flex items-start justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2.5 text-xs"
                >
                  <div className="flex items-start gap-2 min-w-0">
                    {r.success ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                    ) : (
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
                    )}
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-[var(--text-primary)]">
                        {r.modName} → {r.targetCharacter}
                      </div>
                      <div className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
                        {r.message}
                      </div>
                    </div>
                  </div>
                  <FolderOpen className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
