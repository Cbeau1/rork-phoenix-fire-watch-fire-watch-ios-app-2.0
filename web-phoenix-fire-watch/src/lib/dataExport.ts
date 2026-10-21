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
