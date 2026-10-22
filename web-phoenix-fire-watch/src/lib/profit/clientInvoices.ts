import { loadPdfJs } from "@/lib/pdfjs";
import { supabase } from "@/lib/supabase";

/** Hours on the clock at a property inside a window (approved + still pending/open). */
export interface Worked {
  hours: number;
  approved: number;
  pending: number;
}

export interface InvoiceLine {
  item: string;
  quantity: number | null;
  unit_price: number | null;
  amount: number | null;
}

export interface ClientInvoice {
  id: string;
  property_id: string | null;
  property_name: string | null;
  invoice_number: string;
  customer_name: string;
  issued_on: string;
  due_on: string | null;
  /** Local wall-clock time in the org's time zone, "yyyy-MM-ddTHH:mm". */
  period_start: string | null;
  period_end: string | null;
  hours: number | null;
  rate: number | null;
  amount: number;
  description: string;
  message: string;
  lines: InvoiceLine[];
  status: "open" | "paid" | "void";
  paid_on: string | null;
  file_path: string | null;
  file_name: string | null;
  source: "upload" | "manual";
  created_at: string;
  worked: Worked | null;
}

export interface BillingProperty {
  property_id: string;
  name: string;
  invoices: number;
  billed: number;
  billed_hours: number;
  paid: number;
  outstanding: number;
  overdue: number;
  billed_through: string | null;
  rate: number | null;
  unbilled_from: string | null;
  unbilled: Worked | null;
  watch_open: boolean;
}

export interface Billing {
  tz: string;
  today: string;
  properties: BillingProperty[];
  invoices: ClientInvoice[];
}

const n = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
const nn = (v: unknown): number | null => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const worked = (w: Worked | null | undefined): Worked | null => (w ? { hours: n(w.hours), approved: n(w.approved), pending: n(w.pending) } : null);

export async function fetchBilling(): Promise<Billing> {
  const { data, error } = await supabase.rpc("client_billing");
  if (error) throw error;
  const d = data as unknown as Billing;
  return {
    tz: d.tz,
    today: d.today,
    properties: (d.properties ?? []).map((p) => ({
      ...p,
      invoices: n(p.invoices),
      billed: n(p.billed),
      billed_hours: n(p.billed_hours),
      paid: n(p.paid),
      outstanding: n(p.outstanding),
      overdue: n(p.overdue),
      rate: nn(p.rate),
      unbilled: worked(p.unbilled),
    })),
    invoices: (d.invoices ?? []).map((i) => ({
      ...i,
      hours: nn(i.hours),
      rate: nn(i.rate),
      amount: n(i.amount),
      lines: Array.isArray(i.lines) ? i.lines : [],
      worked: worked(i.worked),
    })),
  };
}

export interface InvoiceDraft {
  id?: string;
  property_id: string | null;
  invoice_number: string;
  customer_name: string;
  issued_on: string;
  due_on: string;
  period_start: string;
  period_end: string;
  hours: string;
  rate: string;
  amount: string;
  description: string;
  message: string;
  lines: InvoiceLine[];
}

/** Uploads the invoice PDF (if any) and saves the record. `replaces` = invoices to mark void (consolidated). */
export async function saveInvoice(orgId: string, draft: InvoiceDraft, file: File | null, replaces: string[]): Promise<string> {
  let file_path: string | null = null;
  if (file) {
    file_path = `${orgId}/invoices/${crypto.randomUUID()}.pdf`;
    const up = await supabase.storage.from("crm-documents").upload(file_path, file, { contentType: "application/pdf", upsert: false });
    if (up.error) throw up.error;
  }
  const { data, error } = await supabase.rpc("client_invoice_save", {
    p: { ...draft, file_path, file_name: file?.name.slice(0, 200) ?? null } as never,
    p_void: replaces,
  });
  if (error) {
    if (file_path) void supabase.storage.from("crm-documents").remove([file_path]);
    throw error;
  }
  return data as unknown as string;
}

export async function setInvoiceStatus(id: string, status: ClientInvoice["status"], paidOn?: string): Promise<void> {
  const { error } = await supabase.rpc("client_invoice_status", { p_id: id, p_status: status, p_paid_on: paidOn as string });
  if (error) throw error;
}

export async function deleteInvoice(id: string): Promise<void> {
  const { data, error } = await supabase.rpc("client_invoice_delete", { p_id: id });
  if (error) throw error;
  const path = data as unknown as string | null;
  if (path) await supabase.storage.from("crm-documents").remove([path]);
}

export async function downloadInvoicePdf(path: string): Promise<Uint8Array> {
  const { data, error } = await supabase.storage.from("crm-documents").download(path);
  if (error) throw error;
  return new Uint8Array(await data.arrayBuffer());
}

// ─── Reading a TD business invoice PDF ──────────────────────────────────────

export interface ReadInvoice {
  recognized: boolean;
  invoice_number: string;
  customer_name: string;
  issued_on: string;
  due_on: string;
  period_start: string;
  period_end: string;
  hours: number | null;
  rate: number | null;
  amount: number | null;
  description: string;
  message: string;
  lines: InvoiceLine[];
}

interface Item {
  x: number;
  y: number;
  s: string;
}
type Row = { y: number; items: Item[]; text: string };

const MONEY = /^-?\$?\s?[\d,]+(?:\.\d{1,2})?$/;
const toMoney = (s: string): number | null => {
  const v = Number(s.replace(/[$,\s]/g, ""));
  return MONEY.test(s.trim()) && Number.isFinite(v) ? v : null;
};
const usDate = (s: string): string => {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return "";
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
};
const pad = (v: number): string => String(v).padStart(2, "0");

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_RE = "(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)\\.?";
const POINT = `${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?(?:,?\\s+(?:at\\s+)?(\\d{1,2})(?::(\\d{2}))?\\s*([AaPp])\\.?\\s*[Mm]\\.?)?`;
const RANGE = new RegExp(`${POINT}\\s*(?:through|thru|until|to|[–—-])\\s*${POINT}`, "i");

/** Finds "September 25, 2026 at 7:00 PM through October 6, 2026 at 11:30 AM" style service periods. */
export const parsePeriod = (text: string, issuedOn: string): { start: string; end: string } | null => {
  const m = text.replace(/\s+/g, " ").match(RANGE);
  if (!m) return null;
  const issuedYear = Number(issuedOn.slice(0, 4)) || new Date().getFullYear();
  const point = (g: string[], fallbackYear: number, isEnd: boolean): { date: Date; hasTime: boolean } => {
    const month = MONTHS.indexOf(g[0].slice(0, 3).toLowerCase());
    const year = g[2] ? Number(g[2]) : fallbackYear;
    let h = 0;
    let min = 0;
    const hasTime = !!g[3];
    if (hasTime) {
      h = Number(g[3]) % 12;
      min = g[4] ? Number(g[4]) : 0;
      if (g[5].toLowerCase() === "p") h += 12;
    }
    const date = new Date(year, month, Number(g[1]), h, min);
    if (!hasTime && isEnd) date.setDate(date.getDate() + 1); // whole last day
    return { date, hasTime };
  };
  const endYear = m[9] ? Number(m[9]) : m[3] ? Number(m[3]) : issuedYear;
  const end = point(m.slice(7, 13), endYear, true);
  let start = point(m.slice(1, 7), m[3] ? Number(m[3]) : end.date.getFullYear(), false);
  if (start.date >= end.date && !m[3]) start = point(m.slice(1, 7), end.date.getFullYear() - 1, false);
  if (start.date >= end.date) return null;
  const local = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return { start: local(start.date), end: local(end.date) };
};

const rowsOf = (items: Item[]): Row[] => {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: Row[] = [];
  for (const it of sorted) {
    const r = rows.find((row) => Math.abs(row.y - it.y) <= 3);
    if (r) r.items.push(it);
    else rows.push({ y: it.y, items: [it], text: "" });
  }
  for (const r of rows) {
    r.items.sort((a, b) => a.x - b.x);
    r.text = r.items.map((i) => i.s).join(" ").replace(/\s+/g, " ").trim();
  }
  return rows;
};

/** Text block under a label row ("Description", "Message"), until a big gap or a known section. */
const blockAfter = (rows: Row[], labelIdx: number, stop: RegExp): string => {
  const out: string[] = [];
  let lastY = rows[labelIdx].y;
  for (let i = labelIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (lastY - r.y > 26 || stop.test(r.text)) break;
    out.push(r.text);
    lastY = r.y;
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
};

/** Splits a value row into the columns of its header row (each value goes to the nearest header at or left of it). */
const byColumns = (header: Row, values: Row): string[] => {
  const cols = header.items.map(() => [] as string[]);
  for (const it of values.items) {
    let k = 0;
    header.items.forEach((h, i) => {
      if (h.x <= it.x + 30) k = i;
    });
    cols[k].push(it.s);
  }
  return cols.map((c) => c.join(" ").replace(/\s+/g, " ").trim());
};

const EMPTY: ReadInvoice = {
  recognized: false,
  invoice_number: "",
  customer_name: "",
  issued_on: "",
  due_on: "",
  period_start: "",
  period_end: "",
  hours: null,
  rate: null,
  amount: null,
  description: "",
  message: "",
  lines: [],
};

/**
 * Reads an invoice PDF downloaded from TD business invoicing (Customer / Created date / Due date / Invoice #,
 * Product/Service lines, Description, Total, Message). Works in the browser; nothing leaves the device.
 */
export async function readInvoicePdf(file: File): Promise<ReadInvoice> {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  try {
    const page = await doc.getPage(1);
    const content = await page.getTextContent();
    const items: Item[] = [];
    for (const raw of content.items) {
      if (!("str" in raw) || !raw.str.trim()) continue;
      items.push({ x: raw.transform[4], y: raw.transform[5], s: raw.str });
    }
    const rows = rowsOf(items);
    const out: ReadInvoice = { ...EMPTY, lines: [] };

    const hi = rows.findIndex((r) => /\bCustomer\b/i.test(r.text) && /Invoice\s*#/i.test(r.text));
    if (hi >= 0 && rows[hi + 1]) {
      const head = rows[hi];
      const cols = byColumns(head, rows[hi + 1]);
      head.items.forEach((h, i) => {
        const label = h.s.toLowerCase();
        const v = cols[i] ?? "";
        if (label.includes("customer")) out.customer_name = v;
        else if (label.includes("created") || label.includes("invoice date") || label === "date") out.issued_on = usDate(v);
        else if (label.includes("due")) out.due_on = usDate(v);
        else if (label.includes("invoice")) out.invoice_number = v.replace(/^#\s*/, "");
      });
    }

    const li = rows.findIndex((r) => /Product\s*\/?\s*Service/i.test(r.text) && /Amount/i.test(r.text));
    if (li >= 0) {
      const head = rows[li];
      for (let i = li + 1; i < rows.length; i++) {
        const r = rows[i];
        if (/^(Description|Total|Subtotal|Message)\b/.test(r.text)) {
          if (/^Description\b/.test(r.text)) {
            const d = blockAfter(rows, i, /^(Total|Subtotal|Message|Product\s*\/?\s*Service)\b/);
            out.description = out.description ? `${out.description} ${d}` : d;
            continue;
          }
          break;
        }
        const cols = byColumns(head, r);
        const get = (re: RegExp) => cols[head.items.findIndex((h) => re.test(h.s))] ?? "";
        const amount = toMoney(get(/amount/i));
        if (amount == null) continue;
        out.lines.push({
          item: get(/product|service/i),
          quantity: nnNum(get(/quantity|qty|hours/i)),
          unit_price: toMoney(get(/unit|price|rate/i)),
          amount,
        });
      }
    }

    const total = rows.find((r) => /^Total\b/.test(r.text) && toMoney(r.items[r.items.length - 1].s) != null);
    if (total) out.amount = toMoney(total.items[total.items.length - 1].s);
    if (out.amount == null && out.lines.length) out.amount = out.lines.reduce((s, l) => s + (l.amount ?? 0), 0);

    const mi = rows.findIndex((r) => /^Message$/i.test(r.text));
    if (mi >= 0) out.message = blockAfter(rows, mi, /^(Phoenix Fire Watch|Pay by Check)/i);

    const qty = out.lines.filter((l) => l.quantity != null);
    if (qty.length) out.hours = Math.round(qty.reduce((s, l) => s + (l.quantity ?? 0), 0) * 100) / 100;
    const prices = [...new Set(out.lines.map((l) => l.unit_price).filter((p): p is number => p != null))];
    if (prices.length === 1) out.rate = prices[0];

    const period = parsePeriod(`${out.description} ${out.message}`, out.issued_on);
    if (period) {
      out.period_start = period.start;
      out.period_end = period.end;
    }
    out.recognized = !!out.invoice_number && out.amount != null;
    return out;
  } finally {
    void doc.loadingTask.destroy();
  }
}

const nnNum = (s: string): number | null => {
  const v = Number(s.replace(/[,\s]/g, ""));
  return s.trim() && Number.isFinite(v) ? v : null;
};

// ─── Matching an invoice to a property ──────────────────────────────────────

const STOP = new Set(["the", "llc", "inc", "co", "company", "corp", "of", "and", "at", "club", "hotel"]);
const tokens = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t && !STOP.has(t));

/** Best property for the customer named on the invoice: earlier invoices for that customer first, then name similarity. */
export const matchProperty = (
  customer: string,
  properties: { property_id: string; name: string }[],
  invoices: ClientInvoice[],
): string | null => {
  const c = customer.trim().toLowerCase();
  if (!c) return null;
  const prior = invoices.find((i) => i.property_id && i.customer_name.trim().toLowerCase() === c);
  if (prior?.property_id && properties.some((p) => p.property_id === prior.property_id)) return prior.property_id;
  const exact = properties.find((p) => p.name.trim().toLowerCase() === c);
  if (exact) return exact.property_id;
  const ct = new Set(tokens(customer));
  let best: { id: string; score: number } | null = null;
  for (const p of properties) {
    const pt = new Set(tokens(p.name));
    const inter = [...pt].filter((t) => ct.has(t)).length;
    const score = inter / Math.max(1, Math.min(pt.size, ct.size));
    if (score > (best?.score ?? 0)) best = { id: p.property_id, score };
  }
  return best && best.score >= 0.6 ? best.id : null;
};

/** Non-void invoices at the same property whose service period overlaps [start, end). */
export const overlapping = (invoices: ClientInvoice[], propertyId: string | null, start: string, end: string, selfId?: string): ClientInvoice[] =>
  !propertyId || !start || !end
    ? []
    : invoices.filter(
        (i) =>
          i.id !== selfId &&
          i.property_id === propertyId &&
          i.status !== "void" &&
          i.period_start &&
          i.period_end &&
          i.period_start < end &&
          i.period_end > start,
      );
