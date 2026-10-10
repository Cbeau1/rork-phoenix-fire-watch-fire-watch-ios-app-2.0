import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BellOff, Check, RotateCcw, UserRound } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { PageHeader } from "@/components/fw/primitives";
import { Button } from "@/components/ui/button";
import { AreaField, Empty, fmtDate, FormDialog, Loading, Pill, SelectField } from "@/components/workforce/kit";
import * as api from "@/lib/workforce/api";
import { fullName, REMINDER_KIND, type Reminder } from "@/lib/workforce/constants";
import { todayKey } from "@/lib/workforce/derive";
import { useWorkforce } from "@/state/WorkforceProvider";

const linkFor = (r: Reminder): string => {
  if (r.kind === "followup") return `/workforce/workers/${r.worker_id}?tab=personnel`;
  if (r.kind === "equipment") return `/workforce/workers/${r.worker_id}?tab=equipment`;
  if (r.kind === "doc_expiry") return r.worker_id ? `/workforce/workers/${r.worker_id}?tab=documents` : "/workforce/agencies";
  if (r.kind === "placement_end") return `/workforce/workers/${r.worker_id}?tab=employment`;
  if (r.kind === "invoice_due") return `/workforce/invoices/${r.entity_id}`;
  return `/workforce/workers/${r.worker_id}?tab=${r.kind === "paperwork" ? "employment" : "overview"}`;
};

/** In-app reminders. Titles never include confidential personnel details; nothing is sent externally. */
const Reminders = () => {
  const wf = useWorkforce();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const kind = params.get("kind") ?? "";
  const view = params.get("view") ?? "open";
  const [action, setAction] = useState<{ r: Reminder; type: "resolve" | "dismiss" | "assign" } | null>(null);
  const [note, setNote] = useState<string>("");
  const [assignee, setAssignee] = useState<string>("");
  const [err, setErr] = useState<string>("");

  const m = useMutation({
    mutationFn: (v: { r: Reminder; type: "resolve" | "dismiss" | "assign" | "reopen" }) => api.reminderAction(v.r.id, v.type, note.trim(), v.type === "assign" ? assignee || null : null),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: ["wf", "reminders"] });
      void qc.invalidateQueries({ queryKey: ["wf", "audit"] });
      setAction(null);
      toast.success(v.type === "assign" ? "Reminder assigned" : v.type === "reopen" ? "Reminder reopened" : v.type === "resolve" ? "Reminder resolved" : "Reminder dismissed");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't update."),
  });

  const list = wf.reminders.filter((r) => (view === "open" ? r.status === "open" : r.status !== "open") && (!kind || r.kind === kind));
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    setParams(n, { replace: true });
  };
  const open = (r: Reminder, type: "resolve" | "dismiss" | "assign") => {
    setNote("");
    setErr("");
    setAssignee(r.assigned_to ?? "");
    setAction({ r, type });
  };

  return (
    <div>
      <PageHeader title="Reminders & follow-ups" subtitle="In-app only. Reminders refresh automatically, and duplicates are prevented." />
      <div className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-line bg-surface shadow-card p-3 sm:grid-cols-2 sm:p-4">
        <SelectField label="Show" value={view} onChange={(v) => set("view", v === "open" ? "" : v)} options={[{ value: "open", label: "Open" }, { value: "closed", label: "Resolved & dismissed" }]} />
        <SelectField label="Type" value={kind} onChange={(v) => set("kind", v)} allowNone noneLabel="All types" options={Object.entries(REMINDER_KIND).map(([value, label]) => ({ value, label }))} />
      </div>
      {wf.remindersLoading ? (
        <Loading />
      ) : list.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface shadow-card p-4">
          <Empty title={view === "open" ? "No open reminders" : "Nothing resolved yet"} />
        </div>
      ) : (
        <ul className="space-y-2.5">
          {list.map((r) => {
            const w = r.worker_id ? wf.workerById.get(r.worker_id) : undefined;
            const overdue = r.due_date && r.due_date < todayKey();
            return (
              <li key={r.id} className="rounded-xl border border-line bg-surface shadow-card p-3">
                <div className="flex flex-col gap-3 rounded-lg border border-line bg-raised px-4 py-3 md:flex-row md:items-center md:justify-between">
                  <Link to={linkFor(r)} className="focus-ring min-w-0 rounded">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink hover:text-link">{r.title}</span>
                      <Pill tone="slate">{REMINDER_KIND[r.kind] ?? r.kind}</Pill>
                      {r.due_date && <Pill tone={overdue ? "red" : "amber"}>{overdue ? "Overdue" : "Due"} {fmtDate(r.due_date, "MMM d")}</Pill>}
                    </div>
                    <div className="mt-0.5 text-xs text-ink-3">
                      {w && <>{fullName(w)} · </>}
                      {r.assigned_to ? `Assigned to ${wf.memberName(r.assigned_to)}` : "Unassigned"}
                      {r.status !== "open" && (
                        <>
                          {" "}
                          · {r.status === "dismissed" ? "Dismissed" : "Resolved"} {r.resolved_at && fmtDate(r.resolved_at)}
                          {r.auto_resolved ? " (condition cleared)" : r.resolved_by ? ` by ${wf.memberName(r.resolved_by)}` : ""}
                          {r.resolution_note && !r.auto_resolved && ` — ${r.resolution_note}`}
                        </>
                      )}
                    </div>
                  </Link>
                  <div className="flex shrink-0 flex-wrap gap-1.5">
                    {r.status === "open" ? (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => open(r, "assign")}>
                          <UserRound />
                          Assign
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => open(r, "resolve")}>
                          <Check />
                          Resolve
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => open(r, "dismiss")}>
                          <BellOff />
                          Dismiss
                        </Button>
                      </>
                    ) : (
                      !r.auto_resolved && (
                        <Button size="sm" variant="ghost" onClick={() => m.mutate({ r, type: "reopen" })}>
                          <RotateCcw />
                          Reopen
                        </Button>
                      )
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <FormDialog
        open={!!action}
        onOpenChange={(o) => !o && setAction(null)}
        title={action?.type === "assign" ? "Assign reminder" : action?.type === "dismiss" ? "Dismiss reminder" : "Resolve reminder"}
        description={action?.type === "dismiss" ? "A reason is required and recorded." : undefined}
        dirty={!!note}
        saving={m.isPending}
        onSubmit={() => {
          if (!action) return;
          if (action.type === "dismiss" && note.trim().length < 3) {
            setErr("Give a reason for dismissing.");
            return;
          }
          m.mutate({ r: action.r, type: action.type });
        }}
      >
        {action?.type === "assign" ? (
          <SelectField label="Assign to" value={assignee} onChange={setAssignee} allowNone noneLabel="Unassigned" options={wf.admins.map((a) => ({ value: a.id, label: a.full_name }))} />
        ) : (
          <AreaField label={action?.type === "dismiss" ? "Reason" : "Resolution note (optional)"} required={action?.type === "dismiss"} value={note} onChange={setNote} error={err} rows={3} />
        )}
      </FormDialog>
    </div>
  );
};

export default Reminders;
