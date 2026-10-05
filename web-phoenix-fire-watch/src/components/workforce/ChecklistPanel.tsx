import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, Circle, MinusCircle, Pencil, Plus, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import * as api from "@/lib/workforce/api";
import { CHECK_STATUS, CHECKLIST_KIND, type ChecklistItem } from "@/lib/workforce/constants";
import { cn } from "@/lib/utils";
import { useWorkforce } from "@/state/WorkforceProvider";

import { AreaField, CheckField, Empty, fmtDate, FormDialog, MetaPill, Pill, SelectField, TextField } from "./kit";

const today = () => new Date().toISOString().slice(0, 10);

const ItemDialog = ({
  open,
  onOpenChange,
  item,
  workerId,
  placementId,
  kind,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  item: ChecklistItem | null;
  workerId: string;
  placementId?: string | null;
  kind: string;
}) => {
  const wf = useWorkforce();
  const [title, setTitle] = useState<string>("");
  const [required, setRequired] = useState<boolean>(true);
  const [status, setStatus] = useState<string>("pending");
  const [completedOn, setCompletedOn] = useState<string>("");
  const [responsible, setResponsible] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [documentId, setDocumentId] = useState<string>("");
  const [init, setInit] = useState<string>("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    const s = {
      title: item?.title ?? "",
      required: item?.required ?? true,
      status: item?.status ?? "pending",
      completedOn: item?.completed_on ?? "",
      responsible: item?.responsible_id ?? "",
      notes: item?.notes ?? "",
      documentId: item?.document_id ?? "",
    };
    setTitle(s.title);
    setRequired(s.required);
    setStatus(s.status);
    setCompletedOn(s.completedOn);
    setResponsible(s.responsible);
    setNotes(s.notes);
    setDocumentId(s.documentId);
    setInit(JSON.stringify(s));
    setErrors({});
  }, [open, item]);

  const current = JSON.stringify({ title, required, status, completedOn, responsible, notes, documentId });

  const docs = wf.documents.filter(
    (d) => !d.archived_at && (d.worker_id === workerId || (placementId && d.placement_id === placementId)),
  );

  const save = useMutation({
    mutationFn: () => {
      const row = {
        title: title.trim(),
        required,
        status,
        completed_on: status === "completed" ? completedOn || today() : null,
        responsible_id: responsible || null,
        notes: notes.trim(),
        document_id: documentId || null,
      };
      if (item) return api.updateChecklistItem(item.id, row);
      return api.addChecklistItem({ ...row, org_id: wf.orgId, kind, worker_id: workerId, placement_id: placementId ?? null, sort: 100 });
    },
    onSuccess: () => {
      wf.invalidate("checklist");
      toast.success("Checklist updated");
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save."),
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={item ? "Checklist item" : "Add checklist item"}
      dirty={current !== init}
      saving={save.isPending}
      onSubmit={() => {
        const e: Record<string, string> = {};
        if (!title.trim()) e.title = "Title is required.";
        setErrors(e);
        if (Object.keys(e).length === 0) save.mutate();
      }}
    >
      <TextField label="Item" required value={title} onChange={setTitle} error={errors.title} disabled={!!item?.template_id} hint={item?.template_id ? "Title comes from the checklist template (Settings)." : undefined} />
      <CheckField label="Required" checked={required} onChange={setRequired} disabled={!!item?.template_id} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SelectField
          label="Status"
          required
          value={status}
          onChange={setStatus}
          options={Object.entries(CHECK_STATUS).map(([value, m]) => ({ value, label: m.label }))}
        />
        <TextField label="Completion date" type="date" value={completedOn} onChange={setCompletedOn} disabled={status !== "completed"} />
        <SelectField
          label="Responsible administrator"
          value={responsible}
          onChange={setResponsible}
          allowNone
          noneLabel="Unassigned"
          options={wf.admins.map((m) => ({ value: m.id, label: m.full_name }))}
        />
        <SelectField
          label="Supporting document"
          value={documentId}
          onChange={setDocumentId}
          allowNone
          noneLabel="None"
          options={docs.map((d) => ({ value: d.id, label: d.title }))}
          hint={docs.length === 0 ? "Upload on the Documents tab to link it here." : undefined}
        />
      </div>
      <AreaField label="Notes" value={notes} onChange={setNotes} rows={3} />
    </FormDialog>
  );
};

const STATUS_ICON = {
  completed: <CheckCircle2 className="h-5 w-5 text-status-clear" />,
  not_applicable: <MinusCircle className="h-5 w-5 text-ink-3" />,
  pending: <Circle className="h-5 w-5 text-status-follow" />,
} as const;

/** Worker- or placement-specific checklist. Completion is tracked separately from employment/placement status. */
export const ChecklistPanel = ({
  kind,
  workerId,
  placementId,
  title,
  compact,
}: {
  kind: "direct" | "placement" | "direct_offboarding" | "placement_end";
  workerId: string;
  placementId?: string | null;
  title?: string;
  compact?: boolean;
}) => {
  const wf = useWorkforce();
  const [edit, setEdit] = useState<ChecklistItem | null>(null);
  const [adding, setAdding] = useState<boolean>(false);
  const items = useMemo(
    () =>
      wf.checklist
        .filter((c) => c.kind === kind && c.worker_id === workerId && (placementId ? c.placement_id === placementId : !c.placement_id))
        .sort((a, b) => a.sort - b.sort || a.created_at.localeCompare(b.created_at)),
    [wf.checklist, kind, workerId, placementId],
  );
  const required = items.filter((i) => i.required);
  const doneReq = required.filter((i) => i.status !== "pending").length;
  const pct = required.length === 0 ? 100 : Math.round((doneReq / required.length) * 100);

  const quick = useMutation({
    mutationFn: (i: ChecklistItem) =>
      api.updateChecklistItem(i.id, {
        status: i.status === "completed" ? "pending" : "completed",
        completed_on: i.status === "completed" ? null : today(),
        responsible_id: i.responsible_id ?? wf.user?.id ?? null,
      }),
    onSuccess: () => wf.invalidate("checklist"),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't update."),
  });

  const apply = useMutation({
    mutationFn: () => api.applyChecklist(kind, workerId, placementId ?? undefined),
    onSuccess: (n) => {
      wf.invalidate("checklist");
      toast.success(n > 0 ? `${n} checklist items added` : "Checklist already up to date");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't add the checklist."),
  });

  return (
    <div className={cn(!compact && "rounded-xl border border-line bg-surface")}>
      <div className={cn("flex flex-wrap items-start justify-between gap-3", compact ? "mb-3" : "px-5 pt-5 sm:px-6")}>
        <div className="min-w-0">
          <h3 className={cn("font-display font-bold text-ink", compact ? "text-base" : "text-lg sm:text-xl")}>
            {title ?? CHECKLIST_KIND[kind]?.label}
          </h3>
          {items.length > 0 && (
            <div className="mt-2 flex items-center gap-3">
              <div className="h-1.5 w-40 overflow-hidden rounded-full bg-canvas">
                <div className="h-full rounded-full bg-status-clear transition-[width] duration-500" style={{ width: `${pct}%` }} />
              </div>
              <span className="text-xs text-ink-2">
                {doneReq}/{required.length} required done
              </span>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => apply.mutate()} disabled={apply.isPending}>
            <RefreshCw className={cn(apply.isPending && "animate-spin")} />
            {items.length === 0 ? "Start checklist" : "Add missing template items"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            <Plus />
            Item
          </Button>
        </div>
      </div>
      <div className={cn(!compact && "p-3 sm:p-4")}>
        {items.length === 0 ? (
          <Empty title="No checklist yet" description="Start the checklist from the template configured in Workforce settings." />
        ) : (
          <ul className="space-y-2">
            {items.map((i) => (
              <li key={i.id} className="flex items-start gap-3 rounded-lg border border-line bg-raised px-3.5 py-3">
                <button
                  type="button"
                  onClick={() => i.status !== "not_applicable" && quick.mutate(i)}
                  aria-label={i.status === "completed" ? `Mark “${i.title}” pending` : `Mark “${i.title}” completed`}
                  className="focus-ring mt-0.5 rounded-full"
                  disabled={i.status === "not_applicable"}
                >
                  {STATUS_ICON[i.status as keyof typeof STATUS_ICON] ?? STATUS_ICON.pending}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn("text-sm font-medium text-ink", i.status === "not_applicable" && "line-through opacity-70")}>{i.title}</span>
                    {i.required ? <Pill tone="ember">Required</Pill> : <Pill tone="slate">Optional</Pill>}
                    <MetaPill meta={CHECK_STATUS} value={i.status} />
                  </div>
                  <div className="mt-1 text-xs text-ink-3">
                    {i.completed_on && <>Completed {fmtDate(i.completed_on)} · </>}
                    {i.responsible_id ? `Responsible: ${wf.memberName(i.responsible_id)}` : "Unassigned"}
                    {i.document_id && <> · Document linked</>}
                  </div>
                  {i.notes && <p className="mt-1 text-xs text-ink-2">{i.notes}</p>}
                </div>
                <Button variant="ghost" size="icon" aria-label={`Edit ${i.title}`} onClick={() => setEdit(i)}>
                  <Pencil />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <ItemDialog
        open={!!edit || adding}
        onOpenChange={(o) => {
          if (!o) {
            setEdit(null);
            setAdding(false);
          }
        }}
        item={edit}
        workerId={workerId}
        placementId={placementId}
        kind={kind}
      />
    </div>
  );
};
