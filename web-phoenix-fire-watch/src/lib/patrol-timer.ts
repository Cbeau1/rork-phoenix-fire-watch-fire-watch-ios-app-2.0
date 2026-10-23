/** Minutes before a patrol is due that the officer gets warned. */
export const WARNING_MINUTES = 5;

/** Interval bounds enforced by the database as well. */
export const MIN_INTERVAL = 10;
export const MAX_INTERVAL = 720;

export const INTERVAL_OPTIONS: number[] = [15, 20, 30, 45, 60, 90, 120, 180, 240, 360, 480, 720];

/** "45 min", "1 hr", "1 hr 30 min", "4 hrs" */
export const formatInterval = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  const hours = `${h} ${h === 1 ? "hr" : "hrs"}`;
  return m ? `${hours} ${m} min` : hours;
};

/** "04:59" or "1:04:59" */
export const formatCountdown = (ms: number): string => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
};

export interface TimerSchedule {
  intervalMs: number;
  /** When the next patrol is due. */
  dueAt: number;
  /** When the 5-minute warning fires for `dueAt`. */
  warnAt: number;
  remaining: number;
  /** 0 → 1 across the current interval. */
  progress: number;
  /** Inside the warning window before `dueAt`. */
  isWarning: boolean;
  /** Number of due times that passed with no patrol logged. */
  missed: number;
  /** Most recent due time that passed without a patrol, if any. */
  lastDueAt: number | null;
  /** First due time missed since the last patrol (patrol is overdue), if any. */
  overdueSince: number | null;
}

/**
 * Repeating schedule: each patrol logged at the property restarts the countdown; if a
 * due time passes without a patrol, the timer keeps cycling so alerts continue.
 */
export const computeSchedule = ({
  startAt,
  lastPatrolAt,
  intervalMinutes,
  now,
}: {
  startAt: number;
  lastPatrolAt: number | null;
  intervalMinutes: number;
  now: number;
}): TimerSchedule => {
  const intervalMs = Math.max(MIN_INTERVAL, intervalMinutes) * 60_000;
  const anchor = Math.max(startAt, lastPatrolAt ?? 0);
  const missed = Math.floor(Math.max(0, now - anchor) / intervalMs);
  const dueAt = anchor + (missed + 1) * intervalMs;
  const warnAt = dueAt - WARNING_MINUTES * 60_000;
  const remaining = dueAt - now;
  return {
    intervalMs,
    dueAt,
    warnAt,
    remaining,
    progress: Math.min(1, Math.max(0, 1 - remaining / intervalMs)),
    isWarning: now >= warnAt,
    missed,
    lastDueAt: missed > 0 ? anchor + missed * intervalMs : null,
    overdueSince: missed > 0 ? anchor + intervalMs : null,
  };
};

/**
 * When a shift's countdown starts. If the property's last patrol (by anyone, e.g. the previous
 * officer) was still inside its interval at clock-in, the countdown continues from that patrol;
 * otherwise it starts at clock-in. Later patrols always restart it.
 * Example: last patrol 6:48, every 30 min, clock-in 7:00 -> next due 7:18 (not 7:30).
 */
export const shiftAnchor = (clockIn: number, intervalMinutes: number, patrolTimes: (number | null | undefined)[]): number => {
  const floor = clockIn - Math.max(1, intervalMinutes) * 60_000;
  const now = Date.now();
  let last = -Infinity;
  for (const t of patrolTimes) {
    if (typeof t === "number" && Number.isFinite(t) && t <= now && t > last) last = t;
  }
  return last > floor ? last : clockIn;
};
