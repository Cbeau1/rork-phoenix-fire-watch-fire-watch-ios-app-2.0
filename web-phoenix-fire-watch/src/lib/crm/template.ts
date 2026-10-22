import { format, parseISO } from "date-fns";

import { COVERAGE_LABEL, type Coverage, fmtTime, money, weeklyHours } from "./types";

export const MERGE_FIELDS: { key: string; label: string }[] = [
  { key: "client_name", label: "Client name" },
  { key: "property_name", label: "Property name" },
  { key: "property_address", label: "Property address" },
  { key: "coverage", label: "Coverage" },
  { key: "rate", label: "Hourly rate" },
  { key: "weekly_estimate", label: "Weekly estimate" },
  { key: "minimum_hours", label: "Minimum hours" },
  { key: "start_date", label: "Start date" },
  { key: "end_date", label: "End date" },
  { key: "patrol_interval", label: "Patrol interval" },
  { key: "payment_terms", label: "Payment terms" },
  { key: "reason", label: "Reason for fire watch" },
  { key: "fire_marshal", label: "Fire marshal" },
  { key: "company_name", label: "Company name" },
  { key: "today", label: "Today's date" },
];

/** Paragraphs are separated by blank lines; "# " and "## " start headings (the signed PDF uses the same rules). */
export const DEFAULT_CONTRACT_TEMPLATE = `# Fire Watch Service Agreement

This Fire Watch Service Agreement ("Agreement") is made on {{today}} between {{company_name}} ("Provider") and {{client_name}} ("Client").

## 1. Services

Provider will furnish trained fire watch personnel at {{property_name}}, {{property_address}}, to conduct continuous fire watch patrols while the property's fire protection or life-safety systems are impaired or as otherwise required by the Authority Having Jurisdiction. Reason for service: {{reason}}.

Patrols will be performed at least every {{patrol_interval}}, and each patrol will be recorded with the time, the areas checked, and any conditions found.

## 2. Coverage and schedule

Coverage: {{coverage}}. Service begins {{start_date}} and continues until {{end_date}}, or until the Client gives written notice that fire watch is no longer required by the Authority Having Jurisdiction.

## 3. Rates and payment

Client will pay {{rate}} per officer hour (estimated {{weekly_estimate}} per week at the scheduled coverage). A minimum of {{minimum_hours}} hours applies per engagement. Invoices are issued weekly and are payable {{payment_terms}}. Past-due balances may result in suspension of service after written notice.

## 4. Client responsibilities

Client will provide officers with safe access to all areas to be patrolled, keys or access codes as needed, a working phone or radio contact, and the name of the responsible on-site contact. Client remains responsible for repairing impaired systems and for all notifications to the fire department and fire marshal ({{fire_marshal}}).

## 5. Fire watch duties

Officers will patrol, look for fire hazards, notify the fire department immediately in an emergency, assist with evacuation where safe to do so, and keep a written patrol log. Officers do not perform firefighting, system repairs, or maintenance.

## 6. Cancellation

Either party may end this Agreement with 24 hours' written notice. Client will pay for all hours worked through the end of service.

## 7. Limitation of liability

Provider's services are intended to reduce risk and do not guarantee that a fire or loss will not occur. Provider's total liability under this Agreement is limited to the amounts paid by Client for the services in the 30 days before the claim, except where prohibited by law.

## 8. Entire agreement

This Agreement is the entire agreement between the parties for these services. Changes must be made in writing. By signing electronically, each party agrees that an electronic signature has the same effect as a handwritten signature.`;

export interface MergeContext {
  clientName: string;
  propertyName: string;
  propertyAddress: string;
  coverage: Coverage | string;
  hoursPerWeek: number | null;
  rate: number | null;
  minimumHours: number | null;
  startDate: string | null;
  startTime?: string | null;
  endDate: string | null;
  patrolMinutes: number | null;
  paymentTerms: string;
  reason: string;
  fireMarshal: string;
  companyName: string;
}

const day = (iso: string | null | undefined): string => {
  if (!iso) return "";
  try {
    return format(parseISO(iso), "MMMM d, yyyy");
  } catch {
    return iso;
  }
};

export const mergeValues = (c: MergeContext): Record<string, string> => {
  const hours = weeklyHours(c.coverage, c.hoursPerWeek);
  const covLabel = COVERAGE_LABEL[c.coverage as Coverage] ?? "Custom hours";
  return {
    client_name: c.clientName || "the Client",
    property_name: c.propertyName || "the property",
    property_address: c.propertyAddress || "address on file",
    coverage: c.coverage === "custom" ? `${hours} hours per week` : `${covLabel} (${hours} hours per week)`,
    rate: c.rate != null ? money(c.rate) : "the agreed rate",
    weekly_estimate: c.rate != null && hours > 0 ? money(c.rate * hours) : "to be confirmed",
    minimum_hours: c.minimumHours != null && c.minimumHours > 0 ? String(c.minimumHours) : "4",
    start_date: c.startDate ? `${day(c.startDate)}${c.startTime ? ` at ${fmtTime(c.startTime)}` : ""}` : "the date service is requested",
    end_date: c.endDate ? day(c.endDate) : "the impaired systems are restored",
    patrol_interval: c.patrolMinutes ? (c.patrolMinutes % 60 === 0 ? `${c.patrolMinutes / 60} hour${c.patrolMinutes === 60 ? "" : "s"}` : `${c.patrolMinutes} minutes`) : "60 minutes",
    payment_terms: c.paymentTerms || "Net 15",
    reason: c.reason || "fire protection system impairment",
    fire_marshal: c.fireMarshal || "as applicable",
    company_name: c.companyName || "Provider",
    today: format(new Date(), "MMMM d, yyyy"),
  };
};

export const renderTemplate = (template: string, values: Record<string, string>): string =>
  template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, key: string) => (key in values ? values[key] : m));

export type Block = { kind: "h1" | "h2" | "p"; text: string };

export const toBlocks = (body: string): Block[] =>
  body
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((t) => (t.startsWith("## ") ? { kind: "h2", text: t.slice(3).trim() } : t.startsWith("# ") ? { kind: "h1", text: t.slice(2).trim() } : { kind: "p", text: t }));

export const sha256Hex = async (text: string): Promise<string> => {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};
