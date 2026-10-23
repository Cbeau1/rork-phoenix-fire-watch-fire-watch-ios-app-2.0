import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Download, FileSearch, Loader2, Mail, Plus, RotateCcw, Send, Settings2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { FieldLabel } from "@/components/fw/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { CheckField, ConfirmDialog, ErrorBlock, FormDialog, Pill, selectContent, selectItem, selectTrigger } from "@/components/workforce/kit";
import { downloadBlob } from "@/lib/report";
import {
  base64ToBlob,
  type DailyReportRun,
  type DailyReportSettings,
  fetchPropertyRuns,
  fetchRecipientSuggestions,
  fetchReportSettings,
  fetchReportStatus,
  fmtInTz,
  previewReport,
  reportDayLabel,
  reportDownloadUrl,
  retryReport,
  saveReportSettings,
  SEND_TIMES,
  sendReportNow,
  sendTimeLabel,
  tzAbbr,
} from "@/lib/reports/api";
import { friendlyError } from "@/lib/supabase";
import type { Tone } from "@/lib/workforce/constants";
import { cn } from "@/lib/utils";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ORG_TZ = "__org__";
const ZONES: { value: string; label: string }[] = [
  { value: "America/New_York", label: "Eastern (New York)" },
  { value: "America/Chicago", label: "Central (Chicago)" },
  { value: "America/Denver", label: "Mountain (Denver)" },
  { value: "America/Phoenix", label: "Arizona (Phoenix)" },
  { value: "America/Los_Angeles", label: "Pacific (Los Angeles)" },
  { value: "America/Anchorage", label: "Alaska" },
  { value: "Pacific/Honolulu", label: "Hawaii" },
];

export const runStatusMeta = (r: Pick<DailyReportRun, "status" | "test_mode">): { label: string; tone: Tone } => {
  switch (r.status) {
    case "sent":
      return r.test_mode ? { label: "Sent · test", tone: "amber" } : { label: "Sent", tone: "green" };
    case "failed":
      return { label: "Failed", tone: "red" };
    case "skipped":
      return { label: "Skipped", tone: "slate" };
    default:
      return { label: "Sending…", tone: "blue" };
  }
};

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** Admin-only: the automatic morning patrol report email for one property (send time chosen per property). */
export const DailyReportCard = ({ propertyId }: { propertyId: string }) => {
  const qc = useQueryClient();
  const keys = {
    settings: ["daily-report", "settings", propertyId],
    runs: ["daily-report", "runs", propertyId],
    status: ["daily-report", "status", propertyId],
  };
  const settings = useQuery({ queryKey: keys.settings, queryFn: () => fetchReportSettings(propertyId) });
  const runs = useQuery({
    queryKey: keys.runs,
    queryFn: () => fetchPropertyRuns(propertyId),
    refetchInterval: (q) => (q.state.data?.some((r) => r.status === "sending" || r.status === "queued") ? 5000 : false),
  });
  const status = useQuery({ queryKey: keys.status, queryFn: () => fetchReportStatus(propertyId), staleTime: 60_000 });

  const [editing, setEditing] = useState<boolean>(false);
  const [confirmSend, setConfirmSend] = useState<boolean>(false);
  const [previewing, setPreviewing] = useState<boolean>(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["daily-report"] });
  };

  const send = useMutation({
    mutationFn: () => sendReportNow(propertyId),
    onSuccess: (r) => {
      setConfirmSend(false);
      if (r.status === "sent") toast.success(r.test_mode ? "Report sent to the test email" : "Report sent");
      else if (r.status === "failed") toast.error("The report didn't send", { description: r.error });
      else toast.message("Nothing to send yet", { description: "No patrols, incidents or time on site in the last 24 hours, so no email went out." });
      refresh();
    },
    onError: (e) => toast.error("Couldn't send the report", { description: friendlyError(e) }),
  });

  const s = settings.data;
  const st = status.data;
  const tz = st?.tz ?? "America/New_York";

  const preview = async () => {
    setPreviewing(true);
    try {
      const r = await previewReport(propertyId, s?.include_photos ?? true);
      downloadBlob(base64ToBlob(r.pdf_base64), r.filename);
      if (r.empty) toast.message("Preview downloaded — nothing recorded yet", { description: "No activity in the last 24 hours. A blank report is never emailed." });
      else toast.success("Preview downloaded", { description: "Covers the last 24 hours, up to now." });
    } catch (e) {
      toast.error("Couldn't build the preview", { description: friendlyError(e) });
    } finally {
      setPreviewing(false);
    }
  };

  const retry = async (run: DailyReportRun) => {
    setRowBusy(run.id);
    try {
      const r = await retryReport(run.id);
      if (r.status === "sent") toast.success(r.test_mode ? "Sent to the test email" : "Report sent");
      else toast.error("Still failing", { description: r.error });
    } catch (e) {
      toast.error("Couldn't retry", { description: friendlyError(e) });
    } finally {
      setRowBusy(null);
      refresh();
    }
  };

  const download = async (run: DailyReportRun) => {
    setRowBusy(run.id);
    try {
      const { url } = await reportDownloadUrl(run.id);
      window.open(url, "_blank", "noopener");
    } catch (e) {
      toast.error("Couldn't open the PDF", { description: friendlyError(e) });
    } finally {
      setRowBusy(null);
    }
  };

  const toggle = useMutation({
    mutationFn: (on: boolean) => saveReportSettings({ ...(s as DailyReportSettings), enabled: on }),
    onSuccess: (r) => {
      qc.setQueryData(keys.settings, r);
      toast.success(r.enabled ? `Daily report on — sends every day at ${sendTimeLabel(r.send_time)}` : "Daily report turned off");
      refresh();
    },
    onError: (e) => toast.error("Couldn't change the daily report", { description: friendlyError(e) }),
  });

  const enabled = !!s?.enabled;
  const recipients = s?.recipients ?? [];
  const at = sendTimeLabel(s?.send_time ?? "09:00");
  const zone = st?.tz ? ` ${tzAbbr(st.next_send_at ?? new Date().toISOString(), tz)}` : "";

  const onToggle = (on: boolean) => {
    if (!s) return;
    // Turning on needs someone to send to — open settings instead of failing.
    if (on && recipients.length === 0) {
      toast.message("Add who gets the report first", { description: "Then switch it on." });
      setEditing(true);
      return;
    }
    toggle.mutate(on);
  };

  return (
    <section className="mt-5 overflow-hidden rounded-xl border border-line bg-surface shadow-card" aria-labelledby="daily-report-title">
      <div className="flex flex-col gap-5 p-6 sm:p-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <Mail className={cn("mt-0.5 h-8 w-8 shrink-0", enabled ? "text-link" : "text-ink-3")} strokeWidth={1.6} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="daily-report-title" className="font-display text-xl font-bold text-ink sm:text-[22px]">
                  Daily report email
                </h2>
                <label
                  className={cn(
                    "inline-flex cursor-pointer items-center gap-2 rounded-full py-0.5 pl-1 pr-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] ring-1 ring-inset transition-colors",
                    enabled ? "bg-status-clear/10 text-status-clear ring-status-clear/30" : "bg-raised text-ink-3 ring-line",
                    (!s || toggle.isPending) && "cursor-wait opacity-70",
                  )}
                >
                  <Switch
                    checked={enabled}
                    onCheckedChange={onToggle}
                    disabled={!s || toggle.isPending}
                    aria-label={enabled ? "Turn the daily report off for this property" : "Turn the daily report on for this property"}
                    className="scale-75"
                  />
                  {settings.isLoading ? "…" : toggle.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : enabled ? "On" : "Off"}
                </label>
              </div>
              <p className="mt-1 text-sm text-ink-2">
                Every day at <span className="font-medium text-ink">{at}{zone}</span>, a PDF of the previous 24 hours (patrols, incidents,
                photos, check-ins) is emailed to this client automatically.
              </p>
              {enabled && st?.next_send_at && (
                <p className="mt-1 text-sm text-ink">
                  Next report: <span className="font-medium">{fmtInTz(st.next_send_at, tz)}</span>
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 lg:shrink-0">
            <Button variant="outline" onClick={() => setEditing(true)} disabled={!s}>
              <Settings2 />
              {enabled ? "Edit" : "Set up"}
            </Button>
            <Button variant="outline" onClick={() => void preview()} disabled={previewing}>
              {previewing ? <Loader2 className="animate-spin" /> : <FileSearch />}
              Preview PDF
            </Button>
            <Button onClick={() => setConfirmSend(true)} disabled={send.isPending || !s}>
              {send.isPending ? <Loader2 className="animate-spin" /> : <Send />}
              Send now
            </Button>
          </div>
        </div>

        {st && !st.email_configured && (
          <Notice tone="red">Email sending isn't set up on the server yet, so reports can't go out.</Notice>
        )}
        {st?.test_mode && (
          <Notice tone="amber">
            Test mode is on: every report goes only to <span className="font-medium">{st.test_email || "the test email (not set)"}</span>, never to
            the recipients below. Turn it off with the Test mode switch in the menu when you're ready.
          </Notice>
        )}

        {settings.isError ? (
          <ErrorBlock message={friendlyError(settings.error)} onRetry={() => void settings.refetch()} />
        ) : (
          <div className="grid gap-3 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <div className="min-w-0 rounded-lg border border-line bg-raised px-4 py-3">
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-3">Recipients</div>
              {recipients.length ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {recipients.map((r) => (
                    <span key={r} className="rounded-md border border-line bg-surface px-2 py-0.5 font-mono text-[13px] text-ink">
                      {r}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-1 text-[15px] text-ink-3">No recipients yet</p>
              )}
            </div>
            <div className="min-w-0 rounded-lg border border-line bg-raised px-4 py-3">
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-3">Includes</div>
              <p className="mt-1 text-[15px] text-ink">
                {s?.include_photos ? "Patrol & incident photos" : "No photos"}
                <span className="block text-xs text-ink-3">
                  Never sent blank — skipped when nothing was recorded
                </span>
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-line">
        <div className="flex items-center justify-between px-6 pt-4 sm:px-7">
          <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-3">Recent reports</h3>
        </div>
        {runs.isLoading ? (
          <div className="flex items-center gap-2 px-6 py-6 text-sm text-ink-2 sm:px-7">
            <Loader2 className="h-4 w-4 animate-spin text-link" /> Loading history…
          </div>
        ) : runs.isError ? (
          <div className="p-4">
            <ErrorBlock message={friendlyError(runs.error)} onRetry={() => void runs.refetch()} />
          </div>
        ) : !runs.data?.length ? (
          <p className="px-6 pb-6 pt-3 text-sm text-ink-3 sm:px-7">No reports yet. The first one goes out at the next {at} after you turn this on.</p>
        ) : (
          <ul className="divide-y divide-line px-2 pb-2 pt-2 sm:px-3">
            {runs.data.map((r) => {
              const m = runStatusMeta(r);
              return (
                <li key={r.id} className="flex flex-col gap-2 rounded-lg px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink">{reportDayLabel(r)}</span>
                      <Pill tone={m.tone}>{m.label}</Pill>
                      {r.trigger === "manual" && <span className="text-xs text-ink-3">sent manually</span>}
                    </div>
                    <p className="mt-0.5 text-sm text-ink-2">
                      {plural(r.patrol_count, "patrol")} · {plural(r.incident_count, "incident")}
                      {r.status === "sent" && r.sent_to.length ? ` · to ${r.sent_to.join(", ")}` : ""}
                      {r.sent_at ? ` · ${fmtInTz(r.sent_at, r.tz)}` : ""}
                    </p>
                    {r.status === "failed" && r.error && (
                      <p className="mt-1 flex items-start gap-1.5 text-sm text-status-incident-ink">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>
                          {r.error}
                          {r.next_retry_at ? ` Retrying automatically at ${fmtInTz(r.next_retry_at, r.tz, false)}.` : ""}
                        </span>
                      </p>
                    )}
                    {r.status !== "failed" && r.note && <p className="mt-0.5 text-xs text-ink-3">{r.note}</p>}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {r.status === "failed" && (
                      <Button size="sm" variant="outline" onClick={() => void retry(r)} disabled={rowBusy === r.id}>
                        {rowBusy === r.id ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                        Retry
                      </Button>
                    )}
                    {r.pdf_path && (
                      <Button size="sm" variant="ghost" onClick={() => void download(r)} disabled={rowBusy === r.id} aria-label={`Open PDF for ${reportDayLabel(r)}`}>
                        <Download />
                        PDF
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {s && <SettingsDialog open={editing} onOpenChange={setEditing} initial={s} orgTzHint={st?.tz ?? null} onSaved={refresh} />}
      <ConfirmDialog
        open={confirmSend}
        onOpenChange={setConfirmSend}
        title="Send the report now?"
        description={
          st?.test_mode
            ? `This emails the report for the last 24 hours, up to now, to the test email only (${st.test_email || "not set"}). Nothing is sent if nothing was recorded.`
            : recipients.length
              ? `This emails the report for the last 24 hours, up to now, to ${recipients.join(", ")}. Nothing is sent if nothing was recorded.`
              : "Add at least one recipient first."
        }
        confirmLabel="Send now"
        busy={send.isPending}
        disabled={!st?.test_mode && !recipients.length}
        onConfirm={() => send.mutate()}
      />
    </section>
  );
};

const Notice = ({ tone, children }: { tone: "amber" | "red"; children: React.ReactNode }) => (
  <div
    className={cn(
      "flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm",
      tone === "amber" ? "border-status-follow/40 bg-status-follow/10 text-ink" : "border-status-incident/40 bg-status-incident/10 text-ink",
    )}
  >
    <AlertTriangle className={cn("mt-0.5 h-4 w-4 shrink-0", tone === "amber" ? "text-status-follow" : "text-status-incident-ink")} />
    <p>{children}</p>
  </div>
);

const SettingsDialog = ({
  open,
  onOpenChange,
  initial,
  orgTzHint,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial: DailyReportSettings;
  orgTzHint: string | null;
  onSaved: () => void;
}) => {
  const [form, setForm] = useState<DailyReportSettings>(initial);
  const [draft, setDraft] = useState<string>("");
  const [err, setErr] = useState<string>("");
  useEffect(() => {
    if (open) {
      setForm(initial);
      setDraft("");
      setErr("");
    }
  }, [open, initial]);

  const suggestions = useQuery({
    queryKey: ["daily-report", "suggestions", initial.property_id],
    queryFn: () => fetchRecipientSuggestions(initial.property_id),
    enabled: open,
  });

  const save = useMutation({
    mutationFn: (s: DailyReportSettings) => saveReportSettings(s),
    onSuccess: () => {
      toast.success("Daily report settings saved");
      onSaved();
      onOpenChange(false);
    },
    onError: (e) => setErr(friendlyError(e)),
  });

  const dirty = JSON.stringify(form) !== JSON.stringify(initial) || draft.trim() !== "";
  const has = (e: string) => form.recipients.some((r) => r.toLowerCase() === e.toLowerCase());
  const add = (raw: string) => {
    const list = raw
      .split(/[\s,;]+/)
      .map((x) => x.trim())
      .filter(Boolean);
    const bad = list.find((x) => !EMAIL_RE.test(x));
    if (bad) {
      setErr(`"${bad}" isn't a valid email address.`);
      return false;
    }
    const next = [...form.recipients];
    for (const x of list) if (!next.some((r) => r.toLowerCase() === x.toLowerCase())) next.push(x.toLowerCase());
    if (next.length > 20) {
      setErr("Up to 20 recipients.");
      return false;
    }
    setForm({ ...form, recipients: next });
    setErr("");
    return true;
  };

  const submit = () => {
    let recipients = form.recipients;
    if (draft.trim()) {
      const list = draft.split(/[\s,;]+/).filter(Boolean);
      const bad = list.find((x) => !EMAIL_RE.test(x));
      if (bad) return setErr(`"${bad}" isn't a valid email address.`);
      recipients = [...new Set([...recipients, ...list.map((x) => x.toLowerCase())])];
    }
    if (form.enabled && !recipients.length) return setErr("Add at least one recipient before turning daily reports on.");
    save.mutate({ ...form, recipients });
  };

  const unused = (suggestions.data ?? []).filter((s) => !has(s.email));

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Daily report email"
      description="Sent automatically every day at the time you pick, in the property's time zone, covering the previous 24 hours."
      dirty={dirty}
      saving={save.isPending}
      onSubmit={submit}
    >
      <CheckField
        label="Send the daily report automatically"
        hint="You can still preview or send it manually while this is off."
        checked={form.enabled}
        onChange={(v) => setForm({ ...form, enabled: v })}
      />

      <div>
        <FieldLabel htmlFor="dr-recipient">Recipients</FieldLabel>
        <div className="flex gap-2">
          <Input
            id="dr-recipient"
            type="email"
            inputMode="email"
            autoComplete="off"
            placeholder="name@company.com"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                if (draft.trim() && add(draft)) setDraft("");
              }
            }}
            className="h-11 border-line-strong bg-field text-ink"
          />
          <Button type="button" variant="outline" className="h-11" onClick={() => draft.trim() && add(draft) && setDraft("")}>
            <Plus />
            Add
          </Button>
        </div>
        {form.recipients.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {form.recipients.map((r) => (
              <span key={r} className="inline-flex items-center gap-1 rounded-md border border-line bg-raised py-0.5 pl-2 pr-1 font-mono text-[13px] text-ink">
                {r}
                <button
                  type="button"
                  className="focus-ring rounded p-0.5 text-ink-3 hover:text-ink"
                  onClick={() => setForm({ ...form, recipients: form.recipients.filter((x) => x !== r) })}
                  aria-label={`Remove ${r}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}
        {unused.length > 0 && (
          <div className="mt-3">
            <p className="text-xs text-ink-3">On file for this property:</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {unused.map((s) => (
                <button
                  key={s.email}
                  type="button"
                  onClick={() => add(s.email)}
                  className="focus-ring inline-flex items-center gap-1 rounded-full border border-dashed border-line-strong px-2.5 py-1 text-xs text-ink-2 hover:border-link hover:text-ink"
                >
                  <Plus className="h-3 w-3" />
                  {s.label} · {s.email}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <CheckField
        label="Include patrol and incident photos"
        hint="Up to 18 photos are embedded; the rest stay in the app."
        checked={form.include_photos}
        onChange={(v) => setForm({ ...form, include_photos: v })}
      />

      <div>
        <FieldLabel htmlFor="dr-time">Send time</FieldLabel>
        <Select value={form.send_time} onValueChange={(v) => setForm({ ...form, send_time: v })}>
          <SelectTrigger id="dr-time" className={selectTrigger}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className={cn(selectContent, "max-h-72")}>
            {(SEND_TIMES.includes(form.send_time) ? SEND_TIMES : [form.send_time, ...SEND_TIMES]).map((t) => (
              <SelectItem key={t} value={t} className={selectItem}>
                {sendTimeLabel(t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="mt-1.5 text-xs text-ink-3">The report covers the 24 hours before this time. If a send is missed, it goes out within 4 hours.</p>
      </div>

      <div>
        <FieldLabel htmlFor="dr-tz">Time zone</FieldLabel>
        <Select value={form.timezone || ORG_TZ} onValueChange={(v) => setForm({ ...form, timezone: v === ORG_TZ ? "" : v })}>
          <SelectTrigger id="dr-tz" className={selectTrigger}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className={selectContent}>
            <SelectItem value={ORG_TZ} className={selectItem}>
              Company default{!initial.timezone && orgTzHint ? ` (${orgTzHint})` : ""}
            </SelectItem>
            {ZONES.map((z) => (
              <SelectItem key={z.value} value={z.value} className={selectItem}>
                {z.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {err && (
        <p className="rounded-lg border border-status-incident/40 bg-status-incident/10 px-3 py-2 text-sm text-status-incident-ink" role="alert">
          {err}
        </p>
      )}
    </FormDialog>
  );
};
