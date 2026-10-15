/**
 * Reads a temp-agency invoice (PDF or photo) with a vision model and returns structured fields.
 * Pure module (no Deno APIs) so the same code can be exercised from a local script.
 */

export const MODEL = "google/gemini-3.8-flash";
export const FALLBACK_MODELS = ["anthropic/claude-sonnet-5.5", "openai/gpt-6.1-sol"];

export type LineType = "regular" | "overtime" | "holiday" | "fee";

export interface ScannedLine {
  worker_name: string | null;
  description: string;
  line_type: LineType;
  service_start: string | null;
  service_end: string | null;
  hours: number | null;
  rate: number | null;
  amount: number | null;
}

export interface ScannedInvoice {
  is_invoice: boolean;
  vendor_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  period_start: string | null;
  period_end: string | null;
  subtotal: number | null;
  total: number | null;
  payment_terms: string | null;
  lines: ScannedLine[];
  notes: string | null;
}

const nullable = (type: string) => ({ type: [type, "null"] });

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "is_invoice",
    "vendor_name",
    "invoice_number",
    "invoice_date",
    "due_date",
    "period_start",
    "period_end",
    "subtotal",
    "total",
    "payment_terms",
    "lines",
    "notes",
  ],
  properties: {
    is_invoice: { type: "boolean", description: "False if the document is not an invoice or bill." },
    vendor_name: { ...nullable("string"), description: "Company that issued the invoice (the staffing agency)." },
    invoice_number: nullable("string"),
    invoice_date: { ...nullable("string"), description: "YYYY-MM-DD" },
    due_date: { ...nullable("string"), description: "YYYY-MM-DD. Only if printed or computable from printed terms and invoice date." },
    period_start: { ...nullable("string"), description: "First day of service / week covered, YYYY-MM-DD" },
    period_end: { ...nullable("string"), description: "Last day of service / week ending, YYYY-MM-DD" },
    subtotal: nullable("number"),
    total: { ...nullable("number"), description: "Final amount due on this invoice, in dollars." },
    payment_terms: nullable("string"),
    notes: { ...nullable("string"), description: "Short note about anything unreadable or ambiguous; null if none." },
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["worker_name", "description", "line_type", "service_start", "service_end", "hours", "rate", "amount"],
        properties: {
          worker_name: { ...nullable("string"), description: "Employee / associate name as printed, 'First Last'." },
          description: { type: "string" },
          line_type: { type: "string", enum: ["regular", "overtime", "holiday", "fee"] },
          service_start: { ...nullable("string"), description: "YYYY-MM-DD" },
          service_end: { ...nullable("string"), description: "YYYY-MM-DD" },
          hours: nullable("number"),
          rate: { ...nullable("number"), description: "Bill rate per hour in dollars" },
          amount: nullable("number"),
        },
      },
    },
  },
} as const;

const PROMPT = (today: string, agencies: string[]) => `You are reading an invoice that a temporary staffing agency sent to a fire watch security company.
Extract the fields exactly as printed. Rules:
- Dates as YYYY-MM-DD. Today is ${today}; use it only to resolve a missing year.
- Money as plain numbers (1341.2, not "$1,341.20"). Hours as decimals (7.5 for 7:30).
- One line per billed row. If a row is per worker per week with REG and OT columns, return separate "regular" and "overtime" lines for that worker.
- line_type "fee" for anything that is not hours (fees, adjustments, taxes, credits — credits are negative amounts).
- If only a "week ending" date is printed, period_end is that date and period_start is 6 days earlier. Lines without their own dates use the invoice's period.
- Never invent values. Use null when a field is not on the document.
${agencies.length ? `Known agencies (match vendor_name to one of these spellings if it is clearly the same company): ${agencies.join("; ")}.` : ""}`;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const date = (v: unknown): string | null => (typeof v === "string" && DATE_RE.test(v.trim()) && !Number.isNaN(Date.parse(v.trim())) ? v.trim() : null);
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[$,\s]/g, "")) : NaN;
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};
const str = (v: unknown, max = 200): string | null => {
  const s = typeof v === "string" ? v.trim().slice(0, max) : "";
  return s ? s : null;
};

/** Coerces model output into safe, bounded values. */
export function sanitize(raw: unknown): ScannedInvoice {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const lines = Array.isArray(r.lines) ? r.lines.slice(0, 200) : [];
  return {
    is_invoice: r.is_invoice !== false,
    vendor_name: str(r.vendor_name),
    invoice_number: str(r.invoice_number, 80),
    invoice_date: date(r.invoice_date),
    due_date: date(r.due_date),
    period_start: date(r.period_start),
    period_end: date(r.period_end),
    subtotal: num(r.subtotal),
    total: num(r.total),
    payment_terms: str(r.payment_terms),
    notes: str(r.notes, 400),
    lines: lines.map((l): ScannedLine => {
      const o = (l && typeof l === "object" ? l : {}) as Record<string, unknown>;
      const t = typeof o.line_type === "string" && ["regular", "overtime", "holiday", "fee"].includes(o.line_type) ? (o.line_type as LineType) : "regular";
      return {
        worker_name: str(o.worker_name, 120),
        description: str(o.description, 300) ?? "",
        line_type: t,
        service_start: date(o.service_start),
        service_end: date(o.service_end),
        hours: t === "fee" ? null : num(o.hours),
        rate: t === "fee" ? null : num(o.rate),
        amount: num(o.amount),
      };
    }),
  };
}

const toBase64 = (bytes: Uint8Array): string => {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
};

/** Calls the Rork Toolkit gateway and returns the parsed invoice. Throws Error with a user-safe message. */
export async function scanInvoice(opts: {
  toolkitUrl: string;
  secret: string;
  bytes: Uint8Array;
  mime: string;
  fileName: string;
  agencies: string[];
  today: string;
}): Promise<ScannedInvoice> {
  const b64 = toBase64(opts.bytes);
  const filePart =
    opts.mime === "application/pdf"
      ? { type: "file", file: { filename: opts.fileName || "invoice.pdf", file_data: `data:application/pdf;base64,${b64}` } }
      : { type: "image_url", image_url: { url: `data:${opts.mime};base64,${b64}`, detail: "high" } };
  const res = await fetch(`${opts.toolkitUrl.replace(/\/$/, "")}/v2/vercel/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      max_tokens: 8000,
      providerOptions: { gateway: { models: FALLBACK_MODELS } },
      response_format: { type: "json_schema", json_schema: { name: "agency_invoice", strict: true, schema: SCHEMA } },
      messages: [{ role: "user", content: [{ type: "text", text: PROMPT(opts.today, opts.agencies) }, filePart] }],
    }),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    console.error("invoice-scan gateway error", res.status, detail);
    if (res.status === 413) throw new Error("That file is too large to read. Try a smaller PDF or a photo.");
    if (res.status === 429) throw new Error("The invoice reader is busy. Try again in a minute.");
    if (res.status === 402) throw new Error("The invoice reader is unavailable right now. Enter the invoice manually.");
    throw new Error("Couldn't read that invoice. Try again, or enter it manually.");
  }
  const body = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
  const content = body.choices?.[0]?.message?.content;
  const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((c) => (c as { text?: string }).text ?? "").join("") : "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("Couldn't read that invoice. Try a clearer copy, or enter it manually.");
  try {
    return sanitize(JSON.parse(m[0]));
  } catch {
    throw new Error("Couldn't read that invoice. Try a clearer copy, or enter it manually.");
  }
}
