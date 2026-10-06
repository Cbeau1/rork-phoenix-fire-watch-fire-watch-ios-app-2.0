import { endOfMonth, endOfQuarter, format, startOfMonth, startOfQuarter, startOfYear, subMonths } from "date-fns";

import type { ExData } from "./api";
import {
  OPEN_STATUSES,
  PAYABLE_STATUSES,
  type Allocation,
  type Attachment,
  type Category,
  type Direction,
  type Expenditure,
  type Payment,
  type Reimbursement,
  type Reversal,
} from "./constants";
import { addTo, toCents, type Cents, type Totals } from "./money";

export const today = (): string => format(new Date(), "yyyy-MM-dd");

export interface PaymentLine {
  payment: Payment;
  amount: Cents;
  reversed: Reversal | null;
}

export interface ReimbView {
  r: Reimbursement;
  exp: Expenditure | undefined;
  currency: string;
  requested: Cents;
  approved: Cents | null;
  paid: Cents;
  /** Remaining payable balance; 0 unless approved/partially paid. Never negative. */
  remaining: Cents;
  payments: PaymentLine[];
  payable: boolean;
}

export interface PaymentView {
  payment: Payment;
  reversed: Reversal | null;
  allocations: { allocation: Allocation; reimb: ReimbView | undefined }[];
  attachments: Attachment[];
}

export interface DirectionState {
  /** The open request for this direction (or the latest closed one when none is open). */
  view: ReimbView | null;
  flag: string;
}

export interface ExpRow {
  e: Expenditure;
  category: Category | undefined;
  amount: Cents;
  receipts: Attachment[];
  hasReceipt: boolean;
  person: DirectionState;
  recovery: DirectionState;
  duplicates: Expenditure[];
}

export interface ExIndex {
  rows: ExpRow[];
  rowById: Map<string, ExpRow>;
  categoryById: Map<string, Category>;
  reimbs: ReimbView[];
  reimbById: Map<string, ReimbView>;
  payments: PaymentView[];
  paymentById: Map<string, PaymentView>;
}

const norm = (s: string) => s.trim().toLowerCase();
const dayDiff = (a: string, b: string) => Math.abs((Date.parse(a) - Date.parse(b)) / 86_400_000);

/** Same rule as the server's ex_possible_duplicates: vendor + (amount within 3 days, or same receipt/invoice #). */
export const isDuplicatePair = (a: Expenditure, b: Expenditure): boolean =>
  a.id !== b.id &&
  norm(a.vendor) === norm(b.vendor) &&
  ((toCents(a.amount) === toCents(b.amount) && dayDiff(a.spent_on, b.spent_on) <= 3) ||
    (norm(a.invoice_ref) !== "" && norm(a.invoice_ref) === norm(b.invoice_ref)));

const pickState = (list: ReimbView[] | undefined, flag: string): DirectionState => {
  if (!list || list.length === 0) return { view: null, flag };
  const open = list.find((v) => OPEN_STATUSES.has(v.r.status));
  return { view: open ?? list[0], flag };
};

export function buildIndex(data: ExData): ExIndex {
  const categoryById = new Map(data.categories.map((c) => [c.id, c]));
  const expById = new Map(data.expenditures.map((e) => [e.id, e]));
  const reversalByPayment = new Map(data.reversals.map((r) => [r.payment_id, r]));
  const paymentById0 = new Map(data.payments.map((p) => [p.id, p]));

  const allocsByReimb = new Map<string, Allocation[]>();
  const allocsByPayment = new Map<string, Allocation[]>();
  for (const a of data.allocations) {
    allocsByReimb.set(a.reimbursement_id, [...(allocsByReimb.get(a.reimbursement_id) ?? []), a]);
    allocsByPayment.set(a.payment_id, [...(allocsByPayment.get(a.payment_id) ?? []), a]);
  }

  const reimbs: ReimbView[] = data.reimbursements.map((r) => {
    const exp = expById.get(r.expenditure_id);
    const payments: PaymentLine[] = (allocsByReimb.get(r.id) ?? [])
      .map((a) => {
        const payment = paymentById0.get(a.payment_id);
        return payment ? { payment, amount: toCents(a.amount), reversed: reversalByPayment.get(a.payment_id) ?? null } : null;
      })
      .filter((x): x is PaymentLine => x !== null)
      .sort((a, b) => b.payment.paid_on.localeCompare(a.payment.paid_on));
    const paid = payments.filter((p) => !p.reversed).reduce((s, p) => s + p.amount, 0);
    const approved = r.approved_amount === null ? null : toCents(r.approved_amount);
    const payable = PAYABLE_STATUSES.has(r.status);
    return {
      r,
      exp,
      currency: exp?.currency ?? "USD",
      requested: toCents(r.requested_amount),
      approved,
      paid,
      remaining: payable && approved !== null ? Math.max(0, approved - paid) : 0,
      payments,
      payable,
    };
  });
  const reimbById = new Map(reimbs.map((v) => [v.r.id, v]));

  const byExpDir = new Map<string, ReimbView[]>();
  for (const v of reimbs) {
    const k = `${v.r.expenditure_id}:${v.r.direction}`;
    byExpDir.set(k, [...(byExpDir.get(k) ?? []), v]);
  }
  for (const list of byExpDir.values()) list.sort((a, b) => b.r.created_at.localeCompare(a.r.created_at));

  const attByExp = new Map<string, Attachment[]>();
  const attByPay = new Map<string, Attachment[]>();
  for (const a of data.attachments) {
    if (a.archived_at) continue;
    if (a.expenditure_id) attByExp.set(a.expenditure_id, [...(attByExp.get(a.expenditure_id) ?? []), a]);
    if (a.payment_id) attByPay.set(a.payment_id, [...(attByPay.get(a.payment_id) ?? []), a]);
  }

  // Duplicate candidates among active records, bucketed by vendor.
  const byVendor = new Map<string, Expenditure[]>();
  for (const e of data.expenditures) {
    if (e.archived_at) continue;
    const k = norm(e.vendor);
    byVendor.set(k, [...(byVendor.get(k) ?? []), e]);
  }

  const rows: ExpRow[] = data.expenditures.map((e) => {
    const receipts = attByExp.get(e.id) ?? [];
    const duplicates =
      e.archived_at || e.duplicate_reviewed_at ? [] : (byVendor.get(norm(e.vendor)) ?? []).filter((o) => isDuplicatePair(e, o));
    return {
      e,
      category: categoryById.get(e.category_id),
      amount: toCents(e.amount),
      receipts,
      hasReceipt: receipts.length > 0,
      person: pickState(byExpDir.get(`${e.id}:to_person`), e.person_reimb_flag),
      recovery: pickState(byExpDir.get(`${e.id}:from_client`), e.client_recovery_flag),
      duplicates,
    };
  });

  const payments: PaymentView[] = data.payments.map((payment) => ({
    payment,
    reversed: reversalByPayment.get(payment.id) ?? null,
    allocations: (allocsByPayment.get(payment.id) ?? []).map((allocation) => ({ allocation, reimb: reimbById.get(allocation.reimbursement_id) })),
    attachments: attByPay.get(payment.id) ?? [],
  }));

  return {
    rows,
    rowById: new Map(rows.map((r) => [r.e.id, r])),
    categoryById,
    reimbs,
    reimbById,
    payments,
    paymentById: new Map(payments.map((p) => [p.payment.id, p])),
  };
}

/* ---------------- Date ranges ---------------- */

export interface Range {
  from: string;
  to: string;
}

export const inRange = (d: string, r: Range): boolean => (!r.from || d >= r.from) && (!r.to || d <= r.to);

export const PRESETS: { id: string; label: string; range: () => Range }[] = [
  { id: "month", label: "This month", range: () => ({ from: format(startOfMonth(new Date()), "yyyy-MM-dd"), to: format(endOfMonth(new Date()), "yyyy-MM-dd") }) },
  {
    id: "last_month",
    label: "Last month",
    range: () => {
      const d = subMonths(new Date(), 1);
      return { from: format(startOfMonth(d), "yyyy-MM-dd"), to: format(endOfMonth(d), "yyyy-MM-dd") };
    },
  },
  { id: "quarter", label: "This quarter", range: () => ({ from: format(startOfQuarter(new Date()), "yyyy-MM-dd"), to: format(endOfQuarter(new Date()), "yyyy-MM-dd") }) },
  { id: "ytd", label: "Year to date", range: () => ({ from: format(startOfYear(new Date()), "yyyy-MM-dd"), to: today() }) },
  { id: "12m", label: "Last 12 months", range: () => ({ from: format(startOfMonth(subMonths(new Date(), 11)), "yyyy-MM-dd"), to: today() }) },
  { id: "all", label: "All time", range: () => ({ from: "", to: "" }) },
];

/* ---------------- Dashboard summary ---------------- */

export interface Summary {
  spending: Totals;
  business: Totals;
  personal: Totals;
  reimbursedPaid: Totals;
  outstanding: Totals;
  awaiting: { count: number; totals: Totals };
  missing: { count: number; totals: Totals };
  recoveryOutstanding: Totals;
  recovered: Totals;
  count: number;
}

/**
 * Spending uses purchase dates; reimbursement payments use payment dates. Reimbursement payments
 * are never added to spending — they only settle who paid.
 */
export function summarize(ix: ExIndex, range: Range): Summary {
  const s: Summary = {
    spending: {},
    business: {},
    personal: {},
    reimbursedPaid: {},
    outstanding: {},
    awaiting: { count: 0, totals: {} },
    missing: { count: 0, totals: {} },
    recoveryOutstanding: {},
    recovered: {},
    count: 0,
  };
  for (const row of ix.rows) {
    if (row.e.archived_at || !inRange(row.e.spent_on, range)) continue;
    s.count++;
    addTo(s.spending, row.e.currency, row.amount);
    addTo(row.e.paid_by === "business" ? s.business : s.personal, row.e.currency, row.amount);
    if (!row.hasReceipt) {
      s.missing.count++;
      addTo(s.missing.totals, row.e.currency, row.amount);
    }
  }
  for (const v of ix.reimbs) {
    if (v.exp?.archived_at) continue;
    if (v.r.direction === "to_person") {
      if (v.payable) addTo(s.outstanding, v.currency, v.remaining);
      if (v.r.status === "pending_review") {
        s.awaiting.count++;
        addTo(s.awaiting.totals, v.currency, v.requested);
      }
    } else if (v.payable) addTo(s.recoveryOutstanding, v.currency, v.remaining);
  }
  for (const p of ix.payments) {
    if (p.reversed || !inRange(p.payment.paid_on, range)) continue;
    addTo(p.payment.direction === "to_person" ? s.reimbursedPaid : s.recovered, p.payment.currency, toCents(p.payment.amount));
  }
  return s;
}

/* ---------------- Record filters ---------------- */

export interface Filters {
  q: string;
  from: string;
  to: string;
  category: string;
  vendor: string;
  payer: string;
  paidBy: string;
  method: string;
  property: string;
  agency: string;
  direction: string;
  status: string;
  missing: boolean;
  duplicates: boolean;
  archived: boolean;
}

export const FILTER_KEYS: (keyof Filters)[] = [
  "q",
  "from",
  "to",
  "category",
  "vendor",
  "payer",
  "paidBy",
  "method",
  "property",
  "agency",
  "direction",
  "status",
  "missing",
  "duplicates",
  "archived",
];

export const readFilters = (p: URLSearchParams): Filters => ({
  q: p.get("q") ?? "",
  from: p.get("from") ?? "",
  to: p.get("to") ?? "",
  category: p.get("category") ?? "",
  vendor: p.get("vendor") ?? "",
  payer: p.get("payer") ?? "",
  paidBy: p.get("paidBy") ?? "",
  method: p.get("method") ?? "",
  property: p.get("property") ?? "",
  agency: p.get("agency") ?? "",
  direction: p.get("direction") ?? "",
  status: p.get("status") ?? "",
  missing: p.get("missing") === "1",
  duplicates: p.get("duplicates") === "1",
  archived: p.get("archived") === "1",
});

export const payerLabel = (e: Expenditure): string => (e.paid_by === "business" ? "Business" : e.payer_name || "—");

const stateMatches = (st: DirectionState, status: string): boolean => {
  if (!status) return true;
  if (status === "outstanding") return !!st.view && st.view.payable && st.view.remaining > 0;
  if (status === "not_applicable" || status === "not_requested") return !st.view && st.flag === status;
  if (status === "none") return !st.view;
  return st.view?.r.status === status;
};

export function filterRows(rows: ExpRow[], f: Filters, propertyName: (id: string) => string): ExpRow[] {
  const q = norm(f.q);
  return rows.filter((row) => {
    const e = row.e;
    if (f.archived ? !e.archived_at : !!e.archived_at) return false;
    if (!inRange(e.spent_on, f)) return false;
    if (f.category && e.category_id !== f.category) return false;
    if (f.vendor && norm(e.vendor) !== norm(f.vendor)) return false;
    if (f.payer && norm(payerLabel(e)) !== norm(f.payer)) return false;
    if (f.paidBy === "personal" ? e.paid_by === "business" : f.paidBy && e.paid_by !== f.paidBy) return false;
    if (f.method && e.payment_method !== f.method) return false;
    if (f.property && e.property_id !== f.property) return false;
    if (f.agency && e.agency_id !== f.agency) return false;
    if (f.missing && row.hasReceipt) return false;
    if (f.duplicates && row.duplicates.length === 0) return false;
    if (f.direction === "to_person") {
      if (!stateMatches(row.person, f.status || "")) return false;
      if (!f.status && !row.person.view) return false;
    } else if (f.direction === "from_client") {
      if (!stateMatches(row.recovery, f.status || "")) return false;
      if (!f.status && !row.recovery.view) return false;
    } else if (f.status && !stateMatches(row.person, f.status) && !stateMatches(row.recovery, f.status)) return false;
    if (q) {
      const hay = [e.code, e.vendor, e.description, e.purpose, e.invoice_ref, e.payer_name, e.notes, row.category?.name ?? "", e.property_id ? propertyName(e.property_id) : e.property_name]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export type SortKey = "date" | "vendor" | "category" | "amount" | "paidBy" | "code";

export function sortRows(rows: ExpRow[], key: SortKey, dir: "asc" | "desc"): ExpRow[] {
  const m = dir === "asc" ? 1 : -1;
  const cmp = (a: ExpRow, b: ExpRow): number => {
    switch (key) {
      case "vendor":
        return a.e.vendor.localeCompare(b.e.vendor);
      case "category":
        return (a.category?.name ?? "").localeCompare(b.category?.name ?? "");
      case "amount":
        return a.amount - b.amount;
      case "paidBy":
        return payerLabel(a.e).localeCompare(payerLabel(b.e));
      case "code":
        return a.e.code.localeCompare(b.e.code);
      default:
        return a.e.spent_on.localeCompare(b.e.spent_on) || a.e.created_at.localeCompare(b.e.created_at);
    }
  };
  return [...rows].sort((a, b) => cmp(a, b) * m);
}

/* ---------------- Report helpers ---------------- */

export const group = <T,>(items: T[], key: (t: T) => string): Map<string, T[]> => {
  const m = new Map<string, T[]>();
  for (const i of items) {
    const k = key(i);
    m.set(k, [...(m.get(k) ?? []), i]);
  }
  return m;
};

export const sumByCurrency = (rows: { currency: string; cents: Cents }[]): Totals => {
  const t: Totals = {};
  for (const r of rows) addTo(t, r.currency, r.cents);
  return t;
};

export const directionOf = (v: ReimbView): Direction => v.r.direction as Direction;
