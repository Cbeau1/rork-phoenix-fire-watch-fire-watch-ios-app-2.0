import { addDays, format, isSameMonth, parseISO, startOfWeek } from "date-fns";

/** A person who can be scheduled. Optionally linked to a team login so officers see "My shifts". */
export interface Staff {
  id: string;
  name: string;
  profileId: string | null;
  createdAt: string;
}

/** One scheduled shift at a property. `start`/`end` are "HH:mm"; an end at or before the start ends the next day. */
export interface Shift {
  id: string;
  propertyId: string;
  staffId: string;
  /** yyyy-MM-dd (local calendar day the shift starts). */
  date: string;
  start: string;
  end: string;
  notes: string;
  /** When an admin marked this shift paid; always null for officers (pay data is admin-only). */
  paidAt: string | null;
}

export type ShiftWorkStatus = "open" | "pending" | "approved" | "rejected";

/** The payroll hours attached to a shift: a real clock punch, or an entry made by "Mark completed". */
export interface ShiftWork {
  entryId: string;
  shiftId: string;
  status: ShiftWorkStatus;
  clockIn: string;
  clockOut: string | null;
  source: "clock" | "manual";
}

export const SHIFT_WORK_LABEL: Record<ShiftWorkStatus, string> = {
  open: "On shift",
  pending: "Needs approval",
  approved: "Approved",
  rejected: "Rejected",
};

export interface ShiftInput {
  staffId: string;
  propertyId: string;
  start: string;
  end: string;
  notes: string;
}

export const SHIFT_PRESETS: ReadonlyArray<{ label: string; start: string; end: string }> = [
  { label: "Day", start: "07:00", end: "19:00" },
  { label: "Night", start: "19:00", end: "07:00" },
  { label: "1st", start: "06:00", end: "14:00" },
  { label: "2nd", start: "14:00", end: "22:00" },
  { label: "3rd", start: "22:00", end: "06:00" },
];

/** Weeks run Monday → Sunday. */
export const weekStartOf = (d: Date): Date => startOfWeek(d, { weekStartsOn: 1 });

export const weekDays = (weekStart: Date): Date[] => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

export const toDateKey = (d: Date): string => format(d, "yyyy-MM-dd");

export const fromDateKey = (key: string): Date => parseISO(key);

/** "Sep 29 – Oct 5, 2026" */
export const weekLabel = (weekStart: Date): string => {
  const end = addDays(weekStart, 6);
  return isSameMonth(weekStart, end)
    ? `${format(weekStart, "MMM d")} – ${format(end, "d, yyyy")}`
    : `${format(weekStart, "MMM d")} – ${format(end, "MMM d, yyyy")}`;
};

/** Postgres `time` ("19:00:00") → "19:00". */
export const fromDbTime = (t: string): string => t.slice(0, 5);

const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

export const isOvernight = (s: { start: string; end: string }): boolean => toMinutes(s.end) <= toMinutes(s.start);

export const shiftMinutes = (s: { start: string; end: string }): number => {
  const diff = toMinutes(s.end) - toMinutes(s.start);
  return diff <= 0 ? diff + 24 * 60 : diff;
};

/** "19:00" → "7 PM", "06:30" → "6:30 AM" */
export const formatClock = (hhmm: string): string => {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  const suffix = h < 12 ? "AM" : "PM";
  const h12 = h % 12 || 12;
  return m === 0 ? `${h12} ${suffix}` : `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
};

/** "7 PM – 7 AM" */
export const formatShiftRange = (s: { start: string; end: string }): string =>
  `${formatClock(s.start)} – ${formatClock(s.end)}`;

/** 720 → "12h", 450 → "7.5h" */
export const formatHours = (minutes: number): string => {
  const h = minutes / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
};

/** Scheduled start/end as real dates in the browser's time zone (overnight shifts end the next day). */
export const scheduledWindow = (s: Pick<Shift, "date" | "start" | "end">): { start: Date; end: Date } => {
  const start = parseISO(`${s.date}T${s.start}`);
  const end = parseISO(`${s.date}T${s.end}`);
  return { start, end: isOvernight(s) ? addDays(end, 1) : end };
};

export const byShiftStart = (a: Shift, b: Shift): number =>
  a.date === b.date ? toMinutes(a.start) - toMinutes(b.start) : a.date.localeCompare(b.date);
