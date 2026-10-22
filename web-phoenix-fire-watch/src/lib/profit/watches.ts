import { supabase } from "@/lib/supabase";

/** Totals for a watch's date range, same rules as the Profit dashboard (approved hours; pending kept separate). */
export interface WatchTotals {
  from: string;
  to: string;
  truncated: boolean;
  hours: number;
  revenue: number;
  labor: number;
  expenses: number;
  profit: number;
  pending_hours: number;
  pending_revenue: number;
  pending_cost: number;
  unpriced_revenue_hours: number;
  rate: number | null;
  /** Client invoices counted in this watch; when > 0, revenue = invoiced amount + timecard revenue for uninvoiced hours. */
  invoices: number;
  /** Recorded payroll/agency expenditures at this property (included in expenses). */
  labor_expenses: number;
  /** This watch's share of company overhead (expenditures with no property), split by days on watch each month. */
  overhead: number;
  billed: number;
  billed_hours: number;
  unbilled_hours: number;
  unbilled_revenue: number;
}

export interface ActiveWatch {
  id: string;
  property_id: string;
  name: string;
  started_on: string;
  totals: WatchTotals;
  upcoming_shifts: number;
  on_duty: number;
}

export interface EndedWatch {
  id: string;
  property_id: string;
  name: string;
  started_on: string;
  ended_on: string;
  ended_at: string;
  shifts_cleared: number;
  totals: WatchTotals;
}

export interface IdleProperty {
  property_id: string;
  name: string;
  last_ended_on: string | null;
}

export interface WatchList {
  today: string;
  active: ActiveWatch[];
  ended: EndedWatch[];
  idle: IdleProperty[];
}

export interface WatchPreview {
  totals: WatchTotals;
  clear: { date: string; start: string }[];
  kept_shifts: number;
  on_duty: number;
  later_entries: number;
}

const n = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

const totals = (t: Partial<WatchTotals> | null | undefined): WatchTotals => ({
  from: t?.from ?? "",
  to: t?.to ?? "",
  truncated: t?.truncated === true,
  hours: n(t?.hours),
  revenue: n(t?.revenue),
  labor: n(t?.labor),
  expenses: n(t?.expenses),
  profit: n(t?.profit),
  pending_hours: n(t?.pending_hours),
  pending_revenue: n(t?.pending_revenue),
  pending_cost: n(t?.pending_cost),
  unpriced_revenue_hours: n(t?.unpriced_revenue_hours),
  rate: t?.rate == null ? null : n(t.rate),
  invoices: n(t?.invoices),
  labor_expenses: n(t?.labor_expenses),
  overhead: n(t?.overhead),
  billed: n(t?.billed),
  billed_hours: n(t?.billed_hours),
  unbilled_hours: n(t?.unbilled_hours),
  unbilled_revenue: n(t?.unbilled_revenue),
});

export async function fetchWatches(): Promise<WatchList> {
  const { data, error } = await supabase.rpc("property_watches");
  if (error) throw error;
  const d = data as unknown as WatchList;
  return {
    today: d.today,
    active: (d.active ?? []).map((w) => ({ ...w, totals: totals(w.totals), upcoming_shifts: n(w.upcoming_shifts), on_duty: n(w.on_duty) })),
    ended: (d.ended ?? []).map((w) => ({ ...w, totals: totals(w.totals), shifts_cleared: n(w.shifts_cleared) })),
    idle: d.idle ?? [],
  };
}

export async function previewEndWatch(watchId: string, start: string, end: string): Promise<WatchPreview> {
  const { data, error } = await supabase.rpc("property_watch_preview", { p_watch: watchId, p_start: start, p_end: end });
  if (error) throw error;
  const d = data as unknown as WatchPreview;
  return { totals: totals(d.totals), clear: d.clear ?? [], kept_shifts: n(d.kept_shifts), on_duty: n(d.on_duty), later_entries: n(d.later_entries) };
}

export async function endWatch(watchId: string, start: string, end: string): Promise<{ totals: WatchTotals; shifts_cleared: number }> {
  const { data, error } = await supabase.rpc("property_watch_end", { p_watch: watchId, p_start: start, p_end: end });
  if (error) throw error;
  const d = data as unknown as { totals: WatchTotals; shifts_cleared: number };
  return { totals: totals(d.totals), shifts_cleared: n(d.shifts_cleared) };
}

export async function startWatch(propertyId: string, start: string): Promise<void> {
  const { error } = await supabase.rpc("property_watch_start", { p_property: propertyId, p_start: start });
  if (error) throw error;
}

/** Calendar days from start to end, inclusive. */
export const watchDays = (start: string, end: string): number =>
  Math.max(1, Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1);
