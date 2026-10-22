import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { AreaField, FormDialog, TextField } from "@/components/workforce/kit";
import {
  EMPTY_INSPECTOR,
  isEmail,
  toInput,
  useSaveInspector,
  type FireInspector,
  type InspectorInput,
} from "@/lib/inspectors";
import { friendlyError } from "@/lib/supabase";

interface Props {
  open: boolean;
  /** Existing inspector to edit; null to add a new one. */
  inspector: FireInspector | null;
  onClose: () => void;
  onSaved?: (saved: FireInspector) => void;
}

/** Add or edit a fire inspector in the directory. */
export const InspectorFormDialog = ({ open, inspector, onClose, onSaved }: Props) => {
  const save = useSaveInspector();
  const initial = useMemo<InspectorInput>(() => (inspector ? toInput(inspector) : EMPTY_INSPECTOR), [inspector]);
  const [form, setForm] = useState<InspectorInput>(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof InspectorInput, string>>>({});

  useEffect(() => {
    if (open) {
      setForm(initial);
      setErrors({});
    }
  }, [open, initial]);

  const set = (k: keyof InspectorInput) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const dirty = (Object.keys(form) as (keyof InspectorInput)[]).some((k) => form[k] !== initial[k]);

  const submit = () => {
    const next: Partial<Record<keyof InspectorInput, string>> = {};
    if (!form.name.trim()) next.name = "Name is required.";
    if (form.email.trim() && !isEmail(form.email)) next.email = "Enter a valid email.";
    if (form.notes.length > 4000) next.notes = "Keep notes under 4,000 characters.";
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    save.mutate(
      { id: inspector?.id, input: form },
      {
        onSuccess: (saved) => {
          toast.success(inspector ? "Inspector updated" : "Inspector added");
          onSaved?.(saved);
          onClose();
        },
        onError: (e) => toast.error(friendlyError(e)),
      },
    );
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={inspector ? "Edit fire inspector" : "Add fire inspector"}
      description={inspector ? "Changes also update the fire marshal contact on every property they're assigned to." : undefined}
      dirty={dirty}
      saving={save.isPending}
      onSubmit={submit}
      submitLabel={inspector ? "Save changes" : "Add inspector"}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Name" value={form.name} onChange={set("name")} required maxLength={120} error={errors.name} />
        <TextField label="Title" value={form.title} onChange={set("title")} placeholder="e.g. Fire Inspector II" maxLength={120} />
        <TextField label="Department" value={form.department} onChange={set("department")} placeholder="e.g. LA County Fire" maxLength={160} />
        <TextField label="Jurisdiction" value={form.jurisdiction} onChange={set("jurisdiction")} placeholder="City or district" maxLength={160} />
        <TextField label="Office phone" type="tel" inputMode="tel" value={form.phone} onChange={set("phone")} maxLength={40} />
        <TextField label="Mobile" type="tel" inputMode="tel" value={form.mobile} onChange={set("mobile")} maxLength={40} />
      </div>
      <TextField label="Email" type="email" inputMode="email" value={form.email} onChange={set("email")} maxLength={200} error={errors.email} />
      <TextField label="Office address" value={form.address} onChange={set("address")} maxLength={300} />
      <AreaField label="Notes" value={form.notes} onChange={set("notes")} rows={3} error={errors.notes} placeholder="Best times to reach, inspection preferences…" />
    </FormDialog>
  );
};
