import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DoorOpen, Pencil, Plus, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ChecklistPanel } from "@/components/workforce/ChecklistPanel";
import {
  AreaField,
  CheckField,
  DataTile,
  Empty,
  ErrorBlock,
  fmtDate,
  fmtDateTime,
  FormDialog,
  isDate,
  Loading,
  Pill,
  Restricted,
  SectionCard,
  SelectField,
  TextField,
  toNum,
} from "@/components/workforce/kit";
import * as api from "@/lib/workforce/api";
import { EMPLOYMENT_TYPES, money, type Employment, type Worker } from "@/lib/workforce/constants";
import { todayKey } from "@/lib/workforce/derive";
import { useWorkforce } from "@/state/WorkforceProvider";

const EmploymentDialog = ({
  open,
  onOpenChange,
  worker,
  emp,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  worker: Worker;
  emp: Employment | null;
}) => {
  const wf = useWorkforce();
  const init = useMemo(
    () => ({
      employment_type: emp?.employment_type ?? "",
      supervisor: emp?.supervisor ?? "",
      start_date: emp?.start_date ?? worker.start_date ?? "",
      end_date: emp?.end_date ?? "",
      notes: emp?.notes ?? "",
    }),
    [emp, worker.start_date],
  );
  const [d, setD] = useState(init);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (open) {
      setD(init);
      setErrors({});
    }
  }, [open, init]);
  const save = useMutation({
    mutationFn: () =>
      api.saveEmployment(worker.id, wf.orgId, {
        employment_type: d.employment_type,
        supervisor: d.supervisor.trim(),
        start_date: d.start_date || null,
        end_date: d.end_date || null,
        notes: d.notes.trim(),
      }),
    onSuccess: () => {
      wf.invalidate("employment");
      toast.success("Employment information saved");
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save."),
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Employment information"
      description="Changes here don't alter past payroll, client invoices or billing."
      dirty={JSON.stringify(d) !== JSON.stringify(init)}
      saving={save.isPending}
      onSubmit={() => {
        const e: Record<string, string> = {};
        if (d.start_date && !isDate(d.start_date)) e.start_date = "Use a valid date.";
        if (d.end_date && d.start_date && d.end_date < d.start_date) e.end_date = "End date must be after the start date.";
        setErrors(e);
        if (Object.keys(e).length === 0) save.mutate();
      }}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SelectField
          label="Employment type"
          value={d.employment_type}
          onChange={(v) => setD({ ...d, employment_type: v })}
          allowNone
          noneLabel="Not specified"
          options={EMPLOYMENT_TYPES.map((t) => ({ value: t, label: t }))}
        />
        <TextField label="Supervisor" value={d.supervisor} onChange={(v) => setD({ ...d, supervisor: v })} maxLength={120} />
        <TextField label="Start date" type="date" value={d.start_date} onChange={(v) => setD({ ...d, start_date: v })} error={errors.start_date} />
        <TextField label="End date" type="date" value={d.end_date} onChange={(v) => setD({ ...d, end_date: v })} error={errors.end_date} />
      </div>
      <AreaField label="Administrative employment notes" value={d.notes} onChange={(v) => setD({ ...d, notes: v })} rows={4} hint="Don't enter Social Security numbers or bank details." />
    </FormDialog>
  );
};

const PayDialog = ({ open, onOpenChange, worker }: { open: boolean; onOpenChange: (v: boolean) => void; worker: Worker }) => {
  const wf = useWorkforce();
  const queryClient = useQueryClient();
  const [rate, setRate] = useState<string>("");
  const [eff, setEff] = useState<string>(todayKey());
  const [note, setNote] = useState<string>("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (open) {
      setRate("");
      setEff(todayKey());
      setNote("");
      setErrors({});
    }
  }, [open]);
  const save = useMutation({
    mutationFn: () => api.addPay(worker.id, toNum(rate) ?? 0, eff, note.trim()),
    onSuccess: () => {
      wf.invalidate("pay");
      void queryClient.invalidateQueries({ queryKey: ["tc"] });
      toast.success("Pay rate added — history preserved");
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save."),
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add pay rate"
      description="Adds a new effective-dated rate. Earlier rates are kept as history and never edited."
      dirty={!!rate || !!note}
      saving={save.isPending}
      onSubmit={() => {
        const e: Record<string, string> = {};
        const n = toNum(rate);
        if (n === null || n <= 0) e.rate = "Enter an hourly rate above zero.";
        if (!isDate(eff)) e.eff = "Effective date is required.";
        setErrors(e);
        if (Object.keys(e).length === 0) save.mutate();
      }}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField label="Hourly pay rate (USD)" required inputMode="decimal" value={rate} onChange={setRate} error={errors.rate} placeholder="22.50" />
        <TextField label="Effective date" required type="date" value={eff} onChange={setEff} error={errors.eff} />
      </div>
      <TextField label="Note" value={note} onChange={setNote} placeholder="e.g. Annual review" maxLength={300} />
    </FormDialog>
  );
};

const OffboardDialog = ({
  open,
  onOpenChange,
  worker,
  emp,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  worker: Worker;
  emp: Employment | null;
}) => {
  const wf = useWorkforce();
  const [end, setEnd] = useState<string>(todayKey());
  const [reason, setReason] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [terminate, setTerminate] = useState<boolean>(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (open) {
      setEnd(emp?.end_date ?? todayKey());
      setReason(emp?.separation_reason ?? "");
      setNotes(emp?.separation_notes ?? "");
      setTerminate(worker.status !== "terminated");
      setErrors({});
    }
  }, [open, emp, worker.status]);
  const save = useMutation({
    mutationFn: async () => {
      await api.saveEmployment(worker.id, wf.orgId, { end_date: end, separation_reason: reason, separation_notes: notes.trim() });
      await api.applyChecklist("direct_offboarding", worker.id);
      if (terminate && worker.status !== "terminated") await api.updateWorker(worker.id, { status: "terminated" });
    },
    onSuccess: () => {
      wf.invalidate("employment", "checklist", "workers");
      toast.success("Offboarding started");
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save."),
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Offboard employee"
      description="Records the separation and adds the offboarding checklist. Shifts, reports, documents and records are preserved. The linked app account is NOT disabled automatically."
      dirty={!!reason || !!notes}
      saving={save.isPending}
      submitLabel="Start offboarding"
      onSubmit={() => {
        const e: Record<string, string> = {};
        if (!isDate(end)) e.end = "End date is required.";
        if (!reason) e.reason = "Choose a separation reason.";
        setErrors(e);
        if (Object.keys(e).length === 0) save.mutate();
      }}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField label="End date" required type="date" value={end} onChange={setEnd} error={errors.end} />
        <SelectField
          label="Separation reason"
          required
          value={reason}
          onChange={setReason}
          error={errors.reason}
          options={["Resignation", "End of contract / season", "Termination", "Retirement", "Job abandonment", "Other"].map((v) => ({ value: v, label: v }))}
        />
      </div>
      <AreaField label="Separation notes" value={notes} onChange={setNotes} rows={3} />
      <CheckField label="Set status to Terminated" checked={terminate} onChange={setTerminate} hint="Leave unchecked to keep the current status until offboarding is finished." />
    </FormDialog>
  );
};

const AccessReviewDialog = ({
  open,
  onOpenChange,
  onSave,
  saving,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSave: (note: string) => void;
  saving: boolean;
}) => {
  const [note, setNote] = useState<string>("");
  const [err, setErr] = useState<string>("");
  useEffect(() => {
    if (open) {
      setNote("");
      setErr("");
    }
  }, [open]);
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Record app-access review"
      description="Document what was decided. To disable the account, use the Team page — that's a separate, explicit action."
      dirty={!!note}
      saving={saving}
      onSubmit={() => {
        if (note.trim().length < 3) {
          setErr("Describe the decision (e.g. “Account deactivated on Team page”).");
          return;
        }
        onSave(note.trim());
      }}
    >
      <AreaField label="Review decision" required value={note} onChange={setNote} error={err} rows={3} />
    </FormDialog>
  );
};

/** Exported so the placement end flow can reuse the same access-review dialog. */
export { AccessReviewDialog };

/** Effective-dated hourly pay history for any worker (direct or agency). */
export const PayRatesCard = ({ worker }: { worker: Worker }) => {
  const wf = useWorkforce();
  const [payOpen, setPayOpen] = useState<boolean>(false);
  const payQ = useQuery({ queryKey: ["wf", "pay", worker.id], enabled: wf.perms.pay, queryFn: () => api.listPay(worker.id) });
  const pay = payQ.data ?? [];
  const today = todayKey();
  const current = pay.filter((p) => p.effective_date <= today).sort((a, b) => b.effective_date.localeCompare(a.effective_date))[0];
  return (
    <>
      <SectionCard
        title="Pay-rate history"
        subtitle={worker.source === "agency" ? "What this worker earns per hour — used for gross pay on the Payroll tab. Separate from what the agency bills you." : "Used for gross pay on the Payroll tab. Earlier rates are kept as history."}
        action={
          wf.perms.pay ? (
            <Button size="sm" onClick={() => setPayOpen(true)}>
              <Plus />
              Add rate
            </Button>
          ) : undefined
        }
      >
        {!wf.perms.pay ? (
          <Restricted what="Employee pay information" />
        ) : payQ.isLoading ? (
          <Loading />
        ) : payQ.error ? (
          <ErrorBlock message={(payQ.error as Error).message} onRetry={() => void payQ.refetch()} />
        ) : pay.length === 0 ? (
          <Empty title="No pay rates recorded" />
        ) : (
          <ul className="space-y-2">
            {pay.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-raised px-4 py-3">
                <div>
                  <span className="font-display text-lg font-bold tabular-nums text-ink">{money(Number(p.hourly_rate))}</span>
                  <span className="text-sm text-ink-3"> / hr</span>
                  {p.id === current?.id && <Pill tone="green" className="ml-2">Current</Pill>}
                  {p.effective_date > today && <Pill tone="blue" className="ml-2">Scheduled</Pill>}
                  {p.note && <div className="text-xs text-ink-2">{p.note}</div>}
                </div>
                <div className="text-right text-xs text-ink-3">
                  Effective {fmtDate(p.effective_date)}
                  <div>Added by {wf.memberName(p.created_by)}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
      <PayDialog open={payOpen} onOpenChange={setPayOpen} worker={worker} />
    </>
  );
};

export const EmploymentTab = ({ worker }: { worker: Worker }) => {
  const wf = useWorkforce();
  const [editOpen, setEditOpen] = useState<boolean>(false);
  const [offOpen, setOffOpen] = useState<boolean>(false);
  const [reviewOpen, setReviewOpen] = useState<boolean>(false);

  const empQ = useQuery({ queryKey: ["wf", "employment", worker.id], queryFn: () => api.getEmployment(worker.id) });
  const payQ = useQuery({ queryKey: ["wf", "pay", worker.id], enabled: wf.perms.pay, queryFn: () => api.listPay(worker.id) });
  const emp = empQ.data ?? null;
  const pay = payQ.data ?? [];
  const today = todayKey();
  const current = pay.filter((p) => p.effective_date <= today).sort((a, b) => b.effective_date.localeCompare(a.effective_date))[0];

  const review = useMutation({
    mutationFn: (note: string) =>
      api.saveEmployment(worker.id, wf.orgId, { access_reviewed_at: new Date().toISOString(), access_review_note: note }),
    onSuccess: () => {
      wf.invalidate("employment");
      setReviewOpen(false);
      toast.success("Access review recorded");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save."),
  });
  const archiveFiles = useMutation({
    mutationFn: () => api.saveEmployment(worker.id, wf.orgId, { files_archived_at: new Date().toISOString() }),
    onSuccess: () => {
      wf.invalidate("employment");
      toast.success("Personnel file marked archived");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save."),
  });

  if (empQ.isLoading) return <Loading />;
  if (empQ.error) return <ErrorBlock message={(empQ.error as Error).message} onRetry={() => void empQ.refetch()} />;

  const offboarding = !!emp?.separation_reason || wf.checklist.some((c) => c.worker_id === worker.id && c.kind === "direct_offboarding");
  const account = worker.profile_id ? wf.memberById.get(worker.profile_id) : undefined;
  const outstandingEquip = wf.equipment.filter((e) => e.worker_id === worker.id && e.status === "issued");

  return (
    <div className="space-y-5">
      <SectionCard
        title="Employment"
        action={
          <>
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil />
              Edit
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setOffOpen(true)}>
              <DoorOpen />
              {offboarding ? "Update offboarding" : "Offboard"}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          <DataTile label="Position">{worker.position}</DataTile>
          <DataTile label="Employment type">{emp?.employment_type}</DataTile>
          <DataTile label="Supervisor">{emp?.supervisor}</DataTile>
          <DataTile label="Start date">{emp?.start_date ? fmtDate(emp.start_date) : ""}</DataTile>
          <DataTile label="End date">{emp?.end_date ? fmtDate(emp.end_date) : ""}</DataTile>
          <DataTile label="Current hourly pay rate">
            {wf.perms.pay ? (payQ.isLoading ? "…" : current ? money(Number(current.hourly_rate)) : "") : <span className="text-ink-3">Restricted</span>}
          </DataTile>
          <DataTile label="Administrative notes" className="sm:col-span-2 lg:col-span-3">
            {emp?.notes ? <span className="whitespace-pre-line">{emp.notes}</span> : null}
          </DataTile>
        </div>
      </SectionCard>

      <PayRatesCard worker={worker} />

      <ChecklistPanel kind="direct" workerId={worker.id} />

      {offboarding && (
        <>
          <SectionCard title="Offboarding" subtitle="Historical shifts, patrol reports, documents and personnel records are always preserved.">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              <DataTile label="End date">{emp?.end_date ? fmtDate(emp.end_date) : ""}</DataTile>
              <DataTile label="Separation reason">{emp?.separation_reason}</DataTile>
              <DataTile label="Equipment outstanding">
                {outstandingEquip.length === 0 ? "All returned" : `${outstandingEquip.length} item(s) still issued — see Equipment tab`}
              </DataTile>
              <DataTile label="Separation notes" className="sm:col-span-2 lg:col-span-3">
                {emp?.separation_notes ? <span className="whitespace-pre-line">{emp.separation_notes}</span> : null}
              </DataTile>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2.5 lg:grid-cols-2">
              <div className="rounded-lg border border-line bg-raised px-4 py-3">
                <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-3">Linked app account access</div>
                <p className="mt-1 text-sm text-ink">
                  {account ? `${account.full_name} — ${account.active ? "still active" : "deactivated"}` : "No linked account"}
                </p>
                {emp?.access_reviewed_at ? (
                  <p className="mt-1 text-xs text-ink-2">
                    Reviewed {fmtDateTime(emp.access_reviewed_at)}: {emp.access_review_note}
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-status-follow">Access not yet reviewed.</p>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => setReviewOpen(true)}>
                    <ShieldCheck />
                    Record review
                  </Button>
                  {account && account.active && (
                    <Button asChild size="sm" variant="ghost">
                      <Link to="/team">Open Team page to deactivate</Link>
                    </Button>
                  )}
                </div>
              </div>
              <div className="rounded-lg border border-line bg-raised px-4 py-3">
                <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-3">File archival</div>
                <p className="mt-1 text-sm text-ink">
                  {emp?.files_archived_at ? `Personnel file archived ${fmtDate(emp.files_archived_at)}` : "Personnel file not yet archived."}
                </p>
                {!emp?.files_archived_at && (
                  <Button size="sm" variant="outline" className="mt-2" onClick={() => archiveFiles.mutate()} disabled={archiveFiles.isPending}>
                    Mark file archived
                  </Button>
                )}
                <p className="mt-2 text-xs text-ink-3">Archive the whole profile from the header when offboarding is complete.</p>
              </div>
            </div>
          </SectionCard>
          <ChecklistPanel kind="direct_offboarding" workerId={worker.id} />
        </>
      )}

      <EmploymentDialog open={editOpen} onOpenChange={setEditOpen} worker={worker} emp={emp} />
      <OffboardDialog open={offOpen} onOpenChange={setOffOpen} worker={worker} emp={emp} />
      <AccessReviewDialog open={reviewOpen} onOpenChange={setReviewOpen} onSave={(n) => review.mutate(n)} saving={review.isPending} />
    </div>
  );
};
