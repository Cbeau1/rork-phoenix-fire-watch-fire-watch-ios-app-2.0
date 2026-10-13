import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { useEffect, useState } from "react";

import { FieldError, FieldHint, FieldLabel } from "@/components/fw/primitives";
import { createTeamLogin, generatePassword, nextGenericLoginEmail, RolePicker, type LoginCredentials } from "@/components/fw/TeamLogin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { friendlyError } from "@/lib/supabase";
import type { Role } from "@/lib/types";
import * as api from "@/lib/workforce/api";
import { fullName, type Worker } from "@/lib/workforce/constants";
import { useWorkforce } from "@/state/WorkforceProvider";

import { FormDialog } from "./kit";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Gives an existing Workforce employee a Team login, linked to their profile. */
export const AddToTeamDialog = ({
  worker,
  open,
  onOpenChange,
  onCreated,
}: {
  worker: Worker;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (c: LoginCredentials) => void;
}) => {
  const wf = useWorkforce();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>(generatePassword);
  const [role, setRole] = useState<Role>("officer");
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setEmail(worker.email || nextGenericLoginEmail(worker.first_name, worker.last_name, wf.members.map((m) => m.email)).email);
    setPassword(generatePassword());
    setRole("officer");
    setErrors({});
    // Only re-seed when the dialog opens, not when the member list refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, worker]);

  const name = fullName(worker);

  const create = useMutation({
    mutationFn: async (): Promise<LoginCredentials> => {
      const e = email.trim().toLowerCase();
      // The login is matched to this profile by email, so keep them identical.
      if (e !== (worker.email ?? "").toLowerCase()) await api.updateWorker(worker.id, { email: e });
      await createTeamLogin({ fullName: name, email: e, password, role });
      return { name, email: e, password };
    },
    onSuccess: (c) => {
      wf.invalidate("workers", "checklist", "members");
      void queryClient.invalidateQueries({ queryKey: ["members"] });
      onOpenChange(false);
      onCreated(c);
    },
    onError: (err) => setErrors({ form: friendlyError(err) }),
  });

  const submit = () => {
    const next: Record<string, string> = {};
    const e = email.trim().toLowerCase();
    if (!EMAIL_RE.test(e)) next.email = "Enter a valid email address — it's their username.";
    else if (wf.members.some((m) => m.email.toLowerCase() === e)) next.email = "Someone on your Team already uses this email.";
    if (password.length < 8) next.password = "Use at least 8 characters.";
    setErrors(next);
    if (Object.keys(next).length === 0) create.mutate();
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Add ${name} to Team`}
      description="Creates their app login and links it to this Workforce profile. They'll appear on the Team page."
      dirty={false}
      saving={create.isPending}
      onSubmit={submit}
      submitLabel="Create login"
    >
      <div>
        <FieldLabel htmlFor="att-email" required>
          Email (their username)
        </FieldLabel>
        <Input id="att-email" type="email" inputMode="email" value={email} aria-invalid={!!errors.email} onChange={(ev) => setEmail(ev.target.value)} placeholder="officer@company.com" />
        {errors.email ? (
          <FieldError message={errors.email} />
        ) : (
          <FieldHint>{worker.email ? "Also saved as the email on this profile." : "Generated from their name — change it if they have their own email."}</FieldHint>
        )}
      </div>
      <div>
        <FieldLabel htmlFor="att-password" required>
          Temporary password
        </FieldLabel>
        <div className="flex gap-2">
          <Input id="att-password" value={password} aria-invalid={!!errors.password} onChange={(ev) => setPassword(ev.target.value)} className="font-mono" autoComplete="off" />
          <Button type="button" variant="outline" onClick={() => setPassword(generatePassword())}>
            <KeyRound />
            Generate
          </Button>
        </div>
        {errors.password ? <FieldError message={errors.password} /> : <FieldHint>They can change it after signing in.</FieldHint>}
      </div>
      <div>
        <div className="mb-2 text-sm font-medium text-ink">Team role</div>
        <RolePicker value={role} onChange={setRole} />
      </div>
      {errors.form && (
        <p role="alert" className="rounded-lg border border-status-incident/40 bg-status-incident/10 px-3.5 py-2.5 text-sm text-status-incident-ink">
          {errors.form}
        </p>
      )}
    </FormDialog>
  );
};
