import type { AgreementField, AgreementLayout } from "./agreementLayout";
import type { CrmClient, CrmContact, CrmDeal, CrmPropertyLite, CrmQuote, CrmSettings } from "./types";
import { fmtTime, ROLE_LABEL, weeklyHours } from "./types";

/**
 * Field knowledge for the company's fillable agreement PDF. Known field names get friendly labels, groups and
 * prefill from the client, contact, property, quote and request; any other field still appears under "Other fields".
 */

export type FieldGroup = "client" | "proposal" | "coverage" | "rates" | "start" | "acceptance" | "other";

export const GROUP_LABEL: Record<FieldGroup, string> = {
  client: "Prepared for",
  proposal: "Proposal details",
  coverage: "Coverage schedule",
  rates: "Rates & deposit",
  start: "Start & patrols",
  acceptance: "Signing party",
  other: "Other fields",
};

const KNOWN: Record<string, { label: string; group: FieldGroup; hint?: string; placeholder?: string }> = {
  client_name: { label: "Client / property name", group: "client" },
  client_attn: { label: "Attention (contact name & title)", group: "client" },
  client_street: { label: "Street address", group: "client" },
  client_city: { label: "City, state, ZIP", group: "client" },
  client_email: { label: "Email", group: "client" },
  billing_email: { label: "Billing / AP email", group: "client" },
  proposal_no: { label: "Proposal no.", group: "proposal" },
  proposal_date: { label: "Proposal date", group: "proposal" },
  valid_through: { label: "Valid through", group: "proposal" },
  client_phone: { label: "Client phone", group: "proposal" },
  po_number: { label: "PO number (if required)", group: "proposal" },
  wd_schedule: { label: "Weekdays — schedule (times)", group: "coverage", placeholder: "e.g. 24 hours" },
  wd_hours: { label: "Weekdays — hours / day", group: "coverage" },
  wd_officers: { label: "Weekdays — officers", group: "coverage" },
  we_schedule: { label: "Weekends — schedule (times)", group: "coverage", placeholder: "Leave blank if no weekend coverage" },
  we_hours: { label: "Weekends — hours / day", group: "coverage" },
  we_officers: { label: "Weekends — officers", group: "coverage" },
  hourly_rate: { label: "Hourly rate (per officer)", group: "rates" },
  holiday_rate: { label: "Holiday rate", group: "rates", hint: "Blank = hourly rate" },
  short_notice_rate: { label: "Short-notice rate", group: "rates", hint: "Blank = hourly rate" },
  deposit: { label: "Deposit due before service", group: "rates", placeholder: "$0.00 if waived" },
  est_daily: { label: "Estimated daily cost", group: "rates" },
  est_weekly: { label: "Estimated weekly cost", group: "rates" },
  est_30day: { label: "Estimated 30-day cost", group: "rates" },
  start_date: { label: "Start date", group: "start" },
  start_time: { label: "Start time", group: "start" },
  patrol_interval: { label: "Required patrol interval", group: "start" },
  client_entity: { label: "Client legal entity (signing party)", group: "acceptance" },
  property_owner: { label: "Property owner (if client signs as agent)", group: "acceptance" },
};

/** Completed by the signer (or automatically) at signing — never typed in by the admin. */
export const SIGN_TIME_FIELDS = new Set(["client_sig_name", "client_sig_title", "client_sig_date", "pfw_date"]);

/** Leftover e-sign signature boxes (e.g. "Signature5_es_:signer:signature"): the app stamps the real signature there. */
export const isSignatureBox = (name: string): boolean => /_es_:|(^|[_:\s])signature\d*$/i.test(name);

/** Calculated from the schedule and rate, so they're shown read-only. */
export const COMPUTED_FIELDS = new Set(["est_daily", "est_weekly", "est_30day"]);

const humanize = (name: string) =>
  name
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (c) => c.toUpperCase());

export interface EditableField {
  name: string;
  label: string;
  group: FieldGroup;
  hint?: string;
  placeholder?: string;
  computed: boolean;
  multiline: boolean;
}

export const editableFields = (layout: AgreementLayout): EditableField[] =>
  layout.fields
    .filter((f: AgreementField) => !SIGN_TIME_FIELDS.has(f.name) && !isSignatureBox(f.name))
    .map((f) => {
      const k = KNOWN[f.name];
      return {
        name: f.name,
        label: k?.label ?? humanize(f.name),
        group: k?.group ?? "other",
        hint: k?.hint,
        placeholder: k?.placeholder,
        computed: COMPUTED_FIELDS.has(f.name) && hasEstimateInputs(layout),
        multiline: f.multiline,
      };
    });

const hasEstimateInputs = (layout: AgreementLayout) => ["hourly_rate", "wd_hours", "wd_officers"].every((n) => layout.fields.some((f) => f.name === n));

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const parseNum = (s: string | undefined): number => {
  const n = Number((s ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** Estimates printed on the agreement: weekly = rate × (weekday hours × officers × 5 + weekend hours × officers × 2). */
export const computeEstimates = (v: Record<string, string>): Record<string, string> => {
  const rate = parseNum(v.hourly_rate);
  const weekly = rate * (parseNum(v.wd_hours) * parseNum(v.wd_officers) * 5 + parseNum(v.we_hours) * parseNum(v.we_officers) * 2);
  if (!rate || !weekly) return { est_daily: "", est_weekly: "", est_30day: "" };
  return { est_daily: usd(weekly / 7), est_weekly: usd(weekly), est_30day: usd((weekly / 7) * 30) };
};

const longDate = (ymd: string | null | undefined): string => {
  if (!ymd) return "";
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return "";
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
};

const todayIn = (tz: string): string => {
  try {
    return new Date().toLocaleDateString("en-CA", { timeZone: tz });
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
};

const addDaysYmd = (ymd: string, days: number) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

const scheduleFor = (coverage: string, hoursPerWeek: number | null): { schedule: string; hours: number } => {
  if (coverage === "24_7") return { schedule: "24 hours (12:00 AM – 12:00 AM)", hours: 24 };
  if (coverage === "12_day") return { schedule: "7:00 AM – 7:00 PM", hours: 12 };
  if (coverage === "12_night") return { schedule: "7:00 PM – 7:00 AM", hours: 12 };
  const perDay = Math.round(((weeklyHours(coverage, hoursPerWeek) || 0) / 7) * 100) / 100;
  return { schedule: "", hours: perDay };
};

export interface PrefillContext {
  client: CrmClient;
  contacts: CrmContact[];
  property: CrmPropertyLite | null;
  deal: CrmDeal;
  quote: CrmQuote | null;
  settings: CrmSettings;
  tz: string;
  contractNumber?: number | null;
}

/** Values for every known field, built from what the pipeline already knows. */
export const prefillAgreement = (layout: AgreementLayout, ctx: PrefillContext): Record<string, string> => {
  const { client, contacts, property, deal, quote, settings, tz } = ctx;
  const primary = contacts.find((c) => c.role !== "billing" && c.email) ?? contacts.find((c) => c.email) ?? contacts[0] ?? null;
  const billing = contacts.find((c) => c.role === "billing" && c.email);
  const address = property?.address || client.billing_address || "";
  const comma = address.indexOf(",");
  const coverage = quote?.coverage ?? deal.coverage;
  const { schedule, hours } = scheduleFor(coverage, quote ? Number(quote.hours_per_week) : deal.hours_per_week);
  const rate = quote ? Number(quote.hourly_rate) : deal.est_rate != null ? Number(deal.est_rate) : null;
  const today = todayIn(tz);
  const interval = deal.patrol_interval_minutes ?? property?.patrol_interval_minutes ?? null;
  const proposalNo = quote ? `Q-${quote.number}` : ctx.contractNumber ? `C-${ctx.contractNumber}` : "";
  const role = primary && primary.role !== "other" ? ROLE_LABEL[primary.role] : "";

  const all: Record<string, string> = {
    client_name: property?.name || client.name,
    client_attn: primary ? `${primary.name}${role ? `, ${role}` : ""}` : "",
    client_street: comma > 0 ? address.slice(0, comma).trim() : address.trim(),
    client_city: comma > 0 ? address.slice(comma + 1).trim() : "",
    client_email: primary?.email ?? "",
    billing_email: billing?.email || client.billing_email || "",
    proposal_no: proposalNo,
    proposal_date: longDate(today),
    valid_through: longDate(quote?.valid_until || addDaysYmd(today, settings.quote_valid_days || 14)),
    client_phone: primary?.phone || client.billing_phone || "",
    po_number: "",
    wd_schedule: schedule,
    wd_hours: hours ? String(hours) : "",
    wd_officers: "1",
    we_schedule: schedule,
    we_hours: hours ? String(hours) : "",
    we_officers: "1",
    hourly_rate: rate != null ? usd(rate) : "",
    holiday_rate: "",
    short_notice_rate: "",
    deposit: "",
    start_date: longDate(quote?.start_date ?? deal.requested_start_date),
    start_time: fmtTime(deal.requested_start_time),
    patrol_interval: interval ? `Every ${interval} minutes` : "",
    client_entity: client.billing_name || client.name,
    property_owner: "",
  };
  const names = new Set(editableFields(layout).map((f) => f.name));
  const out: Record<string, string> = {};
  for (const n of names) out[n] = all[n] ?? "";
  return withEstimates(layout, out);
};

export const withEstimates = (layout: AgreementLayout, v: Record<string, string>): Record<string, string> => {
  if (!hasEstimateInputs(layout)) return v;
  const est = computeEstimates(v);
  const out = { ...v };
  for (const k of Object.keys(est)) if (layout.fields.some((f) => f.name === k)) out[k] = est[k];
  return out;
};

/** Canonical body stored on the contract (sorted keys, empties dropped) so its fingerprint is stable. */
export const serializeAgreement = (values: Record<string, string>): string => {
  const fields: Record<string, string> = {};
  for (const k of Object.keys(values).sort()) {
    const v = values[k].trim();
    if (v && !SIGN_TIME_FIELDS.has(k) && !isSignatureBox(k)) fields[k] = v;
  }
  return JSON.stringify({ v: 1, fields });
};

export const parseAgreement = (body: string): Record<string, string> => {
  try {
    const parsed = JSON.parse(body) as { fields?: Record<string, unknown> };
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed.fields ?? {})) if (typeof v === "string") out[k] = v;
    return out;
  } catch {
    return {};
  }
};
