import { format, parseISO } from "date-fns";

import { buildPdf } from "@/lib/workforce/exports";

import { COVERAGE_LABEL, type CrmClient, type CrmContact, type CrmDeal, type CrmPropertyLite, type CrmQuote, type CrmSettings, money, weeklyHours } from "./types";

const day = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  try {
    return format(parseISO(iso), "MMM d, yyyy");
  } catch {
    return iso;
  }
};

export const quoteFileName = (q: CrmQuote, clientName: string): string =>
  `Quote-Q-${q.number}-${clientName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 40) || "client"}.pdf`;

/** Client-facing quote PDF in the same branded letterhead as the rest of the app's documents. */
export const buildQuotePdf = async (opts: {
  quote: CrmQuote;
  deal: CrmDeal;
  client: CrmClient;
  contact: CrmContact | null;
  property: CrmPropertyLite | null;
  settings: CrmSettings;
  orgName: string;
  preparedBy: string;
}): Promise<Blob> => {
  const { quote: q, deal, client, contact, property, settings } = opts;
  const hours = weeklyHours(q.coverage, q.hours_per_week);
  const weekly = hours * Number(q.hourly_rate);
  const company = [opts.orgName, settings.company_address, settings.company_phone, settings.company_email].filter(Boolean);
  const terms = [
    `Rates are per officer hour. Invoices are issued weekly and are payable ${q.payment_terms || settings.payment_terms || "Net 15"}.`,
    q.minimum_hours ? `A minimum of ${q.minimum_hours} hours applies.` : "",
    "Coverage continues until you notify us in writing that fire watch is no longer required by the Authority Having Jurisdiction.",
    q.valid_until ? `This quote is valid until ${day(q.valid_until)}.` : "",
  ].filter(Boolean);
  return buildPdf({
    title: `Fire Watch Quote Q-${q.number}`,
    subtitle: `Prepared for ${client.name}${property ? ` · ${property.name}` : ""}`,
    orgName: opts.orgName,
    preparedBy: opts.preparedBy,
    heading: "FIRE WATCH QUOTE",
    confidential: false,
    footer: company.join(" · "),
    sections: [
      {
        title: "Estimate",
        metrics: [
          { label: "Hourly rate", value: money(q.hourly_rate), hint: "Per officer hour" },
          { label: "Hours per week", value: String(hours), hint: COVERAGE_LABEL[q.coverage] },
          { label: "Weekly estimate", value: money(weekly), hint: "Rate × weekly hours" },
        ],
      },
      {
        title: "Service details",
        fields: [
          ["Client", client.name],
          ["Attention", contact ? [contact.name, contact.email, contact.phone].filter(Boolean).join(" · ") : "—"],
          ["Property", property ? property.name : "—"],
          ["Address", property?.address || "—"],
          ["Coverage", COVERAGE_LABEL[q.coverage]],
          ["Schedule", q.schedule || "—"],
          ["Start", day(q.start_date)],
          ["End", q.end_date ? day(q.end_date) : "Until systems are restored"],
          ["Patrol interval", `Every ${deal.patrol_interval_minutes ?? property?.patrol_interval_minutes ?? 60} minutes`],
          ["Reason", deal.reason || "—"],
        ],
      },
      ...(q.notes || settings.quote_notes ? [{ title: "Notes", text: [q.notes, settings.quote_notes].filter(Boolean) }] : []),
      { title: "Terms", text: terms },
      {
        title: "Next steps",
        text: [
          `To accept, reply to this email or call ${settings.company_phone || opts.orgName}. We'll send a service agreement to sign online and schedule your officers.`,
        ],
      },
    ],
  });
};

export const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(new Error("Couldn't prepare the PDF."));
    r.readAsDataURL(blob);
  });
