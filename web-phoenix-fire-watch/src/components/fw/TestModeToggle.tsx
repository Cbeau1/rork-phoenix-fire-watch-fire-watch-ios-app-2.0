import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { DispatchSettingsDialog } from "@/components/fw/DispatchSettingsDialog";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/workforce/kit";
import { type DispatchSettings, fetchSettings, saveSettings } from "@/lib/dispatch/api";
import { friendlyError } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useAuth } from "@/state/AuthProvider";

const okPhone = (s: string): boolean => {
  const d = s.replace(/\D/g, "");
  return d.length === 10 || (d.length === 11 && d.startsWith("1"));
};

/** Same defaults the server and the Alert settings dialog use when no settings row exists yet. */
const patchFrom = (s: DispatchSettings | null, testMode: boolean): Omit<DispatchSettings, "org_id"> => ({
  alert_phones: s?.alert_phones ?? [],
  grace_minutes: s?.grace_minutes ?? 10,
  late_minutes: s?.late_minutes ?? 15,
  sms_alerts: s?.sms_alerts ?? true,
  test_mode: testMode,
  test_phone: s?.test_phone ?? "",
  test_email: s?.test_email ?? "",
});

/**
 * Admin-only, always within reach: flip test mode before an upgrade so guards and clients get no texts or
 * report emails (everything goes to the test phone/email instead). Turning it off asks for confirmation.
 */
export const TestModeToggle = ({ variant = "full" }: { variant?: "full" | "compact" }) => {
  const { isAdmin, user } = useAuth();
  const orgId = user?.orgId ?? "";
  const qc = useQueryClient();
  const [confirmOff, setConfirmOff] = useState<boolean>(false);
  const [setupOpen, setSetupOpen] = useState<boolean>(false);

  const q = useQuery({
    queryKey: ["dispatch", "settings", orgId],
    enabled: isAdmin && !!orgId,
    queryFn: () => fetchSettings(orgId),
    staleTime: 30_000,
  });

  const save = useMutation({
    mutationFn: (on: boolean) => saveSettings(orgId, patchFrom(q.data ?? null, on)),
    onSuccess: (_r, on) => {
      setConfirmOff(false);
      void qc.invalidateQueries({ queryKey: ["dispatch"] });
      void qc.invalidateQueries({ queryKey: ["reports"] });
      if (on) toast.success("Test mode on", { description: `Texts and report emails now go only to ${q.data?.test_phone || "the test phone"}${q.data?.test_email ? ` / ${q.data.test_email}` : ""}.` });
      else toast.success("Test mode off", { description: "Guards and clients receive texts and report emails again." });
    },
    onError: (e) => toast.error("Couldn't change test mode", { description: friendlyError(e) }),
  });

  if (!isAdmin || !orgId) return null;

  // No settings row yet = the server treats the org as in test mode.
  const on = q.data ? q.data.test_mode : true;
  const busy = q.isLoading || save.isPending;

  const onChange = (next: boolean) => {
    if (next) {
      if (!okPhone(q.data?.test_phone ?? "")) {
        toast.message("Add a test phone first", { description: "Test messages need somewhere to go." });
        setSetupOpen(true);
        return;
      }
      save.mutate(true);
    } else {
      setConfirmOff(true);
    }
  };

  const label = q.isError ? "Test mode: unknown" : on ? "Test mode on" : "Test mode off";

  return (
    <>
      {variant === "compact" ? (
        <label
          title={on ? "Test mode is on — texts and report emails go only to the test contacts" : "Test mode is off — messages go to real people"}
          className={cn(
            "flex cursor-pointer flex-col items-center gap-1 rounded-lg px-1 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em]",
            on ? "text-status-follow" : "text-ink-3",
          )}
        >
          <Switch checked={on} onCheckedChange={onChange} disabled={busy || q.isError} aria-label={label} className="scale-90" />
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Test"}
        </label>
      ) : (
        <label
          className={cn(
            "flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors",
            on ? "border-status-follow/45 bg-status-follow/[0.09]" : "border-line bg-surface hover:bg-raised",
          )}
        >
          <FlaskConical className={cn("h-[18px] w-[18px] shrink-0", on ? "text-status-follow" : "text-ink-3")} />
          <span className="min-w-0 flex-1">
            <span className={cn("block text-sm font-medium", on ? "text-status-follow" : "text-ink")}>{label}</span>
            <span className="block truncate text-xs text-ink-3">
              {q.isError ? "Couldn't load — check Dispatch" : on ? `Messages only to ${q.data?.test_phone || "test phone"}` : "Messages go to real people"}
            </span>
          </span>
          {busy ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-ink-3" />
          ) : (
            <Switch checked={on} onCheckedChange={onChange} disabled={q.isError} aria-label={on ? "Turn test mode off" : "Turn test mode on"} />
          )}
        </label>
      )}

      <ConfirmDialog
        open={confirmOff}
        onOpenChange={setConfirmOff}
        title="Turn off test mode?"
        description="Shift links and alerts will text real guards and admins, and daily reports will email your clients. Turn it back on anytime before an upgrade."
        confirmLabel="Turn off test mode"
        destructive
        busy={save.isPending}
        onConfirm={() => save.mutate(false)}
      />
      {setupOpen && <DispatchSettingsDialog open onOpenChange={setSetupOpen} orgId={orgId} settings={q.data ?? null} />}
    </>
  );
};
