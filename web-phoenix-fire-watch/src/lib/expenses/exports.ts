import { buildPdf, downloadBlob, downloadCsv, stamp, type PdfSection } from "@/lib/workforce/exports";

import { METHOD, PAID_BY, statusMeta, type Direction } from "./constants";
import { payerLabel, type DirectionState, type ExpRow } from "./derive";
import { centsToInput, fmtMoney } from "./money";

/** Minimal context the exporters need (satisfied by useExpenses()). */
export interface ExportCtx {
  user: { name: string; orgName: string } | null;
  propertyName: (id: string | null | undefined) => string;
  memberName: (id: string | null | undefined) => string;
  agencyById: Map<string, { name: string }>;
}

const HEADING = "PHOENIX FIRE WATCH · EXPENDITURES";
const FOOTER = "Confidential financial records. Internal use only — not tax advice.";

const stateText = (st: DirectionState, dir: Direction): string => {
  if (!st.view) return st.flag === "not_requested" ? "Not requested" : "Not applicable";
  return statusMeta(dir)[st.view.r.status]?.label ?? st.view.r.status;
};
const balance = (st: DirectionState): string => (st.view && st.view.payable ? centsToInput(st.view.remaining) : "");

const client = (r: ExpRow, ctx: ExportCtx) => (r.e.property_id ? ctx.propertyName(r.e.property_id) : r.e.property_name);

export const RECORD_HEAD = [
  "Expenditure ID",
  "Purchase date",
  "Vendor",
  "Description",
  "Business purpose",
  "Category",
  "Amount",
  "Currency",
  "Tax included",
  "Paid by",
  "Payer",
  "Payment method",
  "Account label",
  "Property / client",
  "Agency",
  "Receipt / invoice #",
  "Receipts attached",
  "Reimbursement to person",
  "Owed balance",
  "Client/agency recovery",
  "Recovery balance",
  "Created by",
  "Created",
  "Last edited by",
  "Last edited",
  "Archived",
];

export const recordRow = (r: ExpRow, ctx: ExportCtx): string[] => [
  r.e.code,
  r.e.spent_on,
  r.e.vendor,
  r.e.description,
  r.e.purpose,
  r.category?.name ?? "",
  centsToInput(r.amount),
  r.e.currency,
  r.e.tax_amount != null ? String(r.e.tax_amount) : "",
  PAID_BY[r.e.paid_by as keyof typeof PAID_BY] ?? r.e.paid_by,
  payerLabel(r.e),
  METHOD[r.e.payment_method] ?? r.e.payment_method,
  r.e.account_label,
  client(r, ctx),
  r.e.agency_id ? (ctx.agencyById.get(r.e.agency_id)?.name ?? "") : "",
  r.e.invoice_ref,
  String(r.receipts.length),
  stateText(r.person, "to_person"),
  balance(r.person),
  stateText(r.recovery, "from_client"),
  balance(r.recovery),
  ctx.memberName(r.e.created_by),
  r.e.created_at,
  ctx.memberName(r.e.updated_by),
  r.e.updated_at,
  r.e.archived_at ? "Yes" : "",
];

/** CSV cells are neutralized against spreadsheet formula injection by csvCell(). */
export const exportRecordsCsv = (rows: ExpRow[], ctx: ExportCtx) =>
  downloadCsv(`Expenditures_${stamp()}.csv`, RECORD_HEAD, rows.map((r) => recordRow(r, ctx)));

export const exportRecordsPdf = (rows: ExpRow[], ctx: ExportCtx, filters: string) =>
  exportPdf(ctx, "Expenditure Records", `Basis: purchase date${filters ? ` · Filters: ${filters}` : ""}`, [
    {
      title: `Records (${rows.length})`,
      table: {
        head: ["ID", "Date", "Vendor", "Description", "Category", "Amount", "Paid by", "Property / client", "Receipt", "Owed to person", "Recovery"],
        body: rows.map((r) => [
          r.e.code,
          r.e.spent_on,
          r.e.vendor,
          r.e.description,
          r.category?.name ?? "",
          fmtMoney(r.amount, r.e.currency),
          payerLabel(r.e),
          client(r, ctx),
          r.receipts.length ? String(r.receipts.length) : "MISSING",
          `${stateText(r.person, "to_person")}${balance(r.person) ? ` (${fmtMoney(r.person.view?.remaining ?? 0, r.e.currency)} left)` : ""}`,
          `${stateText(r.recovery, "from_client")}${balance(r.recovery) ? ` (${fmtMoney(r.recovery.view?.remaining ?? 0, r.e.currency)} left)` : ""}`,
        ]),
      },
      emptyText: "No records match.",
    },
  ]);

export const exportPdf = (ctx: ExportCtx, title: string, subtitle: string, sections: PdfSection[]) =>
  downloadBlob(
    buildPdf({
      title,
      subtitle,
      orgName: ctx.user?.orgName ?? "",
      preparedBy: ctx.user?.name ?? "",
      landscape: true,
      heading: HEADING,
      footer: FOOTER,
      sections,
    }),
    `${title.replace(/[^\w-]+/g, "_")}_${stamp()}.pdf`,
  );

export const exportTableCsv = (title: string, head: string[], body: string[][]) =>
  downloadCsv(`${title.replace(/[^\w-]+/g, "_")}_${stamp()}.csv`, head, body);
