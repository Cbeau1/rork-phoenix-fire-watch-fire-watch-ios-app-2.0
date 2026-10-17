import { supabase } from "@/lib/supabase";
import { wfError } from "@/lib/workforce/api";

import type {
  Allocation,
  Attachment,
  Category,
  Expenditure,
  HistoryEntry,
  Payment,
  Recurring,
  Reimbursement,
  Reversal,
  ShiftLink,
} from "./constants";

const unwrap = <T>(res: { data: T | null; error: unknown }): T => {
  if (res.error) throw wfError(res.error);
  return res.data as T;
};

const LIMIT = 20000;

/** Verifies (server-side) that the caller may use Expenditures; first use seeds default categories. */
export const checkAccess = async (): Promise<boolean> => unwrap(await supabase.rpc("ex_access")) === true;

export interface ExData {
  expenditures: Expenditure[];
  categories: Category[];
  reimbursements: Reimbursement[];
  payments: Payment[];
  allocations: Allocation[];
  reversals: Reversal[];
  attachments: Attachment[];
  shiftLinks: ShiftLink[];
  recurring: Recurring[];
}

/** Every Expenditures table is RLS-protected (org + Expenditures permission). */
export async function loadAll(): Promise<ExData> {
  // Add any monthly recurring entries that came due since the last hourly run. Fail-soft: the cron job is the backstop.
  const sync = await supabase.rpc("ex_sync_recurring");
  if (sync.error) console.warn("[Expenditures] recurring sync skipped", sync.error.message);
  const [expenditures, categories, reimbursements, payments, allocations, reversals, attachments, shiftLinks, recurring] = await Promise.all([
    supabase.from("ex_expenditures").select("*").order("spent_on", { ascending: false }).order("created_at", { ascending: false }).limit(LIMIT),
    supabase.from("ex_categories").select("*").order("sort").order("name"),
    supabase.from("ex_reimbursements").select("*").order("requested_on", { ascending: false }).limit(LIMIT),
    supabase.from("ex_payments").select("*").order("paid_on", { ascending: false }).order("recorded_at", { ascending: false }).limit(LIMIT),
    supabase.from("ex_allocations").select("*").limit(LIMIT),
    supabase.from("ex_payment_reversals").select("*").limit(LIMIT),
    supabase.from("ex_attachments").select("*").order("uploaded_at").limit(LIMIT),
    supabase.from("ex_shift_links").select("*").limit(LIMIT),
    supabase.from("ex_recurring").select("*").is("archived_at", null).order("day_of_month").order("vendor"),
  ]);
  return {
    expenditures: unwrap(expenditures),
    categories: unwrap(categories),
    reimbursements: unwrap(reimbursements),
    payments: unwrap(payments),
    allocations: unwrap(allocations),
    reversals: unwrap(reversals),
    attachments: unwrap(attachments),
    shiftLinks: unwrap(shiftLinks),
    recurring: unwrap(recurring),
  };
}

export interface LookupAgency {
  id: string;
  name: string;
  archived: boolean;
}
export interface LookupWorker {
  id: string;
  name: string;
  code: string;
  source: string;
  status: string;
  agencyId: string | null;
  archived: boolean;
}
export interface LookupPlacement {
  id: string;
  workerId: string;
  agencyId: string;
  propertyId: string | null;
  propertyName: string;
  startDate: string;
  endDate: string | null;
  status: string;
}
export interface LookupInvoice {
  id: string;
  agencyId: string;
  number: string;
  invoiceDate: string | null;
  total: string;
  status: string;
  paidOn: string | null;
  paymentRef: string;
  archived: boolean;
}
export interface Lookups {
  agencies: LookupAgency[];
  workers: LookupWorker[];
  placements: LookupPlacement[];
  invoices: LookupInvoice[];
}

/** Minimal workforce/agency records for linking — returned only to Expenditures-authorized admins. */
export const loadLookups = async (): Promise<Lookups> => {
  const raw = unwrap(await supabase.rpc("ex_lookups")) as unknown as Partial<Lookups> | null;
  return {
    agencies: raw?.agencies ?? [],
    workers: raw?.workers ?? [],
    placements: raw?.placements ?? [],
    invoices: raw?.invoices ?? [],
  };
};

export interface ShiftOption {
  id: string;
  date: string;
  start: string;
  end: string;
  staffName: string;
  propertyId: string;
  paid: boolean;
}

/** Schedule shifts for payroll linking (shift pay status is admin-only by RLS). */
export const loadShifts = async (from: string, to: string): Promise<ShiftOption[]> => {
  const rows = unwrap(
    await supabase
      .from("shifts")
      .select("id, shift_date, start_time, end_time, property_id, staff(name), shift_payments(paid_at)")
      .gte("shift_date", from)
      .lte("shift_date", to)
      .order("shift_date")
      .order("start_time")
      .limit(2000),
  );
  return rows.map((r) => {
    const staff = r.staff as unknown as { name?: string } | { name?: string }[] | null;
    const pay = r.shift_payments as unknown;
    return {
      id: r.id,
      date: r.shift_date,
      start: r.start_time.slice(0, 5),
      end: r.end_time.slice(0, 5),
      staffName: (Array.isArray(staff) ? staff[0]?.name : staff?.name) ?? "Unassigned",
      propertyId: r.property_id,
      paid: Array.isArray(pay) ? pay.length > 0 : !!pay,
    };
  });
};

export const loadShiftsByIds = async (ids: string[]): Promise<ShiftOption[]> => {
  if (ids.length === 0) return [];
  const rows = unwrap(
    await supabase
      .from("shifts")
      .select("id, shift_date, start_time, end_time, property_id, staff(name), shift_payments(paid_at)")
      .in("id", ids.slice(0, 500)),
  );
  return rows.map((r) => {
    const staff = r.staff as unknown as { name?: string } | { name?: string }[] | null;
    const pay = r.shift_payments as unknown;
    return {
      id: r.id,
      date: r.shift_date,
      start: r.start_time.slice(0, 5),
      end: r.end_time.slice(0, 5),
      staffName: (Array.isArray(staff) ? staff[0]?.name : staff?.name) ?? "Unassigned",
      propertyId: r.property_id,
      paid: Array.isArray(pay) ? pay.length > 0 : !!pay,
    };
  });
};

export const loadHistory = async (opts: { expenditureId?: string; limit?: number } = {}): Promise<HistoryEntry[]> => {
  let q = supabase.from("ex_history").select("*").order("created_at", { ascending: false }).limit(opts.limit ?? 300);
  if (opts.expenditureId) q = q.eq("expenditure_id", opts.expenditureId);
  return unwrap(await q);
};

/* ---------------- Mutations (all validated + audited server-side) ---------------- */

export type ExpenditurePayload = {
  spent_on: string;
  vendor: string;
  description: string;
  purpose: string;
  category_id: string;
  amount: string;
  currency: string;
  tax_amount: string;
  paid_by: string;
  payer_name: string;
  payer_worker_id: string;
  payment_method: string;
  account_label: string;
  property_id: string;
  client_name: string;
  agency_id: string;
  placement_id: string;
  agency_invoice_id: string;
  invoice_ref: string;
  notes: string;
  person_reimb_flag: string;
  client_recovery_flag: string;
  shift_ids?: string[];
  confirm_duplicate?: boolean;
  duplicate_note?: string;
};

export const saveExpenditure = async (id: string | null, p: ExpenditurePayload) =>
  unwrap(await supabase.rpc("ex_save_expenditure", { p_id: id as string, p: p as never })) as unknown as { id: string; code: string };

export const archiveExpenditure = async (id: string, archive: boolean, reason: string) => {
  unwrap(await supabase.rpc("ex_archive_expenditure", { p_id: id, p_archive: archive, p_reason: reason }));
};

export const confirmDuplicate = async (id: string, note: string) => {
  unwrap(await supabase.rpc("ex_confirm_duplicate", { p_id: id, p_note: note }));
};

export const possibleDuplicates = async (vendor: string, date: string, amount: string, ref: string, exclude: string | null) =>
  unwrap(
    await supabase.rpc("ex_possible_duplicates", {
      p_vendor: vendor,
      p_date: date,
      p_amount: Number(amount),
      p_ref: ref,
      p_exclude: exclude as string,
    }),
  ) ?? [];

export const saveCategory = async (id: string | null, name: string, kind: string, active: boolean, sort: number) =>
  unwrap(await supabase.rpc("ex_save_category", { p_id: id as string, p_name: name, p_kind: kind, p_active: active, p_sort: sort }));

export type RecurringPayload = {
  vendor: string;
  description: string;
  category_id: string;
  amount: string;
  currency: string;
  paid_by: string;
  payer_name: string;
  payment_method: string;
  account_label: string;
  property_id: string;
  client_name: string;
  notes: string;
  day_of_month: number;
  start_on: string;
  end_on: string;
};

/** Saves a monthly template; the server immediately adds any entries already due. */
export const saveRecurring = async (id: string | null, p: RecurringPayload) =>
  unwrap(await supabase.rpc("ex_save_recurring", { p_id: id as string, p: p as never })) as unknown as { id: string; created: number };

export const setRecurringState = async (id: string, action: "pause" | "resume" | "delete") =>
  unwrap(await supabase.rpc("ex_set_recurring_state", { p_id: id, p_action: action })) as unknown as { created: number };

export type ReimbursementPayload = {
  expenditure_id?: string;
  direction?: string;
  party_type: string;
  party_name: string;
  party_worker_id: string;
  party_agency_id: string;
  party_property_id: string;
  agency_invoice_id: string;
  requested_amount: string;
  requested_on: string;
  due_on: string;
  invoice_ref: string;
  notes: string;
  submit?: boolean;
};

export const saveReimbursement = async (id: string | null, p: ReimbursementPayload) =>
  unwrap(await supabase.rpc("ex_save_reimbursement", { p_id: id as string, p: p as never })) as unknown as { id: string; code: string };

export type ReviewAction = "submit" | "approve" | "adjust" | "reject" | "cancel" | "reopen";
export const reviewReimbursement = async (id: string, action: ReviewAction, amount: string, note: string) => {
  unwrap(await supabase.rpc("ex_review_reimbursement", { p_id: id, p_action: action, p_amount: amount, p_note: note }));
};

export type PaymentPayload = {
  direction: string;
  paid_on: string;
  method: string;
  reference: string;
  notes: string;
  amount: string;
  allocations: { reimbursement_id: string; amount: string }[];
};
export const recordPayment = async (p: PaymentPayload) =>
  unwrap(await supabase.rpc("ex_record_payment", { p: p as never })) as unknown as { id: string; code: string; amount: string };

export const reversePayment = async (id: string, reason: string) => {
  unwrap(await supabase.rpc("ex_reverse_payment", { p_id: id, p_reason: reason }));
};

export const archiveAttachment = async (id: string, reason: string) => {
  unwrap(await supabase.rpc("ex_archive_attachment", { p_id: id, p_reason: reason }));
};

export const logEvent = async (action: "view" | "preview" | "download" | "export" | "print", summary: string, expenditureId?: string | null) => {
  unwrap(await supabase.rpc("ex_log_event", { p_action: action, p_exp: (expenditureId ?? null) as string, p_summary: summary }));
};

/* ---------------- Private files (server validates type by magic bytes + size) ---------------- */

async function invoke<T>(body: FormData | Record<string, unknown>, fallback: string): Promise<T> {
  const { data, error } = await supabase.functions.invoke("workforce-files", { body });
  if (error) {
    let message = fallback;
    const ctx = (error as { context?: unknown }).context;
    if (ctx instanceof Response) {
      try {
        const payload = (await ctx.json()) as { error?: string };
        if (payload.error) message = payload.error;
      } catch {
        // not JSON
      }
    }
    throw new Error(message);
  }
  return data as T;
}

export const uploadFile = (file: File, target: { expenditureId?: string; paymentId?: string }) => {
  const form = new FormData();
  form.set("action", "upload-expense-file");
  form.set("file", file);
  form.set("expenditureId", target.expenditureId ?? "");
  form.set("paymentId", target.paymentId ?? "");
  return invoke<{ ok: boolean; id: string }>(form, "Upload failed. Please try again.");
};

/** 60-second signed URL — never stored, cached or shared. */
export const fileUrl = async (id: string, mode: "preview" | "download") =>
  (await invoke<{ ok: boolean; url: string }>({ action: "expense-file-url", id, mode }, "Couldn't open the file.")).url;
