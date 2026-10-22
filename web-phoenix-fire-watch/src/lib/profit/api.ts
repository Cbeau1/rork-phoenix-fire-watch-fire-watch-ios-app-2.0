import type { Tables } from "@/integrations/supabase/types";
import { supabase } from "@/lib/supabase";

export type ProfitPeriod = "today" | "week" | "month" | "last_month" | "30d" | "ytd";

export const PERIODS: { id: ProfitPeriod; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "week", label: "This week" },
  { id: "month", label: "This month" },
  { id: "last_month", label: "Last month" },
  { id: "30d", label: "Last 30 days" },
  { id: "ytd", label: "Year to date" },
];

export interface ProfitProperty {
  id: string;
  name: string;
  current_rate: number | null;
  current_rate_from: string | null;
  current_rate_source: "manual" | "contract" | null;
  /** Approved timecard hours worked in the period. */
  hours: number;
  /** What was billed: client invoices issued in the period (full amount, on the invoice date). */
  revenue: number;
  /** Approved hours outside every invoice's service period — worked but not invoiced yet (not counted as revenue). */
  unbilled_hours: number;
  /** Estimated value of the unbilled hours at the client rate (not counted as revenue). */
  unbilled_revenue: number;
  timecard_hours: number;
  timecard_revenue: number;
  /** Client invoices issued in this period (same as revenue). */
  billed: number;
  billed_hours: number;
  wages: number;
  burden: number;
  agency: number;
  overtime_hours: number;
  expenses: number;
  /** Payroll/agency-category expenditures at this property (already part of expenses). */
  labor_expenses: number;
  pending_hours: number;
  pending_revenue: number;
  pending_cost: number;
  unpriced_revenue_hours: number;
  unpriced_cost_hours: number;
}

export interface ProfitDay {
  day: string;
  revenue: number;
  cost: number;
  pending_revenue: number;
  pending_cost: number;
  /** Estimated value of hours worked that day but not invoiced yet (not in revenue). */
  unbilled_revenue?: number;
}

/** Temp agency and its default charge per staffing hour (null = not set; falls back to the worker's pay rate). */
export interface ProfitAgency {
  id: string;
  name: string;
  regular_rate: number | null;
  overtime_rate: number | null;
  workers: number;
}

export interface ProfitDashboard {
  tz: string;
  period: ProfitPeriod;
  start: string;
  end: string;
  today: string;
  generated_at: string;
  burden_pct: number;
  /** Business federal income tax, % of positive net profit. */
  federal_tax_pct: number;
  properties: ProfitProperty[];
  unassigned: { hours: number; cost: number; pending_hours: number; pending_cost: number };
  overhead: { category: string; amount: number }[];
  excluded_labor_expenses: number;
  /** Approved timecard hours whose labor is already recorded as a payroll/agency expenditure (not counted twice). */
  paid_labor_hours: number;
  daily: ProfitDay[];
  live: { on_duty: number; sites: number; revenue_per_hour: number; cost_per_hour: number; unpriced: number };
  missing_pay: { name: string; hours: number }[];
  agencies: ProfitAgency[];
}

export type BillRate = Tables<"property_bill_rates">;

const n = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

export async function fetchProfit(period: ProfitPeriod): Promise<ProfitDashboard> {
  const { data, error } = await supabase.rpc("profit_dashboard", { p_period: period });
  if (error) throw error;
  const d = data as unknown as ProfitDashboard;
  return {
    ...d,
    burden_pct: n(d.burden_pct),
    federal_tax_pct: n(d.federal_tax_pct),
    properties: (d.properties ?? []).map((p) => ({
      ...p,
      current_rate: p.current_rate == null ? null : n(p.current_rate),
      hours: n(p.hours),
      revenue: n(p.revenue),
      unbilled_hours: n(p.unbilled_hours),
      unbilled_revenue: n(p.unbilled_revenue),
      timecard_hours: n(p.timecard_hours ?? p.hours),
      timecard_revenue: n(p.timecard_revenue ?? p.revenue),
      billed: n(p.billed),
      billed_hours: n(p.billed_hours),
      wages: n(p.wages),
      burden: n(p.burden),
      agency: n(p.agency),
      overtime_hours: n(p.overtime_hours),
      expenses: n(p.expenses),
      labor_expenses: n(p.labor_expenses),
      pending_hours: n(p.pending_hours),
      pending_revenue: n(p.pending_revenue),
      pending_cost: n(p.pending_cost),
      unpriced_revenue_hours: n(p.unpriced_revenue_hours),
      unpriced_cost_hours: n(p.unpriced_cost_hours),
    })),
    overhead: (d.overhead ?? []).map((o) => ({ ...o, amount: n(o.amount) })),
    daily: d.daily ?? [],
    missing_pay: d.missing_pay ?? [],
    agencies: (d.agencies ?? []).map((a) => ({
      ...a,
      regular_rate: a.regular_rate == null ? null : n(a.regular_rate),
      overtime_rate: a.overtime_rate == null ? null : n(a.overtime_rate),
      workers: n(a.workers),
    })),
    excluded_labor_expenses: n(d.excluded_labor_expenses),
    paid_labor_hours: n(d.paid_labor_hours),
  };
}

/** Labor cost for a property row (wages + payroll burden + agency charges). */
export const laborCost = (p: Pick<ProfitProperty, "wages" | "burden" | "agency">): number => p.wages + p.burden + p.agency;
export const totalCost = (p: ProfitProperty): number => laborCost(p) + p.expenses;
export const profitOf = (p: ProfitProperty): number => p.revenue - totalCost(p);
/** Margin as a fraction, or null when there's no revenue to compare against. */
export const marginOf = (revenue: number, profit: number): number | null => (revenue > 0 ? profit / revenue : null);

export interface ProfitTotals {
  revenue: number;
  labor: number;
  wages: number;
  burden: number;
  agency: number;
  siteExpenses: number;
  overhead: number;
  unassignedCost: number;
  cost: number;
  /** Profit before federal tax. */
  profit: number;
  margin: number | null;
  /** Federal tax on positive profit (0 on a loss). */
  tax: number;
  /** Profit after federal tax. */
  net: number;
  netMargin: number | null;
  billed: number;
  unbilledHours: number;
  unbilledRevenue: number;
  timecardHours: number;
  hours: number;
  pendingHours: number;
  pendingRevenue: number;
  pendingCost: number;
  unpricedRevenueHours: number;
  unpricedCostHours: number;
}

export const totalsOf = (d: ProfitDashboard): ProfitTotals => {
  const sum = (f: (p: ProfitProperty) => number) => d.properties.reduce((s, p) => s + f(p), 0);
  const wages = sum((p) => p.wages);
  const burden = sum((p) => p.burden);
  const agency = sum((p) => p.agency);
  const siteExpenses = sum((p) => p.expenses);
  const overhead = d.overhead.reduce((s, o) => s + o.amount, 0);
  const unassignedCost = n(d.unassigned?.cost);
  const revenue = sum((p) => p.revenue);
  const labor = wages + burden + agency + unassignedCost;
  const cost = labor + siteExpenses + overhead;
  const profit = revenue - cost;
  const tax = profit > 0 ? (profit * d.federal_tax_pct) / 100 : 0;
  const net = profit - tax;
  return {
    revenue,
    labor,
    wages,
    burden,
    agency,
    siteExpenses,
    overhead,
    unassignedCost,
    cost,
    profit,
    margin: marginOf(revenue, profit),
    tax,
    net,
    netMargin: marginOf(revenue, net),
    billed: sum((p) => p.billed),
    unbilledHours: sum((p) => p.unbilled_hours),
    unbilledRevenue: sum((p) => p.unbilled_revenue),
    timecardHours: sum((p) => p.timecard_hours) + n(d.unassigned?.hours),
    hours: sum((p) => p.hours) + n(d.unassigned?.hours),
    pendingHours: sum((p) => p.pending_hours) + n(d.unassigned?.pending_hours),
    pendingRevenue: sum((p) => p.pending_revenue),
    pendingCost: sum((p) => p.pending_cost) + n(d.unassigned?.pending_cost),
    unpricedRevenueHours: sum((p) => p.unpriced_revenue_hours),
    unpricedCostHours: d.missing_pay.reduce((s, m) => s + n(m.hours), 0),
  };
};

export async function fetchBillRates(propertyId: string): Promise<BillRate[]> {
  const { data, error } = await supabase
    .from("property_bill_rates")
    .select("*")
    .eq("property_id", propertyId)
    .order("effective_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function addBillRate(propertyId: string, rate: number, effective: string, note: string): Promise<BillRate> {
  const { data, error } = await supabase.rpc("profit_add_bill_rate", {
    p_property: propertyId,
    p_rate: rate,
    p_effective: effective,
    p_note: note,
  });
  if (error) throw error;
  return data as unknown as BillRate;
}

export async function deleteBillRate(id: string): Promise<void> {
  const { error } = await supabase.rpc("profit_delete_bill_rate", { p_id: id });
  if (error) throw error;
}

/** Set (or clear, with regular = null) an agency's default charge per staffing hour. Overtime null = 1.5× regular. */
export async function setAgencyRate(agencyId: string, regular: number | null, overtime: number | null): Promise<void> {
  const { error } = await supabase.rpc("profit_set_agency_rate", {
    p_agency: agencyId,
    p_regular: regular as number,
    p_overtime: overtime as number,
  });
  if (error) throw error;
}

export async function saveBurden(pct: number): Promise<void> {
  const { error } = await supabase.rpc("profit_save_settings", { p_burden: pct });
  if (error) throw error;
}

export async function saveFederalTax(pct: number): Promise<void> {
  const { error } = await supabase.rpc("profit_save_tax", { p_pct: pct });
  if (error) throw error;
}

/** Rate in effect on a day: newest on/before it, else the earliest on file (same rule as the server). */
export const rateInEffect = (rates: BillRate[], day: string): BillRate | null => {
  const sorted = [...rates].sort((a, b) => b.effective_date.localeCompare(a.effective_date) || b.created_at.localeCompare(a.created_at));
  return sorted.find((r) => r.effective_date <= day) ?? sorted[sorted.length - 1] ?? null;
};

export const pct = (m: number | null): string => (m == null ? "—" : `${(m * 100).toFixed(1)}%`);

/** Calendar day "today" in a timezone, yyyy-MM-dd. */
export const todayIn = (tz: string): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
