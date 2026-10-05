import { useMutation } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Building, Pencil, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { PageHeader } from "@/components/fw/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DocumentsPanel } from "@/components/workforce/DocumentsPanel";
import {
  AreaField,
  CheckField,
  ConfirmDialog,
  DataTile,
  Empty,
  fmtDate,
  FormDialog,
  MetaPill,
  Pill,
  Restricted,
  SectionCard,
  TextField,
} from "@/components/workforce/kit";
import { PlacementCard } from "@/components/workforce/placements";
import * as api from "@/lib/workforce/api";
import { fullName, INVOICE_STATUS, money, WORKER_STATUS, type Agency } from "@/lib/workforce/constants";
import { cn } from "@/lib/utils";
import NotFound from "@/pages/NotFound";
import { useWorkforce } from "@/state/WorkforceProvider";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const FIELDS = [
  "name",
  "primary_contact",
  "phone",
  "email",
  "after_hours_contact",
  "after_hours_phone",
  "billing_contact",
  "billing_email",
  "billing_phone",
  "address",
  "account_number",
  "payment_terms",
  "notes",
] as const;
type Field = (typeof FIELDS)[number];

export const AgencyDialog = ({ open, onOpenChange, agency }: { open: boolean; onOpenChange: (v: boolean) => void; agency: Agency | null }) => {
  const wf = useWorkforce();
  const navigate = useNavigate();
  const init = useMemo(() => {
    const o = Object.fromEntries(FIELDS.map((f) => [f, (agency?.[f] as string | undefined) ?? ""])) as Record<Field, string>;
    return { ...o, active: agency?.active ?? true };
  }, [agency]);
  const [d, setD] = useState(init);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (open) {
      setD(init);
      setErrors({});
    }
  }, [open, init]);
  const set = (k: Field) => (v: string) => setD((p) => ({ ...p, [k]: v }));
  const save = useMutation({
    mutationFn: () => {
      const row = Object.fromEntries(FIELDS.map((f) => [f, d[f].trim()])) as Record<Field, string>;
      return api.saveAgency(agency?.id ?? null, { ...row, active: d.active, org_id: wf.orgId });
    },
    onSuccess: (a) => {
      wf.invalidate("agencies");
      toast.success(agency ? "Agency saved" : "Agency added");
      onOpenChange(false);
      if (!agency) navigate(`/workforce/agencies/${a.id}`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save."),
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={agency ? `Edit ${agency.name}` : "Add staffing agency"}
      dirty={JSON.stringify(d) !== JSON.stringify(init)}
      saving={save.isPending}
      onSubmit={() => {
        const e: Record<string, string> = {};
        if (!d.name.trim()) e.name = "Agency name is required.";
        for (const k of ["email", "billing_email"] as const) if (d[k].trim() && !EMAIL_RE.test(d[k].trim())) e[k] = "Enter a valid email.";
        const dupe = wf.agencies.find((a) => a.id !== agency?.id && a.name.trim().toLowerCase() === d.name.trim().toLowerCase());
        if (dupe) e.name = "An agency with this name already exists.";
        setErrors(e);
        if (Object.keys(e).length === 0) save.mutate();
      }}
      wide
    >
      <TextField label="Agency name" required value={d.name} onChange={set("name")} error={errors.name} maxLength={160} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <TextField label="Primary contact" value={d.primary_contact} onChange={set("primary_contact")} />
        <TextField label="Phone" type="tel" value={d.phone} onChange={set("phone")} />
        <TextField label="Email" type="email" value={d.email} onChange={set("email")} error={errors.email} />
        <TextField label="After-hours dispatch contact" value={d.after_hours_contact} onChange={set("after_hours_contact")} />
        <TextField label="After-hours phone" type="tel" value={d.after_hours_phone} onChange={set("after_hours_phone")} />
        <div className="hidden sm:block" />
        <TextField label="Billing contact" value={d.billing_contact} onChange={set("billing_contact")} />
        <TextField label="Billing email" type="email" value={d.billing_email} onChange={set("billing_email")} error={errors.billing_email} />
        <TextField label="Billing phone" type="tel" value={d.billing_phone} onChange={set("billing_phone")} />
      </div>
      <AreaField label="Business address" value={d.address} onChange={set("address")} rows={2} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField label="Account / customer number" value={d.account_number} onChange={set("account_number")} />
        <TextField label="Payment terms" value={d.payment_terms} onChange={set("payment_terms")} placeholder="e.g. Net 30" />
      </div>
      <AreaField label="Administrative notes" value={d.notes} onChange={set("notes")} rows={3} />
      <CheckField label="Active agency" checked={d.active} onChange={(v) => setD((p) => ({ ...p, active: v }))} hint="Inactive agencies can't be chosen for new workers." />
    </FormDialog>
  );
};

export const AgencyList = () => {
  const wf = useWorkforce();
  const [q, setQ] = useState<string>("");
  const [addOpen, setAddOpen] = useState<boolean>(false);
  const [showArchived, setShowArchived] = useState<boolean>(false);
  const list = wf.agencies.filter(
    (a) => (showArchived ? !!a.archived_at : !a.archived_at) && (!q.trim() || `${a.name} ${a.primary_contact} ${a.account_number}`.toLowerCase().includes(q.trim().toLowerCase())),
  );
  return (
    <div>
      <PageHeader
        title="Staffing agencies"
        subtitle={`${list.length} ${showArchived ? "archived" : ""} ${list.length === 1 ? "agency" : "agencies"}`}
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <Plus />
            Add agency
          </Button>
        }
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
          <Input aria-label="Search agencies" placeholder="Search agencies…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-10" />
        </div>
        <Button variant={showArchived ? "secondary" : "ghost"} onClick={() => setShowArchived((v) => !v)}>
          {showArchived ? "Showing archived" : "Show archived"}
        </Button>
      </div>
      {list.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface p-4">
          <Empty title={wf.agencies.length === 0 ? "No agencies yet" : "No matching agencies"} description="Add the staffing agencies that supply temporary workers." />
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((a) => {
            const workers = wf.workers.filter((w) => w.agency_id === a.id && !w.archived_at);
            const activePl = wf.placements.filter((p) => p.agency_id === a.id && p.status === "active").length;
            return (
              <li key={a.id}>
                <Link to={`/workforce/agencies/${a.id}`} className="focus-ring block rounded-xl border border-line bg-surface p-3 transition-colors hover:border-[#7A8394] hover:bg-[#4A5260]">
                  <div className="rounded-lg border border-line bg-raised p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-3">
                        <Building className="h-6 w-6 shrink-0 text-ember" strokeWidth={1.7} />
                        <span className="truncate font-display text-lg font-bold text-ink">{a.name}</span>
                      </div>
                      <Pill tone={a.active ? "green" : "slate"}>{a.active ? "Active" : "Inactive"}</Pill>
                    </div>
                    <div className="mt-2 truncate text-sm text-ink-2">{[a.primary_contact, a.phone].filter(Boolean).join(" · ") || "No contact recorded"}</div>
                  </div>
                  <div className="flex gap-4 px-2 pb-1 pt-3 text-xs text-ink-2">
                    <span>{workers.length} workers</span>
                    <span>{activePl} active placements</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <AgencyDialog open={addOpen} onOpenChange={setAddOpen} agency={null} />
    </div>
  );
};

export const AgencyProfile = () => {
  const { id = "" } = useParams();
  const wf = useWorkforce();
  const agency = wf.agencyById.get(id);
  const [edit, setEdit] = useState<boolean>(false);
  const [archiveOpen, setArchiveOpen] = useState<boolean>(false);
  const archive = useMutation({
    mutationFn: () =>
      api.saveAgency(id, agency?.archived_at ? { name: agency.name, archived_at: null, archived_by: null } : { name: agency?.name ?? "", archived_at: new Date().toISOString(), archived_by: wf.user?.id ?? null, active: false }),
    onSuccess: (a) => {
      wf.invalidate("agencies");
      setArchiveOpen(false);
      toast.success(a.archived_at ? "Agency archived — history preserved" : "Agency restored");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't update."),
  });
  if (!agency) return <NotFound embedded />;
  const workers = wf.workers.filter((w) => w.agency_id === agency.id);
  const placements = wf.placements.filter((p) => p.agency_id === agency.id);
  const current = placements.filter((p) => p.status === "active" || p.status === "pending");
  const invoices = wf.invoices.filter((i) => i.agency_id === agency.id && !i.archived_at && i.status !== "paid");
  const workerIds = new Set(workers.map((w) => w.id));
  const followups = wf.followups.filter((f) => workerIds.has(f.worker_id));
  return (
    <div>
      <PageHeader
        backTo="/workforce/agencies"
        backLabel="Staffing agencies"
        title={agency.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Pill tone={agency.active ? "green" : "slate"}>{agency.active ? "Active" : "Inactive"}</Pill>
            {agency.archived_at && <Pill tone="slate">Archived {fmtDate(agency.archived_at)}</Pill>}
          </span>
        }
        actions={
          <>
            <Button variant="outline" onClick={() => setEdit(true)}>
              <Pencil />
              Edit
            </Button>
            <Button variant="ghost" onClick={() => (agency.archived_at ? archive.mutate() : setArchiveOpen(true))}>
              {agency.archived_at ? <ArchiveRestore /> : <Archive />}
              {agency.archived_at ? "Restore" : "Archive"}
            </Button>
          </>
        }
      />
      <div className="space-y-5">
        <SectionCard title="Agency details">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            <DataTile label="Primary contact">{[agency.primary_contact, agency.phone, agency.email].filter(Boolean).join(" · ")}</DataTile>
            <DataTile label="After-hours dispatch">{[agency.after_hours_contact, agency.after_hours_phone].filter(Boolean).join(" · ")}</DataTile>
            <DataTile label="Billing contact">{[agency.billing_contact, agency.billing_email, agency.billing_phone].filter(Boolean).join(" · ")}</DataTile>
            <DataTile label="Business address">{agency.address && <span className="whitespace-pre-line">{agency.address}</span>}</DataTile>
            <DataTile label="Account / customer #">{agency.account_number}</DataTile>
            <DataTile label="Payment terms">{agency.payment_terms}</DataTile>
            <DataTile label="Administrative notes" className="sm:col-span-2 lg:col-span-3">{agency.notes && <span className="whitespace-pre-line">{agency.notes}</span>}</DataTile>
          </div>
        </SectionCard>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <SectionCard title={`Linked workers (${workers.length})`}>
            {workers.length === 0 ? (
              <Empty title="No workers from this agency" />
            ) : (
              <ul className="space-y-2">
                {workers.map((w) => (
                  <li key={w.id}>
                    <Link to={`/workforce/workers/${w.id}`} className={cn("focus-ring flex items-center justify-between gap-2 rounded-lg border border-line bg-raised px-4 py-3 hover:border-[#7A8394]", w.archived_at && "opacity-60")}>
                      <span className="min-w-0 truncate text-sm text-ink">
                        {fullName(w)} <span className="font-mono text-xs text-ink-3">{w.worker_code}</span>
                      </span>
                      <MetaPill meta={WORKER_STATUS} value={w.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
          <div className="space-y-5">
            <SectionCard title="Outstanding invoices">
              {!wf.perms.finance ? (
                <Restricted what="Agency invoices" />
              ) : invoices.length === 0 ? (
                <Empty title="No outstanding invoices" />
              ) : (
                <ul className="space-y-2">
                  {invoices.map((i) => (
                    <li key={i.id}>
                      <Link to={`/workforce/invoices/${i.id}`} className="focus-ring flex items-center justify-between gap-2 rounded-lg border border-line bg-raised px-4 py-3 hover:border-[#7A8394]">
                        <span className="text-sm text-ink">
                          #{i.invoice_number} · {money(Number(i.total))}
                          {i.due_date && <span className="text-xs text-ink-3"> · due {fmtDate(i.due_date)}</span>}
                        </span>
                        <MetaPill meta={INVOICE_STATUS} value={i.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
            <SectionCard title="Personnel follow-ups">
              {!wf.perms.personnel ? (
                <Restricted what="Personnel follow-ups" />
              ) : followups.length === 0 ? (
                <Empty title="No open follow-ups for this agency's workers" />
              ) : (
                <ul className="space-y-2">
                  {followups.map((f) => (
                    <li key={f.id}>
                      <Link to={`/workforce/workers/${f.worker_id}?tab=personnel`} className="focus-ring flex items-center justify-between rounded-lg border border-line bg-raised px-4 py-3 text-sm text-ink hover:border-[#7A8394]">
                        {fullName(wf.workerById.get(f.worker_id) ?? { first_name: "Worker", last_name: "" })}
                        <Pill tone="amber">Due {fmtDate(f.followup_due, "MMM d")}</Pill>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </div>
        </div>

        <div>
          <h2 className="mb-3 font-display text-xl font-bold text-ink">Current placements ({current.length})</h2>
          {current.length === 0 ? (
            <div className="rounded-xl border border-line bg-surface p-4">
              <Empty title="No pending or active placements" />
            </div>
          ) : (
            <div className="space-y-3">
              {current.map((p) => (
                <PlacementCard key={p.id} placement={p} showWorker />
              ))}
            </div>
          )}
        </div>

        <DocumentsPanel ownerType="agency" ownerId={agency.id} filter={(d) => d.agency_id === agency.id && d.owner_type === "agency"} title="Agreements & documents" />
      </div>
      <AgencyDialog open={edit} onOpenChange={setEdit} agency={agency} />
      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title="Archive this agency?"
        description="The agency becomes inactive and moves to the archive. Its workers, placements, invoices and documents are all preserved."
        confirmLabel="Archive"
        busy={archive.isPending}
        onConfirm={() => archive.mutate()}
      />
    </div>
  );
};
