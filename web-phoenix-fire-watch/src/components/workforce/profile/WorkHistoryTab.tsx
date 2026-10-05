import { CalendarX2, Info } from "lucide-react";
import { useMemo } from "react";

import { DataTile, Empty, fmtDate, Pill, SectionCard } from "@/components/workforce/kit";
import { hoursLabel, type Worker } from "@/lib/workforce/constants";
import { shiftHours, workHistory } from "@/lib/workforce/derive";
import { useWorkforce } from "@/state/WorkforceProvider";

const Unavailable = ({ label, why }: { label: string; why: string }) => (
  <div className="rounded-lg border border-dashed border-line px-4 py-3">
    <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-3">{label}</div>
    <div className="mt-1 flex items-start gap-2 text-sm text-ink-3">
      <CalendarX2 className="mt-0.5 h-4 w-4 shrink-0" />
      {why}
    </div>
  </div>
);

/** Read-only history reused from the existing schedule and patrol logs. Nothing is inferred. */
export const WorkHistoryTab = ({ worker }: { worker: Worker }) => {
  const wf = useWorkforce();
  const h = useMemo(() => workHistory(worker, wf.shifts, wf.patrols, wf.placements), [worker, wf.shifts, wf.patrols, wf.placements]);
  const propName = (id: string) => wf.propertyById.get(id)?.name ?? "Property removed";
  const replacementFor = wf.placements.filter((p) => p.replacement_worker_id === worker.id);
  const replacedBy = wf.placements.filter((p) => p.worker_id === worker.id && p.replacement_worker_id);

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2 rounded-lg border border-line bg-raised px-4 py-3 text-sm text-ink-2">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />
        <span>
          Built from the existing Schedule and patrol logs. It's read only here — edit shifts on the Schedule page. A past shift counts as
          completed only when the worker's linked app account logged a patrol at that property during the shift, or an admin marked it paid.
        </span>
      </div>

      <SectionCard title="Summary">
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <DataTile label="Assigned properties">{h.propertyIds.length > 0 ? String(h.propertyIds.length) : "0"}</DataTile>
          <DataTile label="Scheduled shifts">{h.linkedSchedule ? String(h.shifts.length) : <span className="text-ink-3">Not linked</span>}</DataTile>
          <DataTile label="Completed shifts">{h.linkedSchedule ? String(h.completed.length) : <span className="text-ink-3">Not linked</span>}</DataTile>
          <DataTile label="Recorded hours">{h.linkedSchedule ? hoursLabel(h.completedHours) : <span className="text-ink-3">Not linked</span>}</DataTile>
        </div>
        <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <Unavailable label="Late arrivals" why="Not tracked — the app has no clock-in times, so late arrivals can't be determined reliably." />
          <Unavailable label="Call-outs" why="Not tracked — call-outs aren't recorded in the schedule. Log them as Attendance records in Personnel." />
          <Unavailable label="No-shows" why="Not inferred — a missing patrol doesn't prove a no-show. Log confirmed no-shows in Personnel." />
        </div>
        {!h.linkedSchedule && (
          <p className="mt-3 text-sm text-status-follow">Link this profile to a schedule name (Edit profile) to show shifts and hours.</p>
        )}
        {h.linkedSchedule && !h.linkedAccount && (
          <p className="mt-3 text-sm text-ink-3">No officer app account linked, so only shifts marked paid count as completed.</p>
        )}
      </SectionCard>

      <SectionCard title="Assigned properties">
        {h.propertyIds.length === 0 ? (
          <Empty title="No assigned properties" />
        ) : (
          <div className="flex flex-wrap gap-2">
            {h.propertyIds.map((id) => (
              <span key={id} className="rounded-lg border border-line bg-raised px-3 py-2 text-sm text-ink">
                {propName(id)}
              </span>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Upcoming shifts">
        {h.upcoming.length === 0 ? (
          <Empty title="No upcoming shifts" />
        ) : (
          <ul className="space-y-2">
            {h.upcoming.slice(0, 20).map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-raised px-4 py-3 text-sm">
                <span className="text-ink">
                  {fmtDate(s.shift_date, "EEE, MMM d")} · {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}
                </span>
                <span className="text-ink-2">{propName(s.property_id)}</span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="Past shifts">
        {h.past.length === 0 ? (
          <Empty title="No past shifts" />
        ) : (
          <ul className="space-y-2">
            {h.past.slice(0, 60).map((s) => {
              const by = h.completedBy.get(s.id);
              return (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-raised px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <div className="text-ink">
                      {fmtDate(s.shift_date, "EEE, MMM d, yyyy")} · {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)} · {hoursLabel(shiftHours(s))}
                    </div>
                    <div className="text-xs text-ink-3">{propName(s.property_id)}</div>
                  </div>
                  {by ? (
                    <Pill tone="green">{by === "both" ? "Completed · patrols + paid" : by === "patrol" ? "Completed · patrols logged" : "Completed · marked paid"}</Pill>
                  ) : (
                    <Pill tone="slate">No completion record</Pill>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="Replacement coverage">
        {replacementFor.length === 0 && replacedBy.length === 0 ? (
          <Empty title="No replacement coverage recorded" description="Recorded when a placement is ended with a replacement worker." />
        ) : (
          <ul className="space-y-2">
            {replacementFor.map((p) => (
              <li key={p.id} className="rounded-lg border border-line bg-raised px-4 py-3 text-sm text-ink">
                Covered for {wf.workerById.get(p.worker_id) ? `${wf.workerById.get(p.worker_id)?.first_name} ${wf.workerById.get(p.worker_id)?.last_name}` : "a worker"} at{" "}
                {(p.property_id && propName(p.property_id)) || p.property_name} from {fmtDate(p.last_shift_date ?? p.end_date)}
              </li>
            ))}
            {replacedBy.map((p) => (
              <li key={p.id} className="rounded-lg border border-line bg-raised px-4 py-3 text-sm text-ink">
                Replaced by {wf.workerById.get(p.replacement_worker_id ?? "")?.first_name ?? "another worker"} at{" "}
                {(p.property_id && propName(p.property_id)) || p.property_name}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
};
