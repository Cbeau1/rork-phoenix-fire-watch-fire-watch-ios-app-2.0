import type { Recurring } from "./constants";

/** Local "yyyy-MM-dd" for a date (device time, matching the rest of Expenditures). */
export const todayKey = (d: Date = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const daysIn = (y: number, m0: number): number => new Date(y, m0 + 1, 0).getDate();

/** The charge date in a given month — days past the month's end fall on its last day (e.g. the 31st → Feb 28). */
export const occurrenceIn = (y: number, m0: number, day: number): string =>
  `${y}-${String(m0 + 1).padStart(2, "0")}-${String(Math.min(day, daysIn(y, m0))).padStart(2, "0")}`;

export const ordinal = (n: number): string => {
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
};

export const scheduleLabel = (day: number): string => (day >= 29 ? `Monthly on the ${ordinal(day)} (or last day)` : `Monthly on the ${ordinal(day)}`);

interface Sched {
  day: number;
  start: string;
  end: string | null;
  skipBefore?: string | null;
}

const parts = (key: string): [number, number] => [Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1];

/** Every charge date from the start month through `until` (inclusive), capped to 36 entries. */
export const occurrencesThrough = (s: Sched, until: string): string[] => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.start) || s.day < 1 || s.day > 31) return [];
  const out: string[] = [];
  let [y, m] = parts(s.start);
  const floor = s.skipBefore && s.skipBefore > s.start ? s.skipBefore : s.start;
  for (let i = 0; i < 400 && out.length < 36; i++) {
    const occ = occurrenceIn(y, m, s.day);
    if (occ > until) break;
    if (s.end && occ > s.end) break;
    if (occ >= floor) out.push(occ);
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return out;
};

/** The next charge date strictly after today, or null if the schedule has ended. */
export const nextOccurrence = (s: Sched, today: string = todayKey()): string | null => {
  let [y, m] = parts(today > s.start ? today : s.start);
  const floor = [s.start, s.skipBefore ?? "", today].sort().pop() ?? today;
  for (let i = 0; i < 3; i++) {
    const occ = occurrenceIn(y, m, s.day);
    if (occ > today && occ >= floor) return s.end && occ > s.end ? null : occ;
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return null;
};

export type RecurringStatus = "active" | "paused" | "scheduled" | "ended";

export const recurringStatus = (r: Recurring, today: string = todayKey()): RecurringStatus => {
  if (r.paused_at) return "paused";
  if (r.start_on > today) return "scheduled";
  if (!nextOccurrence({ day: r.day_of_month, start: r.start_on, end: r.end_on, skipBefore: r.skip_before }, today)) return "ended";
  return "active";
};

export const toSched = (r: Recurring): Sched => ({ day: r.day_of_month, start: r.start_on, end: r.end_on, skipBefore: r.skip_before });
