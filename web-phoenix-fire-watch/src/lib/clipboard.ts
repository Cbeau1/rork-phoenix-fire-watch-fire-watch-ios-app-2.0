/**
 * Copies text to the clipboard. Falls back to a hidden textarea + execCommand when the
 * async Clipboard API is missing or blocked (embedded previews, older Safari, non-secure pages).
 * The fallback textarea is placed inside the open dialog so its focus trap doesn't block selection.
 */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  const active = document.activeElement as HTMLElement | null;
  const host = (active?.closest('[role="dialog"], [role="alertdialog"]') as HTMLElement | null) ?? document.body;
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.top = "0";
  ta.style.left = "0";
  ta.style.width = "1px";
  ta.style.height = "1px";
  ta.style.opacity = "0";
  ta.style.pointerEvents = "none";
  host.appendChild(ta);
  let ok = false;
  try {
    ta.focus({ preventScroll: true });
    ta.select();
    ta.setSelectionRange(0, text.length);
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  } finally {
    host.removeChild(ta);
    active?.focus({ preventScroll: true });
  }
  return ok;
}
