import { addDays, format, parseISO } from "date-fns";

import type { Tables } from "@/integrations/supabase/types";
import { toDateKey, weekStartOf } from "@/lib/schedule";
import { supabase } from "@/lib/supabase";
import { wfError } from "@/lib/workforce/api";
import type { Tone } from "@/lib/workforce/constants";

export type EntryStatus = "open" | "pending" | "approved" | "rejected";

/** One clock-in → clock-out punch. Server time is the official time for both punches. */
export interface TimeEntry {
  id: string;
  profileId: string | null;
  workerName: string;
  propertyId: string | null;
  clockIn: string;
  clockOut: string | null;
  status: EntryStatus;
  employeeNote: string;
  adminNote: string;
  source: "clock" | "manual";
  edited: boolean;
  approvedBy: string | null;
  approvedAt: string | null;
}

export interface EntryLog {
  id: number;
  actorName: string;
  action: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

export const ENTRY_STATUS: Record<EntryStatus, { label: string; tone: Tone }> = {
  open: { label: "Clocked in", tone: "ember" },
  pending: { label: "Needs approval", tone: "amber" },
  approved: { label: "Approved", tone: "green" },
  rejected: { label: "Rejected", tone: "red" },
};

export const LOG_LABEL: Record<string, string> = {
  clock_in: "Clocked in",
  clock_out: "Clocked out",
  approve: "Approved",
  reject: "Rejected",
  reopen: "Moved back to review",
  edit: "Times edited",
  manual_add: "Entry added by admin",
};

const toEntry = (r: Tables<"time_entries">): TimeEntry => ({
  id: r.id,
  profileId: r.profile_id,
  workerName: r.worker_name,
  propertyId: r.property_id,
  clockIn: r.clock_in,
  clockOut: r.clock_out,
  status: (["open", "pending", "approved", "rejected"].includes(r.status) ? r.status : "pending") as EntryStatus,
  employeeNote: r.employee_note,
  adminNote: r.admin_note,
  source: r.source === "manual" ? "manual" : "clock",
  edited: r.edited,
  approvedBy: r.approved_by,
  approvedAt: r.approved_at,
});

// ─── Hours math ─────────────────────────────────────────────────────────────

/** Whole minutes worked (open entries count up to `now`). */
export const entryMinutes = (e: Pick<TimeEntry, "clockIn" | "clockOut">, now: number = Date.now()): number => {
  const end = e.clockOut ? Date.parse(e.clockOut) : now;
  return Math.max(0, Math.floor((end - Date.parse(e.clockIn)) / 60000));
};

/** Decimal hours for payroll, e.g. 8.25 */
export const fmtHours = (minutes: number): string => (minutes / 60).toFixed(2);

/** "7h 45m" */
export const fmtDuration = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${m}m` : `${h}h ${String(m).padStart(2, "0")}m`;
};

/** Live timer "3:04:09" */
export const fmtElapsed = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export const OVERTIME_MINUTES = 40 * 60;

// ─── Pay periods (weeks run Monday → Sunday, matching the Schedule) ─────────

export interface PayPeriod {
  start: Date;
  /** 7 or 14 days. */
  days: number;
}

export const periodEnd = (p: PayPeriod): Date => addDays(p.start, p.days - 1);

export const periodLabel = (p: PayPeriod): string => {
  const end = periodEnd(p);
  return p.start.getFullYear() === end.getFullYear()
    ? `${format(p.start, "MMM d")} – ${format(end, "MMM d, yyyy")}`
    : `${format(p.start, "MMM d, yyyy")} – ${format(end, "MMM d, yyyy")}`;
};

export const currentPeriod = (days: number): PayPeriod => ({ start: weekStartOf(new Date()), days });

/** Local calendar day an entry belongs to (the day it started). */
export const entryDay = (e: Pick<TimeEntry, "clockIn">): string => toDateKey(new Date(e.clockIn));

export interface PersonSummary {
  key: string;
  profileId: string | null;
  name: string;
  entries: TimeEntry[];
  approvedMin: number;
  pendingMin: number;
  rejectedMin: number;
  openCount: number;
  /** Approved minutes per workweek in the period, split at 40 hours. */
  weeks: { start: string; approvedMin: number; regularMin: number; overMin: number }[];
  regularMin: number;
  overMin: number;
}

/** Groups entries by person and totals them. Only approved hours count toward payroll totals. */
export const summarize = (entries: TimeEntry[], period: PayPeriod, nameFor: (id: string | null, fallback: string) => string): PersonSummary[] => {
  const weekKeys = Array.from({ length: Math.ceil(period.days / 7) }, (_, i) => toDateKey(addDays(period.start, i * 7)));
  const map = new Map<string, PersonSummary>();
  for (const e of entries) {
    const key = e.profileId ?? `name:${e.workerName}`;
    let s = map.get(key);
    if (!s) {
      s = {
        key,
        profileId: e.profileId,
        name: nameFor(e.profileId, e.workerName),
        entries: [],
        approvedMin: 0,
        pendingMin: 0,
        rejectedMin: 0,
        openCount: 0,
        weeks: weekKeys.map((start) => ({ start, approvedMin: 0, regularMin: 0, overMin: 0 })),
        regularMin: 0,
        overMin: 0,
      };
      map.set(key, s);
    }
    s.entries.push(e);
    const min = entryMinutes(e);
    if (e.status === "approved") {
      s.approvedMin += min;
      const wk = toDateKey(weekStartOf(new Date(e.clockIn)));
      const w = s.weeks.find((x) => x.start === wk);
      if (w) w.approvedMin += min;
    } else if (e.status === "pending") s.pendingMin += min;
    else if (e.status === "rejected") s.rejectedMin += min;
    else s.openCount += 1;
  }
  const out = [...map.values()];
  for (const s of out) {
    s.entries.sort((a, b) => Date.parse(a.clockIn) - Date.parse(b.clockIn));
    for (const w of s.weeks) {
      w.regularMin = Math.min(w.approvedMin, OVERTIME_MINUTES);
      w.overMin = Math.max(0, w.approvedMin - OVERTIME_MINUTES);
      s.regularMin += w.regularMin;
      s.overMin += w.overMin;
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
};

// ─── API ────────────────────────────────────────────────────────────────────

const COLS = "*";

/** Entries that started inside the period (RLS: officers only ever receive their own rows). */
export async function loadEntries(period: PayPeriod, profileId?: string): Promise<TimeEntry[]> {
  const from = period.start.toISOString();
  const to = addDays(period.start, period.days).toISOString();
  let q = supabase.from("time_entries").select(COLS).gte("clock_in", from).lt("clock_in", to);
  if (profileId) q = q.eq("profile_id", profileId);
  const { data, error } = await q.order("clock_in", { ascending: true }).limit(5000);
  if (error) throw wfError(error);
  return (data ?? []).map(toEntry);
}

/** Everyone currently clocked in (admin) or just the caller (officer). */
export async function loadOpenEntries(profileId?: string): Promise<TimeEntry[]> {
  let q = supabase.from("time_entries").select(COLS).is("clock_out", null);
  if (profileId) q = q.eq("profile_id", profileId);
  const { data, error } = await q.order("clock_in").limit(500);
  if (error) throw wfError(error);
  return (data ?? []).map(toEntry);
}

export async function clockIn(note = ""): Promise<TimeEntry> {
  const { data, error } = await supabase.rpc("tc_clock_in", { p_note: note });
  if (error) throw wfError(error);
  return toEntry(data as Tables<"time_entries">);
}

export async function clockOut(note = ""): Promise<TimeEntry> {
  const { data, error } = await supabase.rpc("tc_clock_out", { p_note: note });
  if (error) throw wfError(error);
  return toEntry(data as Tables<"time_entries">);
}

export async function reviewEntries(ids: string[], action: "approve" | "reject" | "reopen", note = ""): Promise<number> {
  const { data, error } = await supabase.rpc("tc_review", { p_ids: ids, p_action: action, p_note: note });
  if (error) throw wfError(error);
  return Number(data ?? 0);
}

export interface EntryInput {
  id: string | null;
  profileId: string;
  clockIn: Date;
  clockOut: Date;
  propertyId: string | null;
  reason: string;
}

export async function saveEntry(input: EntryInput): Promise<void> {
  const { error } = await supabase.rpc("tc_admin_save", {
    p_id: input.id as string,
    p_profile_id: input.profileId,
    p_clock_in: input.clockIn.toISOString(),
    p_clock_out: input.clockOut.toISOString(),
    p_property_id: (input.propertyId ?? null) as string,
    p_reason: input.reason,
  });
  if (error) throw wfError(error);
}

export async function loadEntryLog(entryId: string): Promise<EntryLog[]> {
  const { data, error } = await supabase
    .from("time_entry_log")
    .select("id, actor_name, action, detail, created_at")
    .eq("entry_id", entryId)
    .order("created_at", { ascending: true });
  if (error) throw wfError(error);
  return (data ?? []).map((r) => ({
    id: r.id,
    actorName: r.actor_name,
    action: r.action,
    detail: (r.detail ?? {}) as Record<string, unknown>,
    createdAt: r.created_at,
  }));
}

export interface TeamMember {
  id: string;
  name: string;
  role: string;
  active: boolean;
}

export async function loadTeam(): Promise<TeamMember[]> {
  const { data, error } = await supabase.from("profiles").select("id, full_name, role, active").order("full_name").limit(1000);
  if (error) throw wfError(error);
  return (data ?? []).map((r) => ({ id: r.id, name: r.full_name, role: r.role, active: r.active }));
}

// ─── Pay rates (from Workforce, visible only with the "Employee pay" permission) ─

export interface RateRow {
  rate: number;
  /** yyyy-MM-dd */
  effective: string;
}

/** Hourly rate history per Team login, newest first. Empty when the caller can't see wages. */
export async function loadPayRates(): Promise<Map<string, RateRow[]>> {
  const { data, error } = await supabase.rpc("tc_pay_rates");
  if (error) throw wfError(error);
  const map = new Map<string, RateRow[]>();
  for (const r of data ?? []) {
    const list = map.get(r.profile_id) ?? [];
    list.push({ rate: Number(r.hourly_rate), effective: r.effective_date });
    map.set(r.profile_id, list);
  }
  for (const list of map.values()) list.sort((a, b) => b.effective.localeCompare(a.effective));
  return map;
}

/** Rate in effect on a given day (yyyy-MM-dd), or null if none was set yet. */
export const rateOn = (rates: RateRow[] | undefined, day: string): number | null =>
  rates?.find((r) => r.effective <= day)?.rate ?? null;

export interface PayEstimate {
  /** Rate in effect at the end of the period (for display). */
  rate: number | null;
  straightCents: number;
  overtimePremiumCents: number;
  grossCents: number;
  /** Approved minutes that had no pay rate on file and weren't priced. */
  unpricedMin: number;
}

/**
 * Gross pay before taxes and deductions, from approved hours only.
 * Every approved hour is paid at the rate in effect that day; overtime hours (over 40 per
 * Monday–Sunday week) add a half-time premium on that week's average rate.
 */
export const estimatePay = (p: PersonSummary, period: PayPeriod, rates: RateRow[] | undefined): PayEstimate => {
  let straight = 0;
  let premium = 0;
  let unpricedMin = 0;
  for (const w of p.weeks) {
    let weekPay = 0;
    let pricedMin = 0;
    for (const e of p.entries) {
      if (e.status !== "approved") continue;
      if (toDateKey(weekStartOf(new Date(e.clockIn))) !== w.start) continue;
      const min = entryMinutes(e);
      const r = rateOn(rates, entryDay(e));
      if (r === null) {
        unpricedMin += min;
        continue;
      }
      weekPay += (min / 60) * r;
      pricedMin += min;
    }
    straight += weekPay;
    if (w.overMin > 0 && pricedMin > 0) premium += (w.overMin / 60) * 0.5 * (weekPay / (pricedMin / 60));
  }
  const straightCents = Math.round(straight * 100);
  const overtimePremiumCents = Math.round(premium * 100);
  return {
    rate: rateOn(rates, toDateKey(periodEnd(period))),
    straightCents,
    overtimePremiumCents,
    grossCents: straightCents + overtimePremiumCents,
    unpricedMin,
  };
};

export const fmtCents = (c: number): string =>
  (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

/** yyyy-MM-dd → Date at local midnight */
export const dayToDate = (key: string): Date => parseISO(key);
