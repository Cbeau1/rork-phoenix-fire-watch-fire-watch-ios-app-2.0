import type { Tables } from "@/integrations/supabase/types";

export type Worker = Tables<"wf_workers">;
export type Agency = Tables<"wf_agencies">;
export type Employment = Tables<"wf_employment">;
export type PayRate = Tables<"wf_pay_rates">;
export type Placement = Tables<"wf_placements">;
export type PlacementRate = Tables<"wf_placement_rates">;
export type PlacementHours = Tables<"wf_placement_hours">;
export type Invoice = Tables<"wf_invoices">;
export type InvoiceLine = Tables<"wf_invoice_lines">;
export type PersonnelRecord = Tables<"wf_personnel_records">;
export type PersonnelRevision = Tables<"wf_personnel_revisions">;
export type WfDocument = Tables<"wf_documents">;
export type DocVersion = Tables<"wf_document_versions">;
export type Template = Tables<"wf_requirement_templates">;
export type ChecklistItem = Tables<"wf_checklist_items">;
export type Equipment = Tables<"wf_equipment">;
export type Reminder = Tables<"wf_reminders">;
export type AuditEntry = Tables<"wf_audit_log">;
export type WfSettings = Tables<"wf_settings">;

export type WorkerSource = "direct" | "agency";
export type Perm = "manage" | "personnel" | "pay" | "documents" | "finance" | "purge" | "admin" | "expenses";
export type WfPerms = Record<Perm, boolean>;

export const NO_PERMS: WfPerms = {
  manage: false,
  personnel: false,
  pay: false,
  documents: false,
  finance: false,
  purge: false,
  admin: false,
  expenses: false,
};

export const PERM_META: Record<Perm, { label: string; description: string }> = {
  manage: { label: "Workforce access", description: "Directory, profiles, checklists, placements, equipment, reminders." },
  personnel: { label: "Personnel records", description: "Coaching, warnings, investigations and do-not-assign reasons." },
  pay: { label: "Employee pay", description: "Hourly pay rates and pay-rate history for direct employees." },
  documents: { label: "Restricted documents", description: "Payroll/tax, performance, disciplinary and separation files." },
  finance: { label: "Agency financials", description: "Agency bill rates, cost estimates and invoice reconciliation." },
  purge: { label: "Permanent deletion", description: "Permanently delete archived profiles and documents." },
  admin: { label: "Manage permissions", description: "Grant or remove these workforce permissions for other admins." },
  expenses: {
    label: "Expenditures",
    description: "Business spending, receipts, reimbursements and recoveries. Independent of Workforce access.",
  },
};

/** Permissions that don't depend on general Workforce access. */
export const INDEPENDENT_PERMS = new Set<Perm>(["expenses"]);

export type Tone = "green" | "amber" | "red" | "slate" | "primary" | "blue";

export const TONE_CLASS: Record<Tone, string> = {
  green: "bg-status-clear/12 text-status-clear ring-status-clear/35",
  amber: "bg-status-follow/12 text-status-follow ring-status-follow/35",
  red: "bg-status-incident/12 text-status-incident-ink ring-status-incident/35",
  slate: "bg-surface text-ink-2 ring-line",
  primary: "bg-primary/12 text-link ring-link/35",
  blue: "bg-sky-400/12 text-sky-300 ring-sky-400/35",
};

export const SOURCE_LABEL: Record<WorkerSource, string> = {
  direct: "Direct Employee",
  agency: "Temporary Agency Worker",
};

export const SOURCE_SHORT: Record<WorkerSource, string> = { direct: "Direct", agency: "Agency" };

export const DIRECT_STATUSES = ["onboarding", "active", "on_leave", "suspended", "terminated"] as const;
export const AGENCY_STATUSES = ["pending_placement", "active", "unavailable", "assignment_ended", "do_not_assign"] as const;

export const WORKER_STATUS: Record<string, { label: string; tone: Tone }> = {
  onboarding: { label: "Onboarding", tone: "blue" },
  active: { label: "Active", tone: "green" },
  on_leave: { label: "On leave", tone: "amber" },
  suspended: { label: "Suspended", tone: "red" },
  terminated: { label: "Terminated", tone: "slate" },
  pending_placement: { label: "Pending placement", tone: "blue" },
  unavailable: { label: "Unavailable", tone: "amber" },
  assignment_ended: { label: "Assignment ended", tone: "slate" },
  do_not_assign: { label: "Do not assign", tone: "red" },
};

export const statusesFor = (source: string): readonly string[] =>
  source === "agency" ? AGENCY_STATUSES : DIRECT_STATUSES;

export const PLACEMENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Pending", tone: "blue" },
  active: { label: "Active", tone: "green" },
  completed: { label: "Completed", tone: "slate" },
  cancelled: { label: "Cancelled", tone: "red" },
};

export const INVOICE_STATUS: Record<string, { label: string; tone: Tone }> = {
  received: { label: "Received", tone: "blue" },
  under_review: { label: "Under review", tone: "amber" },
  approved: { label: "Approved", tone: "green" },
  disputed: { label: "Disputed", tone: "red" },
  paid: { label: "Paid", tone: "slate" },
};

export const REVIEW_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Pending review", tone: "amber" },
  approved: { label: "Approved", tone: "green" },
  rejected: { label: "Rejected", tone: "red" },
  expired: { label: "Expired", tone: "red" },
  superseded: { label: "Superseded", tone: "slate" },
};

export const CHECK_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Pending", tone: "amber" },
  completed: { label: "Completed", tone: "green" },
  not_applicable: { label: "Not applicable", tone: "slate" },
};

export const EQUIP_STATUS: Record<string, { label: string; tone: Tone }> = {
  issued: { label: "Issued", tone: "blue" },
  returned: { label: "Returned", tone: "green" },
  lost: { label: "Lost", tone: "red" },
  damaged: { label: "Damaged", tone: "amber" },
};

export const EQUIP_TYPE: Record<string, string> = {
  uniform: "Uniform",
  badge: "Badge",
  radio: "Radio",
  key: "Key",
  other: "Other equipment",
};

export const OWNERSHIP: Record<string, string> = { pfw: "Phoenix Fire Watch", agency: "Agency", other: "Other" };

export const PERSONNEL_TYPE: Record<string, string> = {
  coaching: "Coaching note",
  commendation: "Commendation",
  client_complaint: "Client complaint",
  attendance: "Attendance concern",
  written_warning: "Written warning",
  investigation: "Investigation",
  admin_note: "Administrative note",
};

export const PERSONNEL_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "slate" },
  under_review: { label: "Under review", tone: "amber" },
  closed: { label: "Closed", tone: "green" },
};

export const WORKER_DOC_CATEGORIES: Record<string, string> = {
  application_resume: "Application / resume",
  offer_agreement: "Offer letter / employment agreement",
  signed_policies: "Signed policies",
  handbook_ack: "Handbook acknowledgment",
  payroll_tax: "Payroll / tax paperwork",
  performance_review: "Performance review",
  disciplinary: "Disciplinary document",
  separation: "Separation document",
  placement_confirmation: "Agency placement confirmation",
  other: "Other",
};

export const AGENCY_DOC_CATEGORIES: Record<string, string> = {
  service_agreement: "Service agreement",
  rate_agreement: "Rate agreement",
  insurance: "Insurance documentation",
  invoice: "Invoice",
  agency_other: "Other",
};

export const DOC_CATEGORY_LABEL: Record<string, string> = { ...WORKER_DOC_CATEGORIES, ...AGENCY_DOC_CATEGORIES };

/** Categories that are always stored as restricted (need the restricted-documents permission). */
export const RESTRICTED_CATEGORIES = new Set(["payroll_tax", "performance_review", "disciplinary", "separation"]);
/** Categories always stored as financial (need agency-financials permission). */
export const FINANCIAL_CATEGORIES = new Set(["invoice", "rate_agreement"]);

/** Worker document categories that don't apply to agency workers (employee hiring / payroll paperwork). */
export const DIRECT_ONLY_CATEGORIES = new Set(["offer_agreement", "payroll_tax", "handbook_ack", "performance_review", "separation"]);
export const AGENCY_ONLY_CATEGORIES = new Set(["placement_confirmation"]);

export const CLASSIFICATION: Record<string, { label: string; tone: Tone }> = {
  standard: { label: "Standard", tone: "slate" },
  restricted: { label: "Restricted", tone: "red" },
  financial: { label: "Financial", tone: "amber" },
};

export const CHECKLIST_KIND: Record<string, { label: string; description: string }> = {
  direct: { label: "Direct employee onboarding", description: "Paperwork and setup for new direct employees." },
  placement: { label: "Agency placement", description: "Created for every new agency placement." },
  direct_offboarding: { label: "Direct employee offboarding", description: "Used when an employee separates." },
  placement_end: { label: "Ending a placement", description: "Used when an agency placement ends." },
};

export const INVOICE_LINE_TYPE: Record<string, string> = {
  regular: "Regular hours",
  overtime: "Overtime hours",
  holiday: "Holiday hours",
  fee: "Additional fee",
};

export const EMPLOYMENT_TYPES = ["Full-time", "Part-time", "Seasonal", "On-call", "Temporary (direct)"] as const;

export const PREFERRED_CONTACT: Record<string, string> = { phone: "Phone call", text: "Text message", email: "Email" };

export const REMINDER_KIND: Record<string, string> = {
  paperwork: "Missing paperwork",
  doc_expiry: "Document expiration",
  followup: "Personnel follow-up",
  equipment: "Equipment return",
  placement_end: "Placement ending",
  invoice_due: "Invoice due",
};

export const AUDIT_ACTION: Record<string, string> = {
  create: "Created",
  update: "Edited",
  status_change: "Status changed",
  archive: "Archived",
  restore: "Restored",
  delete: "Deleted",
  purge: "Permanently deleted",
  view: "Viewed",
  preview: "Previewed",
  download: "Downloaded",
  export: "Exported",
  print: "Printed",
};

export const ENTITY_LABEL: Record<string, string> = {
  wf_workers: "Worker profile",
  wf_agencies: "Agency",
  wf_employment: "Employment",
  wf_pay_rates: "Pay rate",
  wf_restrictions: "Do-not-assign restriction",
  wf_restriction_reviews: "Restriction review",
  wf_placements: "Placement",
  wf_placement_rates: "Agency bill rate",
  wf_placement_hours: "Approved hours",
  wf_invoices: "Agency invoice",
  wf_invoice_lines: "Invoice line",
  wf_personnel_records: "Personnel record",
  wf_documents: "Document",
  wf_document_versions: "Document version",
  wf_requirement_templates: "Checklist template",
  wf_checklist_items: "Checklist item",
  wf_equipment: "Equipment",
  wf_reminders: "Reminder",
  wf_settings: "Workforce settings",
  wf_permissions: "Permissions",
  directory: "Directory",
  report: "Report",
};

export const fullName = (w: Pick<Worker, "first_name" | "last_name">): string => `${w.first_name} ${w.last_name}`.trim();

export const money = (n: number | null | undefined): string =>
  n === null || n === undefined || Number.isNaN(n)
    ? "—"
    : n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

export const hoursLabel = (n: number): string => `${Number.isInteger(n) ? n : n.toFixed(2)}h`;
