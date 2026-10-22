import { Archive, ArchiveRestore, Building2, ChevronRight, Link2, Mail, Pencil, Phone, Plus, Trash2, Unlink } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";

import { PageHeader } from "@/components/fw/primitives";
import { AreaField, CheckField, ConfirmDialog, Empty, ErrorBlock, FormDialog, Loading, Pill, SectionCard, SelectField, TextField } from "@/components/workforce/kit";
import { Button } from "@/components/ui/button";
import { crm, useClient, useInvalidateCrm, useOrg, useOrgTimezone } from "@/lib/crm/api";
import { type ContactRole, type CrmClient, type CrmContact, dealWeekly, fmtZoned, money, ROLE_LABEL, STAGE_META } from "@/lib/crm/types";
import { friendlyError } from "@/lib/supabase";
import { useFireWatch } from "@/state/FireWatchProvider";

import { IntakeDialog } from "./IntakeDialog";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ClientDialog = ({ open, onOpenChange, client }: { open: boolean; onOpenChange: (v: boolean) => void; client: CrmClient }) => {
  const invalidate = useInvalidateCrm();
  const initial = useMemo(
    () => ({
      name: client.name,
      billing_name: client.billing_name,
      billing_email: client.billing_email,
      billing_phone: client.billing_phone,
      billing_address: client.billing_address,
      notes: client.notes,
    }),
    [client],
  );
  const [f, setF] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  return (
    <FormDialog
      open={open}
      onOpenChange={(v) => {
        if (v) setF(initial);
        setErrors({});
        onOpenChange(v);
      }}
      title="Edit client"
      dirty={JSON.stringify(f) !== JSON.stringify(initial)}
      saving={saving}
      onSubmit={() => {
        const e: Record<string, string> = {};
        if (!f.name.trim()) e.name = "Enter the client name.";
        if (f.billing_email && !EMAIL.test(f.billing_email.trim())) e.billing_email = "Enter a valid email.";
        setErrors(e);
        if (Object.keys(e).length) return;
        setSaving(true);
        crm
          .updateClient(client.id, { ...f, name: f.name.trim().replace(/\s+/g, " "), billing_email: f.billing_email.trim().toLowerCase() })
          .then(async () => {
            await invalidate();
            toast.success("Client saved");
            onOpenChange(false);
          })
          .catch((err) => toast.error(/duplicate|unique/i.test(String(err?.message)) ? "Another client already has that name." : friendlyError(err)))
          .finally(() => setSaving(false));
      }}
    >
      <TextField label="Client or company name" value={f.name} onChange={(v) => setF({ ...f, name: v })} required error={errors.name} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Billing contact" value={f.billing_name} onChange={(v) => setF({ ...f, billing_name: v })} />
        <TextField label="Billing email" value={f.billing_email} onChange={(v) => setF({ ...f, billing_email: v })} type="email" error={errors.billing_email} />
        <TextField label="Billing phone" value={f.billing_phone} onChange={(v) => setF({ ...f, billing_phone: v })} type="tel" />
        <TextField label="Billing address" value={f.billing_address} onChange={(v) => setF({ ...f, billing_address: v })} />
      </div>
      <AreaField label="Notes" value={f.notes} onChange={(v) => setF({ ...f, notes: v })} rows={3} />
    </FormDialog>
  );
};

type ContactDraft = { id?: string; name: string; email: string; phone: string; role: ContactRole; receives_updates: boolean; notes: string };
const emptyContact: ContactDraft = { name: "", email: "", phone: "", role: "site", receives_updates: false, notes: "" };

const ContactDialog = ({ draft, onClose, clientId }: { draft: ContactDraft | null; onClose: () => void; clientId: string }) => {
  const invalidate = useInvalidateCrm();
  const { orgId } = useOrg();
  const [f, setF] = useState<ContactDraft>(draft ?? emptyContact);
  const [seed, setSeed] = useState<ContactDraft | null>(draft);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  if (draft !== seed) {
    setSeed(draft);
    setF(draft ?? emptyContact);
    setErrors({});
  }
  return (
    <FormDialog
      open={!!draft}
      onOpenChange={(v) => !v && onClose()}
      title={f.id ? "Edit contact" : "Add contact"}
      dirty={JSON.stringify(f) !== JSON.stringify(draft)}
      saving={saving}
      onSubmit={() => {
        const e: Record<string, string> = {};
        if (!f.name.trim()) e.name = "Enter a name.";
        if (f.email && !EMAIL.test(f.email.trim())) e.email = "Enter a valid email.";
        if (f.receives_updates && !f.email.trim()) e.email = "Add an email to receive patrol updates.";
        setErrors(e);
        if (Object.keys(e).length) return;
        setSaving(true);
        crm
          .saveContact(orgId, clientId, f)
          .then(async () => {
            await invalidate();
            toast.success("Contact saved");
            onClose();
          })
          .catch((err) => toast.error(friendlyError(err)))
          .finally(() => setSaving(false));
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Name" value={f.name} onChange={(v) => setF({ ...f, name: v })} required error={errors.name} />
        <SelectField label="Role" value={f.role} onChange={(v) => setF({ ...f, role: v as ContactRole })} options={(Object.keys(ROLE_LABEL) as ContactRole[]).map((r) => ({ value: r, label: ROLE_LABEL[r] }))} />
        <TextField label="Phone" value={f.phone} onChange={(v) => setF({ ...f, phone: v })} type="tel" inputMode="tel" />
        <TextField label="Email" value={f.email} onChange={(v) => setF({ ...f, email: v })} type="email" inputMode="email" error={errors.email} />
      </div>
      <CheckField label="Receives patrol updates" hint="Daily patrol reports will go to contacts with this on." checked={f.receives_updates} onChange={(v) => setF({ ...f, receives_updates: v })} />
      <AreaField label="Notes" value={f.notes} onChange={(v) => setF({ ...f, notes: v })} rows={2} />
    </FormDialog>
  );
};

const ClientDetail = () => {
  const { id = "" } = useParams();
  const q = useClient(id);
  const tz = useOrgTimezone();
  const invalidate = useInvalidateCrm();
  const { properties, reload } = useFireWatch();
  const [edit, setEdit] = useState(false);
  const [contact, setContact] = useState<ContactDraft | null>(null);
  const [removeContact, setRemoveContact] = useState<CrmContact | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkId, setLinkId] = useState("");
  const [intake, setIntake] = useState(false);
  const [busy, setBusy] = useState(false);

  const linkedIds = new Set((q.data?.properties ?? []).map((p) => p.id));
  const linkable = properties.filter((p) => !linkedIds.has(p.id));

  if (q.isLoading) return <Loading label="Loading client…" />;
  if (q.error) return <ErrorBlock message={friendlyError(q.error)} onRetry={() => void q.refetch()} />;
  if (!q.data) return <Empty title="Client not found" action={<Button asChild variant="outline"><Link to="/clients/list">Back to clients</Link></Button>} />;
  const { client, contacts, properties: props, deals } = q.data;

  const act = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      await invalidate();
      toast.success(ok);
      return true;
    } catch (err) {
      toast.error(friendlyError(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        backTo="/clients/list"
        backLabel="Clients"
        title={client.name}
        subtitle={client.archived_at ? <Pill tone="slate">Archived</Pill> : `Client since ${fmtZoned(client.created_at, tz, false)}`}
        actions={
          <>
            <Button variant="outline" onClick={() => setEdit(true)}>
              <Pencil />
              Edit
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void act(
                  () => crm.updateClient(client.id, { archived_at: client.archived_at ? null : new Date().toISOString() }),
                  client.archived_at ? "Client restored" : "Client archived",
                )
              }
            >
              {client.archived_at ? <ArchiveRestore /> : <Archive />}
              {client.archived_at ? "Restore" : "Archive"}
            </Button>
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Contacts" action={<Button size="sm" onClick={() => setContact({ ...emptyContact })}><Plus />Add contact</Button>}>
          {contacts.length === 0 ? (
            <p className="px-2 py-4 text-sm text-ink-3">No contacts yet.</p>
          ) : (
            <ul className="grid gap-2">
              {contacts.map((c) => (
                <li key={c.id} className="flex items-start gap-3 rounded-xl border border-line bg-raised/50 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
                      {c.name}
                      <Pill tone="slate">{ROLE_LABEL[c.role]}</Pill>
                      {c.receives_updates && <Pill tone="blue">Patrol updates</Pill>}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                      {c.phone && <a className="inline-flex items-center gap-1.5 font-mono text-link hover:underline" href={`tel:${c.phone}`}><Phone className="h-3.5 w-3.5" />{c.phone}</a>}
                      {c.email && <a className="inline-flex items-center gap-1.5 text-link hover:underline" href={`mailto:${c.email}`}><Mail className="h-3.5 w-3.5" />{c.email}</a>}
                    </div>
                    {c.notes && <p className="mt-1 text-xs text-ink-3">{c.notes}</p>}
                  </div>
                  <Button size="icon" variant="ghost" aria-label={`Edit ${c.name}`} onClick={() => setContact({ id: c.id, name: c.name, email: c.email, phone: c.phone, role: c.role, receives_updates: c.receives_updates, notes: c.notes })}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" aria-label={`Remove ${c.name}`} onClick={() => setRemoveContact(c)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Billing">
          <dl className="grid gap-3 px-2 pb-1 text-sm">
            {[
              ["Contact", client.billing_name],
              ["Email", client.billing_email],
              ["Phone", client.billing_phone],
              ["Address", client.billing_address],
            ].map(([k, v]) => (
              <div key={k} className="grid grid-cols-[88px_1fr] gap-3">
                <dt className="text-ink-3">{k}</dt>
                <dd className="text-ink">{v || "—"}</dd>
              </div>
            ))}
            {client.notes && <p className="whitespace-pre-line rounded-lg bg-raised px-3 py-2 text-ink-2">{client.notes}</p>}
          </dl>
        </SectionCard>

        <SectionCard
          title="Properties"
          action={
            linkable.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => { setLinkId(""); setLinkOpen(true); }}>
                <Link2 />
                Link property
              </Button>
            )
          }
        >
          {props.length === 0 ? (
            <p className="px-2 py-4 text-sm text-ink-3">No properties linked yet.</p>
          ) : (
            <ul className="grid gap-2">
              {props.map((p) => (
                <li key={p.id} className="flex items-center gap-3 rounded-xl border border-line bg-raised/50 px-4 py-3">
                  <Building2 className="h-5 w-5 shrink-0 text-link" />
                  <Link to={`/properties/${p.id}`} className="focus-ring min-w-0 flex-1 rounded">
                    <p className="truncate font-medium text-ink hover:underline">{p.name}</p>
                    <p className="truncate text-sm text-ink-2">{p.address || "No address"}</p>
                  </Link>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Unlink ${p.name}`}
                    disabled={busy}
                    onClick={() => void act(() => crm.updateProperty(p.id, { client_id: null }), `${p.name} unlinked`).then(() => reload())}
                  >
                    <Unlink className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Jobs & quotes" action={<Button size="sm" onClick={() => setIntake(true)}><Plus />New request</Button>}>
          {deals.length === 0 ? (
            <p className="px-2 py-4 text-sm text-ink-3">No requests yet.</p>
          ) : (
            <ul className="grid gap-2">
              {deals.map((d) => {
                const { weekly } = dealWeekly(d);
                return (
                  <li key={d.id}>
                    <Link to={`/clients/deals/${d.id}`} className="focus-ring flex items-center gap-3 rounded-xl border border-line bg-raised/50 px-4 py-3 transition-colors hover:border-line-strong">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-ink">{d.property?.name ?? "No property"}</p>
                        <p className="truncate text-xs text-ink-3">{d.reason || "Fire watch"} · {fmtZoned(d.created_at, tz, false)}</p>
                      </div>
                      <span className="font-mono text-sm tabular-nums text-ink-2">{weekly != null ? `${money(weekly, false)}/wk` : ""}</span>
                      <Pill tone={STAGE_META[d.stage].tone}>{STAGE_META[d.stage].label}</Pill>
                      <ChevronRight className="h-4 w-4 text-ink-3" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>
      </div>

      <ClientDialog open={edit} onOpenChange={setEdit} client={client} />
      <ContactDialog draft={contact} onClose={() => setContact(null)} clientId={client.id} />
      <ConfirmDialog
        open={!!removeContact}
        onOpenChange={(v) => !v && setRemoveContact(null)}
        title={`Remove ${removeContact?.name ?? "contact"}?`}
        description="They'll no longer appear on this client or receive updates. Sent quotes and signed agreements keep their records."
        confirmLabel="Remove"
        destructive
        busy={busy}
        onConfirm={() => {
          const c = removeContact;
          if (!c) return;
          void act(() => crm.deleteContact(c.id), "Contact removed").then((ok) => ok && setRemoveContact(null));
        }}
      />
      <ConfirmDialog
        open={linkOpen}
        onOpenChange={setLinkOpen}
        title="Link a property"
        description="Attach a property that's already in the app to this client."
        confirmLabel="Link"
        busy={busy}
        disabled={!linkId}
        onConfirm={() =>
          void act(() => crm.updateProperty(linkId, { client_id: client.id }), "Property linked").then((ok) => {
            if (ok) {
              setLinkOpen(false);
              reload();
            }
          })
        }
      >
        <SelectField
          label="Property"
          value={linkId}
          onChange={setLinkId}
          options={linkable.map((p) => ({ value: p.id, label: `${p.name}${p.address ? ` — ${p.address}` : ""}` }))}
        />
      </ConfirmDialog>
      <IntakeDialog open={intake} onOpenChange={setIntake} preset={{ id: client.id, name: client.name }} />
    </div>
  );
};

export default ClientDetail;
