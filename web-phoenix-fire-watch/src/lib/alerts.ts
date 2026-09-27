let audioCtx: AudioContext | null = null;

const getAudioContext = (): AudioContext | null => {
  if (audioCtx) return audioCtx;
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    audioCtx = new Ctor();
  } catch {
    return null;
  }
  return audioCtx;
};

/** Unlocks alert audio. Must be called from a tap/click so browsers allow sound later. */
export const primeAlertSound = (): void => {
  const ctx = getAudioContext();
  if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => undefined);
};

/** Plays a short synthesized chime: a gentle double-tone for warnings, an insistent pattern when due. */
export const playAlertSound = (kind: "warning" | "due"): void => {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  const notes = kind === "due" ? [988, 740, 988, 740, 988, 740] : [880, 1319, 880, 1319];
  const step = kind === "due" ? 0.2 : 0.24;
  notes.forEach((freq, i) => {
    const t = ctx.currentTime + 0.05 + i * step;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.4, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + step * 0.92);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + step);
  });
};

export const vibrate = (pattern: number[]): void => {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      // not supported on this device
    }
  }
};

export type NotifyPermission = NotificationPermission | "unsupported";

export const notificationPermission = (): NotifyPermission =>
  typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported";

/** Asks for notification permission (only prompts when the user hasn't decided yet). */
export const requestNotificationPermission = async (): Promise<NotifyPermission> => {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
};

/** Shows a system notification (via the service worker when available) that opens `url` when tapped. */
export const showSystemNotification = async ({
  title,
  body,
  url,
  tag,
  onClick,
}: {
  title: string;
  body: string;
  url: string;
  tag: string;
  onClick: () => void;
}): Promise<void> => {
  if (notificationPermission() !== "granted") return;
  const options: NotificationOptions = {
    body,
    tag,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    requireInteraction: true,
    data: { url },
  };
  try {
    const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    if (reg) {
      await reg.showNotification(title, options);
      return;
    }
    const n = new Notification(title, options);
    n.onclick = () => {
      window.focus();
      onClick();
      n.close();
    };
  } catch (err) {
    console.warn("[PatrolTimer] notification failed", err instanceof Error ? err.message : err);
  }
};
