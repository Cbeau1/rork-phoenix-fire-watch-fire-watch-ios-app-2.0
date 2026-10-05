import type { Invoice, InvoiceLine, Placement, PlacementHours, PlacementRate } from "./constants";

const num = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The agency bill rate in effect on a date (latest effective_date on or before it). Historical rows are never edited. */
export const rateOn = (rates: PlacementRate[], placementId: string, date: string): PlacementRate | null => {
  let best: PlacementRate | null = null;
  for (const r of rates) {
    if (r.placement_id !== placementId || r.effective_date > date) continue;
    if (!best || r.effective_date > best.effective_date || (r.effective_date === best.effective_date && r.created_at > best.created_at)) {
      best = r;
    }
  }
  return best;
};

export interface CostEstimate {
  regularHours: number;
  overtimeHours: number;
  holidayHours: number;
  /** Cost of the hours that could be priced. */
  estimate: number;
  complete: boolean;
  /** Why the estimate is incomplete (empty when complete). */
  issues: string[];
  pricedDays: number;
}

/**
 * Estimated agency cost for approved hours using the agency's configured, effective-dated rates.
 * Never assumes overtime/holiday multipliers: hours of a type without a supplied rate make the estimate incomplete.
 */
export const estimatePlacementCost = (
  placement: Placement,
  hours: PlacementHours[],
  rates: PlacementRate[],
  range?: { from?: string | null; to?: string | null },
): CostEstimate => {
  const rows = hours.filter(
    (h) =>
      h.placement_id === placement.id &&
      (!range?.from || h.work_date >= range.from) &&
      (!range?.to || h.work_date <= range.to),
  );
  const out: CostEstimate = {
    regularHours: 0,
    overtimeHours: 0,
    holidayHours: 0,
    estimate: 0,
    complete: true,
    issues: [],
    pricedDays: 0,
  };
  const issues = new Set<string>();
  if (rows.length === 0) issues.add("No approved hours recorded");
  for (const h of rows) {
    const reg = num(h.regular_hours) ?? 0;
    const ot = num(h.overtime_hours) ?? 0;
    const hol = num(h.holiday_hours) ?? 0;
    out.regularHours += reg;
    out.overtimeHours += ot;
    out.holidayHours += hol;
    const rate = rateOn(rates, placement.id, h.work_date);
    if (!rate) {
      issues.add(`No agency bill rate in effect on ${h.work_date}`);
      continue;
    }
    let ok = true;
    let cost = reg * (num(rate.regular_rate) ?? 0);
    if (ot > 0) {
      const r = num(rate.overtime_rate);
      if (r === null) {
        issues.add("Overtime hours recorded but no overtime bill rate supplied");
        ok = false;
      } else cost += ot * r;
    }
    if (hol > 0) {
      const r = num(rate.holiday_rate);
      if (r === null) {
        issues.add("Holiday hours recorded but no holiday bill rate supplied");
        ok = false;
      } else cost += hol * r;
    }
    out.estimate += cost;
    if (ok) out.pricedDays += 1;
  }
  out.estimate = round2(out.estimate);
  out.issues = Array.from(issues);
  out.complete = out.issues.length === 0;
  return out;
};

export interface LineCheck {
  line: InvoiceLine;
  expectedHours: number | null;
  expectedRate: number | null;
  expectedAmount: number | null;
  hoursDiff: number | null;
  rateDiff: number | null;
  amountDiff: number | null;
  /** "match" | "difference" | "unverified" */
  result: "match" | "difference" | "unverified";
  notes: string[];
}

const TOL = 0.01;

/** Compares one invoice line against approved hours and effective-dated agency rates from app records. */
export const checkLine = (line: InvoiceLine, hours: PlacementHours[], rates: PlacementRate[]): LineCheck => {
  const notes: string[] = [];
  const base: LineCheck = {
    line,
    expectedHours: null,
    expectedRate: null,
    expectedAmount: null,
    hoursDiff: null,
    rateDiff: null,
    amountDiff: null,
    result: "unverified",
    notes,
  };
  const amount = num(line.amount) ?? 0;
  const hrs = num(line.hours);
  const rate = num(line.rate);
  if (hrs !== null && rate !== null && Math.abs(round2(hrs * rate) - amount) > TOL) {
    notes.push(`Line math: ${hrs} × ${rate} = ${round2(hrs * rate)}, invoiced ${amount}`);
  }
  if (!line.placement_id) {
    notes.push("Not linked to a placement — can't compare with app records");
    return base;
  }
  if (!line.service_start || !line.service_end) {
    notes.push("Service dates missing");
    return base;
  }
  const start = line.service_start;
  const end = line.service_end;
  const effRate = rateOn(rates, line.placement_id, start);
  if (line.line_type === "fee") {
    const fee = effRate ? num(effRate.other_fees) : null;
    if (fee === null) {
      notes.push("No agreed fee configured for this placement");
      return base;
    }
    base.expectedAmount = fee;
    base.amountDiff = round2(amount - fee);
    base.result = Math.abs(base.amountDiff) > TOL || notes.length > 0 ? "difference" : "match";
    return base;
  }
  const field = line.line_type === "overtime" ? "overtime_hours" : line.line_type === "holiday" ? "holiday_hours" : "regular_hours";
  const approved = hours.filter((h) => h.placement_id === line.placement_id && h.work_date >= start && h.work_date <= end);
  if (approved.length === 0) {
    notes.push("No approved hours recorded for these service dates");
    return base;
  }
  const expHours = round2(approved.reduce((s, h) => s + (num(h[field]) ?? 0), 0));
  base.expectedHours = expHours;
  const rateChanges = new Set(approved.map((h) => rateOn(rates, line.placement_id ?? "", h.work_date)?.id ?? "none"));
  if (rateChanges.size > 1) notes.push("Agency rate changed within this service period");
  if (!effRate) {
    notes.push("No agency bill rate in effect for these dates");
  } else {
    const r =
      line.line_type === "overtime"
        ? num(effRate.overtime_rate)
        : line.line_type === "holiday"
          ? num(effRate.holiday_rate)
          : num(effRate.regular_rate);
    if (r === null) notes.push(`No ${line.line_type} bill rate supplied by the agency`);
    else {
      base.expectedRate = r;
      if (rateChanges.size <= 1) base.expectedAmount = round2(expHours * r);
      else {
        base.expectedAmount = round2(
          approved.reduce((s, h) => {
            const er = rateOn(rates, line.placement_id ?? "", h.work_date);
            const rr = er
              ? line.line_type === "overtime"
                ? num(er.overtime_rate)
                : line.line_type === "holiday"
                  ? num(er.holiday_rate)
                  : num(er.regular_rate)
              : null;
            return s + (num(h[field]) ?? 0) * (rr ?? 0);
          }, 0),
        );
      }
    }
  }
  if (hrs !== null) base.hoursDiff = round2(hrs - expHours);
  if (rate !== null && base.expectedRate !== null) base.rateDiff = round2(rate - base.expectedRate);
  if (base.expectedAmount !== null) base.amountDiff = round2(amount - base.expectedAmount);
  const diff =
    (base.hoursDiff !== null && Math.abs(base.hoursDiff) > TOL) ||
    (base.rateDiff !== null && Math.abs(base.rateDiff) > TOL) ||
    (base.amountDiff !== null && Math.abs(base.amountDiff) > TOL) ||
    notes.some((n) => n.startsWith("Line math"));
  if (diff) base.result = "difference";
  else if (base.expectedAmount !== null && base.hoursDiff !== null) base.result = "match";
  return base;
};

export interface Reconciliation {
  checks: LineCheck[];
  linesTotal: number;
  invoiceTotal: number;
  totalDiff: number;
  expectedTotal: number | null;
  invoicedComparable: number;
  differences: number;
  unverified: number;
}

export const reconcileInvoice = (
  invoice: Invoice,
  lines: InvoiceLine[],
  hours: PlacementHours[],
  rates: PlacementRate[],
): Reconciliation => {
  const mine = lines.filter((l) => l.invoice_id === invoice.id);
  const checks = mine.map((l) => checkLine(l, hours, rates));
  const linesTotal = round2(mine.reduce((s, l) => s + (num(l.amount) ?? 0), 0));
  const invoiceTotal = num(invoice.total) ?? 0;
  const verifiable = checks.filter((c) => c.expectedAmount !== null);
  return {
    checks,
    linesTotal,
    invoiceTotal,
    totalDiff: round2(invoiceTotal - linesTotal),
    expectedTotal: checks.length > 0 && verifiable.length === checks.length ? round2(verifiable.reduce((s, c) => s + (c.expectedAmount ?? 0), 0)) : null,
    invoicedComparable: round2(verifiable.reduce((s, c) => s + (num(c.line.amount) ?? 0), 0)),
    differences: checks.filter((c) => c.result === "difference").length + (Math.abs(invoiceTotal - linesTotal) > TOL ? 1 : 0),
    unverified: checks.filter((c) => c.result === "unverified").length,
  };
};

const normInvoiceNo = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/^0+/, "");

/** Possible duplicates within the same agency: same invoice number, or same total and service period. */
export const duplicateInvoices = (invoice: Pick<Invoice, "id" | "agency_id" | "invoice_number" | "total" | "period_start" | "period_end">, all: Invoice[]): Invoice[] =>
  all.filter((o) => {
    if (o.id === invoice.id || o.agency_id !== invoice.agency_id) return false;
    if (normInvoiceNo(o.invoice_number) === normInvoiceNo(invoice.invoice_number)) return true;
    return (
      !!invoice.period_start &&
      o.period_start === invoice.period_start &&
      o.period_end === invoice.period_end &&
      Math.abs((num(o.total) ?? 0) - (num(invoice.total) ?? 0)) < TOL
    );
  });
