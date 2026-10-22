import { PDFDocument, PDFTextField, rgb, StandardFonts } from "npm:pdf-lib@1.17.1";

/**
 * Fills an organization's own fillable PDF agreement (AcroForm) and stamps signatures and initials.
 * Positions come from the layout detected when the admin uploaded the PDF (PDF points, origin bottom-left,
 * y = the baseline of the underscore line).
 */

export interface Spot {
  page: number;
  x: number;
  y: number;
  w: number;
}

export interface AgreementLayout {
  v: 1;
  pages: number;
  fields: { name: string; page: number; readOnly: boolean }[];
  initials: Spot[];
  clientSig: Spot | null;
  companySig: Spot | null;
}

/** Fields completed at signing time, never by the admin. */
export const SIGN_TIME_FIELDS = {
  name: "client_sig_name",
  title: "client_sig_title",
  date: "client_sig_date",
  companyDate: "pfw_date",
} as const;

// Standard PDF fonts only cover Windows-1252; replace anything else so filling never fails on odd characters.
const WIN_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");
export const winAnsi = (s: string): string =>
  s
    .replace(/\t/g, "    ")
    .replace(/[\u2010\u2011\u2212]/g, "-")
    .replace(/[\u00A0\u2007\u202F]/g, " ")
    .split("")
    .map((ch) => {
      const c = ch.charCodeAt(0);
      if (c === 10) return ch;
      if (c < 32) return "";
      if (c <= 126 || (c >= 160 && c <= 255) || WIN_EXTRA.has(ch)) return ch;
      return "?";
    })
    .join("");

const num = (v: unknown, min: number, max: number): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null;

const spot = (v: unknown, pages: number): Spot | null => {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const page = num(o.page, 0, pages - 1), x = num(o.x, 0, 5000), y = num(o.y, 0, 5000), w = num(o.w, 1, 5000);
  return page == null || x == null || y == null || w == null ? null : { page: Math.round(page), x, y, w };
};

/** Validates layout JSON coming from the database; anything malformed is dropped rather than trusted. */
export function parseLayout(raw: unknown): AgreementLayout {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pages = num(o.pages, 1, 200) ?? 200;
  return {
    v: 1,
    pages,
    fields: [],
    initials: (Array.isArray(o.initials) ? o.initials : []).map((s) => spot(s, pages)).filter((s): s is Spot => !!s).slice(0, 200),
    clientSig: spot(o.clientSig, pages),
    companySig: spot(o.companySig, pages),
  };
}

/** Parses the contract body for PDF contracts: canonical JSON {"v":1,"fields":{...}}. */
export function parseFieldValues(body: string): Record<string, string> {
  try {
    const parsed = JSON.parse(body) as { fields?: Record<string, unknown> };
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed.fields ?? {})) {
      if (typeof v === "string" && k.length <= 120) out[k] = v.slice(0, 2000);
    }
    return out;
  } catch {
    return {};
  }
}

export const fmtLongDate = (iso: string, timeZone = "America/New_York"): string =>
  new Date(iso).toLocaleDateString("en-US", { timeZone, month: "long", day: "numeric", year: "numeric" });

/** Loads the template, writes values into matching text fields and flattens so the result can't be edited. */
export async function fillAgreement(template: Uint8Array, values: Record<string, string>): Promise<PDFDocument> {
  const pdf = await PDFDocument.load(template, { updateMetadata: false });
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const form = pdf.getForm();
  for (const field of form.getFields()) {
    if (!(field instanceof PDFTextField)) continue;
    const v = values[field.getName()];
    const text = v == null ? "" : winAnsi(v).replace(/\n+/g, field.isMultiline() ? "\n" : " ");
    const max = field.getMaxLength();
    field.setText(max ? text.slice(0, max) : text);
  }
  form.updateFieldAppearances(helv);
  form.flatten();
  return pdf;
}

/** Stamps the client's signature and initials (and an optional company countersignature) onto a filled agreement. */
export async function stampSignatures(
  pdf: PDFDocument,
  layout: AgreementLayout,
  opts: { signaturePng: Uint8Array | null; signerName: string; initials: string; countersignName: string },
): Promise<void> {
  const pages = pdf.getPages();
  const script = await pdf.embedFont(StandardFonts.TimesRomanItalic);
  const ink = rgb(0.07, 0.12, 0.33);
  const at = (s: Spot) => pages[s.page];

  const typed = (s: Spot, name: string) => {
    const p = at(s);
    if (!p) return;
    let size = 22;
    const text = winAnsi(name);
    while (size > 10 && script.widthOfTextAtSize(text, size) > s.w - 8) size -= 1;
    p.drawText(text, { x: s.x + 6, y: s.y + 4, size, font: script, color: ink });
  };

  if (layout.clientSig) {
    const p = at(layout.clientSig);
    if (p && opts.signaturePng) {
      const img = await pdf.embedPng(opts.signaturePng);
      const maxH = 38, maxW = layout.clientSig.w - 8;
      let h = maxH, w = (h * img.width) / img.height;
      if (w > maxW) {
        w = maxW;
        h = (w * img.height) / img.width;
      }
      p.drawImage(img, { x: layout.clientSig.x + 4, y: layout.clientSig.y + 2, width: w, height: h });
    } else if (p) {
      typed(layout.clientSig, opts.signerName);
    }
  }
  if (layout.companySig && opts.countersignName.trim()) typed(layout.companySig, opts.countersignName.trim());

  const ini = winAnsi(opts.initials.trim()).slice(0, 6);
  if (ini) {
    for (const s of layout.initials) {
      const p = at(s);
      if (!p) continue;
      let size = 10;
      while (size > 6 && script.widthOfTextAtSize(ini, size) > s.w) size -= 0.5;
      const w = script.widthOfTextAtSize(ini, size);
      p.drawText(ini, { x: s.x + Math.max(0, (s.w - w) / 2), y: s.y + 1.5, size, font: script, color: ink });
    }
  }
}
