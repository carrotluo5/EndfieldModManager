// These codes are accepted by the global-hotkey accelerator parser.
const namedKeys = new Set([
  "Backquote", "Backslash", "BracketLeft", "BracketRight", "Comma", "Equal", "Minus",
  "Period", "Quote", "Semicolon", "Slash", "Backspace", "CapsLock", "Enter", "Space", "Tab",
  "Delete", "End", "Home", "Insert", "PageDown", "PageUp", "Pause", "PrintScreen",
  "ScrollLock", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp", "NumLock",
  "NumpadAdd", "NumpadDecimal", "NumpadDivide", "NumpadMultiply", "NumpadSubtract",
]);

export function overlayHotkeyFromEvent(event: KeyboardEvent): string | null {
  if (event.isComposing || event.repeat || event.metaKey || event.getModifierState("AltGraph")) {
    return null;
  }

  const code = event.code && event.code !== "Unidentified" ? event.code : event.key;
  let key: string;
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
  else if (/^[a-z0-9]$/i.test(code)) key = code.toUpperCase();
  else if (code === " ") key = "Space";
  else if (code === "NumpadEnter") key = "Enter";
  else if (/^(F([1-9]|1[0-9]|2[0-4])|Numpad[0-9])$/.test(code) || namedKeys.has(code)) key = code;
  else return null;

  const parts = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  return [...parts, key].join("+");
}
