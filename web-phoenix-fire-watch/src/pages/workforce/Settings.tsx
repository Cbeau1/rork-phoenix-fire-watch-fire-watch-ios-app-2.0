import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Pencil, Plus, RefreshCw, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/fw/primitives";
import { Button } from "@/components/ui/button";
import {
  CheckField,
  ConfirmDialog,
  Empty,
  ErrorBlock,
  FormDialog,
  Loading,
  Pill,
  SectionCard,
  SelectField,
  TextField,
  useUnloadGuard,
} from "@/components/workforce/kit";
import { AuditList } from "@/components/workforce/profile/ActivityTab";
import * as api from "@/lib/workforce/api";
import { CHECKLIST_KIND, DOC_CATEGORY_LABEL, PERM_META, type Perm, type Template, type WfPerms } from "@/lib/workforce/constants";
import { cn } from "@/lib/utils";
import { useWorkforce } from "@/state/WorkforceProvider";

const KINDS = ["direct", "placement", "direct_offboarding", "placement_end"] as const;
type Kind = (typeof KINDS)[number];

/** Categories that make sense for each checklist (agency placements never get employee hiring/payroll docs). */
const DOC_OPTIONS: Record<Kind, string[]> = {
  direct: ["application_resume", "offer_agreement", "signed_policies", "handbook_ack", "payroll_tax", "other"],
  placement: ["placement_confirmation", "other"],
  direct_offboarding: ["separation", "other"],
  placement_end: ["other"],
};

const TemplateDialog = ({ open, onOpenChange, kind, template }: { open: boolean; onOpenChange: (v: boolean) => void; kind: Kind; template: Template | null }) => {
  const wf = useWorkforce();
  const init = useMemo(
    () => ({ title: template?.title ?? "", required: template?.required ?? true, doc: template?.doc_category ?? "", active: template?.active ?? true }),
    [template],
  );
  const [d, setD] = useState(init);
  const [err, setErr] = useState<string>("");
  useEffect(() => {
    if (open) {
      setD(init);
      setErr("");
    }
  }, [open, init]);
  const save = useMutation({
    mutationFn: () => {
      const maxSort = Math.max(0, ...wf.templates.filter((t) => t.applies_to === kind).map((t) => t.sort));
      return api.saveTemplate(template?.id ?? null, {
        org_id: wf.orgId,
        applies_to: kind,
        title: d.title.trim(),
        required: d.required,
        doc_category: d.doc || null,
        active: d.active,
        sort: template?.sort ?? maxSort + 1,
      });
    },
    onSuccess: () => {
      wf.invalidate("templates");
      toast.success("Template saved. Use “Apply to existing” to update open checklists.");
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save."),
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={template ? "Edit checklist item" : "Add checklist item"}
      description={CHECKLIST_KIND[kind]?.label}
      dirty={JSON.stringify(d) !== JSON.stringify(init)}
      saving={save.isPending}
      onSubmit={() => {
        if (!d.title.trim()) {
          setErr("Title is required.");
          return;
        }
        if (/train|certif/i.test(d.title)) {
          setErr("Training and certification items aren't part of this module.");
          return;
        }
        save.mutate();
      }}
    >
      <TextField label="Item" required value={d.title} onChange={(v) => setD({ ...d, title: v })} error={err} maxLength={160} />
      <SelectField
        label="Typical supporting document"
        value={d.doc}
        onChange={(v) => setD({ ...d, doc: v })}
        allowNone
        noneLabel="None"
        options={DOC_OPTIONS[kind].map((c) => ({ value: c, label: DOC_CATEGORY_LABEL[c] ?? c }))}
      />
      <CheckField label="Required" checked={d.required} onChange={(v) => setD({ ...d, required: v })} hint="Missing required items show up as paperwork reminders. They never change status or cancel shifts." />
      <CheckField label="Active" checked={d.active} onChange={(v) => setD({ ...d, active: v })} hint="Inactive items aren't added to new checklists. Existing items are kept." />
    </FormDialog>
  );
};

const TemplatesSection = () => {
  const wf = useWorkforce();
  const [kind, setKind] = useState<Kind>("direct");
  const [edit, setEdit] = useState<Template | null>(null);
  const [adding, setAdding] = useState<boolean>(false);
  const [applyOpen, setApplyOpen] = useState<boolean>(false);
  const list = wf.templates.filter((t) => t.applies_to === kind).sort((a, b) => a.sort - b.sort);
  const move = useMutation({
    mutationFn: async ({ t, dir }: { t: Template; dir: -1 | 1 }) => {
      const i = list.findIndex((x) => x.id === t.id);
      const other = list[i + dir];
      if (!other) return;
      await api.saveTemplate(t.id, { applies_to: t.applies_to, title: t.title, sort: other.sort });
      await api.saveTemplate(other.id, { applies_to: other.applies_to, title: other.title, sort: t.sort });
    },
    onSuccess: () => wf.invalidate("templates"),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't reorder."),
  });
  const apply = useMutation({
    mutationFn: () => api.applyTemplateChanges(kind),
    onSuccess: (r) => {
      wf.invalidate("checklist");
      setApplyOpen(false);
      toast.success(`Applied: ${r.added} item(s) added, ${r.updated} pending item(s) updated. Completed items unchanged.`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't apply."),
  });
  return (
    <SectionCard
      title="Checklist templates"
      subtitle="Requirements are set separately for each worker source. Agency placements never inherit direct-employee hiring or payroll items."
      action={
        <>
          <Button size="sm" variant="outline" onClick={() => setApplyOpen(true)}>
            <RefreshCw />
            Apply to existing
          </Button>
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus />
            Item
          </Button>
        </>
      }
    >
      <div className="mb-3 flex flex-wrap gap-1.5">
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            aria-pressed={kind === k}
            className={cn("focus-ring rounded-lg px-3 py-1.5 text-sm", kind === k ? "bg-ember text-white" : "bg-raised text-ink-2 hover:text-ink")}
          >
            {CHECKLIST_KIND[k]?.label}
          </button>
        ))}
      </div>
      <p className="mb-3 text-xs text-ink-3">{CHECKLIST_KIND[kind]?.description}</p>
      {list.length === 0 ? (
        <Empty title="No items" />
      ) : (
        <ul className="space-y-2">
          {list.map((t, i) => (
            <li key={t.id} className={cn("flex items-center gap-2 rounded-lg border border-line bg-raised px-3.5 py-2.5", !t.active && "opacity-55")}>
              <div className="flex flex-col">
                <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => move.mutate({ t, dir: -1 })} className="focus-ring rounded text-ink-3 hover:text-ink disabled:opacity-30">
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button type="button" aria-label="Move down" disabled={i === list.length - 1} onClick={() => move.mutate({ t, dir: 1 })} className="focus-ring rounded text-ink-3 hover:text-ink disabled:opacity-30">
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm text-ink">
                  {t.title}
                  {t.required ? <Pill tone="ember">Required</Pill> : <Pill tone="slate">Optional</Pill>}
                  {!t.active && <Pill tone="slate">Inactive</Pill>}
                </div>
                {t.doc_category && <div className="text-xs text-ink-3">{DOC_CATEGORY_LABEL[t.doc_category]}</div>}
              </div>
              <Button variant="ghost" size="icon" aria-label={`Edit ${t.title}`} onClick={() => setEdit(t)}>
                <Pencil />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <TemplateDialog
        open={adding || !!edit}
        onOpenChange={(o) => {
          if (!o) {
            setAdding(false);
            setEdit(null);
          }
        }}
        kind={kind}
        template={edit}
      />
      <ConfirmDialog
        open={applyOpen}
        onOpenChange={setApplyOpen}
        title={`Apply “${CHECKLIST_KIND[kind]?.label}” template to existing checklists?`}
        description="Adds new active items to open checklists and updates the title/required flag of items that are still pending. Completed and not-applicable items are never reset. Terminated workers and closed placements are skipped."
        confirmLabel="Apply changes"
        busy={apply.isPending}
        onConfirm={() => apply.mutate()}
      />
    </SectionCard>
  );
};

const RemindersSection = () => {
  const wf = useWorkforce();
  const s = wf.settings;
  const init = useMemo(
    () => ({
      doc: (s?.doc_expiry_days ?? [30, 14, 7]).join(", "),
      placement: String(s?.placement_end_days ?? 14),
      invoice: String(s?.invoice_due_days ?? 7),
      followup: String(s?.followup_due_days ?? 7),
      retentionYears: s?.retention_review_years != null ? String(s.retention_review_years) : "",
      retentionNote: s?.retention_note ?? "",
    }),
    [s],
  );
  const [d, setD] = useState(init);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => setD(init), [init]);
  const dirty = JSON.stringify(d) !== JSON.stringify(init);
  useUnloadGuard(dirty);
  const save = useMutation({
    mutationFn: () =>
      api.saveSettings(wf.orgId, {
        doc_expiry_days: Array.from(new Set(d.doc.split(",").map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n > 0 && n <= 365))).sort((a, b) => b - a),
        placement_end_days: Number(d.placement),
        invoice_due_days: Number(d.invoice),
        followup_due_days: Number(d.followup),
        retention_review_years: d.retentionYears ? Number(d.retentionYears) : null,
        retention_note: d.retentionNote.trim(),
      }),
    onSuccess: () => {
      wf.invalidate("settings", "reminders");
      toast.success("Settings saved");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save."),
  });
  const submit = () => {
    const e: Record<string, string> = {};
    const days = d.doc.split(",").map((x) => Number(x.trim()));
    if (days.length === 0 || days.some((n) => !Number.isInteger(n) || n < 1 || n > 365)) e.doc = "Comma-separated whole days, 1–365 (e.g. 30, 14, 7).";
    for (const k of ["placement", "invoice", "followup"] as const) {
      const n = Number(d[k]);
      if (!Number.isInteger(n) || n < 0 || n > 180) e[k] = "0–180 days.";
    }
    if (d.retentionYears && (!Number.isInteger(Number(d.retentionYears)) || Number(d.retentionYears) < 1 || Number(d.retentionYears) > 50)) e.retentionYears = "1–50 years, or blank.";
    setErrors(e);
    if (Object.keys(e).length === 0) save.mutate();
  };
  return (
    <SectionCard
      title="Reminders & retention"
      action={
        <Button size="sm" onClick={submit} disabled={!dirty || save.isPending}>
          <Save />
          Save
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField label="Document expiration reminders (days before)" value={d.doc} onChange={(v) => setD({ ...d, doc: v })} error={errors.doc} hint="Default 30, 14, 7. Each threshold gets one reminder." />
        <TextField label="Placement ending reminder (days before)" inputMode="numeric" value={d.placement} onChange={(v) => setD({ ...d, placement: v })} error={errors.placement} />
        <TextField label="Invoice due reminder (days before)" inputMode="numeric" value={d.invoice} onChange={(v) => setD({ ...d, invoice: v })} error={errors.invoice} />
        <TextField label="Personnel follow-up reminder (days before)" inputMode="numeric" value={d.followup} onChange={(v) => setD({ ...d, followup: v })} error={errors.followup} />
        <TextField
          label="Archived-record review period (years)"
          inputMode="numeric"
          value={d.retentionYears}
          onChange={(v) => setD({ ...d, retentionYears: v })}
          error={errors.retentionYears}
          hint="Your organization's own policy. Nothing is deleted automatically. Blank keeps records until an authorized admin deletes them."
        />
        <TextField label="Retention policy note" value={d.retentionNote} onChange={(v) => setD({ ...d, retentionNote: v })} placeholder="e.g. Per counsel guidance dated…" />
      </div>
      <p className="mt-3 text-xs text-ink-3">
        No legal retention periods are assumed. Workforce records aren't affected by the patrol-data retention setting on the Account page.
      </p>
    </SectionCard>
  );
};

const PermissionsSection = () => {
  const wf = useWorkforce();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["wf", "roster"], enabled: wf.perms.admin, queryFn: api.permissionRoster });
  const save = useMutation({
    mutationFn: ({ id, perms }: { id: string; perms: WfPerms }) => api.setPermissions(id, perms),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["wf", "roster"] });
      void qc.invalidateQueries({ queryKey: ["wf", "perms"] });
      toast.success("Permissions updated");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't update."),
  });
  if (!wf.perms.admin) {
    return (
      <SectionCard title="Your workforce permissions">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(PERM_META) as Perm[]).map((p) => (
            <Pill key={p} tone={wf.perms[p] ? "green" : "slate"}>
              {PERM_META[p].label}: {wf.perms[p] ? "Yes" : "No"}
            </Pill>
          ))}
        </div>
      </SectionCard>
    );
  }
  const perms = Object.keys(PERM_META) as Perm[];
  return (
    <SectionCard title="Permissions" subtitle="Only verified, active organization admins can be given workforce access. Officers never can.">
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBlock message={(q.error as Error).message} onRetry={() => void q.refetch()} />
      ) : (
        <div className="space-y-2.5">
          {(q.data ?? []).map((r) => (
            <div key={r.profileId} className="rounded-lg border border-line bg-raised px-4 py-3">
              <div className="text-sm font-medium text-ink">
                {r.name} <span className="text-xs text-ink-3">{r.email}</span>
              </div>
              <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
                {perms.map((p) => (
                  <label key={p} className="flex items-start gap-2 text-xs text-ink-2" title={PERM_META[p].description}>
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 accent-[#DC2626]"
                      checked={r[p]}
                      disabled={save.isPending || (p !== "manage" && !r.manage)}
                      onChange={(e) => save.mutate({ id: r.profileId, perms: { ...r, [p]: e.target.checked } })}
                    />
                    <span>
                      <span className="text-ink">{PERM_META[p].label}</span>
                      <span className="block text-ink-3">{PERM_META[p].description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
};

const AuditSection = () => {
  const q = useQuery({ queryKey: ["wf", "audit", "org"], queryFn: () => api.listAudit({ limit: 200 }) });
  return (
    <SectionCard title="Audit log" subtitle="Append-only. Shows entries you have permission to see (latest 200).">
      {q.isLoading ? <Loading /> : q.error ? <ErrorBlock message={(q.error as Error).message} onRetry={() => void q.refetch()} /> : <AuditList entries={q.data ?? []} />}
    </SectionCard>
  );
};

const BackupSection = () => (
  <SectionCard title="Backups & restoring records">
    <div className="space-y-2 text-sm text-ink-2">
      <p className="rounded-lg border border-line bg-raised px-4 py-3">
        <span className="font-medium text-ink">Archive first.</span> Archived profiles, agencies, documents and invoices can be restored at any time
        from the “Show archived” views. Nothing is lost.
      </p>
      <p className="rounded-lg border border-line bg-raised px-4 py-3">
        <span className="font-medium text-ink">Database records</span> are covered by the backend's automatic daily database backups, the same as patrol data.
        Records that were permanently deleted can only come back through a point-in-time database restore, done through Rork support.
      </p>
      <p className="rounded-lg border border-line bg-raised px-4 py-3">
        <span className="font-medium text-ink">Private files</span> (documents and photos) live in the private “workforce-files” storage bucket. Earlier document
        versions are never overwritten. Permanently deleted files aren't included in database backups, so download copies of anything you need to keep first.
      </p>
    </div>
  </SectionCard>
);

const Settings = () => (
  <div>
    <PageHeader title="Workforce settings" subtitle="Checklists, reminder intervals, retention, permissions and the audit trail." />
    <div className="space-y-5">
      <TemplatesSection />
      <RemindersSection />
      <PermissionsSection />
      <AuditSection />
      <BackupSection />
    </div>
  </div>
);

export default Settings;
