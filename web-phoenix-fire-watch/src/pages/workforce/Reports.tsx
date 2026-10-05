import { FileSpreadsheet, FileText, Lock } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/fw/primitives";
import { Button } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/workforce/kit";
import { placementPropertyName } from "@/components/workforce/placements";
import * as api from "@/lib/workforce/api";
import { estimatePlacementCost, reconcileInvoice } from "@/lib/workforce/calc";
import {
  EQUIP_STATUS,
  EQUIP_TYPE,
  fullName,
  INVOICE_STATUS,
  money,
  OWNERSHIP,
  PERSONNEL_TYPE,
  PLACEMENT_STATUS,
  REMINDER_KIND,
  WORKER_STATUS,
  type Perm,
} from "@/lib/workforce/constants";
import { awaitingReturn } from "@/lib/workforce/derive";
import { buildPdf, downloadBlob, downloadCsv, stamp } from "@/lib/workforce/exports";
import { useWorkforce } from "@/state/WorkforceProvider";

import { fmtDate } from "@/components/workforce/kit";

type Fmt = "csv" | "pdf";

const ReportCard = ({
  title,
  description,
  locked,
  busy,
  onRun,
  children,
}: {
  title: string;
  description: string;
  locked?: string;
  busy: boolean;
  onRun: (f: Fmt) => void;
  children?: React.ReactNode;
}) => (
  <section className="flex flex-col rounded-xl border border-line bg-surface p-3">
    <div className="flex-1 rounded-lg border border-line bg-raised p-4">
      <h2 className="font-display text-lg font-bold text-ink">{title}</h2>
      <p className="mt-1 text-sm text-ink-2">{description}</p>
      {children && <div className="mt-3 grid grid-cols-1 gap-3">{children}</div>}
    </div>
    <div className="flex flex-wrap gap-2 px-1 pb-1 pt-3">
      {locked ? (
        <span className="flex items-center gap-2 text-sm text-ink-3">
          <Lock className="h-4 w-4" />
          {locked}
        </span>
      ) : (
        <>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onRun("csv")}>
            <FileSpreadsheet />
            CSV
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onRun("pdf")}>
            <FileText />
            PDF
          </Button>
        </>
      )}
    </div>
  </section>
);

/** Permission-aware exports. Every export is logged; CSV cells are protected against formula injection. */
const Reports = () => {
  const wf = useWorkforce();
  const [busy, setBusy] = useState<boolean>(false);
  const [agency, setAgency] = useState<string>("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [invStatus, setInvStatus] = useState<string>("");

  const run = async (
    key: string,
    fmt: Fmt,
    perm: Perm,
    title: string,
    head: string[],
    rows: string[][],
    extra?: { subtitle?: string; summary?: [string, string][] },
  ) => {
    setBusy(true);
    try {
      await api.logEvent("export", "report", `Exported ${title} (${fmt.toUpperCase()}, ${rows.length} rows)`, { perm });
      if (fmt === "csv") downloadCsv(`${key}_${stamp()}.csv`, head, rows);
      else
        downloadBlob(
          buildPdf({
            title,
            subtitle: extra?.subtitle,
            orgName: wf.user?.orgName ?? "",
            preparedBy: wf.user?.name ?? "",
            landscape: head.length > 6,
            sections: [
              ...(extra?.summary ? [{ title: "Summary", fields: extra.summary }] : []),
              { title: "Records", table: { head, body: rows }, emptyText: "No records match." },
            ],
          }),
          `${key}_${stamp()}.pdf`,
        );
      toast.success(`${title} downloaded`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setBusy(false);
    }
  };

  const inRange = (start: string, end: string | null) => (!from || (end ?? "9999-12-31") >= from) && (!to || start <= to);
  const agencyName = (id: string) => wf.agencyById.get(id)?.name ?? "";
  const rangeLabel = [agency ? agencyName(agency) : "All agencies", from || to ? `${from || "start"} – ${to || "today"}` : "All dates"].join(" · ");

  const placementRows = () =>
    wf.placements
      .filter((p) => (!agency || p.agency_id === agency) && inRange(p.start_date, p.end_date))
      .map((p) => {
        const w = wf.workerById.get(p.worker_id);
        return [
          w ? fullName(w) : "",
          w?.worker_code ?? "",
          agencyName(p.agency_id),
          w?.agency_worker_ref ?? "",
          placementPropertyName(p, wf.propertyById),
          p.agency_ref,
          p.start_date,
          p.end_date ?? "",
          PLACEMENT_STATUS[p.status]?.label ?? p.status,
          w ? (WORKER_STATUS[w.status]?.label ?? w.status) : "",
        ];
      });

  const costRows = () =>
    wf.placements
      .filter((p) => (!agency || p.agency_id === agency) && inRange(p.start_date, p.end_date))
      .map((p) => {
        const w = wf.workerById.get(p.worker_id);
        const e = estimatePlacementCost(p, wf.hours, wf.rates, { from: from || null, to: to || null });
        return [
          w ? fullName(w) : "",
          agencyName(p.agency_id),
          placementPropertyName(p, wf.propertyById),
          String(e.regularHours),
          String(e.overtimeHours),
          String(e.holidayHours),
          money(e.estimate),
          e.complete ? "Estimate (not reconciled)" : `Incomplete: ${e.issues.join("; ")}`,
        ];
      });

  const invoiceRows = () =>
    wf.invoices
      .filter((i) => !i.archived_at && (!agency || i.agency_id === agency) && (!invStatus || i.status === invStatus) && (!from || (i.period_end ?? i.invoice_date ?? "") >= from) && (!to || (i.period_start ?? i.invoice_date ?? "") <= to))
      .map((i) => {
        const r = reconcileInvoice(i, wf.lines, wf.hours, wf.rates);
        return [
          agencyName(i.agency_id),
          i.invoice_number,
          i.period_start ? `${i.period_start} – ${i.period_end ?? ""}` : "",
          i.invoice_date ?? "",
          i.due_date ?? "",
          money(r.invoiceTotal),
          money(r.linesTotal),
          r.expectedTotal === null ? "Incomplete" : money(r.expectedTotal),
          String(r.differences),
          String(r.unverified),
          INVOICE_STATUS[i.status]?.label ?? i.status,
          i.paid_on ? `${i.paid_on} ${i.payment_ref}` : "",
        ];
      });

  const equipmentRows = () => {
    const awaiting = new Set(awaitingReturn(wf.equipment, wf.workers, wf.placements).map((e) => e.id));
    return wf.equipment
      .filter((e) => e.status === "issued" && (!agency || wf.workerById.get(e.worker_id)?.agency_id === agency))
      .map((e) => {
        const w = wf.workerById.get(e.worker_id);
        return [
          w ? fullName(w) : "",
          w?.worker_code ?? "",
          EQUIP_TYPE[e.item_type] ?? e.item_type,
          e.item_name,
          e.asset_number,
          String(e.quantity),
          OWNERSHIP[e.ownership] ?? e.ownership,
          e.issued_on ?? "",
          awaiting.has(e.id) ? "Awaiting return" : (EQUIP_STATUS[e.status]?.label ?? e.status),
        ];
      });
  };

  const followupRows = async (): Promise<string[][]> => {
    const rows: string[][] = wf.reminders
      .filter((r) => r.status === "open" && r.kind !== "followup")
      .map((r) => [REMINDER_KIND[r.kind] ?? r.kind, r.title, r.worker_id ? fullName(wf.workerById.get(r.worker_id) ?? { first_name: "", last_name: "" }) : "", r.due_date ?? "", wf.memberName(r.assigned_to)]);
    if (wf.perms.personnel) {
      for (const f of wf.followups) {
        const w = wf.workerById.get(f.worker_id);
        rows.push(["Personnel follow-up", PERSONNEL_TYPE[f.record_type] ?? "Personnel record", w ? fullName(w) : "", f.followup_due ?? "", wf.memberName(f.followup_owner)]);
      }
    }
    return rows;
  };

  return (
    <div>
      <PageHeader title="Exports & reports" subtitle="Sensitive sections are excluded unless you have permission. Every export is recorded in the audit log." />
      <div className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-line bg-surface p-3 sm:grid-cols-3 sm:p-4">
        <SelectField label="Agency" value={agency} onChange={setAgency} allowNone noneLabel="All agencies" options={wf.agencies.map((a) => ({ value: a.id, label: a.name }))} />
        <TextField label="From" type="date" value={from} onChange={setFrom} />
        <TextField label="To" type="date" value={to} onChange={setTo} />
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <ReportCard
          title="Workforce directory"
          description="Use the Directory page's Export CSV to export exactly the filtered list you see."
          busy={busy}
          onRun={(f) =>
            void run(
              "workforce-directory",
              f,
              "manage",
              "Workforce Directory",
              ["Worker ID", "Name", "Source", "Agency", "Phone", "Email", "Position", "Start", "Status", "Service areas"],
              wf.workers
                .filter((w) => !w.archived_at && (!agency || w.agency_id === agency))
                .map((w) => [w.worker_code, fullName(w), w.source === "agency" ? "Agency" : "Direct", agencyName(w.agency_id ?? ""), w.phone, w.email, w.position, w.start_date ?? "", WORKER_STATUS[w.status]?.label ?? w.status, w.service_areas.join("; ")]),
              { subtitle: rangeLabel },
            )
          }
        />
        <ReportCard
          title="Agency workers & placements"
          description="Every placement with worker, agency, property, dates and status. No rates included."
          busy={busy}
          onRun={(f) =>
            void run("agency-placements", f, "manage", "Agency Workers & Placements", ["Worker", "Worker ID", "Agency", "Agency worker ref", "Property", "Assignment ref", "Start", "End", "Placement status", "Worker status"], placementRows(), { subtitle: rangeLabel })
          }
        />
        <ReportCard
          title="Estimated agency costs"
          description="Approved hours × effective-dated agency bill rates. Labeled as estimates; incomplete terms are flagged, never assumed."
          locked={wf.perms.finance ? undefined : "Needs agency-financials permission"}
          busy={busy}
          onRun={(f) => {
            const rows = costRows();
            const total = wf.placements
              .filter((p) => (!agency || p.agency_id === agency) && inRange(p.start_date, p.end_date))
              .reduce((s, p) => s + estimatePlacementCost(p, wf.hours, wf.rates, { from: from || null, to: to || null }).estimate, 0);
            void run("agency-cost-estimates", f, "finance", "Estimated Agency Costs", ["Worker", "Agency", "Property", "Reg hrs", "OT hrs", "Holiday hrs", "Estimate", "Status"], rows, {
              subtitle: rangeLabel,
              summary: [
                ["Total estimated cost", money(Math.round(total * 100) / 100)],
                ["Incomplete placements", String(rows.filter((r) => (r[7] ?? "").startsWith("Incomplete")).length)],
                ["Note", "Estimates only, until agency invoices are reconciled and approved."],
              ],
            });
          }}
        />
        <ReportCard
          title="Invoice reconciliation"
          description="Invoiced vs expected totals, differences and unverified lines for each agency invoice."
          locked={wf.perms.finance ? undefined : "Needs agency-financials permission"}
          busy={busy}
          onRun={(f) =>
            void run(
              "invoice-reconciliation",
              f,
              "finance",
              "Agency Invoice Reconciliation",
              ["Agency", "Invoice #", "Service period", "Invoice date", "Due", "Total", "Lines total", "Expected", "Differences", "Unverified", "Status", "Payment recorded"],
              invoiceRows(),
              { subtitle: rangeLabel },
            )
          }
        >
          {wf.perms.finance && (
            <SelectField label="Invoice status" value={invStatus} onChange={setInvStatus} allowNone noneLabel="All statuses" options={Object.entries(INVOICE_STATUS).map(([value, m]) => ({ value, label: m.label }))} />
          )}
        </ReportCard>
        <ReportCard
          title="Outstanding equipment"
          description="Items currently issued, flagged when the holder has left or their placement ended."
          busy={busy}
          onRun={(f) => void run("outstanding-equipment", f, "manage", "Outstanding Equipment", ["Worker", "Worker ID", "Type", "Item", "Asset #", "Qty", "Ownership", "Issued", "Status"], equipmentRows(), { subtitle: rangeLabel })}
        />
        <ReportCard
          title="Outstanding follow-ups"
          description={wf.perms.personnel ? "Open reminders plus personnel follow-ups (record type only, no details)." : "Open reminders. Personnel follow-ups are excluded without personnel permission."}
          busy={busy}
          onRun={(f) =>
            void (async () => run("outstanding-followups", f, wf.perms.personnel ? "personnel" : "manage", "Outstanding Follow-ups", ["Type", "Item", "Worker", "Due", "Owner"], await followupRows(), { subtitle: `Generated ${fmtDate(new Date().toISOString())}` }))()
          }
        />
      </div>
    </div>
  );
};

export default Reports;
