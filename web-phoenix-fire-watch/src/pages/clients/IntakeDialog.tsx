import { Building2, Link2, UserRound } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { AreaField, CheckField, FormDialog, SelectField, TextField, isDate, toNum } from "@/components/workforce/kit";
import { crm, useClients, useCrmSettings, useInvalidateCrm } from "@/lib/crm/api";
import { COVERAGE_OPTIONS, type Coverage, LEAD_SOURCES } from "@/lib/crm/types";
import { friendlyError } from "@/lib/supabase";
import { useFireWatch } from "@/state/FireWatchProvider";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normName = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
const normAddr = (s: string) => s.replace(/[^a-zA-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

const blank = {
  clientId: "",
  clientName: "",
  contactName: "",
  contactPhone: "",
  contactEmail: "",
  contactRole: "manager",
  contactUpdates: true,
  billingName: "",
  billingEmail: "",
  billingPhone: "",
  billingAddress: "",
  propertyMode: "new" as "new" | "existing",
  propertyId: "",
  propertyName: "",
  propertyAddress: "",
  access: "",
  marshalName: "",
  marshalPhone: "",
  marshalEmail: "",
  reason: "",
  coverage: "24_7" as Coverage,
  hours: "",
  interval: "60",
  startDate: "",
  startTime: "",
  endDate: "",
  rate: "",
  source: "",
  notes: "",
};

const Section = ({ icon: Icon, title, children }: { icon: typeof UserRound; title: string; children: React.ReactNode }) => (
  <fieldset className="grid gap-4 rounded-xl border border-line bg-raised/40 p-4">
    <legend className="flex items-center gap-2 px-1 font-display text-sm font-bold uppercase tracking-[0.08em] text-ink-2">
      <Icon className="h-4 w-4 text-link" />
      {title}
    </legend>
    {children}
  </fieldset>
);

export const IntakeDialog = ({
  open,
  onOpenChange,
  preset,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  preset?: { id: string; name: string };
}) => {
  const navigate = useNavigate();
  const invalidate = useInvalidateCrm();
  const clients = useClients();
  const settings = useCrmSettings();
  const { properties, reload } = useFireWatch();
  const base = useMemo(() => (preset ? { ...blank, clientId: preset.id, clientName: preset.name } : blank), [preset]);
  const [f, setF] = useState(base);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setF(base);
  }
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [showBilling, setShowBilling] = useState(false);
  const set = <K extends keyof typeof blank>(k: K, v: (typeof blank)[K]) => setF((p) => ({ ...p, [k]: v }));
  const dirty = JSON.stringify(f) !== JSON.stringify(base);

  const activeClients = useMemo(() => (clients.data ?? []).filter((c) => !c.archived_at), [clients.data]);
  const clientMatch = useMemo(
    () => (f.clientId ? null : activeClients.find((c) => normName(c.name) === normName(f.clientName) && f.clientName.trim() !== "")),
    [activeClients, f.clientId, f.clientName],
  );
  const suggestions = useMemo(() => {
    const q = normName(f.clientName);
    if (f.clientId || q.length < 2) return [];
    return activeClients.filter((c) => normName(c.name).includes(q) && normName(c.name) !== q).slice(0, 4);
  }, [activeClients, f.clientId, f.clientName]);
  const propertyMatch = useMemo(() => {
    if (f.propertyMode !== "new") return null;
    const a = normAddr(f.propertyAddress);
    const n = f.propertyName.trim().toLowerCase();
    return properties.find((p) => (a.length > 5 && normAddr(p.address) === a) || (n !== "" && p.name.trim().toLowerCase() === n)) ?? null;
  }, [properties, f.propertyMode, f.propertyAddress, f.propertyName]);
  const pickedClient = activeClients.find((c) => c.id === f.clientId) ?? null;

  const close = (v: boolean) => {
    if (!v) {
      setF(base);
      setErrors({});
      setShowBilling(false);
    }
    onOpenChange(v);
  };

  const submit = async () => {
    const e: Record<string, string> = {};
    if (!f.clientId && !f.clientName.trim()) e.clientName = "Enter the client or company name.";
    if (f.contactEmail && !EMAIL.test(f.contactEmail.trim())) e.contactEmail = "Enter a valid email.";
    if (f.billingEmail && !EMAIL.test(f.billingEmail.trim())) e.billingEmail = "Enter a valid email.";
    if (f.marshalEmail && !EMAIL.test(f.marshalEmail.trim())) e.marshalEmail = "Enter a valid email.";
    if (f.propertyMode === "existing" && !f.propertyId) e.propertyId = "Choose a property.";
    if (f.propertyMode === "new" && !f.propertyName.trim() && !f.propertyAddress.trim()) e.propertyAddress = "Enter the property address.";
    if (f.coverage === "custom") {
      const h = toNum(f.hours);
      if (h == null || h <= 0 || h > 168) e.hours = "Hours per week must be between 1 and 168.";
    }
    const iv = toNum(f.interval);
    if (iv == null || iv < 10 || iv > 720) e.interval = "Between 10 and 720 minutes.";
    if (f.startDate && !isDate(f.startDate)) e.startDate = "Use a valid date.";
    if (f.endDate && !isDate(f.endDate)) e.endDate = "Use a valid date.";
    if (f.startDate && f.endDate && f.endDate < f.startDate) e.endDate = "End date is before the start date.";
    if (f.rate && (toNum(f.rate) == null || (toNum(f.rate) ?? 0) < 0)) e.rate = "Enter a dollar amount.";
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    try {
      const contacts = f.contactName.trim()
        ? [{ name: f.contactName.trim(), phone: f.contactPhone.trim(), email: f.contactEmail.trim(), role: f.contactRole, receives_updates: f.contactUpdates }]
        : [];
      if (f.billingName.trim() && normName(f.billingName) !== normName(f.contactName)) {
        contacts.push({ name: f.billingName.trim(), phone: f.billingPhone.trim(), email: f.billingEmail.trim(), role: "billing", receives_updates: false });
      }
      const res = await crm.intake({
        client_id: f.clientId || null,
        client_name: f.clientName.trim(),
        billing_name: f.billingName.trim(),
        billing_email: f.billingEmail.trim(),
        billing_phone: f.billingPhone.trim(),
        billing_address: f.billingAddress.trim(),
        contacts,
        site_contact: contacts[0] ?? {},
        property_id: f.propertyMode === "existing" ? f.propertyId : null,
        property_name: f.propertyName.trim(),
        property_address: f.propertyAddress.trim(),
        access_instructions: f.access.trim(),
        fire_marshal_name: f.marshalName.trim(),
        fire_marshal_phone: f.marshalPhone.trim(),
        fire_marshal_email: f.marshalEmail.trim(),
        reason: f.reason.trim(),
        coverage: f.coverage,
        hours_per_week: f.coverage === "custom" ? f.hours : "",
        patrol_interval_minutes: f.interval,
        requested_start_date: f.startDate,
        requested_start_time: f.startTime,
        end_date: f.endDate,
        est_rate: f.rate || (settings.data?.default_rate != null ? String(settings.data.default_rate) : ""),
        source: f.source,
        notes: f.notes.trim(),
      });
      await invalidate();
      reload();
      const reused = [res.reused_client && "existing client", res.reused_property && "existing property"].filter(Boolean);
      toast.success(reused.length ? `Lead added — linked to the ${reused.join(" and ")}` : "Lead added to the pipeline");
      close(false);
      navigate(`/clients/deals/${res.deal_id}`);
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={close}
      title="New client intake"
      description="Takes about a minute on the phone. Existing clients and properties are matched automatically, so nothing is entered twice."
      dirty={dirty}
      saving={saving}
      onSubmit={() => void submit()}
      submitLabel="Add to pipeline"
      wide
    >
      <Section icon={UserRound} title="Client">
        {pickedClient ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/40 bg-primary/10 px-3.5 py-3 text-sm">
            <span className="text-ink">
              <Link2 className="mr-1.5 inline h-4 w-4 text-link" />
              Adding to <strong>{pickedClient.name}</strong>
            </span>
            <button type="button" className="focus-ring rounded text-link hover:underline" onClick={() => set("clientId", "")}>
              Change
            </button>
          </div>
        ) : (
          <div>
            <TextField
              label="Client or company name"
              value={f.clientName}
              onChange={(v) => set("clientName", v)}
              required
              error={errors.clientName}
              placeholder="e.g. Harbor Point Apartments LLC"
              hint={clientMatch ? `Matches existing client "${clientMatch.name}" — this lead will be added to it.` : undefined}
            />
            {suggestions.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                <span className="text-xs text-ink-3">Existing:</span>
                {suggestions.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setF((p) => ({ ...p, clientId: c.id, clientName: c.name }))}
                    className="focus-ring rounded-full border border-line bg-surface px-2.5 py-0.5 text-xs text-ink-2 hover:border-primary hover:text-ink"
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Contact name" value={f.contactName} onChange={(v) => set("contactName", v)} placeholder="Who called?" />
          <SelectField
            label="Their role"
            value={f.contactRole}
            onChange={(v) => set("contactRole", v)}
            options={[
              { value: "manager", label: "Property / project manager" },
              { value: "site", label: "Site contact" },
              { value: "billing", label: "Billing" },
              { value: "other", label: "Other" },
            ]}
          />
          <TextField label="Phone" value={f.contactPhone} onChange={(v) => set("contactPhone", v)} type="tel" inputMode="tel" />
          <TextField label="Email" value={f.contactEmail} onChange={(v) => set("contactEmail", v)} type="email" inputMode="email" error={errors.contactEmail} />
        </div>
        <CheckField label="Send this contact patrol updates" hint="Used later for daily patrol reports." checked={f.contactUpdates} onChange={(v) => set("contactUpdates", v)} />
        {showBilling ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Billing contact" value={f.billingName} onChange={(v) => set("billingName", v)} />
            <TextField label="Billing email" value={f.billingEmail} onChange={(v) => set("billingEmail", v)} type="email" inputMode="email" error={errors.billingEmail} />
            <TextField label="Billing phone" value={f.billingPhone} onChange={(v) => set("billingPhone", v)} type="tel" inputMode="tel" />
            <TextField label="Billing address" value={f.billingAddress} onChange={(v) => set("billingAddress", v)} />
          </div>
        ) : (
          <button type="button" onClick={() => setShowBilling(true)} className="focus-ring justify-self-start rounded text-sm font-medium text-link hover:underline">
            + Add a separate billing contact
          </button>
        )}
      </Section>

      <Section icon={Building2} title="Property">
        <SelectField
          label="Property"
          value={f.propertyMode}
          onChange={(v) => set("propertyMode", v as "new" | "existing")}
          options={[
            { value: "new", label: "New property" },
            ...(properties.length ? [{ value: "existing", label: "A property already in the app" }] : []),
          ]}
        />
        {f.propertyMode === "existing" ? (
          <SelectField
            label="Choose property"
            value={f.propertyId}
            onChange={(v) => set("propertyId", v)}
            error={errors.propertyId}
            options={properties.map((p) => ({ value: p.id, label: `${p.name}${p.address ? ` — ${p.address}` : ""}` }))}
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Property name" value={f.propertyName} onChange={(v) => set("propertyName", v)} placeholder="e.g. Harbor Point Tower B" />
            <TextField
              label="Address"
              value={f.propertyAddress}
              onChange={(v) => set("propertyAddress", v)}
              error={errors.propertyAddress}
              hint={propertyMatch ? `Matches "${propertyMatch.name}" already in the app — it will be reused.` : undefined}
            />
          </div>
        )}
        <AreaField label="Access instructions" value={f.access} onChange={(v) => set("access", v)} rows={2} placeholder="Gate code, key box, where to park, who lets officers in…" />
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField label="Fire marshal" value={f.marshalName} onChange={(v) => set("marshalName", v)} />
          <TextField label="Marshal phone" value={f.marshalPhone} onChange={(v) => set("marshalPhone", v)} type="tel" inputMode="tel" />
          <TextField label="Marshal email" value={f.marshalEmail} onChange={(v) => set("marshalEmail", v)} type="email" error={errors.marshalEmail} />
        </div>
      </Section>

      <Section icon={Link2} title="Request">
        <TextField label="Reason for fire watch" value={f.reason} onChange={(v) => set("reason", v)} placeholder="e.g. Sprinkler system impaired during repairs" />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Coverage" value={f.coverage} onChange={(v) => set("coverage", v as Coverage)} options={COVERAGE_OPTIONS} />
          {f.coverage === "custom" ? (
            <TextField label="Hours per week" value={f.hours} onChange={(v) => set("hours", v)} inputMode="decimal" required error={errors.hours} />
          ) : (
            <TextField label="Patrol every (minutes)" value={f.interval} onChange={(v) => set("interval", v)} inputMode="numeric" error={errors.interval} />
          )}
          {f.coverage === "custom" && (
            <TextField label="Patrol every (minutes)" value={f.interval} onChange={(v) => set("interval", v)} inputMode="numeric" error={errors.interval} />
          )}
          <TextField label="Start date" type="date" value={f.startDate} onChange={(v) => set("startDate", v)} error={errors.startDate} />
          <TextField label="Start time" type="time" value={f.startTime} onChange={(v) => set("startTime", v)} />
          <TextField label="Expected end date" type="date" value={f.endDate} onChange={(v) => set("endDate", v)} error={errors.endDate} hint="Leave blank if unknown." />
          <TextField
            label="Estimated rate ($/hr)"
            value={f.rate}
            onChange={(v) => set("rate", v)}
            inputMode="decimal"
            error={errors.rate}
            placeholder={settings.data?.default_rate != null ? String(settings.data.default_rate) : ""}
            hint={settings.data?.default_rate != null ? "Blank uses your default rate." : undefined}
          />
          <SelectField label="How they found us" value={f.source} onChange={(v) => set("source", v)} allowNone noneLabel="Not recorded" options={LEAD_SOURCES.map((s) => ({ value: s, label: s }))} />
        </div>
        <AreaField label="Notes" value={f.notes} onChange={(v) => set("notes", v)} rows={2} />
      </Section>
    </FormDialog>
  );
};
