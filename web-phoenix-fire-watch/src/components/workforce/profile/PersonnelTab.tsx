import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, History, Lock, Pencil, Plus, RotateCcw, ShieldOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DocumentsPanel } from "@/components/workforce/DocumentsPanel";
import {
  AreaField,
  CheckField,
  DataTile,
  Empty,
  ErrorBlock,
  fmtDate,
  fmtDateTime,
  FormDialog,
  Loading,
  MetaPill,
  Pill,
  Restricted,
  SectionCard,
  SelectField,
  TextField,
} from "@/components/workforce/kit";
import * as api from "@/lib/workforce/api";
import {
  fullName,
  PERSONNEL_STATUS,
  PERSONNEL_TYPE,
  WORKER_STATUS,
  type PersonnelRecord,
  type Worker,
} from "@/lib/workforce/constants";
import { useWorkforce } from "@/state/WorkforceProvider";

type Draft = Record<string, string | boolean>;

const blank = (r: PersonnelRecord | null): Draft => ({
  record_type: r?.record_type ?? "coaching",
  title: r?.title ?? "",
  event_at: r?.event_at ? r.event_at.slice(0, 16) : "",
  property_id: r?.property_id ?? "",
  shift_id: r?.shift_id ?? "",
  reporting_person: r?.reporting_person ?? "",
  allegation: r?.allegation ?? "",
  observations: r?.observations ?? "",
  worker_response: r?.worker_response ?? "",
  findings: r?.findings ?? "",
  outcome: r?.outcome ?? "",
  action_taken: r?.action_taken ?? "",
  followup_owner: r?.followup_owner ?? "",
  followup_due: r?.followup_due ?? "",
  status: r?.status ?? "draft",
  agency_contact_notified: r?.agency_contact_notified ?? "",
  agency_notified_at: r?.agency_notified_at ? r.agency_notified_at.slice(0, 16) : "",
  agency_notify_method: r?.agency_notify_method ?? "",
  agency_response: r?.agency_response ?? "",
  replacement_requested: r?.replacement_requested ?? false,
  replacement_worker_id: r?.replacement_worker_id ?? "",
  agency_followup_status: r?.agency_followup_status ?? "",
});

const RecordDialog = ({
  open,
  onOpenChange,
  worker,
  record,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  worker: Worker;
  record: PersonnelRecord | null;
}) => {
  const wf = useWorkforce();
  const qc = useQueryClient();
  const init = useMemo(() => blank(record), [record]);
  const [d, setD] = useState<Draft>(init);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (open) {
      setD(init);
      setErrors({});
    }
  }, [open, init]);
  const s = (k: string) => String(d[k] ?? "");
  const set = (k: string) => (v: string | boolean) => setD((p) => ({ ...p, [k]: v }));
  const isAgency = worker.source === "agency";

  const shifts = worker.staff_id
    ? wf.shifts.filter((x) => x.staff_id === worker.staff_id && (!s("property_id") || x.property_id === s("property_id"))).slice(0, 60)
    : [];

  const save = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = { ...d, worker_id: worker.id, title: s("title").trim() };
      for (const k of ["event_at", "agency_notified_at"]) payload[k] = s(k) ? new Date(s(k)).toISOString() : "";
      return api.savePersonnel(record?.id ?? null, payload);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["wf", "personnel", worker.id] });
      wf.invalidate("followups");
      toast.success(record ? "Record updated — revision saved" : "Personnel record created");
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save."),
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={record ? "Edit personnel record" : "New personnel record"}
      description="Confidential. Never included in client reports, officer reports or the mobile apps."
      dirty={JSON.stringify(d) !== JSON.stringify(init)}
      saving={save.isPending}
      onSubmit={() => {
        const e: Record<string, string> = {};
        if (!s("title").trim()) e.title = "Title is required.";
        if (d.status === "closed" && !s("outcome").trim() && !s("action_taken").trim()) e.outcome = "Record the outcome or action before closing.";
        if (s("followup_due") && !s("followup_owner")) e.followup_owner = "Assign a follow-up owner.";
        setErrors(e);
        if (Object.keys(e).length === 0) save.mutate();
      }}
      wide
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SelectField label="Record type" required value={s("record_type")} onChange={set("record_type")} options={Object.entries(PERSONNEL_TYPE).map(([value, label]) => ({ value, label }))} />
        <TextField label="Title" required value={s("title")} onChange={set("title")} error={errors.title} maxLength={200} />
        <TextField label="Event date & time" type="datetime-local" value={s("event_at")} onChange={set("event_at")} />
        <TextField label="Reporting person" value={s("reporting_person")} onChange={set("reporting_person")} />
        <SelectField
          label="Related property"
          value={s("property_id")}
          onChange={set("property_id")}
          allowNone
          noneLabel="None"
          options={wf.properties.map((p) => ({ value: p.id, label: p.name }))}
        />
        <SelectField
          label="Related shift"
          value={s("shift_id")}
          onChange={set("shift_id")}
          allowNone
          noneLabel="None"
          disabled={shifts.length === 0}
          options={shifts.map((x) => ({ value: x.id, label: `${fmtDate(x.shift_date, "MMM d, yyyy")} · ${x.start_time.slice(0, 5)}–${x.end_time.slice(0, 5)}` }))}
          hint={worker.staff_id ? undefined : "Link the worker to the schedule to choose a shift."}
        />
      </div>
      <AreaField label="Reported concern or allegation" value={s("allegation")} onChange={set("allegation")} rows={3} hint="What was reported — not a finding." />
      <AreaField label="Firsthand observations" value={s("observations")} onChange={set("observations")} rows={3} hint="What you or a witness directly observed." />
      <AreaField label="Employee / worker response" value={s("worker_response")} onChange={set("worker_response")} rows={3} />
      <AreaField label="Findings" value={s("findings")} onChange={set("findings")} rows={3} hint="Conclusions reached after review." />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <AreaField label="Outcome" value={s("outcome")} onChange={set("outcome")} rows={2} error={errors.outcome} />
        <AreaField label="Action taken" value={s("action_taken")} onChange={set("action_taken")} rows={2} />
        <SelectField
          label="Follow-up owner"
          value={s("followup_owner")}
          onChange={set("followup_owner")}
          allowNone
          noneLabel="None"
          error={errors.followup_owner}
          options={wf.admins.map((m) => ({ value: m.id, label: m.full_name }))}
        />
        <TextField label="Follow-up due" type="date" value={s("followup_due")} onChange={set("followup_due")} />
        <SelectField label="Status" required value={s("status")} onChange={set("status")} options={Object.entries(PERSONNEL_STATUS).map(([value, m]) => ({ value, label: m.label }))} hint="Closed records must be explicitly reopened (with a reason) before editing." />
      </div>

      {isAgency && (
        <div className="space-y-4 rounded-lg border border-line bg-raised p-4">
          <div>
            <div className="text-sm font-semibold text-ink">Agency communication</div>
            <p className="text-xs text-ink-3">For record keeping only — no emails or texts are sent.</p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField label="Agency contact notified" value={s("agency_contact_notified")} onChange={set("agency_contact_notified")} />
            <TextField label="Notification date & time" type="datetime-local" value={s("agency_notified_at")} onChange={set("agency_notified_at")} />
            <SelectField
              label="Notification method"
              value={s("agency_notify_method")}
              onChange={set("agency_notify_method")}
              allowNone
              noneLabel="Not recorded"
              options={["Phone", "Email", "Text", "In person", "Agency portal"].map((v) => ({ value: v, label: v }))}
            />
            <SelectField
              label="Agency follow-up status"
              value={s("agency_followup_status")}
              onChange={set("agency_followup_status")}
              allowNone
              noneLabel="Not set"
              options={["Awaiting agency response", "Agency responded", "Resolved with agency", "Escalated"].map((v) => ({ value: v, label: v }))}
            />
          </div>
          <AreaField label="Summary of agency response" value={s("agency_response")} onChange={set("agency_response")} rows={2} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <CheckField label="Replacement requested" checked={!!d.replacement_requested} onChange={set("replacement_requested")} />
            <SelectField
              label="Replacement worker"
              value={s("replacement_worker_id")}
              onChange={set("replacement_worker_id")}
              allowNone
              noneLabel="None"
              options={wf.workers.filter((w) => w.id !== worker.id && !w.archived_at).map((w) => ({ value: w.id, label: fullName(w) }))}
            />
          </div>
        </div>
      )}
    </FormDialog>
  );
};

const HistoryDialog = ({ record, onClose }: { record: PersonnelRecord | null; onClose: () => void }) => {
  const wf = useWorkforce();
  const q = useQuery({ queryKey: ["wf", "personnel-history", record?.id], enabled: !!record, queryFn: () => api.personnelHistory(record?.id ?? "") });
  return (
    <Dialog open={!!record} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto border-line bg-surface text-ink sm:max-w-2xl sm:rounded-xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Revision history</DialogTitle>
          <DialogDescription className="text-ink-2">{record?.title} — every save is preserved.</DialogDescription>
        </DialogHeader>
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <ErrorBlock message={(q.error as Error).message} />
        ) : (
          <ol className="space-y-2">
            {(q.data ?? []).map((r) => {
              const snap = r.snapshot as Record<string, unknown>;
              return (
                <li key={r.id} className="rounded-lg border border-line bg-raised px-4 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                    <span className="font-medium text-ink">
                      Revision {r.revision} · <span className="capitalize">{r.action}</span>
                    </span>
                    <span className="text-xs text-ink-3">{fmtDateTime(r.changed_at)}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-ink-2">
                    {r.changed_by_name || wf.memberName(r.changed_by)}
                    {r.changed_fields.length > 0 && <> · Changed: {r.changed_fields.map((f) => f.replace(/_/g, " ")).join(", ")}</>}
                  </div>
                  {r.note && <p className="mt-1 text-xs text-ink">Reason: {r.note}</p>}
                  <details className="mt-1.5">
                    <summary className="cursor-pointer text-xs text-ink-3">View snapshot</summary>
                    <dl className="mt-2 grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
                      {["status", "allegation", "observations", "worker_response", "findings", "outcome", "action_taken", "followup_due"].map((k) => (
                        <div key={k} className="rounded-md border border-line bg-surface px-2.5 py-1.5">
                          <dt className="capitalize text-ink-3">{k.replace(/_/g, " ")}</dt>
                          <dd className="whitespace-pre-line text-ink">{String(snap[k] ?? "") || "—"}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                </li>
              );
            })}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
};

const ReasonDialog = ({
  open,
  onOpenChange,
  title,
  description,
  label,
  min = 3,
  saving,
  onSave,
  extra,
  submitLabel,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  label: string;
  min?: number;
  saving: boolean;
  onSave: (text: string) => void;
  extra?: React.ReactNode;
  submitLabel?: string;
}) => {
  const [text, setText] = useState<string>("");
  const [err, setErr] = useState<string>("");
  useEffect(() => {
    if (open) {
      setText("");
      setErr("");
    }
  }, [open]);
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      dirty={!!text}
      saving={saving}
      submitLabel={submitLabel}
      onSubmit={() => {
        if (text.trim().length < min) {
          setErr(min > 3 ? "Please document this fully (at least a full sentence)." : "A reason is required.");
          return;
        }
        onSave(text.trim());
      }}
    >
      <AreaField label={label} required value={text} onChange={setText} error={err} rows={4} />
      {extra}
    </FormDialog>
  );
};

const RestrictionSection = ({ worker }: { worker: Worker }) => {
  const wf = useWorkforce();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["wf", "restrictions", worker.id], queryFn: () => api.listRestrictions(worker.id) });
  const [addOpen, setAddOpen] = useState<boolean>(false);
  const [review, setReview] = useState<{ id: string; decision: "maintained" | "lifted" } | null>(null);
  const [newStatus, setNewStatus] = useState<string>("pending_placement");
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["wf", "restrictions", worker.id] });
    wf.invalidate("workers");
  };
  const add = useMutation({
    mutationFn: (reason: string) => api.addRestriction(worker.id, reason),
    onSuccess: () => {
      refresh();
      setAddOpen(false);
      toast.success("“Do not assign” restriction recorded");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save."),
  });
  const rev = useMutation({
    mutationFn: (note: string) => api.reviewRestriction(review?.id ?? "", review?.decision ?? "maintained", note, review?.decision === "lifted" ? newStatus : undefined),
    onSuccess: () => {
      refresh();
      setReview(null);
      toast.success("Review recorded");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save."),
  });
  const list = q.data ?? [];
  const active = list.find((r) => r.status === "active");
  return (
    <SectionCard
      title="“Do not assign” restriction"
      subtitle="Applies to this worker only — never to other workers from the same agency."
      action={
        !active && !worker.archived_at ? (
          <Button size="sm" variant="destructive-outline" onClick={() => setAddOpen(true)}>
            <Ban />
            Add restriction
          </Button>
        ) : undefined
      }
    >
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBlock message={(q.error as Error).message} onRetry={() => void q.refetch()} />
      ) : list.length === 0 ? (
        <Empty title="No restrictions" />
      ) : (
        <ul className="space-y-2.5">
          {list.map((r) => (
            <li key={r.id} className="rounded-lg border border-line bg-raised px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Pill tone={r.status === "active" ? "red" : "slate"}>{r.status === "active" ? "Active" : "Lifted"}</Pill>
                <span className="text-xs text-ink-3">
                  By {r.createdBy ?? "—"} · {fmtDateTime(r.createdAt)}
                </span>
              </div>
              <p className="mt-2 whitespace-pre-line text-sm text-ink">{r.reason}</p>
              {r.reviews.length > 0 && (
                <ol className="mt-2 space-y-1 border-l border-line pl-3">
                  {r.reviews.map((v) => (
                    <li key={v.id} className="text-xs text-ink-2">
                      <span className="font-medium capitalize text-ink">{v.decision}</span> · {v.reviewedBy ?? "—"} · {fmtDateTime(v.reviewedAt)}
                      {v.note && <> — {v.note}</>}
                    </li>
                  ))}
                </ol>
              )}
              {r.status === "active" && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => setReview({ id: r.id, decision: "maintained" })}>
                    Record review
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setReview({ id: r.id, decision: "lifted" })}>
                    <ShieldOff />
                    Lift restriction
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <ReasonDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        title="Add “Do not assign” restriction"
        description="Sets this worker's status to “Do not assign”. The reason is visible only to admins with personnel-records permission."
        label="Documented reason"
        min={10}
        saving={add.isPending}
        submitLabel="Add restriction"
        onSave={(t) => add.mutate(t)}
      />
      <ReasonDialog
        open={!!review}
        onOpenChange={(o) => !o && setReview(null)}
        title={review?.decision === "lifted" ? "Lift restriction" : "Record restriction review"}
        label="Review note"
        saving={rev.isPending}
        onSave={(t) => rev.mutate(t)}
        extra={
          review?.decision === "lifted" ? (
            <SelectField
              label="New worker status"
              required
              value={newStatus}
              onChange={setNewStatus}
              options={["pending_placement", "active", "unavailable", "assignment_ended"].map((v) => ({ value: v, label: WORKER_STATUS[v]?.label ?? v }))}
            />
          ) : undefined
        }
      />
    </SectionCard>
  );
};

export const PersonnelTab = ({ worker }: { worker: Worker }) => {
  const wf = useWorkforce();
  const qc = useQueryClient();
  const [edit, setEdit] = useState<PersonnelRecord | null>(null);
  const [adding, setAdding] = useState<boolean>(false);
  const [history, setHistory] = useState<PersonnelRecord | null>(null);
  const [reopen, setReopen] = useState<PersonnelRecord | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["wf", "personnel", worker.id], enabled: wf.perms.personnel, queryFn: () => api.listPersonnel(worker.id) });
  const reopenM = useMutation({
    mutationFn: (reason: string) => api.reopenPersonnel(reopen?.id ?? "", reason),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["wf", "personnel", worker.id] });
      wf.invalidate("followups");
      setReopen(null);
      toast.success("Record reopened — logged");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't reopen."),
  });

  if (!wf.perms.personnel) return <Restricted what="Personnel records and do-not-assign reasons" />;

  const records = q.data ?? [];
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/[0.06] px-4 py-3 text-sm text-ink-2">
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-link" />
        Confidential. Viewing is logged. Personnel records never appear in client reports, officer reports or the mobile apps.
      </div>
      {worker.source === "agency" && <RestrictionSection worker={worker} />}
      <SectionCard
        title="Personnel records"
        action={
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus />
            New record
          </Button>
        }
      >
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <ErrorBlock message={(q.error as Error).message} onRetry={() => void q.refetch()} />
        ) : records.length === 0 ? (
          <Empty title="No personnel records" description="Coaching notes, commendations, complaints, attendance, warnings and investigations." />
        ) : (
          <ul className="space-y-2.5">
            {records.map((r) => {
              const open = expanded === r.id;
              return (
                <li key={r.id} className="rounded-lg border border-line bg-raised">
                  <button
                    type="button"
                    onClick={() => setExpanded(open ? null : r.id)}
                    aria-expanded={open}
                    className="focus-ring flex w-full flex-col gap-1 rounded-lg px-4 py-3 text-left sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-ink">{r.title}</span>
                        <MetaPill meta={PERSONNEL_STATUS} value={r.status} />
                      </div>
                      <div className="text-xs text-ink-3">
                        {PERSONNEL_TYPE[r.record_type]} · {fmtDateTime(r.event_at ?? r.created_at)} · Rev {r.revision}
                      </div>
                    </div>
                    {r.followup_due && r.status !== "closed" && <Pill tone="amber">Follow-up {fmtDate(r.followup_due, "MMM d")}</Pill>}
                  </button>
                  {open && (
                    <div className="space-y-2.5 border-t border-line px-3 pb-3 pt-3">
                      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                        <DataTile label="Reporting person">{r.reporting_person}</DataTile>
                        <DataTile label="Related property / shift">
                          {[r.property_id ? wf.propertyById.get(r.property_id)?.name : "", r.shift_id ? "Linked shift" : ""].filter(Boolean).join(" · ")}
                        </DataTile>
                        <DataTile label="Reported concern / allegation" className="md:col-span-2">{r.allegation && <span className="whitespace-pre-line">{r.allegation}</span>}</DataTile>
                        <DataTile label="Firsthand observations" className="md:col-span-2">{r.observations && <span className="whitespace-pre-line">{r.observations}</span>}</DataTile>
                        <DataTile label="Worker response" className="md:col-span-2">{r.worker_response && <span className="whitespace-pre-line">{r.worker_response}</span>}</DataTile>
                        <DataTile label="Findings">{r.findings && <span className="whitespace-pre-line">{r.findings}</span>}</DataTile>
                        <DataTile label="Outcome">{r.outcome && <span className="whitespace-pre-line">{r.outcome}</span>}</DataTile>
                        <DataTile label="Action taken">{r.action_taken}</DataTile>
                        <DataTile label="Follow-up">{r.followup_due ? `${wf.memberName(r.followup_owner)} · due ${fmtDate(r.followup_due)}` : ""}</DataTile>
                        {worker.source === "agency" && (
                          <>
                            <DataTile label="Agency notified">
                              {[r.agency_contact_notified, r.agency_notified_at ? fmtDateTime(r.agency_notified_at) : "", r.agency_notify_method].filter(Boolean).join(" · ")}
                            </DataTile>
                            <DataTile label="Agency follow-up status">{r.agency_followup_status}</DataTile>
                            <DataTile label="Agency response" className="md:col-span-2">{r.agency_response}</DataTile>
                            <DataTile label="Replacement">
                              {r.replacement_requested ? `Requested${r.replacement_worker_id ? ` · ${fullName(wf.workerById.get(r.replacement_worker_id) ?? { first_name: "Worker", last_name: "" })}` : ""}` : "Not requested"}
                            </DataTile>
                          </>
                        )}
                        <DataTile label="Author">
                          {wf.memberName(r.created_by)} · {fmtDateTime(r.created_at)}
                        </DataTile>
                        {r.reopen_reason && <DataTile label="Last reopened because">{r.reopen_reason}</DataTile>}
                      </div>
                      <DocumentsPanel ownerType="personnel" ownerId={r.id} filter={(doc) => doc.personnel_record_id === r.id} title="Attachments" compact />
                      <div className="flex flex-wrap gap-2">
                        {r.status === "closed" ? (
                          <Button size="sm" variant="outline" onClick={() => setReopen(r)}>
                            <RotateCcw />
                            Reopen to edit
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => setEdit(r)}>
                            <Pencil />
                            Edit
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => setHistory(r)}>
                          <History />
                          Revision history
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
      <RecordDialog
        open={adding || !!edit}
        onOpenChange={(o) => {
          if (!o) {
            setAdding(false);
            setEdit(null);
          }
        }}
        worker={worker}
        record={edit}
      />
      <HistoryDialog record={history} onClose={() => setHistory(null)} />
      <ReasonDialog
        open={!!reopen}
        onOpenChange={(o) => !o && setReopen(null)}
        title="Reopen closed record"
        description="Reopening is logged with your reason and moves the record to Under review."
        label="Reason for reopening"
        saving={reopenM.isPending}
        submitLabel="Reopen"
        onSave={(t) => reopenM.mutate(t)}
      />
    </div>
  );
};
