import { useEffect, useState } from "react";

/**
 * Converts a browser KeyboardEvent into an Electron accelerator string
 * (e.g. "Shift+W", "F9") — the format packages/desktop's globalShortcut
 * registration expects. Only covers the keys realistically useful as a
 * broadcast-tool hotkey (letters, digits, F-keys, arrows, a few special
 * keys); anything else is reported as unsupported.
 */
function eventToAccelerator(e: KeyboardEvent): string | null {
  if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return null; // modifier-only, wait for the real key

  const key = mapKey(e.key);
  if (!key) return null;

  const modifiers: string[] = [];
  if (e.ctrlKey) modifiers.push("Control");
  if (e.altKey) modifiers.push("Alt");
  if (e.shiftKey) modifiers.push("Shift");
  if (e.metaKey) modifiers.push("Super");

  return [...modifiers, key].join("+");
}

function mapKey(key: string): string | null {
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) return key;
  if (/^[a-zA-Z]$/.test(key)) return key.toUpperCase();
  if (/^[0-9]$/.test(key)) return key;

  const special: Record<string, string> = {
    " ": "Space",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    Escape: "Esc",
    Enter: "Return",
    Backspace: "Backspace",
    Tab: "Tab",
    Delete: "Delete",
    Insert: "Insert",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
    "+": "Plus",
    "-": "-",
    "=": "=",
  };
  return special[key] ?? null;
}

export function KeybindInput(props: { value: string; onChange: (accelerator: string) => void }) {
  const [listening, setListening] = useState(false);
  const [unsupported, setUnsupported] = useState(false);

  useEffect(() => {
    if (!listening) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setListening(false);
        return;
      }
      if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return; // keep waiting for the real key

      e.preventDefault();
      const accelerator = eventToAccelerator(e);
      if (accelerator) {
        props.onChange(accelerator);
        setListening(false);
      } else {
        setUnsupported(true);
      }
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening]);

  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <button
        type="button"
        className="secondary"
        style={{ minWidth: 130, fontFamily: "monospace" }}
        onClick={() => {
          setUnsupported(false);
          setListening(true);
        }}
        onBlur={() => setListening(false)}
      >
        {listening ? "Press a key… (Esc to cancel)" : props.value || "Click to set…"}
      </button>
      {props.value && !listening && (
        <button type="button" className="secondary" onClick={() => props.onChange("")} title="Clear">
          ✕
        </button>
      )}
      {unsupported && <span style={{ color: "var(--danger)", fontSize: 12 }}>That key isn't supported — try another.</span>}
    </span>
  );
}
