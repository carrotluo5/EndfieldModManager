import { useState } from "react";
import { ImagePlus, Layers, Pencil, Plus, Shirt, Trash2 } from "lucide-react";
import { api, buildMediaUrl } from "../../lib/tauri";
import { useAppStore } from "../../store/useAppStore";
import type { AppearanceSection } from "../../types/mod";
import { ContextMenu, type ContextMenuState } from "../ui/ContextMenu";
import { ImageCropModal } from "../ui/ImageCropModal";
import { Modal } from "../ui/Modal";

interface AppearanceSectionBarProps {
  characterName: string;
  sections: AppearanceSection[];
  selectedSectionId: string;
  onSelectSection: (sectionId: string) => void;
  totalModCount: number;
  totalEnabledCount: number;
  onSectionsChanged: () => void;
}

export function AppearanceSectionBar({
  characterName,
  sections,
  selectedSectionId,
  onSelectSection,
  totalModCount,
  totalEnabledCount,
  onSectionsChanged,
}: AppearanceSectionBarProps) {
  const addToast = useAppStore((s) => s.addToast);

  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingSection, setEditingSection] = useState<AppearanceSection | null>(null);
  const [formName, setFormName] = useState("");
  const [formNameEn, setFormNameEn] = useState("");
  const [formCoverDataUrl, setFormCoverDataUrl] = useState<string | null>(null);
  const [existingCoverUrl, setExistingCoverUrl] = useState<string | null>(null);
  const [clearCover, setClearCover] = useState(false);
  const [saving, setSaving] = useState(false);

  const [cropOpen, setCropOpen] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<AppearanceSection | null>(null);
  const [deleting, setDeleting] = useState(false);

  const openCreateModal = () => {
    setEditingSection(null);
    setFormName("");
    setFormNameEn("");
    setFormCoverDataUrl(null);
    setExistingCoverUrl(null);
    setClearCover(false);
    setEditorOpen(true);
  };

  const openEditModal = (sec: AppearanceSection) => {
    setEditingSection(sec);
    setFormName(sec.name);
    setFormNameEn(sec.nameEn);
    setFormCoverDataUrl(null);
    setExistingCoverUrl(buildMediaUrl(sec.coverPath, sec.coverMtime));
    setClearCover(false);
    setEditorOpen(true);
  };

  const handleSaveSection = async () => {
    const trimmed = formName.trim();
    if (!trimmed) {
      addToast("warning", "请输入外观分区名称");
      return;
    }
    setSaving(true);
    try {
      if (editingSection) {
        await api.updateAppearanceSection(
          characterName,
          editingSection.id,
          trimmed,
          formNameEn.trim(),
          formCoverDataUrl,
          clearCover
        );
        addToast("success", `已更新外观分区「${trimmed}」`);
      } else {
        const created = await api.createAppearanceSection(
          characterName,
          trimmed,
          formNameEn.trim(),
          formCoverDataUrl
        );
        onSelectSection(created.id);
        addToast("success", `已新建外观分区「${trimmed}」`);
      }
      setEditorOpen(false);
      onSectionsChanged();
    } catch (err) {
      addToast("error", String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const movedCount = await api.deleteAppearanceSection(characterName, deleteTarget.id);
      if (selectedSectionId === deleteTarget.id) {
        onSelectSection("all");
      }
      addToast(
        "success",
        movedCount > 0
          ? `已删除分区「${deleteTarget.name}」，${movedCount} 个 Mod 已归回基础外观`
          : `已删除分区「${deleteTarget.name}」`
      );
      setDeleteTarget(null);
      onSectionsChanged();
    } catch (err) {
      addToast("error", String(err));
    } finally {
      setDeleting(false);
    }
  };

  const handleSectionContextMenu = (e: React.MouseEvent, sec: AppearanceSection) => {
    e.preventDefault();
    e.stopPropagation();
    if (sec.isBase) return;
    setCtxMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          key: "edit",
          label: "编辑外观分区",
          icon: <Pencil className="h-3.5 w-3.5" />,
          onClick: () => openEditModal(sec),
        },
        { divider: true, key: "d1" },
        {
          key: "delete",
          label: "删除外观分区",
          icon: <Trash2 className="h-3.5 w-3.5" />,
          danger: true,
          onClick: () => setDeleteTarget(sec),
        },
      ],
    });
  };

  const previewImgUrl = formCoverDataUrl ?? (clearCover ? null : existingCoverUrl);

  return (
    <>
      <div role="group" aria-label="外观分区" className="flex items-stretch gap-2.5 overflow-x-auto px-0.5 pt-0.5 pb-1">
        <button
          type="button"
          onClick={() => onSelectSection("all")}
          aria-pressed={selectedSectionId === "all"}
          className={`flex min-h-14 shrink-0 items-center gap-2.5 rounded-2xl border px-3 py-2 text-left transition-colors ${
            selectedSectionId === "all"
              ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
              : "glass-surface text-[var(--text-primary)] hover:border-[var(--border-strong)]"
          }`}
        >
          <Layers className="h-5 w-5 shrink-0" />
          <span className="grid gap-0.5">
            <span className="text-sm font-semibold whitespace-nowrap">全部外观</span>
            <span className="text-xs tabular-nums text-[var(--text-secondary)]">
              {totalEnabledCount}/{totalModCount} 已启用
            </span>
          </span>
        </button>

        {sections.map((sec) => {
          const active = selectedSectionId === sec.id;
          const coverUrl = buildMediaUrl(sec.coverPath, sec.coverMtime);
          return (
            <button
              key={sec.id}
              type="button"
              onClick={() => onSelectSection(sec.id)}
              onContextMenu={(e) => handleSectionContextMenu(e, sec)}
              aria-pressed={active}
              title={sec.isBase ? sec.name : `${sec.name}（右键可编辑或删除）`}
              className={`flex min-h-14 min-w-30 shrink-0 items-center gap-2.5 rounded-2xl border px-2.5 py-2 text-left transition-colors ${
                active
                  ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "glass-surface text-[var(--text-primary)] hover:border-[var(--border-strong)]"
              }`}
            >
              {coverUrl ? (
                <img
                  src={coverUrl}
                  alt=""
                  className="h-10 w-8 shrink-0 rounded-lg object-cover"
                />
              ) : (
                <span className="grid h-10 w-8 shrink-0 place-items-center rounded-lg bg-[var(--bg-elevated)] text-[var(--text-secondary)]">
                  <Shirt className="h-4 w-4" />
                </span>
              )}
              <span className="grid gap-0.5">
                <span className="max-w-44 truncate text-sm font-semibold">{sec.name}</span>
                <span className="text-xs tabular-nums text-[var(--text-secondary)]">
                  {sec.enabledCount}/{sec.modCount} 已启用
                </span>
              </span>
            </button>
          );
        })}

        <button
          type="button"
          onClick={openCreateModal}
          className="flex min-h-14 shrink-0 items-center gap-1.5 rounded-2xl border border-dashed border-[var(--border-strong)] px-3 text-sm font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent-soft)]"
        >
          <Plus className="h-3.5 w-3.5" />
          <span className="whitespace-nowrap">新建分区</span>
        </button>
      </div>

      <ContextMenu menu={ctxMenu} onClose={() => setCtxMenu(null)} />

      {/* Create / Edit section modal */}
      <Modal
        open={editorOpen}
        onClose={() => !saving && setEditorOpen(false)}
        title={editingSection ? "编辑外观分区" : "新建外观分区"}
        subtitle={`角色分类：${characterName}`}
        maxWidthClass="max-w-md"
        footer={
          <>
            <button
              type="button"
              onClick={() => setEditorOpen(false)}
              disabled={saving}
              className="rounded-xl border border-[var(--border-subtle)] px-4 py-2 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSaveSection}
              disabled={saving}
              className="rounded-xl bg-[var(--accent-fill)] px-4 py-2 text-xs font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-fill-hover)] disabled:opacity-50"
            >
              {saving ? "保存中..." : "保存"}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex items-start gap-4">
            <div className="flex shrink-0 flex-col items-center gap-2">
              <div className="relative h-28 w-22 overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
                {previewImgUrl ? (
                  <img
                    src={previewImgUrl}
                    alt="分区封面"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-[10px] text-[var(--text-muted)]">
                    <ImagePlus className="h-5 w-5" />
                    <span>可选封面</span>
                  </div>
                )}
              </div>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setCropOpen(true)}
                  className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1 text-[11px] font-medium text-[var(--text-primary)] hover:border-[var(--border-strong)]"
                >
                  {previewImgUrl ? "更换" : "上传"}
                </button>
                {previewImgUrl && (
                  <button
                    type="button"
                    onClick={() => {
                      setFormCoverDataUrl(null);
                      setClearCover(true);
                    }}
                    className="rounded-lg border border-[var(--border-subtle)] px-2 py-1 text-[11px] text-[var(--danger)] hover:bg-[var(--danger-soft)]"
                  >
                    清除
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
                  分区名称 *
                </label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="例如：夏装 / 皮肤 / 联动衣装"
                  className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
                  英文标识（可选）
                </label>
                <input
                  type="text"
                  value={formNameEn}
                  onChange={(e) => setFormNameEn(e.target.value)}
                  placeholder="例如：Summer Skin"
                  className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
                />
              </div>
            </div>
          </div>
        </div>
      </Modal>

      <ImageCropModal
        open={cropOpen}
        title="裁剪外观分区封面 (303×386)"
        aspect={303 / 386}
        initialImageUrl={previewImgUrl}
        onClose={() => setCropOpen(false)}
        onConfirm={(dataUrl) => {
          setFormCoverDataUrl(dataUrl);
          setClearCover(false);
        }}
      />

      {/* Delete confirmation modal */}
      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => !deleting && setDeleteTarget(null)}
        title="删除外观分区"
        maxWidthClass="max-w-md"
        footer={
          <>
            <button
              type="button"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
              className="rounded-xl border border-[var(--border-subtle)] px-4 py-2 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleConfirmDelete}
              disabled={deleting}
              className="rounded-xl bg-[var(--danger)] px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {deleting ? "删除中..." : "确认删除分区"}
            </button>
          </>
        }
      >
        <div className="space-y-2 text-sm text-[var(--text-secondary)]">
          <p>
            确定要删除外观分区
            <span className="mx-1 font-semibold text-[var(--text-primary)]">
              「{deleteTarget?.name}」
            </span>
            吗？
          </p>
          <p className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2.5 text-xs leading-relaxed">
            仅删除分区归类，该分区下所有 Mod 将自动归回「基础外观」，不会删除任何 Mod 文件。
          </p>
        </div>
      </Modal>
    </>
  );
}
