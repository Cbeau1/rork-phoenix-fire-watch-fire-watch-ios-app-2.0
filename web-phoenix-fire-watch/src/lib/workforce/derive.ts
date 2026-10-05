import { addDays, format } from "date-fns";

import { shiftMinutes } from "@/lib/schedule";
import type { Patrol } from "@/lib/types";

import type { ChecklistItem, Equipment, Placement, Worker } from "./constants";

export interface ShiftRow {
  id: string;
  staff_id: string;
  property_id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  notes: string;
  paid: boolean;
}

export const todayKey = (): string => format(new Date(), "yyyy-MM-dd");
export const inDays = (n: number): string => format(addDays(new Date(), n), "yyyy-MM-dd");

const OPEN_PLACEMENT = new Set(["pending", "active"]);

/** Required onboarding / placement checklist items still pending (paperwork outstanding). */
export const missingItems = (workerId: string, checklist: ChecklistItem[], placements: Placement[]): ChecklistItem[] => {
  const placementOpen = new Map(placements.map((p) => [p.id, OPEN_PLACEMENT.has(p.status)]));
  return checklist.filter(
    (c) =>
      c.worker_id === workerId &&
      c.required &&
      c.status === "pending" &&
      (c.kind === "direct" || (c.kind === "placement" && !!c.placement_id && placementOpen.get(c.placement_id))),
  );
};

/** Issued items whose holder has left / placement ended — the item should come back. */
export const awaitingReturn = (equipment: Equipment[], workers: Worker[], placements: Placement[]): Equipment[] => {
  const wById = new Map(workers.map((w) => [w.id, w]));
  const pById = new Map(placements.map((p) => [p.id, p]));
  return equipment.filter((e) => {
    if (e.status !== "issued") return false;
    const w = wById.get(e.worker_id);
    const p = e.placement_id ? pById.get(e.placement_id) : undefined;
    return !!w && (!!w.archived_at || w.status === "terminated" || w.status === "assignment_ended" || (!!p && !OPEN_PLACEMENT.has(p.status)));
  });
};

export const hasOpenPlacement = (workerId: string, placements: Placement[], exceptId?: string): boolean =>
  placements.some((p) => p.worker_id === workerId && p.id !== exceptId && OPEN_PLACEMENT.has(p.status));

const shiftWindow = (s: ShiftRow): [number, number] => {
  const start = new Date(`${s.shift_date}T${s.start_time.slice(0, 5)}:00`).getTime();
  const mins = shiftMinutes({ start: s.start_time.slice(0, 5), end: s.end_time.slice(0, 5) });
  return [start, start + mins * 60_000];
};

export const shiftHours = (s: ShiftRow): number =>
  shiftMinutes({ start: s.start_time.slice(0, 5), end: s.end_time.slice(0, 5) }) / 60;

export interface WorkHistory {
  linkedSchedule: boolean;
  linkedAccount: boolean;
  shifts: ShiftRow[];
  upcoming: ShiftRow[];
  past: ShiftRow[];
  /** Past shifts confirmed by a patrol logged by the worker's account during the shift, or marked paid. */
  completed: ShiftRow[];
  completedBy: Map<string, "patrol" | "paid" | "both">;
  completedHours: number;
  propertyIds: string[];
  patrolCount: number;
}

const GRACE = 30 * 60_000;

/** Work history reused from the existing schedule (shifts, pay marks) and patrol logs — nothing is inferred beyond that. */
export const workHistory = (worker: Worker, shifts: ShiftRow[], patrols: Patrol[], placements: Placement[]): WorkHistory => {
  const mine = worker.staff_id ? shifts.filter((s) => s.staff_id === worker.staff_id) : [];
  const today = todayKey();
  const myPatrols = worker.profile_id ? patrols.filter((p) => p.loggedBy === worker.profile_id) : [];
  const completedBy = new Map<string, "patrol" | "paid" | "both">();
  const past = mine.filter((s) => s.shift_date < today);
  for (const s of past) {
    const [a, b] = shiftWindow(s);
    const patrolled = myPatrols.some((p) => {
      if (p.propertyId !== s.property_id) return false;
      const t = Date.parse(p.dateTime);
      return t >= a - GRACE && t <= b + GRACE;
    });
    if (patrolled && s.paid) completedBy.set(s.id, "both");
    else if (patrolled) completedBy.set(s.id, "patrol");
    else if (s.paid) completedBy.set(s.id, "paid");
  }
  const completed = past.filter((s) => completedBy.has(s.id));
  const props = new Set<string>(mine.map((s) => s.property_id));
  for (const p of placements) if (p.worker_id === worker.id && p.property_id) props.add(p.property_id);
  return {
    linkedSchedule: !!worker.staff_id,
    linkedAccount: !!worker.profile_id,
    shifts: mine,
    upcoming: mine.filter((s) => s.shift_date >= today).sort((x, y) => x.shift_date.localeCompare(y.shift_date)),
    past,
    completed,
    completedBy,
    completedHours: Math.round(completed.reduce((sum, s) => sum + shiftHours(s), 0) * 100) / 100,
    propertyIds: Array.from(props),
    patrolCount: myPatrols.length,
  };
};
