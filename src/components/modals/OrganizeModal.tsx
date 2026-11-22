import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FolderCheck,
  FolderSync,
  RefreshCw,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { api } from "../../lib/tauri";
import { useAppStore } from "../../store/useAppStore";
import type { CharacterItem, OrganizeScanReport } from "../../types/mod";
import { Modal } from "../ui/Modal";
import { SelectMenu } from "../ui/SelectMenu";

interface OrganizeModalProps {
  open: boolean;
  onClose: () => void;
}

export function OrganizeModal({ open, onClose }: OrganizeModalProps) {
  const bumpCharactersTick = useAppStore((s) => s.bumpCharactersTick);
  const bumpModsTick = useAppStore((s) => s.bumpModsTick);
  const addToast = useAppStore((s) => s.addToast);

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<OrganizeScanReport | null>(null);
  const [characters, setCharacters] = useState<CharacterItem[]>([]);

  const [selectedLegacy, setSelectedLegacy] = useState<Record<string, boolean>>({});
  const [selectedMoves, setSelectedMoves] = useState<Record<string, boolean>>({});
  const [moveTargets, setMoveTargets] = useState<Record<string, string>>({});
  const [selectedDirty, setSelectedDirty] = useState<Record<string, boolean>>({});

  const runScan = useCallback(async () => {
    setLoading(true);
    try {
      const [scanRes, charList] = await Promise.all([
        api.scanModsHealthAndOrganize(),
        api.listCharacters().catch(() => [] as CharacterItem[]),
      ]);
      setReport(scanRes);
      setCharacters(charList);

      const legacyMap: Record<string, boolean> = {};
      for (const l of scanRes.legacyMigrations) legacyMap[l.legacyName] = true;
      setSelectedLegacy(legacyMap);

      const moveMap: Record<string, boolean> = {};
      const targetMap: Record<string, string> = {};
      for (const m of scanRes.misplacedMods) {
        moveMap[m.path] = true;
        targetMap[m.path] = m.suggestedCharacter;
      }
      setSelectedMoves(moveMap);
      setMoveTargets(targetMap);

      const dirtyMap: Record<string, boolean> = {};
      for (const d of scanRes.dirtyItems) dirtyMap[d.path] = true;
      setSelectedDirty(dirtyMap);
    } catch (err) {
      addToast("error", `目录健康检查失败：${String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    if (open) {
      void runScan();
    } else {
      setReport(null);
    }
  }, [open, runScan]);

  const handleCreateDefaultChars = async () => {
    setBusy(true);
    try {
      const created = await api.createMissingDefaultCharacters();
      addToast("success", `已自动创建 ${created} 个标准角色 / 分类目录`);
      bumpCharactersTick();
      await runScan();
    } catch (err) {
      addToast("error", String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleMigrateLegacy = async () => {
    if (!report) return;
    const picked = report.legacyMigrations
      .filter((l) => selectedLegacy[l.legacyName])
      .map((l) => l.legacyName);
    if (picked.length === 0) return;

    setBusy(true);
    try {
      const res = await api.executeLegacyMigrations(picked);
      addToast(
        "success",
        `已迁移 ${res.migratedDirs} 个旧版英文分类，共合并 ${res.movedCount} 个 Mod`
      );
      if (res.warnings.length > 0) {
        addToast("warning", res.warnings[0]);
      }
      bumpCharactersTick();
      bumpModsTick();
      await runScan();
    } catch (err) {
      addToast("error", String(err));
    } finally {
      setBusy(false);
    }
  };

  const chosenMoves = useMemo(() => {
    if (!report) return [];
    return report.misplacedMods
      .filter((m) => selectedMoves[m.path])
      .map((m): [string, string, string] => [
        m.sourceCharacter,
        m.dirName,
        moveTargets[m.path] || m.suggestedCharacter,
      ]);
  }, [report, selectedMoves, moveTargets]);

  const chosenQuarantines = useMemo(() => {
    if (!report) return [];
    return report.dirtyItems.filter((d) => selectedDirty[d.path]).map((d) => d.path);
  }, [report, selectedDirty]);

  const handleApplyDualOrganize = async () => {
    if (chosenMoves.length === 0 && chosenQuarantines.length === 0) return;
    setBusy(true);
    try {
      const res = await api.executeOrganizeActions(chosenMoves, chosenQuarantines);
      addToast(
        "success",
        `已移动 ${res.movedCount} 个错位 Mod，已隔离 ${res.quarantinedCount} 个散落项至 DISABLED_loose-*`
      );
      if (res.warnings.length > 0) {
        addToast("warning", res.warnings[0]);
      }
      bumpCharactersTick();
      bumpModsTick();
      await runScan();
    } catch (err) {
      addToast("error", String(err));
    } finally {
      setBusy(false);
    }
  };

  const characterNames = useMemo(() => {
    const names = new Set(characters.map((c) => c.name));
    if (report) {
      for (const m of report.misplacedMods) {
        names.add(m.suggestedCharacter);
      }
    }
    return Array.from(names);
  }, [characters, report]);

  const allClean =
    report &&
    report.missingDefaultCharacters.length === 0 &&
    report.legacyMigrations.length === 0 &&
    report.misplacedMods.length === 0 &&
    report.dirtyItems.length === 0;

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title="Mods 目录结构体检与一键整理"
      subtitle="检测缺失标准角色目录、旧版英文目录迁移、错放角色 Mod 与散落文件隔离"
      maxWidthClass="max-w-3xl"
      footer={
        <>
          <button
            type="button"
            onClick={() => void runScan()}
            disabled={loading || busy}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] px-4 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface)] disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>重新扫描</span>
          </button>

          {(chosenMoves.length > 0 || chosenQuarantines.length > 0) && (
            <button
              type="button"
              onClick={() => void handleApplyDualOrganize()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent-fill)] px-4 py-2 text-xs font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-fill-hover)] disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>
                执行勾选操作（移动 {chosenMoves.length} / 隔离 {chosenQuarantines.length}）
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-xl border border-[var(--border-subtle)] px-4 py-2 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]"
          >
            关闭
          </button>
        </>
      }
    >
      {loading && !report ? (
        <div className="flex flex-col items-center justify-center py-12 text-xs text-[var(--text-secondary)]">
          <RefreshCw className="h-6 w-6 animate-spin text-[var(--accent)]" />
          <p className="mt-3">正在扫描 EFMI Mods 目录树...</p>
        </div>
      ) : allClean ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-emerald-500/30 bg-emerald-500/10 py-10 text-center">
          <CheckCircle2 className="h-9 w-9 text-emerald-500" />
          <div className="mt-3 text-sm font-semibold text-[var(--text-primary)]">
            Mods 目录结构完全规范
          </div>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            未发现缺失标准分类、旧版英文目录、错放 Mod 或散落脏文件。
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* 1. Missing default characters */}
          {report && report.missingDefaultCharacters.length > 0 && (
            <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <FolderCheck className="h-4 w-4 text-[var(--accent)]" />
                  <h3 className="text-xs font-semibold text-[var(--text-primary)]">
                    缺失标准干员 / 分类目录（{report.missingDefaultCharacters.length} 个）
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => void handleCreateDefaultChars()}
                  disabled={busy}
                  className="rounded-xl bg-[var(--accent-fill)] px-3 py-1.5 text-[11px] font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-fill-hover)] disabled:opacity-50"
                >
                  一键补全全部标准目录
                </button>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {report.missingDefaultCharacters.map((name) => (
                  <span
                    key={name}
                    className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)]"
                  >
                    {name}
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* 2. Legacy English directory migrations */}
          {report && report.legacyMigrations.length > 0 && (
            <section className="rounded-2xl border border-sky-500/30 bg-sky-500/5 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <FolderSync className="h-4 w-4 text-sky-400" />
                  <h3 className="text-xs font-semibold text-[var(--text-primary)]">
                    发现旧版英文分类目录（{report.legacyMigrations.length} 个）
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => void handleMigrateLegacy()}
                  disabled={
                    busy ||
                    !report.legacyMigrations.some((l) => selectedLegacy[l.legacyName])
                  }
                  className="rounded-xl bg-sky-500 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-sky-600 disabled:opacity-50"
                >
                  迁移选中旧版分类至中文目录
                </button>
              </div>
              <div className="mt-2.5 space-y-1.5">
                {report.legacyMigrations.map((item) => (
                  <label
                    key={item.legacyName}
                    className="flex cursor-pointer items-center justify-between gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <input
                        type="checkbox"
                        checked={Boolean(selectedLegacy[item.legacyName])}
                        onChange={(e) =>
                          setSelectedLegacy((prev) => ({
                            ...prev,
                            [item.legacyName]: e.target.checked,
                          }))
                        }
                        className="accent-[var(--accent)]"
                      />
                      <span className="font-mono text-[var(--text-secondary)]">
                        {item.legacyName}
                      </span>
                      <ArrowRight className="h-3.5 w-3.5 text-sky-400" />
                      <span className="font-semibold text-[var(--text-primary)]">
                        {item.targetName}
                      </span>
                    </div>
                    <span className="shrink-0 text-[11px] text-[var(--text-muted)]">
                      含 {item.modCount} 个子目录
                    </span>
                  </label>
                ))}
              </div>
            </section>
          )}

          {/* 3. Group A: Misplaced mods */}
          {report && report.misplacedMods.length > 0 && (
            <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
              <div className="mb-2.5 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <h3 className="text-xs font-semibold text-[var(--text-primary)]">
                  组 A：疑似错放分类的 Mod（{report.misplacedMods.length} 个）
                </h3>
              </div>
              <div className="max-h-56 space-y-2 overflow-y-auto">
                {report.misplacedMods.map((item) => (
                  <div
                    key={item.path}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-xs"
                  >
                    <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2">
                      <input
                        type="checkbox"
                        checked={Boolean(selectedMoves[item.path])}
                        onChange={(e) =>
                          setSelectedMoves((prev) => ({
                            ...prev,
                            [item.path]: e.target.checked,
                          }))
                        }
                        className="mt-1 accent-[var(--accent)]"
                      />
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-[var(--text-primary)]">
                          {item.modName}
                        </div>
                        <div className="text-[11px] text-[var(--text-secondary)]">
                          当前位于「{item.sourceCharacter}」 · {item.reason}
                        </div>
                      </div>
                    </label>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-[var(--text-muted)]">移至</span>
                      <SelectMenu
                        aria-label={`将「${item.modName}」移至`}
                        size="compact"
                        disabled={busy}
                        value={moveTargets[item.path] || item.suggestedCharacter}
                        onChange={(value) =>
                          setMoveTargets((prev) => ({
                            ...prev,
                            [item.path]: value,
                          }))
                        }
                        options={characterNames.map((name) => ({ value: name, label: name }))}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 4. Group B: Dirty loose files & invalid folders */}
          {report && report.dirtyItems.length > 0 && (
            <section className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-4">
              <div className="mb-1 flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-rose-500" />
                <h3 className="text-xs font-semibold text-[var(--text-primary)]">
                  组 B：散落零碎文件 / 无效空结构（{report.dirtyItems.length} 项）
                </h3>
              </div>
              <p className="mb-2.5 text-[11px] text-[var(--text-secondary)]">
                勾选条目将被安全重命名或隔离至 <code className="rounded bg-[var(--bg-elevated)] px-1">DISABLED_loose-时间戳</code> 文件夹，不会直接删除文件。
              </p>
              <div className="max-h-56 space-y-1.5 overflow-y-auto">
                {report.dirtyItems.map((item) => (
                  <label
                    key={item.path}
                    className="flex cursor-pointer items-start justify-between gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-xs"
                  >
                    <div className="flex min-w-0 items-start gap-2">
                      <input
                        type="checkbox"
                        checked={Boolean(selectedDirty[item.path])}
                        onChange={(e) =>
                          setSelectedDirty((prev) => ({
                            ...prev,
                            [item.path]: e.target.checked,
                          }))
                        }
                        className="mt-0.5 accent-[var(--accent)]"
                      />
                      <div className="min-w-0">
                        <div className="truncate font-medium text-[var(--text-primary)]">
                          {item.name}
                          <span className="ml-2 rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                            {item.kind}
                          </span>
                        </div>
                        <div className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
                          {item.parentCharacter ? `所属目录：${item.parentCharacter} · ` : "位于 Mods 根目录 · "}
                          {item.reason}
                        </div>
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}
