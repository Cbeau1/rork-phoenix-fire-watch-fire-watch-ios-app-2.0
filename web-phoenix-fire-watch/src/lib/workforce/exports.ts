import { format } from "date-fns";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

import { BRAND, drawBrandLogo, drawPageFooter, drawRunningHeader, loadBrandLogo, loadBrandMark } from "@/lib/pdf-brand";

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

const INK: [number, number, number] = BRAND.ink;
const INK_2: [number, number, number] = BRAND.ink2;
const EMBER: [number, number, number] = BRAND.ember;
const LINE: [number, number, number] = BRAND.line;

/** Generic branded, confidential PDF used by all workforce reports. */
export const buildPdf = async (opts: {
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
}): Promise<Blob> => {
  const doc = new jsPDF({ unit: "pt", format: "letter", orientation: opts.landscape ? "landscape" : "portrait", compress: true });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 40;
  doc.setProperties({ title: opts.title, author: opts.orgName, creator: "Phoenix Fire Watch" });

  const logo = await loadBrandLogo();
  const mark = await loadBrandMark();
  // The logo already carries the brand name — drop the prefix callers used to include.
  const heading = (opts.heading ?? "WORKFORCE MANAGEMENT").replace(/^PHOENIX FIRE WATCH\s*·\s*/i, "");

  // ---- Letterhead: ember edge bar, logo lockup, accent heading, confidential notice
  doc.setFillColor(...EMBER);
  doc.rect(0, 0, W, 5, "F");
  const logoH = 46;
  let textX = M;
  if (logo) textX = M + drawBrandLogo(doc, logo, M, 20, logoH) + 16;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...EMBER);
  doc.text(heading.toUpperCase(), textX, 38, { charSpace: 1.4, maxWidth: W - 2 * M - (textX - M) - 190 });
  if (opts.confidential !== false) {
    doc.text("CONFIDENTIAL — INTERNAL USE ONLY", W - M, 38, { align: "right" });
  }
  if (logo) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...BRAND.ink3);
    doc.text(opts.orgName, textX, 53);
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(...INK);
  doc.text(opts.title, M, 90);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...INK_2);
  let y = 106;
  if (opts.subtitle) {
    doc.text(opts.subtitle, M, y);
    y += 14;
  }
  doc.text(`${opts.orgName} · Prepared by ${opts.preparedBy} · ${format(new Date(), "MMM d, yyyy h:mm a")}`, M, y);
  y += 10;
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.8);
  doc.line(M, y, W - M, y);
  doc.setFillColor(...EMBER);
  doc.rect(M, y - 1, 52, 2, "F");
  y += 20;

  const ensure = (need: number) => {
    if (y + need > H - 50) {
      doc.addPage();
      y = 66;
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
        margin: { left: M, right: M, top: 66 },
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
        margin: { left: M, right: M, top: 66 },
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
    if (i > 1) drawRunningHeader(doc, mark, `${opts.title}${opts.subtitle ? `  ·  ${opts.subtitle}` : ""}`);
    drawPageFooter(doc, {
      orgName: "Phoenix Fire Watch",
      docLabel: opts.footer ?? "Contains personnel information. Do not share with clients or officers.",
    });
  }
  return doc.output("blob");
};
