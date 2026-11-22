import { useEffect, useState } from "react";
import { Keyboard, RotateCcw } from "lucide-react";
import type { HotkeyItem } from "../../types/mod";
import { Modal } from "./Modal";

interface HotkeyRecorderModalProps {
  open: boolean;
  hotkey: HotkeyItem | null;
  onClose: () => void;
  onSave: (newKeyExpr: string) => Promise<void>;
}

const KEY_CODE_MAP: Record<string, string> = {
  ArrowUp: "VK_UP",
  ArrowDown: "VK_DOWN",
  ArrowLeft: "VK_LEFT",
  ArrowRight: "VK_RIGHT",
  Space: "VK_SPACE",
  Enter: "VK_RETURN",
  NumpadEnter: "VK_RETURN",
  Backspace: "VK_BACK",
  Tab: "VK_TAB",
  Home: "VK_HOME",
  End: "VK_END",
  Insert: "VK_INSERT",
  Delete: "VK_DELETE",
  PageUp: "VK_PRIOR",
  PageDown: "VK_NEXT",
  Semicolon: "VK_OEM_1",
  Equal: "VK_OEM_PLUS",
  Comma: "VK_OEM_COMMA",
  Minus: "VK_OEM_MINUS",
  Period: "VK_OEM_PERIOD",
  Slash: "VK_OEM_2",
  Backquote: "VK_OEM_3",
  BracketLeft: "VK_OEM_4",
  Backslash: "VK_OEM_5",
  BracketRight: "VK_OEM_6",
  Quote: "VK_OEM_7",
  NumpadMultiply: "VK_MULTIPLY",
  NumpadAdd: "VK_ADD",
  NumpadSubtract: "VK_SUBTRACT",
  NumpadDecimal: "VK_DECIMAL",
  NumpadDivide: "VK_DIVIDE",
};

function mapMainKeyFromEvent(e: KeyboardEvent): string | null {
  const { code, key } = e;
  if (
    ["Control", "Shift", "Alt", "Meta", "ControlLeft", "ControlRight", "ShiftLeft", "ShiftRight", "AltLeft", "AltRight"].includes(
      code
    ) ||
    ["Control", "Shift", "Alt", "Meta", "Escape"].includes(key)
  ) {
    return null;
  }

  if (KEY_CODE_MAP[code]) return KEY_CODE_MAP[code];
  if (/^Key([A-Z])$/.test(code)) return code.slice(3);
  if (/^Digit([0-9])$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return `VK_${code}`;
  if (/^Numpad([0-9])$/.test(code)) return `VK_NUMPAD${code.slice(6)}`;

  if (key.length === 1 && /[a-zA-Z0-9]/.test(key)) {
    return key.toUpperCase();
  }
  return null;
}

export function HotkeyRecorderModal({
  open,
  hotkey,
  onClose,
  onSave,
}: HotkeyRecorderModalProps) {
  const [expr, setExpr] = useState("");
  const [noModifiers, setNoModifiers] = useState(false);
  const [listening, setListening] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !hotkey) return;
    const initialRaw = hotkey.rawKeys[0] ?? "";
    setNoModifiers(/\bno_modifiers\b/i.test(initialRaw));
    setExpr(initialRaw);
    setListening(true);
    setErrorMsg(null);
    setSaving(false);
  }, [open, hotkey]);

  useEffect(() => {
    if (!open || !listening) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        setListening(false);
        return;
      }
      e.preventDefault();
      e.stopPropagation();

      const mainKey = mapMainKeyFromEvent(e);
      if (!mainKey) return;

      const parts: string[] = [];
      if (e.ctrlKey) parts.push("CTRL");
      if (e.altKey) parts.push("ALT");
      if (e.shiftKey) parts.push("SHIFT");
      if (parts.length === 0 && noModifiers) {
        parts.push("NO_MODIFIERS");
      }
      parts.push(mainKey);

      setExpr(parts.join(" "));
      setErrorMsg(null);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [open, listening, noModifiers]);

  const handleToggleNoModifiers = (checked: boolean) => {
    setNoModifiers(checked);
    const cleaned = expr
      .split(/\s+/)
      .filter((t) => t && !/^no_modifiers$/i.test(t));
    const hasMod = cleaned.some((t) => /^(ctrl|alt|shift)$/i.test(t));
    if (checked && !hasMod && cleaned.length > 0) {
      setExpr(`NO_MODIFIERS ${cleaned.join(" ")}`);
    } else {
      setExpr(cleaned.join(" "));
    }
  };

  const handleConfirm = async () => {
    const clean = expr.trim();
    if (!clean) {
      setErrorMsg("请按下按键或输入有效的 3DMigoto 快捷键表达式");
      return;
    }
    setSaving(true);
    setErrorMsg(null);
    try {
      await onSave(clean);
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => !saving && onClose()}
      title="修改 INI 快捷键"
      subtitle={hotkey ? `${hotkey.iniRelPath} · [${hotkey.section}]` : undefined}
      maxWidthClass="max-w-md"
      footer={
        <>
          <button
            type="button"
            onClick={() => hotkey && setExpr(hotkey.rawKeys[0] ?? "")}
            disabled={saving}
            className="mr-auto inline-flex items-center gap-1 rounded-xl border border-[var(--border-subtle)] px-3 py-2 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>恢复当前键位</span>
          </button>
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
            onClick={() => void handleConfirm()}
            disabled={saving || !expr.trim()}
            className="rounded-xl bg-[var(--accent-fill)] px-4 py-2 text-xs font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-fill-hover)] disabled:opacity-45"
          >
            {saving ? "写回 INI..." : "保存并写回 INI"}
          </button>
        </>
      }
    >
      <div className="space-y-4 text-xs">
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
          <div className="text-[11px] text-[var(--text-secondary)]">功能描述</div>
          <div className="mt-0.5 text-sm font-semibold text-[var(--text-primary)]">
            {hotkey?.alias || hotkey?.description}
          </div>
        </div>

        {/* Capture box */}
        <button
          type="button"
          onClick={() => setListening((v) => !v)}
          className={`flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 p-5 text-center transition-all ${
            listening
              ? "border-[var(--accent)] bg-[var(--accent-soft)]"
              : "border-dashed border-[var(--border-strong)] bg-[var(--bg-elevated)] hover:border-[var(--accent)]"
          }`}
        >
          <Keyboard
            className={`h-7 w-7 ${listening ? "text-[var(--accent)]" : "text-[var(--text-muted)]"}`}
          />
          <div className="font-mono text-base font-bold text-[var(--text-primary)]">
            {expr || "请直接按下新快捷键组合..."}
          </div>
          <span className="text-[11px] text-[var(--text-secondary)]">
            {listening
              ? "正在录制按键（支持 Ctrl / Alt / Shift + 任意键；点击此处可暂停录制）"
              : "录制已暂停（点击此处重新开始按键捕获）"}
          </span>
        </button>

        <label className="flex items-center justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2">
          <div>
            <div className="font-medium text-[var(--text-primary)]">
              严格无修饰键（NO_MODIFIERS）
            </div>
            <div className="text-[10px] text-[var(--text-muted)]">
              勾选后按下 Ctrl/Alt/Shift + 该键时不会误触发（单键推荐）
            </div>
          </div>
          <input
            type="checkbox"
            checked={noModifiers}
            onChange={(e) => handleToggleNoModifiers(e.target.checked)}
            className="h-4 w-4 accent-[var(--accent)]"
          />
        </label>

        <div>
          <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">
            3DMigoto 原始键值（支持手动微调，如 XB_A、VK_F8 等）
          </label>
          <input
            type="text"
            value={expr}
            onFocus={() => setListening(false)}
            onChange={(e) => setExpr(e.target.value)}
            placeholder="例如 CTRL ALT VK_K"
            className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 font-mono text-xs text-[var(--text-primary)]"
          />
        </div>

        <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
          保存后将精确更新对应 `.ini` 文件区块中的 `key =` 行，并同步更新 Persist Bridge 备份文件（若存在），游戏内按 F10 即可立即生效。
        </p>

        {errorMsg && (
          <p className="rounded-xl bg-[var(--danger-soft)] px-3 py-2 text-xs text-[var(--danger)]">
            {errorMsg}
          </p>
        )}
      </div>
    </Modal>
  );
}
