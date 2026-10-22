/**
 * Reads an uploaded fillable PDF agreement: its text fields, the "Initials: ____" spots in page footers,
 * and the signature underscore lines. Coordinates are PDF points (origin bottom-left, y = text baseline),
 * which is what the server uses to stamp signatures.
 */

export interface Spot {
  page: number;
  x: number;
  y: number;
  w: number;
}

export interface AgreementField {
  name: string;
  page: number;
  readOnly: boolean;
  multiline: boolean;
}

export interface AgreementLayout {
  v: 1;
  pages: number;
  fields: AgreementField[];
  initials: Spot[];
  clientSig: Spot | null;
  companySig: Spot | null;
}

interface TextItemLike {
  str: string;
  transform: number[];
  width: number;
}

interface AnnotationLike {
  subtype?: string;
  fieldType?: string;
  fieldName?: string;
  readOnly?: boolean;
  multiLine?: boolean;
  rect?: number[];
}

export interface PdfDocLike {
  numPages: number;
  getPage(n: number): Promise<{
    getTextContent(): Promise<{ items: unknown[] }>;
    getAnnotations(): Promise<unknown[]>;
  }>;
}

type Measure = (text: string, size: number) => number;

const browserMeasure = (): Measure => {
  const ctx = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
  return (text, size) => {
    if (!ctx) return text.length * size * 0.5;
    ctx.font = `${size}px Helvetica, Arial, sans-serif`;
    return ctx.measureText(text).width;
  };
};

const round = (n: number) => Math.round(n * 10) / 10;

export async function detectAgreementLayout(doc: PdfDocLike, measure: Measure = browserMeasure()): Promise<AgreementLayout> {
  const fields: AgreementField[] = [];
  const initials: Spot[] = [];
  const lines: Spot[] = [];
  const fieldRects = new Map<string, { page: number; rect: number[] }>();

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const [text, annots] = await Promise.all([page.getTextContent(), page.getAnnotations()]);

    for (const raw of annots as AnnotationLike[]) {
      if (raw.subtype !== "Widget" || raw.fieldType !== "Tx" || !raw.fieldName) continue;
      if (fields.some((f) => f.name === raw.fieldName)) continue;
      fields.push({ name: raw.fieldName, page: p - 1, readOnly: !!raw.readOnly, multiline: !!raw.multiLine });
      if (raw.rect) fieldRects.set(raw.fieldName, { page: p - 1, rect: raw.rect });
    }

    const items = (text.items as TextItemLike[]).filter((i) => typeof i.str === "string" && Array.isArray(i.transform));
    items.forEach((item, idx) => {
      const [a, b, , , e, f] = item.transform;
      const size = Math.hypot(a, b) || 10;
      const str = item.str;

      // "Client Initials: ______" in one text run
      const m = str.match(/initials?:?\s*(_{3,})/i);
      if (m && m.index !== undefined) {
        const start = str.indexOf(m[1], m.index);
        const total = measure(str, size) || 1;
        const scale = item.width / total;
        initials.push({ page: p - 1, x: round(e + measure(str.slice(0, start), size) * scale), y: round(f), w: round(measure(m[1], size) * scale) });
        return;
      }
      const trimmed = str.trim();
      if (/^_{3,}$/.test(trimmed)) {
        const prev = items[idx - 1];
        if (trimmed.length < 10 && prev && /initials?:?\s*$/i.test(prev.str) && Math.abs(prev.transform[5] - f) < 2) {
          initials.push({ page: p - 1, x: round(e), y: round(f), w: round(item.width) });
        } else if (trimmed.length >= 10) {
          lines.push({ page: p - 1, x: round(e), y: round(f), w: round(item.width) });
        }
      }
    });
  }

  // The client's signature line is the one just above the client's printed-name field; otherwise the right-most
  // line on the last page that has signature lines. The company line sits on the same row.
  let clientSig: Spot | null = null;
  const nameField = fieldRects.get("client_sig_name");
  if (nameField) {
    const top = Math.max(nameField.rect[1], nameField.rect[3]);
    clientSig =
      lines
        .filter((l) => l.page === nameField.page && l.y >= top - 2 && l.y - top < 80)
        .sort((a, b) => Math.abs(a.x - nameField.rect[0]) - Math.abs(b.x - nameField.rect[0]) || a.y - b.y)[0] ?? null;
  }
  if (!clientSig && lines.length) {
    const lastPage = Math.max(...lines.map((l) => l.page));
    clientSig = lines.filter((l) => l.page === lastPage).sort((a, b) => a.y - b.y || b.x - a.x)[0];
  }
  const companySig = clientSig
    ? lines.find((l) => l !== clientSig && l.page === clientSig.page && Math.abs(l.y - clientSig.y) < 6) ?? null
    : null;

  return { v: 1, pages: doc.numPages, fields, initials, clientSig, companySig };
}

export const isAgreementLayout = (v: unknown): v is AgreementLayout =>
  !!v && typeof v === "object" && Array.isArray((v as AgreementLayout).fields) && typeof (v as AgreementLayout).pages === "number";
