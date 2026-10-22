import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, MessageSquareText } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { AreaField, CheckField, FormDialog, TextField } from "@/components/workforce/kit";
import { saveSettings, sendTestText, type DispatchSettings } from "@/lib/dispatch/api";
import { friendlyError } from "@/lib/supabase";

interface Draft {
  phones: string;
  grace: string;
  late: string;
  smsAlerts: boolean;
  testMode: boolean;
  testPhone: string;
  testEmail: string;
  autoText: boolean;
  autoEmail: boolean;
}

const toDraft = (s: DispatchSettings | null): Draft => ({
  phones: (s?.alert_phones ?? []).join("\n"),
  grace: String(s?.grace_minutes ?? 10),
  late: String(s?.late_minutes ?? 15),
  smsAlerts: s?.sms_alerts ?? true,
  testMode: s?.test_mode ?? true,
  testPhone: s?.test_phone ?? "",
  testEmail: s?.test_email ?? "",
  autoText: s?.auto_link_text ?? false,
  autoEmail: s?.auto_link_email ?? false,
});

const digits = (s: string): string => s.replace(/\D/g, "");
const okPhone = (s: string): boolean => {
  const d = digits(s);
  return d.length === 10 || (d.length === 11 && d.startsWith("1"));
};
const splitPhones = (s: string): string[] =>
  s
    .split(/[\n,;]+/)
    .map((p) => p.trim())
    .filter(Boolean);

/** Admin settings for overdue alerts and texting (test mode keeps every text on the test phone). */
export const DispatchSettingsDialog = ({
  open,
  onOpenChange,
  orgId,
  settings,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  orgId: string;
  settings: DispatchSettings | null;
}) => {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => toDraft(settings));
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});

  useEffect(() => {
    if (open) {
      setDraft(toDraft(settings));
      setErrors({});
    }
  }, [open, settings]);

  const initial = useMemo(() => JSON.stringify(toDraft(settings)), [settings]);
  const dirty = JSON.stringify(draft) !== initial;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const save = useMutation({
    mutationFn: async () => {
      const e: Partial<Record<keyof Draft, string>> = {};
      const phones = splitPhones(draft.phones);
      const bad = phones.find((p) => !okPhone(p));
      if (bad) e.phones = `"${bad}" isn't a 10-digit US number.`;
      if (phones.length > 10) e.phones = "Up to 10 numbers.";
      const grace = Number(draft.grace);
      if (!Number.isInteger(grace) || grace < 0 || grace > 120) e.grace = "0–120 minutes.";
      const late = Number(draft.late);
      if (!Number.isInteger(late) || late < 5 || late > 240) e.late = "5–240 minutes.";
      if (draft.testMode && !okPhone(draft.testPhone)) e.testPhone = "Test mode needs a test phone number.";
      if (draft.testEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.testEmail.trim())) e.testEmail = "Enter a valid email.";
      setErrors(e);
      if (Object.keys(e).length) throw new Error("Please fix the highlighted fields.");
      await saveSettings(orgId, {
        alert_phones: phones,
        grace_minutes: grace,
        late_minutes: late,
        sms_alerts: draft.smsAlerts,
        test_mode: draft.testMode,
        test_phone: draft.testPhone.trim(),
        test_email: draft.testEmail.trim(),
        auto_link_text: draft.autoText,
        auto_link_email: draft.autoEmail,
        link_origin: window.location.origin,
      });
    },
    onSuccess: () => {
      toast.success("Alert settings saved");
      void qc.invalidateQueries({ queryKey: ["dispatch"] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : friendlyError(e)),
  });

  const test = useMutation({
    mutationFn: sendTestText,
    onSuccess: (r) => toast.success(`Test text sent to ${r.sent_to.join(", ")}${r.test_mode ? " (test mode)" : ""}`),
    onError: (e) => toast.error(e instanceof Error ? e.message : friendlyError(e)),
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Alert settings"
      description="Who gets texted when a guard misses a patrol or doesn't check in."
      dirty={dirty}
      saving={save.isPending}
      onSubmit={() => save.mutate()}
      footerExtra={
        <Button type="button" variant="ghost" disabled={test.isPending || dirty} onClick={() => test.mutate()} title={dirty ? "Save first" : undefined}>
          {test.isPending ? <Loader2 className="animate-spin" /> : <MessageSquareText />}
          Send test text
        </Button>
      }
    >
      <AreaField
        label="Admin phones to text"
        value={draft.phones}
        onChange={(v) => set("phones", v)}
        rows={3}
        placeholder={"(661) 431-7747\n(555) 555-0199"}
        hint="One per line. Alerts always show on the dispatch board too."
        error={errors.phones}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Patrol grace period (min)"
          value={draft.grace}
          onChange={(v) => set("grace", v)}
          inputMode="numeric"
          hint="Alert this long after a patrol is due."
          error={errors.grace}
        />
        <TextField
          label="Late check-in after (min)"
          value={draft.late}
          onChange={(v) => set("late", v)}
          inputMode="numeric"
          hint="Alert if no check-in this long after start."
          error={errors.late}
        />
      </div>
      <CheckField label="Text admins about alerts" checked={draft.smsAlerts} onChange={(v) => set("smsAlerts", v)} hint="Off = board only." />

      <div className="grid gap-3 rounded-lg border border-line bg-raised/40 p-4">
        <div>
          <p className="text-sm font-semibold text-ink">Send shift links automatically</p>
          <p className="text-xs text-ink-3">
            1 hour before each shift starts, if the guard doesn't already have a link. One try per shift; you can still send or reissue by hand.
          </p>
        </div>
        <CheckField label="Auto-text link 1 hr before shift" checked={draft.autoText} onChange={(v) => set("autoText", v)} />
        <CheckField
          label="Auto-email link 1 hr before shift"
          checked={draft.autoEmail}
          onChange={(v) => set("autoEmail", v)}
          hint="Uses the email on their worker record or app login."
        />
        {(draft.autoText || draft.autoEmail) && draft.testMode && (
          <p className="text-xs font-medium text-status-follow">Test mode is on, so automatic links go only to the test contacts.</p>
        )}
      </div>

      <div className="grid gap-4 rounded-lg border border-status-follow/40 bg-status-follow/[0.06] p-4">
        <CheckField
          label="Test mode"
          checked={draft.testMode}
          onChange={(v) => set("testMode", v)}
          hint="Every text (shift links and alerts) and every report email goes only to the test contacts below."
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Test phone"
            value={draft.testPhone}
            onChange={(v) => set("testPhone", v)}
            inputMode="tel"
            required={draft.testMode}
            error={errors.testPhone}
          />
          <TextField
            label="Test email"
            value={draft.testEmail}
            onChange={(v) => set("testEmail", v)}
            inputMode="email"
            type="email"
            error={errors.testEmail}
          />
        </div>
        {!draft.testMode && (
          <p className="text-sm font-medium text-status-follow">
            With test mode off, shift links text the real guards and alerts text the admin phones above.
          </p>
        )}
      </div>
    </FormDialog>
  );
};
