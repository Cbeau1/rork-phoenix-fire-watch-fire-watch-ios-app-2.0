import type { Tables } from "@/integrations/supabase/types";
import type { Tone } from "@/lib/workforce/constants";

export type Expenditure = Tables<"ex_expenditures">;
export type Category = Tables<"ex_categories">;
export type Reimbursement = Tables<"ex_reimbursements">;
export type Payment = Tables<"ex_payments">;
export type Allocation = Tables<"ex_allocations">;
export type Reversal = Tables<"ex_payment_reversals">;
export type Attachment = Tables<"ex_attachments">;
export type ShiftLink = Tables<"ex_shift_links">;
export type HistoryEntry = Tables<"ex_history">;

export type PaidBy = "business" | "owner" | "employee" | "other";
export type Direction = "to_person" | "from_client";
export type Flag = "not_applicable" | "not_requested";

export const PAID_BY: Record<PaidBy, string> = {
  business: "Business",
  owner: "Owner",
  employee: "Employee",
  other: "Other person",
};

export const METHOD: Record<string, string> = {
  business_card: "Business card",
  personal_card: "Personal card",
  business_bank: "Business bank account",
  personal_bank: "Personal bank account",
  cash: "Cash",
  other: "Other",
};

/** Methods that make sense for each payer (enforced again on the server). */
export const METHODS_FOR: Record<"business" | "personal", string[]> = {
  business: ["business_card", "business_bank", "cash", "other"],
  personal: ["personal_card", "personal_bank", "cash", "other"],
};

export const CURRENCIES = ["USD", "CAD", "MXN", "EUR", "GBP"] as const;

export const DIRECTION: Record<Direction, { label: string; short: string; long: string }> = {
  to_person: { label: "Reimbursement to person", short: "Owed to person", long: "Business reimburses a person" },
  from_client: { label: "Client/agency recovery", short: "Recovery", long: "Client or agency reimburses the business" },
};

export const PARTY_TYPE: Record<string, string> = {
  owner: "Owner",
  employee: "Employee",
  other: "Other",
  client: "Client / property",
  agency: "Agency",
};

export const REIMB_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "slate" },
  pending_review: { label: "Pending review", tone: "amber" },
  approved: { label: "Approved · unpaid", tone: "blue" },
  partially_reimbursed: { label: "Partially reimbursed", tone: "primary" },
  fully_reimbursed: { label: "Fully reimbursed", tone: "green" },
  rejected: { label: "Rejected", tone: "red" },
  cancelled: { label: "Cancelled", tone: "slate" },
};

/** Recovery statuses read better with "recovered" wording. */
export const RECOVERY_STATUS: Record<string, { label: string; tone: Tone }> = {
  ...REIMB_STATUS,
  approved: { label: "Approved · not received", tone: "blue" },
  partially_reimbursed: { label: "Partially recovered", tone: "primary" },
  fully_reimbursed: { label: "Fully recovered", tone: "green" },
};

export const statusMeta = (dir: Direction) => (dir === "to_person" ? REIMB_STATUS : RECOVERY_STATUS);

export const FLAG: Record<Flag, { label: string; tone: Tone }> = {
  not_applicable: { label: "Not applicable", tone: "slate" },
  not_requested: { label: "Not requested", tone: "slate" },
};

export const PAY_METHOD: Record<string, string> = {
  check: "Check",
  cash: "Cash",
  bank_transfer: "Bank transfer",
  card: "Card",
  payroll: "Added to payroll",
  offset: "Offset / credit",
  other: "Other",
};

export const CATEGORY_KIND: Record<string, string> = {
  general: "General",
  payroll: "Payroll (link schedule shifts)",
  agency: "Agency staffing (link agency invoices)",
};

export const HISTORY_ACTION: Record<string, string> = {
  create: "Created",
  update: "Edited",
  archive: "Archived",
  restore: "Restored",
  link: "Linked records",
  attachment: "File attached",
  attachment_archived: "File archived",
  duplicate_confirmed: "Duplicate reviewed",
  reimb_create: "Request created",
  reimb_update: "Request edited",
  reimb_adjust: "Approved amount corrected",
  status_change: "Status changed",
  payment: "Payment recorded",
  payment_reversed: "Payment reversed",
  category_create: "Category created",
  category_update: "Category edited",
  view: "Viewed",
  preview: "Previewed",
  download: "Downloaded",
  export: "Exported",
  print: "Printed",
};

export const OPEN_STATUSES = new Set(["draft", "pending_review", "approved", "partially_reimbursed", "fully_reimbursed"]);
export const PAYABLE_STATUSES = new Set(["approved", "partially_reimbursed"]);
