import { format } from "date-fns";

import type { Patrol } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface FireWatchSession {
  id: string;
  number: number;
  /** ISO time of the first patrol in the session. */
  start: string;
  /** ISO time of the last patrol in the session. */
  end: string;
  /** Newest first. */
  patrols: Patrol[];
}

/**
 * Groups patrols into 24-hour fire watch sessions: a session starts at its first patrol and
 * includes every patrol within the following 24 hours. Returned newest session first.
 */
export const groupSessions = (patrols: Patrol[]): FireWatchSession[] => {
  const asc = [...patrols].sort((a, b) => Date.parse(a.dateTime) - Date.parse(b.dateTime));
  const buckets: { startMs: number; list: Patrol[] }[] = [];
  for (const p of asc) {
    const t = Date.parse(p.dateTime);
    const current = buckets[buckets.length - 1];
    if (!current || t >= current.startMs + DAY_MS) buckets.push({ startMs: t, list: [p] });
    else current.list.push(p);
  }
  return buckets
    .map((b, i) => ({
      id: `session-${i + 1}`,
      number: i + 1,
      start: b.list[0].dateTime,
      end: b.list[b.list.length - 1].dateTime,
      patrols: [...b.list].reverse(),
    }))
    .reverse();
};

/** "Sep 25, 2026 – Sep 26, 2026" (single date when the session stays within one day). */
export const sessionRange = (s: Pick<FireWatchSession, "start" | "end">): string => {
  const a = format(new Date(s.start), "MMM d, yyyy");
  const b = format(new Date(s.end), "MMM d, yyyy");
  return a === b ? a : `${a} – ${b}`;
};

export const sessionLabel = (s: FireWatchSession): string => `Fire Watch #${s.number} — ${sessionRange(s)}`;
