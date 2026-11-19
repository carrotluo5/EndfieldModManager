import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { TagPoolItem } from "../../types/mod";
import { Modal } from "./Modal";

interface TagPoolModalProps {
  open: boolean;
  tags: TagPoolItem[];
  onClose: () => void;
  onSave: (nextTags: TagPoolItem[]) => Promise<void>;
}

const COLOR_PRESETS = [
  "#ec4899",
  "#f43f5e",
  "#f59e0b",
  "#10b981",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#64748b",
];

export function TagPoolModal({ open, tags, onClose, onSave }: TagPoolModalProps) {
  const [drafts, setDrafts] = useState<TagPoolItem[]>([]);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(COLOR_PRESETS[0]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDrafts(tags.map((t) => ({ ...t })));
    setNewName("");
    setNewColor(COLOR_PRESETS[0]);
    setSaving(false);
  }, [open, tags]);

  const handleAdd = () => {
    const clean = newName.trim();
    if (!clean) return;
    if (drafts.some((d) => d.name.toLowerCase() === clean.toLowerCase())) return;
    setDrafts((prev) => [
      ...prev,
      { id: `tag_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, name: clean, color: newColor },
    ]);
    setNewName("");
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const cleaned = drafts
        .map((d) => ({ ...d, name: d.name.trim() }))
        .filter((d) => d.name.length > 0);
      await onSave(cleaned);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => !saving && onClose()}
      title="管理本地标签池"
      subtitle="自定义全局常用标签与色彩样式（纯本地储存，永久开放）"
      maxWidthClass="max-w-lg"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-xl border border-[var(--border-subtle)] px-4 py-2 text-xs font-medium text-[var(--text-secondary)]"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] disabled:opacity-50"
          >
            {saving ? "保存中..." : "保存标签池"}
          </button>
        </>
      }
    >
      <div className="space-y-4 text-xs">
        <div className="flex items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-2.5">
          <input
            type="color"
            value={newColor}
            onChange={(e) => setNewColor(e.target.value)}
            title="选择标签颜色"
            className="h-7 w-8 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
          />
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
            }}
            placeholder="输入新标签名称，例如：泳装 / 高精 / 特效..."
            className="flex-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs text-[var(--text-primary)]"
          />
          <button
            type="button"
            onClick={handleAdd}
            className="inline-flex items-center gap-1 rounded-lg bg-[var(--accent)] px-3 py-1.5 font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>添加</span>
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {COLOR_PRESETS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setNewColor(c)}
              style={{ backgroundColor: c }}
              className={`h-5 w-5 rounded-full border-2 ${
                newColor === c ? "border-[var(--text-primary)] scale-110" : "border-transparent"
              }`}
            />
          ))}
        </div>

        {drafts.length > 0 ? (
          <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
            {drafts.map((item, idx) => (
              <div
                key={item.id}
                className="flex items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-1.5"
              >
                <input
                  type="color"
                  value={item.color}
                  onChange={(e) =>
                    setDrafts((prev) =>
                      prev.map((d, i) => (i === idx ? { ...d, color: e.target.value } : d))
                    )
                  }
                  className="h-6 w-7 shrink-0 cursor-pointer border-0 bg-transparent p-0"
                />
                <input
                  type="text"
                  value={item.name}
                  onChange={(e) =>
                    setDrafts((prev) =>
                      prev.map((d, i) => (i === idx ? { ...d, name: e.target.value } : d))
                    )
                  }
                  className="flex-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1 text-xs text-[var(--text-primary)]"
                />
                <button
                  type="button"
                  onClick={() => setDrafts((prev) => prev.filter((_, i) => i !== idx))}
                  title="删除标签"
                  className="rounded-lg p-1 text-[var(--danger)] hover:bg-[var(--danger-soft)]"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="py-6 text-center text-xs text-[var(--text-muted)]">
            暂无全局标签，可在上方快速添加常用分类标签
          </p>
        )}
      </div>
    </Modal>
  );
}
