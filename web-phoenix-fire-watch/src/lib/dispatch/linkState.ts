import type { Tone } from "@/lib/workforce/constants";

import { fmtAgo, fmtZoned, type BoardShift, type DispatchSettings } from "./api";

export type LinkPhase = "none" | "auto_pending" | "auto_failed" | "revoked" | "expired" | "failed" | "live" | "opened" | "sent" | "created";

export interface LinkState {
  phase: LinkPhase;
  label: string;
  tone: Tone;
  /** A line of detail for tooltips and the dialog. */
  detail: string;
}

/** Guard counts as "live" when the link page pinged within this window. */
export const LIVE_WINDOW_MS = 3 * 60_000;

/** One status for a shift's no-login link, shared by the dispatch board row and the link dialog. */
export const linkState = (s: BoardShift, now: number, tz: string, settings?: DispatchSettings | null): LinkState => {
  const l = s.link;
  const auto = !!(settings?.auto_link_text || settings?.auto_link_email);
  const start = new Date(s.starts_at).getTime();
  const ago = (iso: string) => fmtAgo(Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000)));

  if (!l) {
    if (s.auto_attempt && !s.auto_attempt.ok)
      return { phase: "auto_failed", label: "Auto-send failed", tone: "red", detail: s.auto_attempt.note || "The automatic send didn't go through." };
    if (s.revoked_at) return { phase: "revoked", label: "Revoked", tone: "slate", detail: `Turned off ${fmtZoned(s.revoked_at, tz, true)}` };
    if (auto && start > now && !s.auto_attempt) {
      const at = new Date(start - 60 * 60_000).toISOString();
      const how = settings?.auto_link_text && settings?.auto_link_email ? "Auto-text & email" : settings?.auto_link_text ? "Auto-text" : "Auto-email";
      return { phase: "auto_pending", label: `${how} at ${fmtZoned(at, tz)}`, tone: "blue", detail: "Sent automatically 1 hour before the shift." };
    }
    return { phase: "none", label: "No link", tone: "slate", detail: "No link sent for this shift yet." };
  }
  if (new Date(l.expires_at).getTime() < now) return { phase: "expired", label: "Expired", tone: "slate", detail: `Stopped working ${fmtZoned(l.expires_at, tz, true)}` };
  if (l.send_error && !l.sent_at) return { phase: "failed", label: "Send failed", tone: "red", detail: l.send_error };
  if (l.last_seen_at && now - new Date(l.last_seen_at).getTime() < LIVE_WINDOW_MS)
    return { phase: "live", label: `Live · seen ${ago(l.last_seen_at)}`, tone: "green", detail: "The guard has the link open right now." };
  if (l.opened_at)
    return {
      phase: "opened",
      label: l.last_seen_at ? `Opened · seen ${ago(l.last_seen_at)}` : "Opened",
      tone: "green",
      detail: `First opened ${fmtZoned(l.opened_at, tz, true)}`,
    };
  if (l.sent_at)
    return { phase: "sent", label: `${l.auto ? "Auto-sent" : "Sent"} · not opened`, tone: "amber", detail: `Sent to ${l.sent_to || "the guard"} ${fmtZoned(l.sent_at, tz)}` };
  return { phase: "created", label: "Copied · not opened", tone: "blue", detail: "Link created and copied — not opened yet." };
};
