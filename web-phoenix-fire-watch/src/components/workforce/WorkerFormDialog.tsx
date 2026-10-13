import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, KeyRound, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { FieldError, FieldHint, FieldLabel } from "@/components/fw/primitives";
import {
  createGenericTeamLogin,
  createTeamLogin,
  generatePassword,
  nextGenericLoginEmail,
  RolePicker,
  type LoginCredentials,
} from "@/components/fw/TeamLogin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { friendlyError } from "@/lib/supabase";
import type { Role } from "@/lib/types";
import * as api from "@/lib/workforce/api";
import {
  AGENCY_STATUSES,
  DIRECT_STATUSES,
  PREFERRED_CONTACT,
  SOURCE_LABEL,
  WORKER_STATUS,
  type Worker,
  type WorkerSource,
} from "@/lib/workforce/constants";
import { useAuth } from "@/state/AuthProvider";
import { useWorkforce } from "@/state/WorkforceProvider";

import { AreaField, CheckField, FormDialog, isDate, SelectField, TextField } from "./kit";

interface Draft {
  source: WorkerSource;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  position: string;
  service_areas: string;
  start_date: string;
  status: string;
  agency_id: string;
  agency_worker_ref: string;
  address: string;
  emergency_name: string;
  emergency_relationship: string;
  emergency_phone: string;
  preferred_contact: string;
  availability: string;
  profile_id: string;
  staff_id: string;
}

const toDraft = (w: Worker | null, source: WorkerSource): Draft => ({
  source: (w?.source as WorkerSource) ?? source,
  first_name: w?.first_name ?? "",
  last_name: w?.last_name ?? "",
  phone: w?.phone ?? "",
  email: w?.email ?? "",
  position: w?.position ?? "",
  service_areas: (w?.service_areas ?? []).join(", "),
  start_date: w?.start_date ?? "",
  status: w?.status ?? (source === "agency" ? "pending_placement" : "onboarding"),
  agency_id: w?.agency_id ?? "",
  agency_worker_ref: w?.agency_worker_ref ?? "",
  address: w?.address ?? "",
  emergency_name: w?.emergency_name ?? "",
  emergency_relationship: w?.emergency_relationship ?? "",
  emergency_phone: w?.emergency_phone ?? "",
  preferred_contact: w?.preferred_contact ?? "",
  availability: w?.availability ?? "",
  profile_id: w?.profile_id ?? "",
  staff_id: w?.staff_id ?? "",
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Dupe = { id: string; worker_code: string; full_name: string; source: string; reason: string };

/** Navigation state handed to the new worker's profile so it can show the one-time login details. */
export type NewLoginState = { newLogin?: LoginCredentials; loginError?: string };

/** Create or edit a worker profile (direct employee or temporary agency worker). */
export const WorkerFormDialog = ({
  open,
  onOpenChange,
  worker,
  defaultSource = "direct",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  worker: Worker | null;
  defaultSource?: WorkerSource;
}) => {
  const wf = useWorkforce();
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [addToTeam, setAddToTeam] = useState<boolean>(true);
  const [password, setPassword] = useState<string>(generatePassword);
  const [role, setRole] = useState<Role>("officer");
  const [d, setD] = useState<Draft>(() => toDraft(worker, defaultSource));
  const [initial, setInitial] = useState<string>("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dupes, setDupes] = useState<Dupe[] | null>(null);

  useEffect(() => {
    if (!open) return;
    const next = toDraft(worker, defaultSource);
    setD(next);
    setInitial(JSON.stringify(next));
    setErrors({});
    setDupes(null);
    setAddToTeam(true);
    setPassword(generatePassword());
    setRole("officer");
  }, [open, worker, defaultSource]);

  const dirty = JSON.stringify(d) !== initial;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setD((p) => ({ ...p, [k]: v }));
    if (k === "first_name" || k === "last_name" || k === "email" || k === "phone") setDupes(null);
  };

  const statuses = d.source === "agency" ? AGENCY_STATUSES.filter((s) => s !== "do_not_assign" || worker?.status === "do_not_assign") : DIRECT_STATUSES;

  const linkedProfiles = useMemo(
    () => new Set(wf.workers.filter((w) => w.id !== worker?.id && w.profile_id).map((w) => w.profile_id)),
    [wf.workers, worker],
  );
  const linkedStaff = useMemo(
    () => new Set(wf.workers.filter((w) => w.id !== worker?.id && w.staff_id).map((w) => w.staff_id)),
    [wf.workers, worker],
  );

  /** New workers get a Team login (app account) in the same step unless the admin opts out. */
  const canAddToTeam = !worker && isAdmin && !d.profile_id;
  const willAddToTeam = canAddToTeam && addToTeam;
  /** Login username: their email, or a generated name-based one when no email is entered. */
  const loginPreview = useMemo(() => {
    const typed = d.email.trim().toLowerCase();
    if (typed) return { email: typed, generated: false };
    if (!d.first_name.trim() && !d.last_name.trim()) return null;
    const { email } = nextGenericLoginEmail(d.first_name, d.last_name, wf.members.map((m) => m.email));
    return { email, generated: true };
  }, [d.email, d.first_name, d.last_name, wf.members]);

  const save = useMutation({
    mutationFn: async (): Promise<{ w: Worker; state: NewLoginState }> => {
      const row = {
        first_name: d.first_name.trim(),
        last_name: d.last_name.trim(),
        phone: d.phone.trim(),
        email: d.email.trim().toLowerCase(),
        position: d.position.trim(),
        service_areas: d.service_areas
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 20),
        start_date: d.start_date || null,
        status: d.status,
        agency_id: d.source === "agency" ? d.agency_id : null,
        agency_worker_ref: d.source === "agency" ? d.agency_worker_ref.trim() : "",
        address: d.address.trim(),
        emergency_name: d.emergency_name.trim(),
        emergency_relationship: d.emergency_relationship.trim(),
        emergency_phone: d.emergency_phone.trim(),
        preferred_contact: d.preferred_contact,
        availability: d.availability.trim(),
        profile_id: d.profile_id || null,
        staff_id: d.staff_id || null,
      };
      if (worker) return { w: await api.updateWorker(worker.id, row), state: {} };
      const w = await api.createWorker({ ...row, source: d.source, org_id: wf.orgId });
      if (!willAddToTeam) return { w, state: {} };
      // Profile first: the new login is matched to it by email, so no duplicate profile is created.
      if (!row.email) {
        let saved = "";
        try {
          const credentials = await createGenericTeamLogin({
            first: row.first_name,
            last: row.last_name,
            taken: wf.members.map((m) => m.email),
            password,
            role,
            beforeAttempt: async (email) => {
              await api.updateWorker(w.id, { email });
              saved = email;
            },
          });
          return { w: { ...w, email: credentials.email }, state: { newLogin: credentials } };
        } catch (err) {
          if (saved) await api.updateWorker(w.id, { email: "" }).catch(() => undefined);
          return { w, state: { loginError: friendlyError(err) } };
        }
      }
      const credentials: LoginCredentials = { name: `${row.first_name} ${row.last_name}`, email: row.email, password };
      try {
        await createTeamLogin({ fullName: credentials.name, email: credentials.email, password, role });
        return { w, state: { newLogin: credentials } };
      } catch (err) {
        return { w, state: { loginError: friendlyError(err) } };
      }
    },
    onSuccess: ({ w, state }) => {
      wf.invalidate("workers", "checklist", "members");
      void queryClient.invalidateQueries({ queryKey: ["members"] });
      if (worker) toast.success("Profile saved");
      else if (state.newLogin) toast.success(`Profile created — ${w.worker_code}`, { description: "Also added to Team with an app login." });
      else if (state.loginError) toast.error(`Profile created — ${w.worker_code}, but the Team login failed`, { description: state.loginError });
      else toast.success(`Profile created — ${w.worker_code}`);
      onOpenChange(false);
      if (!worker) navigate(`/workforce/workers/${w.id}`, { state });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Couldn't save the profile."),
  });

  const submit = async () => {
    const e: Record<string, string> = {};
    if (!d.first_name.trim()) e.first_name = "First name is required.";
    if (!d.last_name.trim()) e.last_name = "Last name is required.";
    if (d.source === "agency" && !d.agency_id) e.agency_id = "Choose the staffing agency.";
    if (!d.status) e.status = "Choose a status.";
    if (d.email.trim() && !EMAIL_RE.test(d.email.trim())) e.email = "Enter a valid email address.";
    if (willAddToTeam) {
      const email = d.email.trim().toLowerCase();
      if (email && wf.members.some((m) => m.email.toLowerCase() === email)) e.email = "Someone on your Team already uses this email.";
      if (password.length < 8) e.password = "Use at least 8 characters.";
    }
    if (d.start_date && !isDate(d.start_date)) e.start_date = "Use a valid date.";
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    if (dupes === null) {
      try {
        const found = (await api.findDuplicates(d.first_name, d.last_name, d.email, d.phone, worker?.id)) as Dupe[];
        if (found.length > 0) {
          setDupes(found);
          return;
        }
      } catch {
        // Duplicate check is advisory only.
      }
    }
    save.mutate();
  };

  const agencyOptions = wf.agencies
    .filter((a) => !a.archived_at && (a.active || a.id === d.agency_id))
    .map((a) => ({ value: a.id, label: a.name }));

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={worker ? `Edit ${worker.first_name} ${worker.last_name}` : "Add worker"}
      description={worker ? `${worker.worker_code} · ${SOURCE_LABEL[worker.source as WorkerSource]}` : "A unique worker ID is assigned automatically."}
      dirty={dirty}
      saving={save.isPending}
      onSubmit={() => void submit()}
      submitLabel={dupes && dupes.length > 0 ? "Save anyway" : worker ? "Save changes" : willAddToTeam ? "Create profile & login" : "Create profile"}
      wide
    >
      {!worker && (
        <SelectField
          label="Worker source"
          required
          value={d.source}
          onChange={(v) => {
            const src = v as WorkerSource;
            setD((p) => ({ ...p, source: src, status: src === "agency" ? "pending_placement" : "onboarding" }));
          }}
          options={[
            { value: "direct", label: SOURCE_LABEL.direct },
            { value: "agency", label: SOURCE_LABEL.agency },
          ]}
        />
      )}
      {d.source === "agency" && agencyOptions.length === 0 && (
        <p className="rounded-lg border border-status-follow/40 bg-status-follow/10 px-3.5 py-2.5 text-sm text-ink">
          Add a staffing agency first (Agencies tab), then create the agency worker.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField label="First name" required value={d.first_name} onChange={(v) => set("first_name", v)} error={errors.first_name} maxLength={80} />
        <TextField label="Last name" required value={d.last_name} onChange={(v) => set("last_name", v)} error={errors.last_name} maxLength={80} />
        <TextField label="Phone" type="tel" inputMode="tel" value={d.phone} onChange={(v) => set("phone", v)} maxLength={40} />
        <TextField
          label="Email"
          type="email"
          inputMode="email"
          value={d.email}
          onChange={(v) => set("email", v)}
          error={errors.email}
          hint={willAddToTeam ? (d.email.trim() ? "Also their Team login username." : "Optional — leave blank to generate a login email.") : undefined}
          maxLength={200}
        />
        <TextField label="Position" value={d.position} onChange={(v) => set("position", v)} placeholder="e.g. Fire Watch Officer" maxLength={120} />
        <TextField
          label={d.source === "agency" ? "First assignment date" : "Hire date"}
          type="date"
          value={d.start_date}
          onChange={(v) => set("start_date", v)}
          error={errors.start_date}
        />
        <SelectField
          label="Status"
          required
          value={d.status}
          onChange={(v) => set("status", v)}
          error={errors.status}
          options={statuses.map((s) => ({ value: s, label: WORKER_STATUS[s]?.label ?? s }))}
          disabled={worker?.status === "do_not_assign"}
          hint={
            worker?.status === "do_not_assign"
              ? "Managed by the do-not-assign restriction on the Personnel tab."
              : d.source === "agency"
                ? "“Do not assign” is set from the Personnel tab with a documented reason."
                : "Onboarding paperwork is tracked separately and never changes this status."
          }
        />
        <TextField label="Service areas" value={d.service_areas} onChange={(v) => set("service_areas", v)} placeholder="Comma separated, e.g. Downtown, North" hint="Separate areas with commas." />
      </div>

      {canAddToTeam && (
        <div className="space-y-4 rounded-xl border border-line bg-raised/50 p-4">
          <CheckField
            label="Also add to Team"
            hint="Creates their app login so they appear on the Team page and can clock in and log patrols."
            checked={addToTeam}
            onChange={setAddToTeam}
          />
          {addToTeam && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <div className="text-sm font-medium text-ink">Login email</div>
                <div className="mt-1.5 flex min-h-11 items-center break-all rounded-md border border-line bg-field px-3 py-2 font-mono text-sm text-link">
                  {loginPreview?.email ?? <span className="font-sans text-ink-3">Enter a name to generate it</span>}
                </div>
                <FieldHint>
                  {loginPreview?.generated
                    ? "Generated from their name. Shown with the password after saving so you can share it."
                    : "Uses the email above."}
                </FieldHint>
              </div>
              <div>
                <FieldLabel htmlFor="wf-team-password" required>
                  Temporary password
                </FieldLabel>
                <div className="flex gap-2">
                  <Input
                    id="wf-team-password"
                    value={password}
                    aria-invalid={!!errors.password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="font-mono"
                    autoComplete="off"
                  />
                  <Button type="button" variant="outline" onClick={() => setPassword(generatePassword())} aria-label="Generate a new password">
                    <KeyRound />
                    <span className="hidden sm:inline">Generate</span>
                  </Button>
                </div>
                {errors.password ? <FieldError message={errors.password} /> : <FieldHint>Shown once after saving so you can share it.</FieldHint>}
              </div>
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-ink">
                  <Users className="h-4 w-4 text-ink-3" />
                  Team role
                </div>
                <RolePicker value={role} onChange={setRole} />
              </div>
            </div>
          )}
        </div>
      )}

      {d.source === "agency" && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SelectField label="Staffing agency" required value={d.agency_id} onChange={(v) => set("agency_id", v)} error={errors.agency_id} options={agencyOptions} />
          <TextField label="Agency worker / reference ID" value={d.agency_worker_ref} onChange={(v) => set("agency_worker_ref", v)} maxLength={80} />
        </div>
      )}

      <AreaField
        label={d.source === "agency" ? "Address (optional)" : "Address"}
        value={d.address}
        onChange={(v) => set("address", v)}
        rows={2}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <TextField label="Emergency contact" value={d.emergency_name} onChange={(v) => set("emergency_name", v)} maxLength={120} />
        <TextField label="Relationship" value={d.emergency_relationship} onChange={(v) => set("emergency_relationship", v)} maxLength={60} />
        <TextField label="Emergency phone" type="tel" value={d.emergency_phone} onChange={(v) => set("emergency_phone", v)} maxLength={40} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SelectField
          label="Preferred contact method"
          value={d.preferred_contact}
          onChange={(v) => set("preferred_contact", v)}
          options={Object.entries(PREFERRED_CONTACT).map(([value, label]) => ({ value, label }))}
          allowNone
          noneLabel="Not specified"
        />
        <TextField label="Availability" value={d.availability} onChange={(v) => set("availability", v)} placeholder="e.g. Nights & weekends" maxLength={200} />
        <SelectField
          label="Linked officer app account"
          value={d.profile_id}
          onChange={(v) => set("profile_id", v)}
          allowNone
          noneLabel="No app account"
          options={wf.members
            .filter((m) => !linkedProfiles.has(m.id))
            .map((m) => ({ value: m.id, label: `${m.full_name} · ${m.email}${m.active ? "" : " (inactive)"}` }))}
          hint={canAddToTeam && addToTeam ? "Pick an existing login instead of creating a new one." : "Accounts already linked to another profile are hidden."}
        />
        <SelectField
          label="Linked schedule name"
          value={d.staff_id}
          onChange={(v) => set("staff_id", v)}
          allowNone
          noneLabel="Not on the schedule"
          options={wf.staff.filter((s) => !linkedStaff.has(s.id)).map((s) => ({ value: s.id, label: s.name }))}
          hint="Connects existing scheduled shifts to Work History."
        />
      </div>

      {dupes && dupes.length > 0 && (
        <div className="rounded-lg border border-status-follow/50 bg-status-follow/10 px-4 py-3 text-sm" role="alert">
          <div className="flex items-center gap-2 font-medium text-status-follow">
            <AlertTriangle className="h-4 w-4" />
            Possible duplicate profile
          </div>
          <ul className="mt-2 space-y-1 text-ink">
            {dupes.map((x) => (
              <li key={x.id}>
                {x.full_name} · <span className="font-mono text-xs">{x.worker_code}</span> · {x.reason}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-ink-2">Review these before continuing. Press “Save anyway” if this is a different person.</p>
        </div>
      )}
    </FormDialog>
  );
};
