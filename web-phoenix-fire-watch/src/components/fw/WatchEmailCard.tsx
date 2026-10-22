import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Eye, Flag, Loader2, MailCheck, Send, Settings2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog, ErrorBlock, FormDialog, Pill, TextField, toNum } from "@/components/workforce/kit";
import {
  fetchWatchEmailStatus,
  previewWatchEmail,
  saveWatchEmailSettings,
  sendWatchEmail,
  type WatchEmailKind,
  type WatchEmailLog,
  type WatchEmailOrg,
  type WatchEmailProperty,
  type WatchEmailStatusResponse,
} from "@/lib/fw/watchEmails";
import { fmtInTz } from "@/lib/reports/api";
import { friendlyError } from "@/lib/supabase";
import type { Tone } from "@/lib/workforce/constants";
import { cn } from "@/lib/utils";

const TZ = "America/New_York";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const KIND_LABEL: Record<WatchEmailKind, string> = { start: "Start confirmation", end: "Completion notice" };

const logMeta = (l: WatchEmailLog): { label: string; tone: Tone } => {
  if (l.status === "sent") return l.test_mode ? { label: "Sent · test", tone: "amber" } : { label: "Sent", tone: "green" };
  if (l.status === "failed") return { label: "Failed", tone: "red" };
  if (l.status === "skipped") return { label: "Skipped", tone: "slate" };
  return { label: "Sending…", tone: "blue" };
};

/** Admin-only: automatic client emails when this property's fire watch starts and ends. */
export const WatchEmailCard = ({ propertyId }: { propertyId: string }) => {
  const qc = useQueryClient();
  const key = ["watch-emails", propertyId];
  const status = useQuery({ queryKey: key, queryFn: () => fetchWatchEmailStatus(propertyId) });
  const [editing, setEditing] = useState<boolean>(false);
  const [preview, setPreview] = useState<WatchEmailKind | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["watch-emails"] });

  const toggle = useMutation({
    mutationFn: (p: Partial<WatchEmailProperty>) => saveWatchEmailSettings({ property_id: propertyId, property: p }),
    onSuccess: (_r, p) => {
      const [k, v] = Object.entries(p)[0] ?? [];
      toast.success(`${k === "send_start" ? "Start confirmation" : "Completion notice"} ${v ? "on" : "off"} for this property`);
      refresh();
    },
    onError: (e) => toast.error("Couldn't change that", { description: friendlyError(e) }),
  });

  const d = status.data;
  const p = d?.property;
  const recipients = p?.recipients.length ? p.recipients : d?.auto?.recipient ? [d.auto.recipient] : [];
  const lastFor = (k: WatchEmailKind) => d?.log.find((l) => l.kind === k && l.watch_id === d.watch?.id);
  const startLog = lastFor("start");
  const endLog = lastFor("end");

  const startLine = (): string => {
    if (!d?.watch) return "No fire watch at this property yet.";
    if (startLog?.status === "sent") return `Start confirmation sent ${startLog.sent_at ? fmtInTz(startLog.sent_at, TZ) : ""}.`;
    if (d.watch.ended_on) return "This watch has ended.";
    if (!p?.send_start) return "Start confirmation is off for this property.";
    if (!d.watch.auto_covers_this_watch) return "This watch began before automatic emails were turned on — send its start confirmation from Preview if you want one.";
    if (!d.watch.first_shift_at) return "The start confirmation goes out automatically 24 hours before the first scheduled shift.";
    if (d.watch.start_auto_at) return `Start confirmation goes out automatically ${fmtInTz(d.watch.start_auto_at, TZ)} (24 hours before the first shift).`;
    return "";
  };
  const endLine = (): string => {
    if (!d?.watch) return "";
    if (endLog?.status === "sent") return `Completion notice sent ${endLog.sent_at ? fmtInTz(endLog.sent_at, TZ) : ""}.`;
    if (endLog?.status === "skipped") return "Completion notice was skipped for this watch.";
    if (!p?.send_end) return "Completion notice is off for this property.";
    return d.watch.ended_on
      ? "Completion notice goes out automatically once the last shift is over."
      : "Completion notice goes out automatically after you end the watch and the last shift is over.";
  };

  return (
    <section className="mt-5 overflow-hidden rounded-xl border border-line bg-surface shadow-card" aria-labelledby="watch-email-title">
      <div className="flex flex-col gap-5 p-6 sm:p-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <MailCheck className={cn("mt-0.5 h-8 w-8 shrink-0", p?.send_start || p?.send_end ? "text-link" : "text-ink-3")} strokeWidth={1.6} />
            <div className="min-w-0">
              <h2 id="watch-email-title" className="font-display text-xl font-bold text-ink sm:text-[22px]">
                Watch start &amp; end emails
              </h2>
              <p className="mt-1 text-sm text-ink-2">
                The client gets a confirmation before the watch begins and a completion notice when it ends. Dates and times fill in from the
                real schedule and guard clock-ins.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {(["send_start", "send_end"] as const).map((k) => {
                  const on = !!p?.[k];
                  return (
                    <label
                      key={k}
                      className={cn(
                        "inline-flex cursor-pointer items-center gap-2 rounded-full py-0.5 pl-1 pr-3 text-[11px] font-semibold uppercase tracking-[0.12em] ring-1 ring-inset transition-colors",
                        on ? "bg-status-clear/10 text-status-clear ring-status-clear/30" : "bg-raised text-ink-3 ring-line",
                        (!p || toggle.isPending) && "cursor-wait opacity-70",
                      )}
                    >
                      <Switch
                        checked={on}
                        disabled={!p || toggle.isPending}
                        onCheckedChange={(v) => toggle.mutate({ [k]: v })}
                        aria-label={`${k === "send_start" ? "Start confirmation" : "Completion notice"} ${on ? "on" : "off"}`}
                        className="scale-75"
                      />
                      {k === "send_start" ? "Start" : "End"} · {on ? "On" : "Off"}
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 lg:shrink-0">
            <Button variant="outline" onClick={() => setEditing(true)} disabled={!d}>
              <Settings2 />
              Edit details
            </Button>
            <Button variant="outline" onClick={() => setPreview("start")} disabled={!d?.watch}>
              <Eye />
              Preview
            </Button>
          </div>
        </div>

        {d && !d.email_configured && <Notice tone="red">Email sending isn't set up on the server yet, so these emails can't go out.</Notice>}
        {d?.test_mode && (
          <Notice tone="amber">
            Test mode is on: these emails go only to <span className="font-medium">{d.test_email || "the test email (not set)"}</span>, never to the
            client.
          </Notice>
        )}

        {status.isError ? (
          <ErrorBlock message={friendlyError(status.error)} onRetry={() => void status.refetch()} />
        ) : status.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-ink-2">
            <Loader2 className="h-4 w-4 animate-spin text-link" /> Loading…
          </div>
        ) : (
          d && (
            <>
              <div className="grid gap-3 md:grid-cols-3">
                <Tile label="Sends to">
                  {recipients.length ? (
                    <span className="break-all font-mono text-[13px]">{recipients.join(", ")}</span>
                  ) : (
                    <span className="text-status-incident-ink">No client email on file</span>
                  )}
                  {!p?.recipients.length && recipients.length > 0 && <span className="block text-xs text-ink-3">Property contact</span>}
                </Tile>
                <Tile label="Filled in from the schedule">
                  {d.auto?.coverage || "Coverage — add shifts"}
                  <span className="block text-xs text-ink-3">
                    {[
                      p?.officers ?? d.auto?.officers ? `${p?.officers ?? d.auto?.officers} on duty` : "",
                      d.auto?.patrol ? `Patrols ${d.auto.patrol.toLowerCase()}` : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </Tile>
                <Tile label="Billing email">
                  <span className="break-all">{p?.billing_email || d.auto?.billing_email || "—"}</span>
                  <span className="block text-xs text-ink-3">Invoice within {d.org.invoice_days} business days</span>
                </Tile>
              </div>
              <ul className="grid gap-1.5 text-sm text-ink">
                {[startLine(), endLine()].filter(Boolean).map((t, i) => (
                  <li key={i} className="flex items-start gap-2">
                    {i === 0 ? <Flag className="mt-0.5 h-4 w-4 shrink-0 text-link" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-link" />}
                    {t}
                  </li>
                ))}
              </ul>
            </>
          )
        )}
      </div>

      {!!d?.log.length && (
        <div className="border-t border-line">
          <h3 className="px-6 pt-4 text-xs font-semibold uppercase tracking-[0.14em] text-ink-3 sm:px-7">Sent so far</h3>
          <ul className="divide-y divide-line px-2 pb-2 pt-2 sm:px-3">
            {d.log.map((l) => {
              const m = logMeta(l);
              return (
                <li key={l.id} className="rounded-lg px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">{KIND_LABEL[l.kind]}</span>
                    <Pill tone={m.tone}>{m.label}</Pill>
                    {l.trigger === "manual" && <span className="text-xs text-ink-3">sent manually</span>}
                  </div>
                  <p className="mt-0.5 text-sm text-ink-2">
                    {l.sent_to.length ? `To ${l.sent_to.join(", ")}` : l.intended_to.length ? `For ${l.intended_to.join(", ")}` : ""}
                    {l.sent_at ? ` · ${fmtInTz(l.sent_at, TZ)}` : ` · ${fmtInTz(l.created_at, TZ)}`}
                  </p>
                  {l.error && l.status !== "sent" && (
                    <p className="mt-1 flex items-start gap-1.5 text-sm text-status-incident-ink">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      {l.error}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {d && <EditDialog open={editing} onOpenChange={setEditing} data={d} propertyId={propertyId} onSaved={refresh} />}
      {d && preview && (
        <PreviewDialog propertyId={propertyId} kind={preview} onKind={setPreview} data={d} onClose={() => setPreview(null)} onSent={refresh} />
      )}
    </section>
  );
};

const Tile = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="min-w-0 rounded-lg border border-line bg-raised px-4 py-3">
    <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-3">{label}</div>
    <div className="mt-1 text-[15px] text-ink">{children}</div>
  </div>
);

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

/* ---------------------------------------------------------------- edit */

interface Form {
  recipients: string;
  client_first_name: string;
  onsite_contact: string;
  billing_email: string;
  coverage: string;
  officers: string;
  deposit_amount: string;
  your_phone: string;
  direct_line: string;
  office_line: string;
  invoice_days: string;
  review_url: string;
  signer_name: string;
  signer_title: string;
  company_legal: string;
  website: string;
}

const toForm = (d: WatchEmailStatusResponse): Form => ({
  recipients: d.property.recipients.join(", "),
  client_first_name: d.property.client_first_name,
  onsite_contact: d.property.onsite_contact,
  billing_email: d.property.billing_email,
  coverage: d.property.coverage,
  officers: d.property.officers == null ? "" : String(d.property.officers),
  deposit_amount: d.property.deposit_amount == null ? "" : String(d.property.deposit_amount),
  your_phone: d.org.your_phone,
  direct_line: d.org.direct_line,
  office_line: d.org.office_line,
  invoice_days: String(d.org.invoice_days),
  review_url: d.org.review_url,
  signer_name: d.org.signer_name,
  signer_title: d.org.signer_title,
  company_legal: d.org.company_legal,
  website: d.org.website,
});

const ORG_KEYS = ["your_phone", "direct_line", "office_line", "review_url", "signer_name", "signer_title", "company_legal", "website"] as const;

const EditDialog = ({
  open,
  onOpenChange,
  data,
  propertyId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  data: WatchEmailStatusResponse;
  propertyId: string;
  onSaved: () => void;
}) => {
  const [form, setForm] = useState<Form>(() => toForm(data));
  const [err, setErr] = useState<string>("");
  useEffect(() => {
    if (open) {
      setForm(toForm(data));
      setErr("");
    }
  }, [open, data]);
  const set = (k: keyof Form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(data));
  const a = data.auto;

  const save = useMutation({
    mutationFn: (input: { property: Partial<WatchEmailProperty>; org: Partial<WatchEmailOrg> }) =>
      saveWatchEmailSettings({ property_id: propertyId, ...input }),
    onSuccess: () => {
      toast.success("Watch email details saved");
      onSaved();
      onOpenChange(false);
    },
    onError: (e) => setErr(friendlyError(e)),
  });

  const submit = () => {
    const recipients = form.recipients
      .split(/[\s,;]+/)
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean);
    const bad = recipients.find((x) => !EMAIL_RE.test(x));
    if (bad) return setErr(`"${bad}" isn't a valid email address.`);
    if (form.billing_email.trim() && !EMAIL_RE.test(form.billing_email.trim())) return setErr("The billing email isn't valid.");
    const officers = form.officers.trim() ? toNum(form.officers) : null;
    if (form.officers.trim() && (officers == null || officers < 1 || officers > 50)) return setErr("Officers on duty must be between 1 and 50.");
    const deposit = form.deposit_amount.trim() ? toNum(form.deposit_amount) : null;
    if (form.deposit_amount.trim() && (deposit == null || deposit < 0)) return setErr("The deposit amount isn't valid.");
    const days = toNum(form.invoice_days);
    if (days == null || days < 1 || days > 60) return setErr("Invoice days must be between 1 and 60.");
    if (form.review_url.trim() && !/^https:\/\/\S+$/i.test(form.review_url.trim())) return setErr("The review link must start with https://");
    const org: Partial<WatchEmailOrg> = { invoice_days: Math.round(days) };
    for (const k of ORG_KEYS) org[k] = form[k].trim();
    save.mutate({
      property: {
        recipients,
        client_first_name: form.client_first_name.trim(),
        onsite_contact: form.onsite_contact.trim(),
        billing_email: form.billing_email.trim().toLowerCase(),
        coverage: form.coverage.trim(),
        officers: officers == null ? null : Math.round(officers),
        deposit_amount: deposit,
      },
      org,
    });
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Watch email details"
      description="Leave a field blank to use what the app works out on its own (shown as the grey example)."
      dirty={dirty}
      saving={save.isPending}
      onSubmit={submit}
      wide
    >
      <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-3">This property</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Send to"
          value={form.recipients}
          onChange={set("recipients")}
          placeholder={a?.recipient || "client@company.com"}
          hint="Separate several with commas. Blank = the property contact."
          inputMode="email"
        />
        <TextField label="Client first name" value={form.client_first_name} onChange={set("client_first_name")} placeholder={a?.first_name || "First name"} maxLength={60} />
        <TextField label="On-site contact" value={form.onsite_contact} onChange={set("onsite_contact")} placeholder={a?.onsite_contact || "Name · phone"} maxLength={160} />
        <TextField label="Billing email" value={form.billing_email} onChange={set("billing_email")} placeholder={a?.billing_email || "billing@company.com"} inputMode="email" hint="Where weekly and final invoices go." />
        <TextField label="Coverage" value={form.coverage} onChange={set("coverage")} placeholder={a?.coverage || "24/7 continuous fire watch coverage"} maxLength={160} hint="Worked out from the shift schedule." />
        <TextField
          label="Officers on duty"
          value={form.officers}
          onChange={set("officers")}
          placeholder={a?.officers ? String(a.officers) : "1"}
          inputMode="numeric"
          maxLength={2}
          hint="Most guards scheduled at the same time."
        />
        <TextField
          label="Deposit collected ($)"
          value={form.deposit_amount}
          onChange={set("deposit_amount")}
          placeholder="None"
          inputMode="decimal"
          maxLength={12}
          hint="Mentioned in the completion notice. Blank = no deposit line."
        />
      </div>
      <p className="text-xs text-ink-3">Patrol interval comes from the property's patrol settings{a?.patrol ? ` (${a.patrol.toLowerCase()})` : ""}.</p>

      <h3 className="mt-2 border-t border-line pt-4 text-xs font-semibold uppercase tracking-[0.14em] text-ink-3">Your details · all properties</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Phone in the email" value={form.your_phone} onChange={set("your_phone")} placeholder="727-555-0100" inputMode="tel" hint={'Used in "please call …".'} />
        <TextField label="Final invoice within (business days)" value={form.invoice_days} onChange={set("invoice_days")} inputMode="numeric" maxLength={2} />
        <TextField label="Direct line" value={form.direct_line} onChange={set("direct_line")} placeholder="Optional" inputMode="tel" />
        <TextField label="Office line" value={form.office_line} onChange={set("office_line")} placeholder="Optional" inputMode="tel" />
        <TextField label="Signed by" value={form.signer_name} onChange={set("signer_name")} placeholder="Your name" />
        <TextField label="Title" value={form.signer_title} onChange={set("signer_title")} placeholder="Owner" />
        <TextField label="Company name" value={form.company_legal} onChange={set("company_legal")} placeholder="Company LLC" />
        <TextField label="Website" value={form.website} onChange={set("website")} placeholder="www.example.com" />
        <TextField
          label="Google review link"
          value={form.review_url}
          onChange={set("review_url")}
          placeholder="https://g.page/r/…/review"
          className="sm:col-span-2"
          maxLength={400}
          hint="Shown as a button in the completion notice. Blank = no review request."
        />
      </div>

      {err && (
        <p className="rounded-lg border border-status-incident/40 bg-status-incident/10 px-3 py-2 text-sm text-status-incident-ink" role="alert">
          {err}
        </p>
      )}
    </FormDialog>
  );
};

/* ---------------------------------------------------------------- preview */

const PreviewDialog = ({
  propertyId,
  kind,
  onKind,
  data,
  onClose,
  onSent,
}: {
  propertyId: string;
  kind: WatchEmailKind;
  onKind: (k: WatchEmailKind) => void;
  data: WatchEmailStatusResponse;
  onClose: () => void;
  onSent: () => void;
}) => {
  const [confirm, setConfirm] = useState<boolean>(false);
  const pv = useQuery({ queryKey: ["watch-emails", propertyId, "preview", kind], queryFn: () => previewWatchEmail(propertyId, kind), staleTime: 30_000 });
  const already = data.log.find((l) => l.kind === kind && l.watch_id === data.watch?.id && l.status === "sent");
  const endNotReady = kind === "end" && !data.watch?.ended_on;

  const send = useMutation({
    mutationFn: () => sendWatchEmail(propertyId, kind),
    onSuccess: (r) => {
      setConfirm(false);
      if (r.status === "sent") toast.success(r.test_mode ? "Sent to the test email" : "Email sent to the client");
      else if (r.status === "failed" || r.status === "skipped") toast.error("The email didn't go out", { description: r.error });
      else toast.message("Already being sent");
      onSent();
    },
    onError: (e) => toast.error("Couldn't send the email", { description: friendlyError(e) }),
  });

  const v = pv.data;
  return (
    <Dialog open onOpenChange={(o) => !o && !send.isPending && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto border-line bg-surface text-ink sm:max-w-2xl sm:rounded-xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Email preview</DialogTitle>
          <DialogDescription className="text-ink-2">Exactly what the client receives, with today's schedule and clock-ins filled in.</DialogDescription>
        </DialogHeader>

        <div className="inline-flex w-full rounded-lg border border-line bg-raised p-1" role="tablist">
          {(["start", "end"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={kind === k}
              onClick={() => onKind(k)}
              className={cn(
                "focus-ring flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                kind === k ? "bg-primary text-white shadow-sm" : "text-ink-2 hover:text-ink",
              )}
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>

        {pv.isLoading ? (
          <div className="flex items-center gap-2 py-10 text-sm text-ink-2">
            <Loader2 className="h-4 w-4 animate-spin text-link" /> Building the preview…
          </div>
        ) : pv.isError ? (
          <ErrorBlock message={friendlyError(pv.error)} onRetry={() => void pv.refetch()} />
        ) : (
          v && (
            <div className="grid gap-3">
              <dl className="grid gap-1 rounded-lg border border-line bg-raised px-4 py-3 text-sm">
                <div className="flex gap-2">
                  <dt className="w-16 shrink-0 text-ink-3">Subject</dt>
                  <dd className="font-medium text-ink">{v.subject}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-16 shrink-0 text-ink-3">To</dt>
                  <dd className="break-all text-ink">
                    {v.to.length ? v.to.join(", ") : v.reason}
                    {v.test_mode && v.intended.length > 0 && <span className="block text-xs text-ink-3">Client ({v.intended.join(", ")}) gets it once test mode is off</span>}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-16 shrink-0 text-ink-3">{kind === "start" ? "Start" : "End"}</dt>
                  <dd className="text-ink-2">From {kind === "start" ? v.start_source : v.end_source}</dd>
                </div>
              </dl>
              <iframe
                title={`${KIND_LABEL[kind]} preview`}
                srcDoc={v.html}
                sandbox=""
                className="h-[460px] w-full rounded-lg border border-line bg-white"
              />
            </div>
          )
        )}

        <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-end">
          {endNotReady && <p className="text-xs text-ink-3 sm:mr-auto">End the watch first — the real end time fills in then.</p>}
          {already && !endNotReady && <p className="text-xs text-ink-3 sm:mr-auto">Already sent for this watch — sending again resends it.</p>}
          <Button variant="ghost" onClick={onClose} disabled={send.isPending}>
            Close
          </Button>
          <Button onClick={() => setConfirm(true)} disabled={!v || endNotReady || send.isPending || (!v.to.length && !v.test_mode)}>
            {send.isPending ? <Loader2 className="animate-spin" /> : <Send />}
            {already ? "Resend now" : "Send now"}
          </Button>
        </div>

        <ConfirmDialog
          open={confirm}
          onOpenChange={setConfirm}
          title={`Send the ${KIND_LABEL[kind].toLowerCase()} now?`}
          description={v ? `This emails "${v.subject}" to ${v.to.join(", ") || "nobody"}${v.test_mode ? " (test mode)" : ""}.` : ""}
          confirmLabel="Send now"
          busy={send.isPending}
          onConfirm={() => send.mutate()}
        />
      </DialogContent>
    </Dialog>
  );
};
