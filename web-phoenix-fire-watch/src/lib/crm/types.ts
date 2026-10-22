import type { Tone } from "@/lib/workforce/constants";

export type Stage = "lead" | "quoted" | "contract_sent" | "signed" | "active" | "completed" | "lost";
export type Coverage = "24_7" | "12_day" | "12_night" | "custom";
export type QuoteStatus = "draft" | "sent" | "accepted" | "declined";
export type ContractStatus = "draft" | "sent" | "signed" | "void";
export type ContactRole = "billing" | "site" | "manager" | "other";

/** Pipeline order (Lost sits outside the flow). */
export const STAGES: Stage[] = ["lead", "quoted", "contract_sent", "signed", "active", "completed"];

export const STAGE_META: Record<Stage, { label: string; tone: Tone; dot: string; hint: string }> = {
  lead: { label: "Lead", tone: "blue", dot: "bg-info", hint: "New request — needs a quote" },
  quoted: { label: "Quoted", tone: "primary", dot: "bg-primary", hint: "Quote sent — waiting on the client" },
  contract_sent: { label: "Contract sent", tone: "amber", dot: "bg-status-follow", hint: "Waiting for signature" },
  signed: { label: "Signed", tone: "green", dot: "bg-status-clear", hint: "Ready to staff and start" },
  active: { label: "Active", tone: "green", dot: "bg-status-clear", hint: "Fire watch in progress" },
  completed: { label: "Completed", tone: "slate", dot: "bg-ink-3", hint: "Job finished" },
  lost: { label: "Lost", tone: "red", dot: "bg-status-incident", hint: "Closed without a job" },
};

export const NEXT_ACTION: Partial<Record<Stage, { to: Stage; label: string }>> = {
  lead: { to: "quoted", label: "Mark quoted" },
  quoted: { to: "contract_sent", label: "Mark contract sent" },
  contract_sent: { to: "signed", label: "Mark signed" },
  signed: { to: "active", label: "Start job (Active)" },
  active: { to: "completed", label: "Mark completed" },
};

export const COVERAGE_LABEL: Record<Coverage, string> = {
  "24_7": "24/7 coverage",
  "12_day": "12-hour days",
  "12_night": "12-hour nights",
  custom: "Custom hours",
};

export const COVERAGE_OPTIONS = (Object.keys(COVERAGE_LABEL) as Coverage[]).map((value) => ({ value, label: COVERAGE_LABEL[value] }));

export const QUOTE_META: Record<QuoteStatus, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "slate" },
  sent: { label: "Sent", tone: "primary" },
  accepted: { label: "Accepted", tone: "green" },
  declined: { label: "Declined", tone: "red" },
};

export const CONTRACT_META: Record<ContractStatus, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "slate" },
  sent: { label: "Awaiting signature", tone: "amber" },
  signed: { label: "Signed", tone: "green" },
  void: { label: "Voided", tone: "red" },
};

export const ROLE_LABEL: Record<ContactRole, string> = {
  billing: "Billing",
  site: "Site contact",
  manager: "Manager",
  other: "Other",
};

export const LEAD_SOURCES = ["Phone call", "Email", "Website", "Referral", "Repeat client", "Fire marshal", "Other"];

export const weeklyHours = (coverage: string, hoursPerWeek: number | null | undefined): number => {
  if (coverage === "24_7") return 168;
  if (coverage === "12_day" || coverage === "12_night") return 84;
  return Number(hoursPerWeek ?? 0) || 0;
};

export const money = (n: number | null | undefined, cents = true): string =>
  n == null || !Number.isFinite(Number(n))
    ? "—"
    : `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 })}`;

/** Formats an instant in the organization's timezone with its EST/EDT-style label. */
export const fmtZoned = (iso: string | null | undefined, tz: string, withTime = true): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const opts: Intl.DateTimeFormatOptions = withTime
    ? { timeZone: tz, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }
    : { timeZone: tz, month: "short", day: "numeric", year: "numeric" };
  try {
    return d.toLocaleString("en-US", opts);
  } catch {
    return d.toLocaleString("en-US");
  }
};

export const fmtTime = (t: string | null | undefined): string => {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${ampm}`;
};

export interface CrmClient {
  id: string;
  org_id: string;
  name: string;
  billing_name: string;
  billing_email: string;
  billing_phone: string;
  billing_address: string;
  notes: string;
  archived_at: string | null;
  created_at: string;
}

export interface CrmContact {
  id: string;
  client_id: string;
  name: string;
  email: string;
  phone: string;
  role: ContactRole;
  receives_updates: boolean;
  notes: string;
}

export interface CrmQuote {
  id: string;
  deal_id: string;
  number: number;
  coverage: Coverage;
  hours_per_week: number;
  hourly_rate: number;
  minimum_hours: number | null;
  start_date: string | null;
  end_date: string | null;
  schedule: string;
  payment_terms: string;
  notes: string;
  valid_until: string | null;
  status: QuoteStatus;
  sent_at: string | null;
  sent_to: string;
  accepted_at: string | null;
  accepted_by: string;
  accept_note: string;
  accept_source: string;
  created_at: string;
}

export interface CrmContract {
  id: string;
  deal_id: string;
  quote_id: string | null;
  number: number;
  title: string;
  body: string;
  coverage: string;
  hours_per_week: number | null;
  hourly_rate: number | null;
  start_date: string | null;
  end_date: string | null;
  payment_terms: string;
  status: ContractStatus;
  sign_expires_at: string | null;
  sent_at: string | null;
  sent_to: string;
  sent_to_name: string;
  viewed_at: string | null;
  signer_name: string | null;
  signer_email: string | null;
  signed_at: string | null;
  signer_ip: string | null;
  signer_user_agent: string | null;
  signature_method: string | null;
  signature_image: string | null;
  body_sha256: string | null;
  signed_pdf_path: string | null;
  void_reason: string;
  created_at: string;
  doc_kind: "text" | "pdf";
  template_path: string | null;
  template_layout: unknown;
}

export interface CrmPropertyLite {
  id: string;
  name: string;
  address: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  access_instructions: string;
  fire_marshal_name: string;
  fire_marshal_phone: string;
  fire_marshal_email: string;
  patrol_interval_minutes: number;
  client_id: string | null;
}

export interface CrmDeal {
  id: string;
  org_id: string;
  client_id: string;
  property_id: string | null;
  stage: Stage;
  stage_changed_at: string;
  reason: string;
  coverage: Coverage;
  hours_per_week: number | null;
  patrol_interval_minutes: number | null;
  requested_start_date: string | null;
  requested_start_time: string | null;
  end_date: string | null;
  est_rate: number | null;
  source: string;
  notes: string;
  lost_reason: string;
  created_at: string;
  updated_at: string;
}

export interface BoardDeal extends CrmDeal {
  client: { id: string; name: string } | null;
  property: { id: string; name: string; address: string } | null;
  quotes: Pick<CrmQuote, "id" | "number" | "hourly_rate" | "hours_per_week" | "coverage" | "status" | "created_at">[];
  contracts: Pick<CrmContract, "id" | "number" | "status" | "created_at" | "signed_at">[];
}

export interface CrmSettings {
  org_id: string;
  company_phone: string;
  company_email: string;
  company_address: string;
  default_rate: number | null;
  payment_terms: string;
  quote_valid_days: number;
  sign_link_days: number;
  quote_notes: string;
  contract_template: string;
  agreement_pdf_path: string | null;
  agreement_pdf_name: string;
  agreement_layout: unknown;
  agreement_uploaded_at: string | null;
  countersign_name: string;
}

export interface CrmActivity {
  id: string;
  kind: string;
  summary: string;
  actor_name: string;
  created_at: string;
}

/** Quote used for pricing: accepted, else the newest non-declined, else the newest. */
export const pricingQuote = <Q extends { status: string; created_at: string }>(quotes: Q[]): Q | null => {
  if (quotes.length === 0) return null;
  const sorted = [...quotes].sort((a, b) => b.created_at.localeCompare(a.created_at));
  return sorted.find((q) => q.status === "accepted") ?? sorted.find((q) => q.status !== "declined") ?? sorted[0];
};

/** Weekly value of a pipeline record: rate × weekly hours. */
export const dealWeekly = (d: BoardDeal): { rate: number | null; hours: number; weekly: number | null } => {
  const q = pricingQuote(d.quotes);
  const rate = q ? Number(q.hourly_rate) : d.est_rate != null ? Number(d.est_rate) : null;
  const hours = q ? weeklyHours(q.coverage, q.hours_per_week) : weeklyHours(d.coverage, d.hours_per_week);
  return { rate, hours, weekly: rate != null && hours > 0 ? rate * hours : null };
};
