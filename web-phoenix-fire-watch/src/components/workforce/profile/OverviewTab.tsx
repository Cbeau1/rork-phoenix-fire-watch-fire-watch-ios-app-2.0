import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router-dom";

import { DataTile, fmtDate, MetaPill, Pill, SectionCard } from "@/components/workforce/kit";
import {
  PERSONNEL_TYPE,
  PLACEMENT_STATUS,
  PREFERRED_CONTACT,
  SOURCE_LABEL,
  WORKER_STATUS,
  type Worker,
  type WorkerSource,
} from "@/lib/workforce/constants";
import { awaitingReturn, missingItems, todayKey } from "@/lib/workforce/derive";
import { useWorkforce } from "@/state/WorkforceProvider";

export const OverviewTab = ({ worker }: { worker: Worker }) => {
  const wf = useWorkforce();
  const agency = worker.agency_id ? wf.agencyById.get(worker.agency_id) : undefined;
  const account = worker.profile_id ? wf.memberById.get(worker.profile_id) : undefined;
  const staff = worker.staff_id ? wf.staffById.get(worker.staff_id) : undefined;
  const missing = useMemo(() => missingItems(worker.id, wf.checklist, wf.placements), [worker.id, wf.checklist, wf.placements]);
  const equipment = useMemo(
    () => wf.equipment.filter((e) => e.worker_id === worker.id && e.status === "issued"),
    [wf.equipment, worker.id],
  );
  const overdueReturn = useMemo(
    () => new Set(awaitingReturn(wf.equipment, wf.workers, wf.placements).map((e) => e.id)),
    [wf.equipment, wf.workers, wf.placements],
  );
  const followups = wf.followups.filter((f) => f.worker_id === worker.id);
  const openPlacements = wf.placements.filter((p) => p.worker_id === worker.id && (p.status === "active" || p.status === "pending"));
  const reminders = wf.reminders.filter((r) => r.worker_id === worker.id && r.status === "open");
  const isAgency = worker.source === "agency";

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <div className="space-y-5">
        <SectionCard title="Contact & profile">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <DataTile label="Phone">{worker.phone}</DataTile>
            <DataTile label="Email">{worker.email}</DataTile>
            <DataTile label="Preferred contact">{PREFERRED_CONTACT[worker.preferred_contact] ?? ""}</DataTile>
            <DataTile label="Availability">{worker.availability}</DataTile>
            <DataTile label={isAgency ? "Address (optional)" : "Address"} className="sm:col-span-2">
              {worker.address ? <span className="whitespace-pre-line">{worker.address}</span> : null}
            </DataTile>
            <DataTile label="Position">{worker.position}</DataTile>
            <DataTile label="Service areas">{worker.service_areas.join(", ")}</DataTile>
            <DataTile label="Worker source">{SOURCE_LABEL[worker.source as WorkerSource]}</DataTile>
            <DataTile label={isAgency ? "First assignment date" : "Hire date"}>{worker.start_date ? fmtDate(worker.start_date) : ""}</DataTile>
            {isAgency && (
              <>
                <DataTile label="Agency">
                  {agency ? (
                    <Link className="text-ember hover:underline" to={`/workforce/agencies/${agency.id}`}>
                      {agency.name}
                    </Link>
                  ) : null}
                </DataTile>
                <DataTile label="Agency worker / reference ID">{worker.agency_worker_ref}</DataTile>
              </>
            )}
            <DataTile label="Current status">
              <MetaPill meta={WORKER_STATUS} value={worker.status} />
            </DataTile>
            <DataTile label="Linked officer account">
              {account ? (
                <span>
                  {account.full_name} · {account.email} {!account.active && <Pill tone="slate">Inactive</Pill>}
                </span>
              ) : (
                <span className="text-ink-3">No app account</span>
              )}
            </DataTile>
            <DataTile label="Schedule name">{staff ? staff.name : <span className="text-ink-3">Not linked to the schedule</span>}</DataTile>
          </div>
        </SectionCard>

        <SectionCard title="Emergency contact">
          {worker.emergency_name || worker.emergency_phone ? (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              <DataTile label="Name">{worker.emergency_name}</DataTile>
              <DataTile label="Relationship">{worker.emergency_relationship}</DataTile>
              <DataTile label="Phone">{worker.emergency_phone}</DataTile>
            </div>
          ) : (
            <p className="px-1 py-2 text-sm text-ink-3">No emergency contact provided.</p>
          )}
        </SectionCard>
      </div>

      <div className="space-y-5">
        <SectionCard title="Outstanding items" subtitle="Checklist completion is tracked separately — it never changes status or cancels shifts.">
          <ul className="space-y-2">
            {missing.length === 0 && followups.length === 0 && equipment.length === 0 && reminders.length === 0 && (
              <li className="flex items-center gap-2 rounded-lg border border-line bg-raised px-4 py-3 text-sm text-ink-2">
                <CheckCircle2 className="h-4 w-4 text-status-clear" />
                Nothing outstanding.
              </li>
            )}
            {missing.map((m) => (
              <li key={m.id} className="flex items-center gap-2 rounded-lg border border-line bg-raised px-4 py-3 text-sm text-ink">
                <AlertTriangle className="h-4 w-4 shrink-0 text-status-follow" />
                <span className="min-w-0 flex-1 truncate">{m.title}</span>
                <Pill tone="amber">{m.kind === "placement" ? "Placement" : "Onboarding"}</Pill>
              </li>
            ))}
            {followups.map((f) => (
              <li key={f.id} className="flex items-center gap-2 rounded-lg border border-line bg-raised px-4 py-3 text-sm text-ink">
                <AlertTriangle className="h-4 w-4 shrink-0 text-status-follow" />
                <span className="min-w-0 flex-1 truncate">{PERSONNEL_TYPE[f.record_type] ?? "Personnel"} follow-up</span>
                <Pill tone={f.followup_due && f.followup_due < todayKey() ? "red" : "amber"}>Due {fmtDate(f.followup_due, "MMM d")}</Pill>
              </li>
            ))}
            {equipment.map((e) => (
              <li key={e.id} className="flex items-center gap-2 rounded-lg border border-line bg-raised px-4 py-3 text-sm text-ink">
                <span className="min-w-0 flex-1 truncate">Issued: {e.item_name}{e.quantity > 1 ? ` × ${e.quantity}` : ""}</span>
                <Pill tone={overdueReturn.has(e.id) ? "red" : "blue"}>{overdueReturn.has(e.id) ? "Awaiting return" : "Issued"}</Pill>
              </li>
            ))}
          </ul>
        </SectionCard>

        {isAgency && (
          <SectionCard title="Current placements">
            {openPlacements.length === 0 ? (
              <p className="px-1 py-2 text-sm text-ink-3">No pending or active placements.</p>
            ) : (
              <ul className="space-y-2">
                {openPlacements.map((p) => (
                  <li key={p.id} className="rounded-lg border border-line bg-raised px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-ink">
                        {(p.property_id && wf.propertyById.get(p.property_id)?.name) || p.property_name || "Property removed"}
                      </span>
                      <MetaPill meta={PLACEMENT_STATUS} value={p.status} />
                    </div>
                    <div className="mt-0.5 text-xs text-ink-3">
                      {fmtDate(p.start_date)} – {p.end_date ? fmtDate(p.end_date) : "open-ended"}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        )}
      </div>
    </div>
  );
};
