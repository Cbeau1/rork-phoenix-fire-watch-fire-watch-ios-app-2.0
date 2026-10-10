import { useMutation } from "@tanstack/react-query";
import { CalendarCheck, ChevronDown, ChevronUp, DoorClosed, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import * as api from "@/lib/workforce/api";
import { estimatePlacementCost, rateOn } from "@/lib/workforce/calc";
import { fullName, hoursLabel, money, PLACEMENT_STATUS, type Placement } from "@/lib/workforce/constants";
import { hasOpenPlacement, shiftHours, todayKey } from "@/lib/workforce/derive";
import { cn } from "@/lib/utils";
import { useWorkforce } from "@/state/WorkforceProvider";

import { ChecklistPanel } from "./ChecklistPanel";
import { DocumentsPanel } from "./DocumentsPanel";
import {
  AreaField,
  CheckField,
  ConfirmDialog,
  DataTile,
  Empty,
  fmtDate,
  fmtDateTime,
  FormDialog,
  isDate,
  MetaPill,
  Pill,
  Restricted,
  SelectField,
  TextField,
  toNum,
} from "./kit";
import { AccessReviewDialog } from "./profile/EmploymentTab";

export const placementPropertyName = (p: Placement, byId: Map<string, { name: string }>): string =>
  (p.property_id && byId.get(p.property_id)?.name) || p.property_name || "Property removed";

/** Create or edit an agency placement. New placements get their placement checklist automatically. */
export const PlacementDialog = ({
  open,
  onOpenChange,
  placement,
  workerId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  placement: Placement | null;
  workerId?: string;
}) => {
  const wf = useWorkforce();
  const init = useMemo(
    () => ({
      worker_id: placement?.worker_id ?? workerId ?? "",
      property_id: placement?.property_id ?? "",
      start_date: placement?.start_date ?? todayKey(),
      end_date: placement?.end_date ?? "",
      agency_ref: placement?.agency_ref ?? "",
      status: placement?.status ?? "pending",
      ot_terms: placement?.ot_terms ?? "",
      holiday_terms: placement?.holiday_terms ?? "",
      notes: placement?.notes ?? "",
    }),
    [placement, workerId],
  );
  const [d, setD] = useState(init);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (open) {
      setD(init);
      setErrors({});
    }
  }, [open, init]);

  const worker = wf.workerById.get(d.worker_id);
  const agencyWorkers = wf.workers.filter((w) => w.source === "agency" && !w.archived_at);

  const save = useMutation({
    mutationFn: async () => {
      const prop = wf.propertyById.get(d.property_id);
      const row = {
        property_id: d.property_id || null,
        property_name: prop?.name ?? placement?.property_name ?? "",
        start_date: d.start_date,
        end_date: d.end_date || null,
        agency_ref: d.agency_ref.trim(),
        status: d.status,
        ot_terms: d.ot_terms.trim(),
        holiday_terms: d.holiday_terms.trim(),
        notes: d.notes.trim(),
      };
      if (placement) return api.updatePlacement(placement.id, row);
      if (!worker?.agency_id) throw new Error("This worker has no agency on their profile.");
      return api.createPlacement({ ...row, worker_id: d.worker_id, agency_id: worker.agency_id, org_id: wf.orgId });
    },
    onSuccess: async (p) => {
      if (!placement && p.status === "active" && worker && worker.status === "pending_placement") {
        await api.updateWorker(worker.id, { status: "active" }).catch(() => undefined);
      }
      wf.invalidate("placements", "checklist", "workers");
      toast.success(placement ? "Placement saved" : "Placement created with its checklist");
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save the placement."),
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={placement ? "Edit placement" : "New agency placement"}
      description="Agency bill rates are added separately (agency-financials permission)."
      dirty={JSON.stringify(d) !== JSON.stringify(init)}
      saving={save.isPending}
      onSubmit={() => {
        const e: Record<string, string> = {};
        if (!d.worker_id) e.worker_id = "Choose the agency worker.";
        else if (worker?.status === "do_not_assign") e.worker_id = "This worker has an active “Do not assign” restriction.";
        if (!d.property_id && !placement) e.property_id = "Choose the property.";
        if (!isDate(d.start_date)) e.start_date = "Start date is required.";
        if (d.end_date && d.end_date < d.start_date) e.end_date = "End date must be on or after the start date.";
        setErrors(e);
        if (Object.keys(e).length === 0) save.mutate();
      }}
      wide
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SelectField
          label="Agency worker"
          required
          value={d.worker_id}
          onChange={(v) => setD({ ...d, worker_id: v })}
          error={errors.worker_id}
          disabled={!!placement || !!workerId}
          options={agencyWorkers.map((w) => ({ value: w.id, label: `${fullName(w)} · ${wf.agencyById.get(w.agency_id ?? "")?.name ?? ""}` }))}
        />
        <DataTile label="Staffing agency">{wf.agencyById.get(placement?.agency_id ?? worker?.agency_id ?? "")?.name}</DataTile>
        <SelectField
          label="Property"
          required
          value={d.property_id}
          onChange={(v) => setD({ ...d, property_id: v })}
          error={errors.property_id}
          options={wf.properties.map((p) => ({ value: p.id, label: p.name }))}
        />
        <TextField label="Agency assignment / reference #" value={d.agency_ref} onChange={(v) => setD({ ...d, agency_ref: v })} maxLength={80} />
        <TextField label="Assignment start" required type="date" value={d.start_date} onChange={(v) => setD({ ...d, start_date: v })} error={errors.start_date} />
        <TextField label="Assignment end" type="date" value={d.end_date} onChange={(v) => setD({ ...d, end_date: v })} error={errors.end_date} hint="Leave blank if open-ended." />
        <SelectField
          label="Placement status"
          required
          value={d.status}
          onChange={(v) => setD({ ...d, status: v })}
          options={Object.entries(PLACEMENT_STATUS).map(([value, m]) => ({ value, label: m.label }))}
          hint="Use “End placement” to complete one with its end checklist."
        />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <AreaField label="Agency overtime terms" value={d.ot_terms} onChange={(v) => setD({ ...d, ot_terms: v })} rows={2} hint="As supplied by the agency. Nothing is assumed." />
        <AreaField label="Agency holiday terms" value={d.holiday_terms} onChange={(v) => setD({ ...d, holiday_terms: v })} rows={2} />
      </div>
      <AreaField label="Notes" value={d.notes} onChange={(v) => setD({ ...d, notes: v })} rows={2} />
    </FormDialog>
  );
};

const RateDialog = ({ open, onOpenChange, placement }: { open: boolean; onOpenChange: (v: boolean) => void; placement: Placement }) => {
  const wf = useWorkforce();
  const blank = { eff: placement.start_date, reg: "", ot: "", hol: "", fees: "", feesNote: "", note: "" };
  const [d, setD] = useState(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (open) {
      setD({ ...blank, eff: wf.rates.some((r) => r.placement_id === placement.id) ? todayKey() : placement.start_date });
      setErrors({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const save = useMutation({
    mutationFn: () =>
      api.addPlacementRate({
        org_id: wf.orgId,
        placement_id: placement.id,
        effective_date: d.eff,
        regular_rate: toNum(d.reg) ?? 0,
        overtime_rate: toNum(d.ot),
        holiday_rate: toNum(d.hol),
        other_fees: toNum(d.fees),
        other_fees_note: d.feesNote.trim(),
        note: d.note.trim(),
      }),
    onSuccess: () => {
      wf.invalidate("rates");
      toast.success("Agency bill rate added — earlier rates preserved");
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save."),
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add agency bill rate"
      description="What Phoenix Fire Watch pays the agency. Rates are effective-dated; past rows are never edited, so historical costs don't change."
      dirty={!!d.reg || !!d.ot || !!d.hol || !!d.fees}
      saving={save.isPending}
      onSubmit={() => {
        const e: Record<string, string> = {};
        if (!isDate(d.eff)) e.eff = "Effective date is required.";
        const reg = toNum(d.reg);
        if (reg === null || reg < 0) e.reg = "Enter the regular bill rate.";
        for (const k of ["ot", "hol", "fees"] as const) if (d[k] && (toNum(d[k]) === null || (toNum(d[k]) ?? 0) < 0)) e[k] = "Enter a valid amount or leave blank.";
        setErrors(e);
        if (Object.keys(e).length === 0) save.mutate();
      }}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField label="Effective date" required type="date" value={d.eff} onChange={(v) => setD({ ...d, eff: v })} error={errors.eff} />
        <TextField label="Regular rate ($/hr)" required inputMode="decimal" value={d.reg} onChange={(v) => setD({ ...d, reg: v })} error={errors.reg} />
        <TextField label="Overtime rate ($/hr)" inputMode="decimal" value={d.ot} onChange={(v) => setD({ ...d, ot: v })} error={errors.ot} hint="Only if supplied by the agency." />
        <TextField label="Holiday rate ($/hr)" inputMode="decimal" value={d.hol} onChange={(v) => setD({ ...d, hol: v })} error={errors.hol} hint="Only if supplied by the agency." />
        <TextField label="Other agreed fees ($)" inputMode="decimal" value={d.fees} onChange={(v) => setD({ ...d, fees: v })} error={errors.fees} />
        <TextField label="Fee description" value={d.feesNote} onChange={(v) => setD({ ...d, feesNote: v })} placeholder="e.g. Weekly admin fee" />
      </div>
      <TextField label="Note" value={d.note} onChange={(v) => setD({ ...d, note: v })} placeholder="e.g. Per rate agreement dated…" />
    </FormDialog>
  );
};

const HoursDialog = ({ open, onOpenChange, placement }: { open: boolean; onOpenChange: (v: boolean) => void; placement: Placement }) => {
  const wf = useWorkforce();
  const worker = wf.workerById.get(placement.worker_id);
  const [date, setDate] = useState<string>(todayKey());
  const [reg, setReg] = useState<string>("");
  const [ot, setOt] = useState<string>("");
  const [hol, setHol] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (open) {
      setDate(todayKey());
      setReg("");
      setOt("");
      setHol("");
      setNote("");
      setPicked(new Set());
      setErrors({});
    }
  }, [open]);

  const used = new Set(wf.hours.filter((h) => h.placement_id === placement.id && h.shift_id).map((h) => h.shift_id));
  const candidates = worker?.staff_id
    ? wf.shifts.filter(
        (s) =>
          s.staff_id === worker.staff_id &&
          !used.has(s.id) &&
          s.shift_date >= placement.start_date &&
          (!placement.end_date || s.shift_date <= placement.end_date) &&
          s.shift_date <= todayKey() &&
          (!placement.property_id || s.property_id === placement.property_id),
      )
    : [];

  const save = useMutation({
    mutationFn: async () => {
      const rows = [];
      for (const id of picked) {
        const s = wf.shifts.find((x) => x.id === id);
        if (s)
          rows.push({
            org_id: wf.orgId,
            placement_id: placement.id,
            work_date: s.shift_date,
            regular_hours: Math.round(shiftHours(s) * 100) / 100,
            shift_id: s.id,
            source: "schedule",
            note: "Approved from scheduled shift",
          });
      }
      const r = toNum(reg) ?? 0;
      const o = toNum(ot) ?? 0;
      const h = toNum(hol) ?? 0;
      if (r + o + h > 0) {
        rows.push({ org_id: wf.orgId, placement_id: placement.id, work_date: date, regular_hours: r, overtime_hours: o, holiday_hours: h, source: "manual", note: note.trim() });
      }
      return api.addHours(rows);
    },
    onSuccess: () => {
      wf.invalidate("hours");
      toast.success("Approved hours recorded");
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save."),
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Record approved hours"
      description="Approved hours drive cost estimates and invoice checks. Overtime/holiday hours are only what you enter — never inferred."
      dirty={picked.size > 0 || !!reg || !!ot || !!hol}
      saving={save.isPending}
      onSubmit={() => {
        const e: Record<string, string> = {};
        const manual = (toNum(reg) ?? 0) + (toNum(ot) ?? 0) + (toNum(hol) ?? 0);
        for (const [k, v] of [["reg", reg], ["ot", ot], ["hol", hol]] as const) {
          if (v && (toNum(v) === null || (toNum(v) ?? 0) < 0 || (toNum(v) ?? 0) > 24)) e[k] = "0–24 hours.";
        }
        if (manual > 0 && !isDate(date)) e.date = "Work date is required.";
        if (manual > 0 && (date < placement.start_date || (placement.end_date && date > placement.end_date))) e.date = "Date is outside the placement dates.";
        if (picked.size === 0 && manual === 0 && Object.keys(e).length === 0) e.reg = "Select scheduled shifts or enter hours.";
        setErrors(e);
        if (Object.keys(e).length === 0) save.mutate();
      }}
      wide
    >
      <div>
        <div className="mb-2 text-sm font-medium text-ink">From the existing schedule</div>
        {!worker?.staff_id ? (
          <p className="rounded-lg border border-line bg-raised px-3.5 py-2.5 text-sm text-ink-3">
            Link this worker to a schedule name (Edit profile) to approve hours from scheduled shifts.
          </p>
        ) : candidates.length === 0 ? (
          <p className="rounded-lg border border-line bg-raised px-3.5 py-2.5 text-sm text-ink-3">No unapproved past shifts in this placement's dates.</p>
        ) : (
          <ul className="max-h-56 space-y-1.5 overflow-y-auto">
            {candidates.map((s) => (
              <li key={s.id}>
                <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-line bg-raised px-3.5 py-2.5 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={picked.has(s.id)}
                    onChange={(e) => {
                      const n = new Set(picked);
                      if (e.target.checked) n.add(s.id);
                      else n.delete(s.id);
                      setPicked(n);
                    }}
                  />
                  <span className="flex-1 text-ink">
                    {fmtDate(s.shift_date, "EEE, MMM d")} · {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}
                  </span>
                  <span className="text-xs text-ink-2">{hoursLabel(shiftHours(s))} regular</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="text-sm font-medium text-ink">Or enter hours manually</div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <TextField label="Work date" type="date" value={date} onChange={setDate} error={errors.date} className="col-span-2 sm:col-span-1" />
        <TextField label="Regular" inputMode="decimal" value={reg} onChange={setReg} error={errors.reg} />
        <TextField label="Overtime" inputMode="decimal" value={ot} onChange={setOt} error={errors.ot} />
        <TextField label="Holiday" inputMode="decimal" value={hol} onChange={setHol} error={errors.hol} />
      </div>
      <TextField label="Note" value={note} onChange={setNote} placeholder="e.g. Agency timesheet week of…" />
    </FormDialog>
  );
};

const EndPlacementDialog = ({ open, onOpenChange, placement }: { open: boolean; onOpenChange: (v: boolean) => void; placement: Placement }) => {
  const wf = useWorkforce();
  const worker = wf.workerById.get(placement.worker_id);
  const otherOpen = hasOpenPlacement(placement.worker_id, wf.placements, placement.id);
  const [last, setLast] = useState<string>(todayKey());
  const [reason, setReason] = useState<string>("");
  const [status, setStatus] = useState<string>("completed");
  const [replacement, setReplacement] = useState<string>("");
  const [replNotes, setReplNotes] = useState<string>("");
  const [setEnded, setSetEnded] = useState<boolean>(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (open) {
      setLast(placement.end_date && placement.end_date < todayKey() ? placement.end_date : todayKey());
      setReason("");
      setStatus("completed");
      setReplacement("");
      setReplNotes("");
      setSetEnded(!otherOpen);
      setErrors({});
    }
  }, [open, placement, otherOpen]);
  const save = useMutation({
    mutationFn: async () => {
      await api.updatePlacement(placement.id, {
        status,
        last_shift_date: last,
        end_date: placement.end_date && placement.end_date < last ? placement.end_date : last,
        end_reason: reason.trim(),
        replacement_worker_id: replacement || null,
        replacement_notes: replNotes.trim(),
      });
      await api.applyChecklist("placement_end", placement.worker_id, placement.id);
      if (setEnded && !otherOpen && worker && worker.status === "active") await api.updateWorker(worker.id, { status: "assignment_ended" });
    },
    onSuccess: () => {
      wf.invalidate("placements", "checklist", "workers");
      toast.success("Placement ended — end-of-placement checklist added");
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't end the placement."),
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="End placement"
      description="Shifts, hours, documents and personnel records are preserved. The worker's app account is not disabled automatically."
      dirty={!!reason || !!replNotes}
      saving={save.isPending}
      submitLabel="End placement"
      onSubmit={() => {
        const e: Record<string, string> = {};
        if (!isDate(last)) e.last = "Last shift date is required.";
        else if (last < placement.start_date) e.last = "Must be on or after the start date.";
        if (reason.trim().length < 3) e.reason = "Give the reason the placement ended.";
        setErrors(e);
        if (Object.keys(e).length === 0) save.mutate();
      }}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField label="Last shift / date" required type="date" value={last} onChange={setLast} error={errors.last} />
        <SelectField
          label="Outcome"
          required
          value={status}
          onChange={setStatus}
          options={[
            { value: "completed", label: "Completed" },
            { value: "cancelled", label: "Cancelled" },
          ]}
        />
      </div>
      <AreaField label="Reason placement ended" required value={reason} onChange={setReason} error={errors.reason} rows={2} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SelectField
          label="Replacement worker"
          value={replacement}
          onChange={setReplacement}
          allowNone
          noneLabel="No replacement"
          options={wf.workers.filter((w) => w.id !== placement.worker_id && !w.archived_at && w.status !== "do_not_assign").map((w) => ({ value: w.id, label: fullName(w) }))}
        />
        <TextField label="Replacement details" value={replNotes} onChange={setReplNotes} />
      </div>
      {otherOpen ? (
        <p className="rounded-lg border border-line bg-raised px-3.5 py-2.5 text-sm text-ink-2">
          This worker has another pending or active placement, so their status stays unchanged.
        </p>
      ) : (
        <CheckField label="Set worker status to “Assignment ended”" checked={setEnded} onChange={setSetEnded} />
      )}
    </FormDialog>
  );
};

/** Full placement card: dates, rates, approved hours, cost estimate, checklist, documents, end flow. */
export const PlacementCard = ({ placement, showWorker, defaultOpen }: { placement: Placement; showWorker?: boolean; defaultOpen?: boolean }) => {
  const wf = useWorkforce();
  const [open, setOpen] = useState<boolean>(!!defaultOpen);
  const [edit, setEdit] = useState<boolean>(false);
  const [rateOpen, setRateOpen] = useState<boolean>(false);
  const [hoursOpen, setHoursOpen] = useState<boolean>(false);
  const [endOpen, setEndOpen] = useState<boolean>(false);
  const [reviewOpen, setReviewOpen] = useState<boolean>(false);
  const [delHours, setDelHours] = useState<string | null>(null);
  const worker = wf.workerById.get(placement.worker_id);
  const rates = wf.rates.filter((r) => r.placement_id === placement.id).sort((a, b) => b.effective_date.localeCompare(a.effective_date) || b.created_at.localeCompare(a.created_at));
  const hours = wf.hours.filter((h) => h.placement_id === placement.id);
  const currentRate = rateOn(wf.rates, placement.id, todayKey());
  const est = wf.perms.finance ? estimatePlacementCost(placement, wf.hours, wf.rates) : null;
  const scheduled = worker?.staff_id
    ? wf.shifts.filter(
        (s) =>
          s.staff_id === worker.staff_id &&
          s.shift_date >= placement.start_date &&
          (!placement.end_date || s.shift_date <= placement.end_date) &&
          (!placement.property_id || s.property_id === placement.property_id),
      )
    : null;
  const approvedTotal = hours.reduce((s, h) => s + Number(h.regular_hours) + Number(h.overtime_hours) + Number(h.holiday_hours), 0);
  const ended = placement.status === "completed" || placement.status === "cancelled";
  const account = worker?.profile_id ? wf.memberById.get(worker.profile_id) : undefined;

  const removeHours = useMutation({
    mutationFn: (id: string) => api.deleteHours(id),
    onSuccess: () => {
      wf.invalidate("hours");
      setDelHours(null);
      toast.success("Hours entry removed");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't remove."),
  });
  const review = useMutation({
    mutationFn: (note: string) => api.updatePlacement(placement.id, { access_reviewed_at: new Date().toISOString(), access_review_note: note }),
    onSuccess: () => {
      wf.invalidate("placements");
      setReviewOpen(false);
      toast.success("Access review recorded");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save."),
  });

  return (
    <div className="rounded-xl border border-line bg-surface shadow-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="focus-ring flex w-full items-start justify-between gap-3 rounded-xl px-5 py-4 text-left"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-lg font-bold text-ink">{placementPropertyName(placement, wf.propertyById)}</span>
            <MetaPill meta={PLACEMENT_STATUS} value={placement.status} />
          </div>
          <div className="mt-1 text-sm text-ink-2">
            {showWorker && worker && <>{fullName(worker)} · </>}
            {wf.agencyById.get(placement.agency_id)?.name} · {fmtDate(placement.start_date)} – {placement.end_date ? fmtDate(placement.end_date) : "open-ended"}
          </div>
        </div>
        {open ? <ChevronUp className="mt-1 h-5 w-5 shrink-0 text-ink-3" /> : <ChevronDown className="mt-1 h-5 w-5 shrink-0 text-ink-3" />}
      </button>
      {open && (
        <div className="space-y-4 border-t border-line p-3 sm:p-4">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setEdit(true)}>
              <Pencil />
              Edit
            </Button>
            <Button size="sm" variant="outline" onClick={() => setHoursOpen(true)}>
              <CalendarCheck />
              Record approved hours
            </Button>
            {wf.perms.finance && (
              <Button size="sm" variant="outline" onClick={() => setRateOpen(true)}>
                <Plus />
                Bill rate
              </Button>
            )}
            {!ended && (
              <Button size="sm" variant="ghost" onClick={() => setEndOpen(true)}>
                <DoorClosed />
                End placement
              </Button>
            )}
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            <DataTile label="Agency reference #">{placement.agency_ref}</DataTile>
            <DataTile label="Scheduled shifts">
              {scheduled === null ? <span className="text-ink-3">Worker not linked to the schedule</span> : `${scheduled.length} shift(s) · ${hoursLabel(scheduled.reduce((s, x) => s + shiftHours(x), 0))}`}
            </DataTile>
            <DataTile label="Approved hours">{hours.length === 0 ? <span className="text-ink-3">None recorded</span> : hoursLabel(Math.round(approvedTotal * 100) / 100)}</DataTile>
            <DataTile label="Confirmation document">
              {placement.confirmation_document_id ? (wf.documents.find((x) => x.id === placement.confirmation_document_id)?.title ?? "Linked (restricted)") : <span className="text-status-follow">Not uploaded</span>}
            </DataTile>
            <DataTile label="Overtime terms">{placement.ot_terms}</DataTile>
            <DataTile label="Holiday terms">{placement.holiday_terms}</DataTile>
            {placement.notes && <DataTile label="Notes" className="sm:col-span-2">{placement.notes}</DataTile>}
          </div>

          <div className="rounded-lg border border-line bg-raised p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-ink">Agency bill rates & estimated cost</h4>
              <span className="text-xs text-ink-3">Separate from employee wages and client billing</span>
            </div>
            {!wf.perms.finance ? (
              <div className="mt-2">
                <Restricted what="Agency bill rates and cost estimates" />
              </div>
            ) : (
              <>
                <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
                  <div className="rounded-md border border-line bg-surface px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wider text-ink-3">Regular</div>
                    <div className="text-sm font-medium text-ink">{currentRate ? `${money(Number(currentRate.regular_rate))}/hr` : "—"}</div>
                  </div>
                  <div className="rounded-md border border-line bg-surface px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wider text-ink-3">Overtime</div>
                    <div className="text-sm font-medium text-ink">{currentRate?.overtime_rate != null ? `${money(Number(currentRate.overtime_rate))}/hr` : "Not supplied"}</div>
                  </div>
                  <div className="rounded-md border border-line bg-surface px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wider text-ink-3">Holiday</div>
                    <div className="text-sm font-medium text-ink">{currentRate?.holiday_rate != null ? `${money(Number(currentRate.holiday_rate))}/hr` : "Not supplied"}</div>
                  </div>
                  <div className="rounded-md border border-line bg-surface px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wider text-ink-3">Other fees</div>
                    <div className="text-sm font-medium text-ink">{currentRate?.other_fees != null ? money(Number(currentRate.other_fees)) : "—"}</div>
                  </div>
                </div>
                {est && (
                  <div className={cn("mt-3 rounded-md border px-3 py-2.5", est.complete ? "border-line bg-surface" : "border-status-follow/50 bg-status-follow/10")}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-sm text-ink">
                        Estimated agency cost <Pill tone={est.complete ? "blue" : "amber"}>{est.complete ? "Estimate — not reconciled" : "Incomplete"}</Pill>
                      </span>
                      <span className="font-display text-xl font-bold tabular-nums text-ink">{money(est.estimate)}</span>
                    </div>
                    <div className="mt-1 text-xs text-ink-2">
                      {hoursLabel(est.regularHours)} regular · {hoursLabel(est.overtimeHours)} OT · {hoursLabel(est.holidayHours)} holiday (approved hours only)
                    </div>
                    {est.issues.length > 0 && (
                      <ul className="mt-1.5 list-disc pl-5 text-xs text-status-follow">
                        {est.issues.map((i) => (
                          <li key={i}>{i}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                {rates.length > 0 && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs font-medium text-ink-2">Rate history ({rates.length})</summary>
                    <ul className="mt-2 space-y-1.5">
                      {rates.map((r) => (
                        <li key={r.id} className="rounded-md border border-line bg-surface px-3 py-2 text-xs text-ink-2">
                          <span className="font-medium text-ink">From {fmtDate(r.effective_date)}:</span> {money(Number(r.regular_rate))} reg
                          {r.overtime_rate != null && ` · ${money(Number(r.overtime_rate))} OT`}
                          {r.holiday_rate != null && ` · ${money(Number(r.holiday_rate))} holiday`}
                          {r.other_fees != null && ` · ${money(Number(r.other_fees))} fees${r.other_fees_note ? ` (${r.other_fees_note})` : ""}`}
                          {r.note && ` — ${r.note}`} · added by {wf.memberName(r.created_by)}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            )}
          </div>

          {hours.length > 0 && (
            <details className="rounded-lg border border-line bg-raised p-3.5">
              <summary className="cursor-pointer text-sm font-semibold text-ink">Approved hours ({hours.length} entries)</summary>
              <ul className="mt-2 space-y-1.5">
                {hours
                  .slice()
                  .sort((a, b) => b.work_date.localeCompare(a.work_date))
                  .map((h) => (
                    <li key={h.id} className="flex items-center justify-between gap-2 rounded-md border border-line bg-surface px-3 py-2 text-xs">
                      <span className="text-ink">
                        {fmtDate(h.work_date, "EEE, MMM d, yyyy")} · {Number(h.regular_hours)}h reg
                        {Number(h.overtime_hours) > 0 && ` · ${Number(h.overtime_hours)}h OT`}
                        {Number(h.holiday_hours) > 0 && ` · ${Number(h.holiday_hours)}h holiday`}
                        <span className="text-ink-3"> · {h.source === "schedule" ? "from schedule" : "manual"} · {wf.memberName(h.approved_by)}</span>
                      </span>
                      <Button variant="ghost" size="icon" aria-label="Remove hours entry" onClick={() => setDelHours(h.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </li>
                  ))}
              </ul>
            </details>
          )}

          <ChecklistPanel kind="placement" workerId={placement.worker_id} placementId={placement.id} title="Placement checklist" compact />

          <DocumentsPanel
            ownerType="placement"
            ownerId={placement.id}
            filter={(d) => d.placement_id === placement.id}
            title="Placement documents"
            compact
          />

          {ended && (
            <div className="space-y-3 rounded-lg border border-line bg-raised p-3.5">
              <h4 className="text-sm font-semibold text-ink">Placement ended</h4>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <DataTile label="Last shift / date">{placement.last_shift_date ? fmtDate(placement.last_shift_date) : ""}</DataTile>
                <DataTile label="Reason">{placement.end_reason}</DataTile>
                <DataTile label="Replacement">
                  {placement.replacement_worker_id ? (
                    <Link className="text-link hover:underline" to={`/workforce/workers/${placement.replacement_worker_id}`}>
                      {fullName(wf.workerById.get(placement.replacement_worker_id) ?? { first_name: "Worker", last_name: "" })}
                    </Link>
                  ) : null}
                  {placement.replacement_notes && <div className="text-xs text-ink-2">{placement.replacement_notes}</div>}
                </DataTile>
                <DataTile label="App access review">
                  {placement.access_reviewed_at ? (
                    <>
                      {fmtDateTime(placement.access_reviewed_at)} — {placement.access_review_note}
                    </>
                  ) : (
                    <span className="text-status-follow">Not reviewed{account ? ` (${account.full_name} is ${account.active ? "active" : "inactive"})` : ""}</span>
                  )}
                </DataTile>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setReviewOpen(true)}>
                  <ShieldCheck />
                  Record access review
                </Button>
                {account?.active && (
                  <Button asChild size="sm" variant="ghost">
                    <Link to="/team">Team page (deactivate account)</Link>
                  </Button>
                )}
              </div>
              <ChecklistPanel kind="placement_end" workerId={placement.worker_id} placementId={placement.id} title="End-of-placement checklist" compact />
            </div>
          )}
        </div>
      )}

      <PlacementDialog open={edit} onOpenChange={setEdit} placement={placement} />
      {wf.perms.finance && <RateDialog open={rateOpen} onOpenChange={setRateOpen} placement={placement} />}
      <HoursDialog open={hoursOpen} onOpenChange={setHoursOpen} placement={placement} />
      <EndPlacementDialog open={endOpen} onOpenChange={setEndOpen} placement={placement} />
      <AccessReviewDialog open={reviewOpen} onOpenChange={setReviewOpen} onSave={(n) => review.mutate(n)} saving={review.isPending} />
      <ConfirmDialog
        open={!!delHours}
        onOpenChange={(o) => !o && setDelHours(null)}
        title="Remove this hours entry?"
        description="Cost estimates and invoice checks will update. The removal is recorded in the audit log."
        confirmLabel="Remove"
        destructive
        busy={removeHours.isPending}
        onConfirm={() => delHours && removeHours.mutate(delHours)}
      />
    </div>
  );
};

export const PlacementsTab = ({ workerId }: { workerId: string }) => {
  const wf = useWorkforce();
  const [addOpen, setAddOpen] = useState<boolean>(false);
  const worker = wf.workerById.get(workerId);
  const list = wf.placements.filter((p) => p.worker_id === workerId);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-2">Each placement has its own checklist, rates and documents. Employee hiring and payroll paperwork isn't required.</p>
        <Button onClick={() => setAddOpen(true)} disabled={!!worker?.archived_at || worker?.status === "do_not_assign"}>
          <Plus />
          New placement
        </Button>
      </div>
      {list.length === 0 ? (
        <Empty title="No placements yet" description="Create a placement to link this worker to a property with agency terms." />
      ) : (
        list.map((p, i) => <PlacementCard key={p.id} placement={p} defaultOpen={i === 0} />)
      )}
      <PlacementDialog open={addOpen} onOpenChange={setAddOpen} placement={null} workerId={workerId} />
    </div>
  );
};
