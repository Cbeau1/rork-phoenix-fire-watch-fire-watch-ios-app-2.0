import { format } from "date-fns";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

/**
 * Neutralizes spreadsheet formula injection: any cell starting with = + - @ (or tab/CR) is prefixed
 * with an apostrophe so Excel/Sheets treat it as text.
 */
export const csvCell = (v: unknown): string => {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const toCsv = (headers: string[], rows: unknown[][]): string =>
  [headers.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\r\n");

export const downloadBlob = (blob: Blob, fileName: string): void => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export const downloadCsv = (fileName: string, headers: string[], rows: unknown[][]): void => {
  // BOM so Excel opens UTF-8 correctly.
  downloadBlob(new Blob(["\uFEFF", toCsv(headers, rows)], { type: "text/csv;charset=utf-8" }), fileName);
};

export const stamp = (): string => format(new Date(), "yyyy-MM-dd_HHmm");

export interface PdfSection {
  title: string;
  /** Key/value pairs rendered as a two-column block. */
  fields?: [string, string][];
  table?: { head: string[]; body: string[][] };
  /** Free text paragraphs. */
  text?: string[];
  emptyText?: string;
}

const INK: [number, number, number] = [22, 23, 26];
const INK_2: [number, number, number] = [92, 95, 102];
const EMBER: [number, number, number] = [220, 38, 38];
const LINE: [number, number, number] = [224, 225, 229];

/** Generic branded, confidential PDF used by all workforce reports. */
export const buildPdf = (opts: {
  title: string;
  subtitle?: string;
  orgName: string;
  preparedBy: string;
  sections: PdfSection[];
  landscape?: boolean;
  confidential?: boolean;
  /** Small accent label above the title (defaults to the Workforce heading). */
  heading?: string;
  /** Footer disclaimer on every page. */
  footer?: string;
}): Blob => {
  const doc = new jsPDF({ unit: "pt", format: "letter", orientation: opts.landscape ? "landscape" : "portrait", compress: true });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 40;
  doc.setProperties({ title: opts.title, author: opts.orgName, creator: "Phoenix Fire Watch" });

  doc.setFillColor(...EMBER);
  doc.rect(0, 0, W, 6, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...EMBER);
  doc.text(opts.heading ?? "PHOENIX FIRE WATCH · WORKFORCE MANAGEMENT", M, 32);
  if (opts.confidential !== false) {
    doc.text("CONFIDENTIAL — INTERNAL USE ONLY", W - M, 32, { align: "right" });
  }
  doc.setTextColor(...INK);
  doc.setFontSize(20);
  doc.text(opts.title, M, 60);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...INK_2);
  let y = 78;
  if (opts.subtitle) {
    doc.text(opts.subtitle, M, y);
    y += 14;
  }
  doc.text(`${opts.orgName} · Prepared by ${opts.preparedBy} · ${format(new Date(), "MMM d, yyyy h:mm a")}`, M, y);
  y += 12;
  doc.setDrawColor(...LINE);
  doc.line(M, y, W - M, y);
  y += 18;

  const ensure = (need: number) => {
    if (y + need > H - 50) {
      doc.addPage();
      y = 50;
    }
  };

  for (const s of opts.sections) {
    ensure(40);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...INK);
    doc.text(s.title, M, y);
    y += 14;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    let rendered = false;
    if (s.fields && s.fields.length > 0) {
      autoTable(doc, {
        startY: y,
        margin: { left: M, right: M },
        theme: "plain",
        styles: { fontSize: 9, cellPadding: 3, textColor: INK, overflow: "linebreak" },
        columnStyles: { 0: { cellWidth: 150, textColor: INK_2, fontStyle: "bold" } },
        body: s.fields.map(([k, v]) => [k, v || "—"]),
      });
      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
      rendered = true;
    }
    if (s.table && s.table.body.length > 0) {
      autoTable(doc, {
        startY: y,
        margin: { left: M, right: M },
        head: [s.table.head],
        body: s.table.body,
        theme: "grid",
        styles: { fontSize: 8.5, cellPadding: 4, textColor: INK, lineColor: LINE, overflow: "linebreak" },
        headStyles: { fillColor: [35, 39, 45], textColor: [247, 248, 250], fontStyle: "bold" },
        alternateRowStyles: { fillColor: [247, 247, 248] },
      });
      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 14;
      rendered = true;
    }
    if (s.text && s.text.length > 0) {
      doc.setTextColor(...INK);
      for (const p of s.text) {
        const lines = doc.splitTextToSize(p, W - M * 2) as string[];
        ensure(lines.length * 12 + 6);
        doc.text(lines, M, y);
        y += lines.length * 12 + 6;
      }
      rendered = true;
    }
    if (!rendered) {
      doc.setTextColor(...INK_2);
      doc.text(s.emptyText ?? "No records.", M, y);
      y += 18;
    }
    y += 6;
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(...INK_2);
    doc.text(`Page ${i} of ${pages}`, W - M, H - 24, { align: "right" });
    doc.text(opts.footer ?? "Contains personnel information. Do not share with clients or officers.", M, H - 24);
  }
  return doc.output("blob");
};
