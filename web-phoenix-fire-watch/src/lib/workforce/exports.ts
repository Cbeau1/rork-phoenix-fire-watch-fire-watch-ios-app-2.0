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

/** A table cell: plain text, or text spanning several columns. */
export type PdfCell = string | { content: string; colSpan?: number };

export interface PdfTable {
  head: string[];
  body: PdfCell[][];
  /** Totals rows, rendered bold under a heavy rule on the table's last page. */
  foot?: PdfCell[][];
  /** Body row indexes to render bold on a tinted band (e.g. subtotals). */
  boldRows?: number[];
  /** Column indexes to right-align (numbers, hours, money). */
  numeric?: number[];
}

export interface PdfSection {
  title: string;
  /** Headline figures rendered as a row of tiles. */
  metrics?: { label: string; value: string; hint?: string }[];
  /** Key/value pairs rendered as a two-column block. */
  fields?: [string, string][];
  table?: PdfTable;
  /** Free text paragraphs. */
  text?: string[];
  /** Small grey footnote printed under the section. */
  note?: string;
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
    // Keep a heading with the start of its content (no orphaned titles at the bottom of a page);
    // short text-only blocks such as sign-offs stay together on one page.
    doc.setFontSize(9.5);
    const textNeed =
      s.text && !s.table && !s.fields
        ? 20 + s.text.reduce((h, p) => h + (doc.splitTextToSize(p, W - M * 2) as string[]).length * 12 + 6, 0)
        : 0;
    ensure(s.metrics ? 90 : s.table && s.table.body.length > 0 ? 96 : Math.max(40, Math.min(textNeed, 240)));
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...INK);
    doc.text(s.title, M, y);
    y += 14;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    let rendered = false;
    if (s.metrics && s.metrics.length > 0) {
      const gap = 10;
      const n = s.metrics.length;
      const tileW = (W - 2 * M - gap * (n - 1)) / n;
      const tileH = 54;
      ensure(tileH + 8);
      s.metrics.forEach((m, i) => {
        const x = M + i * (tileW + gap);
        doc.setFillColor(...BRAND.paper2);
        doc.setDrawColor(...LINE);
        doc.setLineWidth(0.6);
        doc.roundedRect(x, y, tileW, tileH, 4, 4, "FD");
        doc.setFillColor(...(i === 0 ? EMBER : ([35, 39, 45] as [number, number, number])));
        doc.rect(x, y + 8, 2.2, tileH - 16, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7);
        doc.setTextColor(...BRAND.ink3);
        doc.text(m.label.toUpperCase(), x + 12, y + 15, { charSpace: 0.9, maxWidth: tileW - 18 });
        doc.setFontSize(16);
        doc.setTextColor(...INK);
        doc.text(m.value, x + 12, y + 35, { maxWidth: tileW - 18 });
        if (m.hint) {
          doc.setFont("helvetica", "normal");
          doc.setFontSize(7.5);
          doc.setTextColor(...INK_2);
          doc.text(m.hint, x + 12, y + 47, { maxWidth: tileW - 18 });
        }
      });
      y += tileH + 14;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      rendered = true;
    }
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
      const tbl = s.table;
      const numeric = new Set(tbl.numeric ?? []);
      const bold = new Set(tbl.boldRows ?? []);
      const columnStyles: Record<number, { halign: "right" }> = {};
      for (const i of numeric) columnStyles[i] = { halign: "right" };
      autoTable(doc, {
        startY: y,
        margin: { left: M, right: M, top: 66 },
        head: [tbl.head],
        body: tbl.body,
        foot: tbl.foot,
        showFoot: "lastPage",
        theme: "grid",
        styles: { fontSize: 8.5, cellPadding: 4, textColor: INK, lineColor: LINE, overflow: "linebreak" },
        headStyles: { fillColor: [35, 39, 45], textColor: [247, 248, 250], fontStyle: "bold" },
        footStyles: { fillColor: [236, 237, 240], textColor: INK, fontStyle: "bold", lineColor: LINE },
        alternateRowStyles: { fillColor: [247, 247, 248] },
        columnStyles,
        didParseCell: (d) => {
          if (d.section === "head" && numeric.has(d.column.index)) d.cell.styles.halign = "right";
          if (d.section === "foot" && numeric.has(d.column.index)) d.cell.styles.halign = "right";
          if (d.section === "body" && bold.has(d.row.index)) {
            d.cell.styles.fontStyle = "bold";
            d.cell.styles.fillColor = [241, 242, 245];
          }
        },
        didDrawCell: (d) => {
          // Heavy rule above the first totals row, like a ledger.
          if (d.section === "foot" && d.row.index === 0) {
            doc.setDrawColor(...INK);
            doc.setLineWidth(1.1);
            doc.line(d.cell.x, d.cell.y, d.cell.x + d.cell.width, d.cell.y);
          }
        },
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
    if (s.note) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(7.5);
      doc.setTextColor(...BRAND.ink3);
      const lines = doc.splitTextToSize(s.note, W - M * 2) as string[];
      ensure(lines.length * 10 + 4);
      doc.text(lines, M, y - 4);
      y += lines.length * 10;
      doc.setFont("helvetica", "normal");
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
