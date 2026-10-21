import { strToU8, zipSync, type Zippable } from "fflate";

import { supabase } from "@/lib/supabase";
import { downloadBlob } from "@/lib/workforce/exports";

interface ExportTable {
  table: string;
  columns: string[];
  rows: Record<string, unknown>[];
}
interface ExportPayload {
  org_id: string;
  exported_at: string;
  tables: ExportTable[];
}

const cell = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const toCsv = (t: ExportTable): string =>
  [t.columns.map(cell).join(","), ...t.rows.map((r) => t.columns.map((c) => cell(r[c])).join(","))].join("\r\n") + "\r\n";

/**
 * Downloads every database table for the signed-in admin's organization as a ZIP:
 * one CSV per table (opens in Excel / Google Sheets) plus a single JSON file with everything.
 */
export const downloadFullExport = async (orgName: string): Promise<{ tables: number; rows: number }> => {
  const { data, error } = await supabase.rpc("admin_export_data");
  if (error) throw new Error(error.message);
  const p = data as unknown as ExportPayload;
  const stamp = p.exported_at.slice(0, 10);
  const totalRows = p.tables.reduce((s, t) => s + t.rows.length, 0);
  const files: Zippable = {};
  for (const t of p.tables) files[`csv/${t.table}.csv`] = strToU8("\uFEFF" + toCsv(t));
  files["all-tables.json"] = strToU8(JSON.stringify(p, null, 2));
  files["README.txt"] = strToU8(
    [
      `${orgName} — full data export`,
      `Exported ${new Date(p.exported_at).toLocaleString()}`,
      `${p.tables.length} tables · ${totalRows} rows`,
      "",
      "csv/        One spreadsheet per table (open in Excel or Google Sheets).",
      "all-tables.json  Every table in one file, for developers or re-importing.",
      "",
      "Times are in UTC. Uploaded files (photos, documents, receipts) are not included — only their records.",
      "This file contains personal and pay information. Store it securely.",
      "",
      "Row counts:",
      ...p.tables.map((t) => `  ${t.table.padEnd(28)} ${t.rows.length}`),
    ].join("\r\n"),
  );
  const zip = zipSync(files, { level: 6 });
  const safe = orgName.replace(/[^\w-]+/g, "_").replace(/^_|_$/g, "") || "Organization";
  downloadBlob(new Blob([zip], { type: "application/zip" }), `${safe}_data_export_${stamp}.zip`);
  return { tables: p.tables.length, rows: totalRows };
};

interface ReportSheet {
  name: string;
  rows: Record<string, unknown>[];
}
interface ReportPayload {
  org_name: string;
  timezone: string;
  exported_at: string;
  sheets: ReportSheet[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
const MONEY_COL = /(pay|rate|amount|total|tax|requested|approved$|premium|monthly)/i;
const HOURS_COL = /hours/i;

/** Local wall-clock strings become Excel dates without any time zone shift. */
const toExcelDate = (s: string): Date => {
  const [d, t] = s.split(" ");
  const [y, m, day] = d.split("-").map(Number);
  const [hh, mm] = (t ?? "00:00").split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, day, hh, mm));
};

/**
 * Downloads a readable Excel workbook for the admin's organization: one sheet per area
 * (properties, employees, schedule, timesheets, payroll, invoices, expenditures…), with names
 * instead of ids and times in the organization's local time zone.
 */
export const downloadExcelReport = async (orgName: string): Promise<{ sheets: number; rows: number }> => {
  const [{ data, error }, ExcelJS] = await Promise.all([supabase.rpc("admin_export_report"), import("exceljs")]);
  if (error) throw new Error(error.message);
  const p = data as unknown as ReportPayload;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Phoenix Fire Watch";
  wb.created = new Date(p.exported_at);

  const sheets = p.sheets.map((s) => {
    const columns = Object.keys(s.rows[0] ?? {}).filter((c) => c !== "__n");
    const rows = s.rows.filter((r) => r.__n !== null && r.__n !== undefined);
    return { name: s.name, columns, rows };
  });
  const total = sheets.reduce((n, s) => n + s.rows.length, 0);

  const navy = "FF0F1E36";
  const styleHeader = (ws: import("exceljs").Worksheet) => {
    const h = ws.getRow(1);
    h.font = { bold: true, color: { argb: "FFFFFFFF" } };
    h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: navy } };
    h.alignment = { vertical: "middle" };
    h.height = 20;
    ws.views = [{ state: "frozen", ySplit: 1 }];
  };

  // Summary sheet first
  const sum = wb.addWorksheet("Summary");
  sum.columns = [{ width: 28 }, { width: 48 }];
  sum.addRow([`${orgName} — data export`]).font = { bold: true, size: 14 };
  sum.addRow(["Exported", new Date(p.exported_at).toLocaleString()]);
  sum.addRow(["Times shown in", p.timezone]);
  sum.addRow(["Total rows", total]);
  sum.addRow([]);
  const sh = sum.addRow(["Sheet", "Rows"]);
  sh.font = { bold: true, color: { argb: "FFFFFFFF" } };
  sh.fill = { type: "pattern", pattern: "solid", fgColor: { argb: navy } };
  for (const s of sheets) sum.addRow([s.name, s.rows.length]);
  sum.addRow([]);
  sum.addRow(["Notes", "Payroll by week uses approved, clocked-out hours; weeks run Monday–Sunday; overtime is hours over 40 per week at time-and-a-half."]);
  sum.addRow(["", "Uploaded files (photos, documents, receipts) are not included — only their records."]);
  sum.addRow(["", "This file contains personal and pay information. Store it securely."]);
  sum.getColumn(2).alignment = { wrapText: true, vertical: "top" };

  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31));
    ws.addRow(s.columns);
    styleHeader(ws);
    const widths = s.columns.map((c) => Math.max(10, c.length + 2));
    for (const r of s.rows) {
      const values = s.columns.map((c, i) => {
        const v = r[c];
        if (v === null || v === undefined || v === "") return null;
        if (typeof v === "string") {
          widths[i] = Math.min(60, Math.max(widths[i], v.length + 2));
          if (DATE_RE.test(v) || DATETIME_RE.test(v)) return toExcelDate(v);
          return v;
        }
        if (typeof v === "object") return JSON.stringify(v);
        widths[i] = Math.max(widths[i], String(v).length + 4);
        return v as number | boolean;
      });
      ws.addRow(values);
    }
    s.columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      col.width = widths[i];
      const sample = s.rows.find((r) => typeof r[c] === "string" && r[c] !== "")?.[c] as string | undefined;
      const firstNum = s.rows.find((r) => typeof r[c] === "number")?.[c];
      if (sample && DATETIME_RE.test(sample)) { col.numFmt = "yyyy-mm-dd h:mm AM/PM"; col.width = Math.max(col.width ?? 10, 20); }
      else if (sample && DATE_RE.test(sample)) { col.numFmt = "yyyy-mm-dd"; col.width = Math.max(col.width ?? 10, 12); }
      else if (firstNum !== undefined && HOURS_COL.test(c)) col.numFmt = "0.00";
      else if (firstNum !== undefined && MONEY_COL.test(c)) col.numFmt = '"$"#,##0.00';
      col.eachCell((cl, rowNo) => { if (rowNo === 1) cl.numFmt = "@"; });
    });
    if (s.rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: s.columns.length } };
  }

  const buf = await wb.xlsx.writeBuffer();
  const safe = orgName.replace(/[^\w-]+/g, "_").replace(/^_|_$/g, "") || "Organization";
  downloadBlob(
    new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `${safe}_report_${p.exported_at.slice(0, 10)}.xlsx`,
  );
  return { sheets: sheets.length, rows: total };
};
