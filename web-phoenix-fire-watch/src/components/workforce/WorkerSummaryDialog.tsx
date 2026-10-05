import { useState } from "react";
import { toast } from "sonner";

import * as api from "@/lib/workforce/api";
import { estimatePlacementCost } from "@/lib/workforce/calc";
import {
  CHECK_STATUS,
  DOC_CATEGORY_LABEL,
  EQUIP_STATUS,
  fullName,
  money,
  PERSONNEL_STATUS,
  PERSONNEL_TYPE,
  PLACEMENT_STATUS,
  PREFERRED_CONTACT,
  REVIEW_STATUS,
  SOURCE_LABEL,
  WORKER_STATUS,
  type Worker,
  type WorkerSource,
} from "@/lib/workforce/constants";
import { shiftHours, workHistory } from "@/lib/workforce/derive";
import { buildPdf, downloadBlob, stamp, type PdfSection } from "@/lib/workforce/exports";
import { useWorkforce } from "@/state/WorkforceProvider";

import { CheckField, FormDialog, fmtDate } from "./kit";

type SectionId = "profile" | "contact" | "checklist" | "documents" | "placements" | "history" | "equipment" | "pay" | "personnel" | "costs";

/** Worker summary PDF with selectable sections. Sensitive sections are off by default and permission-gated. */
export const WorkerSummaryDialog = ({ open, onOpenChange, worker }: { open: boolean; onOpenChange: (v: boolean) => void; worker: Worker }) => {
  const wf = useWorkforce();
  const isAgency = worker.source === "agency";
  const [sel, setSel] = useState<Record<SectionId, boolean>>({
    profile: true,
    contact: true,
    checklist: true,
    documents: true,
    placements: true,
    history: true,
    equipment: true,
    pay: false,
    personnel: false,
    costs: false,
  });
  const [busy, setBusy] = useState<boolean>(false);

  const options: { id: SectionId; label: string; hint?: string; show: boolean; sensitive?: boolean }[] = [
    { id: "profile", label: "Profile & status", show: true },
    { id: "contact", label: "Contact, address & emergency contact", show: true },
    { id: "checklist", label: isAgency ? "Placement checklists" : "Onboarding checklist", show: true },
    { id: "documents", label: "Document list (titles & review status only)", show: true },
    { id: "placements", label: "Placements", show: isAgency },
    { id: "history", label: "Work history", show: true },
    { id: "equipment", label: "Equipment", show: true },
    { id: "pay", label: "Employee pay rates", hint: "Sensitive", show: !isAgency && wf.perms.pay, sensitive: true },
    { id: "costs", label: "Agency bill rates & estimated cost", hint: "Sensitive", show: isAgency && wf.perms.finance, sensitive: true },
    { id: "personnel", label: "Personnel records", hint: "Sensitive", show: wf.perms.personnel, sensitive: true },
  ];

  const build = async () => {
    setBusy(true);
    try {
      const sections: PdfSection[] = [];
      const agency = worker.agency_id ? wf.agencyById.get(worker.agency_id) : undefined;
      const account = worker.profile_id ? wf.memberById.get(worker.profile_id) : undefined;
      const included: string[] = [];
      if (sel.profile) {
        included.push("profile");
        sections.push({
          title: "Profile",
          fields: [
            ["Worker ID", worker.worker_code],
            ["Source", SOURCE_LABEL[worker.source as WorkerSource]],
            ["Status", WORKER_STATUS[worker.status]?.label ?? worker.status],
            ["Position", worker.position],
            [isAgency ? "First assignment" : "Hire date", fmtDate(worker.start_date)],
            ["Service areas", worker.service_areas.join(", ")],
            ...(isAgency ? ([["Agency", agency?.name ?? ""], ["Agency reference ID", worker.agency_worker_ref]] as [string, string][]) : []),
            ["Linked app account", account ? `${account.full_name} (${account.email})` : "None"],
            ["Availability", worker.availability],
          ],
        });
      }
      if (sel.contact) {
        included.push("contact");
        sections.push({
          title: "Contact",
          fields: [
            ["Phone", worker.phone],
            ["Email", worker.email],
            ["Preferred contact", PREFERRED_CONTACT[worker.preferred_contact] ?? ""],
            ["Address", worker.address],
            ["Emergency contact", [worker.emergency_name, worker.emergency_relationship, worker.emergency_phone].filter(Boolean).join(" · ")],
          ],
        });
      }
      if (sel.checklist) {
        included.push("checklist");
        const items = wf.checklist.filter((c) => c.worker_id === worker.id);
        sections.push({
          title: isAgency ? "Placement checklists" : "Checklists",
          table: { head: ["Item", "Required", "Status", "Completed", "Responsible"], body: items.map((c) => [c.title, c.required ? "Yes" : "No", CHECK_STATUS[c.status]?.label ?? c.status, fmtDate(c.completed_on), wf.memberName(c.responsible_id)]) },
          emptyText: "No checklist items.",
        });
      }
      if (sel.documents) {
        included.push("documents");
        const docs = wf.documents.filter((d) => d.worker_id === worker.id && !d.archived_at && d.owner_type !== "personnel");
        sections.push({
          title: "Documents",
          table: {
            head: ["Title", "Category", "Version", "Review", "Expires"],
            body: docs.map((d) => {
              const v = wf.versions.find((x) => x.document_id === d.id && x.version === d.current_version);
              return [d.title, DOC_CATEGORY_LABEL[d.category] ?? d.category, `v${d.current_version}`, REVIEW_STATUS[v?.review_status ?? ""]?.label ?? "—", fmtDate(d.expiration_date)];
            }),
          },
          emptyText: "No documents (or none you have permission to view).",
        });
      }
      if (sel.placements && isAgency) {
        included.push("placements");
        const pl = wf.placements.filter((p) => p.worker_id === worker.id);
        sections.push({
          title: "Placements",
          table: {
            head: ["Property", "Agency", "Start", "End", "Status", "Agency ref"],
            body: pl.map((p) => [(p.property_id && wf.propertyById.get(p.property_id)?.name) || p.property_name, wf.agencyById.get(p.agency_id)?.name ?? "", fmtDate(p.start_date), fmtDate(p.end_date), PLACEMENT_STATUS[p.status]?.label ?? p.status, p.agency_ref]),
          },
          emptyText: "No placements.",
        });
      }
      if (sel.history) {
        included.push("history");
        const h = workHistory(worker, wf.shifts, wf.patrols, wf.placements);
        sections.push({
          title: "Work history",
          fields: [
            ["Assigned properties", h.propertyIds.map((id) => wf.propertyById.get(id)?.name ?? "").filter(Boolean).join(", ")],
            ["Scheduled shifts", h.linkedSchedule ? String(h.shifts.length) : "Not linked to schedule"],
            ["Completed shifts", h.linkedSchedule ? `${h.completed.length} (${h.completedHours}h)` : "—"],
            ["Late arrivals / call-outs / no-shows", "Not tracked by the app"],
          ],
          table: {
            head: ["Date", "Time", "Property", "Hours", "Completion"],
            body: h.past.slice(0, 40).map((s) => [s.shift_date, `${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}`, wf.propertyById.get(s.property_id)?.name ?? "", String(shiftHours(s)), h.completedBy.get(s.id) ?? "No record"]),
          },
        });
      }
      if (sel.equipment) {
        included.push("equipment");
        const eq = wf.equipment.filter((e) => e.worker_id === worker.id);
        sections.push({
          title: "Equipment",
          table: { head: ["Item", "Qty", "Asset #", "Issued", "Returned", "Status"], body: eq.map((e) => [e.item_name, String(e.quantity), e.asset_number, fmtDate(e.issued_on), fmtDate(e.returned_on), EQUIP_STATUS[e.status]?.label ?? e.status]) },
          emptyText: "No equipment issued.",
        });
      }
      if (sel.pay && !isAgency && wf.perms.pay) {
        included.push("pay");
        const pay = await api.listPay(worker.id);
        sections.push({ title: "Employee pay rates (confidential)", table: { head: ["Effective", "Hourly rate", "Note"], body: pay.map((p) => [fmtDate(p.effective_date), money(Number(p.hourly_rate)), p.note]) }, emptyText: "No pay rates." });
      }
      if (sel.costs && isAgency && wf.perms.finance) {
        included.push("costs");
        const pl = wf.placements.filter((p) => p.worker_id === worker.id);
        sections.push({
          title: "Agency cost estimates (not reconciled)",
          table: {
            head: ["Placement", "Approved hours", "Estimate", "Status"],
            body: pl.map((p) => {
              const e = estimatePlacementCost(p, wf.hours, wf.rates);
              return [p.property_name || "Placement", String(e.regularHours + e.overtimeHours + e.holidayHours), money(e.estimate), e.complete ? "Estimate" : `Incomplete: ${e.issues.join("; ")}`];
            }),
          },
          emptyText: "No placements.",
        });
      }
      if (sel.personnel && wf.perms.personnel) {
        included.push("personnel");
        const recs = await api.listPersonnel(worker.id);
        sections.push({
          title: "Personnel records (confidential)",
          table: {
            head: ["Date", "Type", "Title", "Status", "Allegation", "Findings", "Outcome"],
            body: recs.map((r) => [fmtDate(r.event_at ?? r.created_at), PERSONNEL_TYPE[r.record_type] ?? r.record_type, r.title, PERSONNEL_STATUS[r.status]?.label ?? r.status, r.allegation, r.findings, r.outcome]),
          },
          emptyText: "No personnel records.",
        });
      }
      const sensitive = included.filter((s) => ["pay", "costs", "personnel"].includes(s));
      await api.logEvent("export", "wf_workers", `Exported worker summary PDF (${included.join(", ")})`, {
        entityId: worker.id,
        workerId: worker.id,
        perm: sensitive.includes("personnel") ? "personnel" : sensitive.includes("pay") ? "pay" : sensitive.includes("costs") ? "finance" : "manage",
      });
      const blob = buildPdf({
        title: `Worker Summary — ${fullName(worker)}`,
        subtitle: `${worker.worker_code} · ${SOURCE_LABEL[worker.source as WorkerSource]}`,
        orgName: wf.user?.orgName ?? "",
        preparedBy: wf.user?.name ?? "",
        sections,
      });
      downloadBlob(blob, `Worker_Summary_${worker.worker_code}_${stamp()}.pdf`);
      toast.success("Summary PDF downloaded");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't build the PDF.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Worker summary PDF"
      description="Choose the sections to include. Sensitive sections are off by default and the export is logged."
      dirty={false}
      saving={busy}
      onSubmit={() => void build()}
      submitLabel="Download PDF"
    >
      <div className="grid grid-cols-1 gap-2">
        {options
          .filter((o) => o.show)
          .map((o) => (
            <CheckField key={o.id} label={o.label} hint={o.hint} checked={sel[o.id]} onChange={(v) => setSel((p) => ({ ...p, [o.id]: v }))} />
          ))}
      </div>
    </FormDialog>
  );
};
