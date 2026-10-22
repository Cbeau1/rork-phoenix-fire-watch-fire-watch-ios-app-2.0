import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { History } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { AreaField, FormDialog, SelectField, TextField } from "@/components/workforce/kit";
import { fullDateTime } from "@/lib/format";
import { friendlyError, supabase } from "@/lib/supabase";
import { STATUS_META, type Patrol, type PatrolStatus } from "@/lib/types";
import { useFireWatch } from "@/state/FireWatchProvider";

const toLocalInput = (iso: string): string => format(new Date(iso), "yyyy-MM-dd'T'HH:mm");
const splitAreas = (s: string): string[] =>
  s
    .split(/[,\n]/)
    .map((a) => a.trim())
    .filter(Boolean);

const STATUS_OPTIONS = (Object.keys(STATUS_META) as PatrolStatus[]).map((k) => ({ value: k, label: STATUS_META[k].label }));

interface EditRow {
  id: string;
  edited_at: string;
  edited_by_name: string;
  reason: string;
}

/** Past corrections for one report (admins only — RLS hides it from others). */
const EditHistory = ({ patrolId }: { patrolId: string }) => {
  const { data } = useQuery({
    queryKey: ["patrol-edits", patrolId],
    queryFn: async (): Promise<EditRow[]> => {
      const { data, error } = await supabase
        .from("patrol_edits")
        .select("id, edited_at, edited_by_name, reason")
        .eq("patrol_id", patrolId)
        .order("edited_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as EditRow[];
    },
    staleTime: 30_000,
  });
  if (!data || data.length === 0) return null;
  return (
    <div className="rounded-lg border border-line bg-raised px-3.5 py-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3">
        <History className="h-3.5 w-3.5" />
        Edit history
      </div>
      <ul className="space-y-1.5 text-sm text-ink-2">
        {data.map((e) => (
          <li key={e.id}>
            <span className="font-mono text-xs text-ink-3">{fullDateTime(e.edited_at)}</span>
            {" · "}
            {e.edited_by_name || "Admin"}
            {e.reason && <span className="text-ink-3"> — {e.reason}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
};

interface Props {
  patrol: Patrol | null;
  onClose: () => void;
}

/** Admin correction of a submitted patrol report: time, officer, areas, status and notes. */
export const EditPatrolDialog = ({ patrol, onClose }: Props) => {
  const { editPatrol } = useFireWatch();
  const [when, setWhen] = useState<string>("");
  const [officer, setOfficer] = useState<string>("");
  const [areas, setAreas] = useState<string>("");
  const [status, setStatus] = useState<PatrolStatus>("clear");
  const [notes, setNotes] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [saving, setSaving] = useState<boolean>(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!patrol) return;
    setWhen(toLocalInput(patrol.dateTime));
    setOfficer(patrol.officerName);
    setAreas(patrol.areas.join(", "));
    setStatus(patrol.status);
    setNotes(patrol.notes);
    setReason("");
    setErrors({});
  }, [patrol]);

  const dirty = useMemo(() => {
    if (!patrol) return false;
    return (
      when !== toLocalInput(patrol.dateTime) ||
      officer !== patrol.officerName ||
      splitAreas(areas).join("|") !== patrol.areas.join("|") ||
      status !== patrol.status ||
      notes !== patrol.notes
    );
  }, [patrol, when, officer, areas, status, notes]);

  const submit = async () => {
    if (!patrol) return;
    const next: Record<string, string> = {};
    const date = new Date(when);
    if (!when || Number.isNaN(date.getTime())) next.when = "Enter a valid date and time.";
    else if (date.getTime() > Date.now() + 10 * 60_000) next.when = "Time can't be in the future.";
    if (!officer.trim()) next.officer = "Officer name is required.";
    const list = splitAreas(areas);
    if (list.length === 0) next.areas = "List at least one area.";
    else if (list.length > 30) next.areas = "Up to 30 areas.";
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    if (!dirty) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      await editPatrol({
        id: patrol.id,
        dateTime: date.toISOString(),
        officerName: officer.trim(),
        areas: list,
        status,
        notes,
        reason: reason.trim(),
      });
      toast.success("Report updated");
      onClose();
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormDialog
      open={!!patrol}
      onOpenChange={(v) => !v && onClose()}
      title="Edit patrol report"
      description="Correct the time or details. The original is kept in the edit history."
      dirty={dirty}
      saving={saving}
      onSubmit={() => void submit()}
      submitLabel="Save changes"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Date & time" type="datetime-local" value={when} onChange={setWhen} required error={errors.when} />
        <SelectField
          label="Status"
          value={status}
          onChange={(v) => setStatus(v as PatrolStatus)}
          options={STATUS_OPTIONS}
          required
        />
      </div>
      <TextField label="Officer" value={officer} onChange={setOfficer} required maxLength={120} error={errors.officer} />
      <TextField
        label="Areas checked"
        value={areas}
        onChange={setAreas}
        required
        maxLength={2000}
        hint="Separate areas with commas."
        error={errors.areas}
      />
      <AreaField label="Notes" value={notes} onChange={setNotes} rows={4} />
      <TextField
        label="Reason for edit"
        value={reason}
        onChange={setReason}
        maxLength={500}
        placeholder="e.g. Officer logged the wrong time"
        hint="Optional — saved with the edit history."
      />
      {patrol && <EditHistory patrolId={patrol.id} />}
    </FormDialog>
  );
};
