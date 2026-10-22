import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { AlertTriangle, CalendarX2, CheckCircle2, Flame, Info, Loader2, Mail, Play, Square } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { Card, FieldLabel } from "@/components/fw/primitives";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CheckField, ErrorBlock, isDate } from "@/components/workforce/kit";
import { money } from "@/lib/crm/types";
import { fetchWatchEmailStatus, runWatchEmails, skipWatchEmail } from "@/lib/fw/watchEmails";
import {
  type ActiveWatch,
  endWatch,
  fetchWatches,
  type IdleProperty,
  previewEndWatch,
  startWatch,
  watchDays,
  type WatchTotals,
} from "@/lib/profit/watches";
import { friendlyError } from "@/lib/supabase";
import { cn } from "@/lib/utils";

const whole = (n: number): string => money(n, false);
const signed = (n: number): string => (n < 0 ? `−${money(Math.abs(n), false)}` : money(n, false));
const hrs = (n: number): string => `${n.toLocaleString("en-US", { maximumFractionDigits: 1 })} h`;
const day = (d: string, withYear = false): string => format(parseISO(d), withYear ? "MMM d, yyyy" : "MMM d");
const marginOf = (t: WatchTotals): number | null => (t.revenue > 0 ? t.profit / t.revenue : null);
const pctText = (m: number | null): string => (m == null ? "—" : `${(m * 100).toFixed(1)}%`);
const profitTone = (n: number): string => (n < 0 ? "text-status-incident-ink" : "text-status-clear");
const time12 = (hhmm: string): string => {
  const [h, m] = hhmm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

/**
 * Fire watches on the Profit page: each property's watch runs from its start date until END WATCH, which totals
 * the watch and clears the property's remaining scheduled shifts.
 */
export const WatchesCard = () => {
  const q = useQuery({ queryKey: ["profit", "watches"], queryFn: fetchWatches, refetchInterval: 60_000 });
  const [ending, setEnding] = useState<ActiveWatch | null>(null);
  const [starting, setStarting] = useState<IdleProperty | null>(null);
  const [showAllEnded, setShowAllEnded] = useState<boolean>(false);
  const d = q.data;

  return (
    <Card className="overflow-hidden">
      <div id="watches" className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 sm:px-6">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold text-ink sm:text-xl">
            <Flame className="h-5 w-5 text-status-incident" />
            Fire watches
          </h2>
          <p className="mt-1 text-sm text-ink-2">
            Each watch runs from its start date until you end it. Totals cover the whole watch, not just the period above. Uploaded client invoices set the revenue for the time they cover, and costs include every expenditure plus a share of company overhead.
          </p>
        </div>
      </div>

      {q.isLoading ? (
        <div className="flex items-center gap-2 px-6 py-8 text-sm text-ink-3">
          <Loader2 className="h-4 w-4 animate-spin" /> Adding up each watch…
        </div>
      ) : q.isError || !d ? (
        <div className="p-4">
          <ErrorBlock message={friendlyError(q.error)} onRetry={() => void q.refetch()} />
        </div>
      ) : (
        <>
          <SectionLabel>Running now · {d.active.length}</SectionLabel>
          {d.active.length === 0 ? (
            <p className="px-6 pb-4 text-sm text-ink-3">No watches running. Start one below when a new job begins.</p>
          ) : (
            <ul className="divide-y divide-line border-y border-line">
              {d.active.map((w) => (
                <li key={w.id} className="grid gap-3 px-5 py-4 sm:px-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,2fr)_auto] lg:items-center">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden>
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-status-clear opacity-60" />
                        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-status-clear" />
                      </span>
                      <Link to={`/properties/${w.property_id}`} className="truncate font-medium text-ink hover:underline">
                        {w.name}
                      </Link>
                    </div>
                    <p className="mt-0.5 pl-[18px] text-xs text-ink-3">
                      {w.started_on > d.today
                        ? `Starts ${day(w.started_on)}`
                        : `Started ${day(w.started_on)} · Day ${watchDays(w.started_on, d.today)}`}
                      {w.upcoming_shifts > 0 && ` · ${w.upcoming_shifts} upcoming ${w.upcoming_shifts === 1 ? "shift" : "shifts"}`}
                      {w.on_duty > 0 && <span className="text-status-clear"> · {w.on_duty} on duty</span>}
                    </p>
                  </div>
                  <Figures t={w.totals} />
                  <Button
                    variant="destructive-outline"
                    size="sm"
                    className="justify-self-start font-semibold uppercase tracking-[0.08em] lg:justify-self-end"
                    onClick={() => setEnding(w)}
                  >
                    <Square className="fill-current" />
                    End watch
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {d.idle.length > 0 && (
            <>
              <SectionLabel>Not on watch</SectionLabel>
              <ul className="flex flex-wrap gap-2 px-5 pb-4 sm:px-6">
                {d.idle.map((p) => (
                  <li key={p.property_id}>
                    <button
                      type="button"
                      onClick={() => setStarting(p)}
                      className="focus-ring group inline-flex items-center gap-2 rounded-lg border border-line bg-raised/40 px-3 py-2 text-sm text-ink-2 transition-colors hover:border-line-hover hover:text-ink"
                    >
                      <Play className="h-3.5 w-3.5 text-link" />
                      <span className="font-medium text-ink">{p.name}</span>
                      {p.last_ended_on && <span className="text-xs text-ink-3">ended {day(p.last_ended_on)}</span>}
                      <span className="text-xs font-medium text-link opacity-80 group-hover:opacity-100">Start watch</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {d.ended.length > 0 && (
            <>
              <SectionLabel>Completed</SectionLabel>
              <ul className="divide-y divide-line border-t border-line">
                {(showAllEnded ? d.ended : d.ended.slice(0, 5)).map((w) => (
                  <li key={w.id} className="grid gap-3 px-5 py-3.5 sm:px-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,2fr)_auto] lg:items-center">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-ink-3" />
                        <Link to={`/properties/${w.property_id}`} className="truncate font-medium text-ink hover:underline">
                          {w.name}
                        </Link>
                      </div>
                      <p className="mt-0.5 pl-6 text-xs text-ink-3">
                        {day(w.started_on)} – {day(w.ended_on, true)} · {watchDays(w.started_on, w.ended_on)} days
                        {w.shifts_cleared > 0 && ` · ${w.shifts_cleared} scheduled ${w.shifts_cleared === 1 ? "shift" : "shifts"} cleared`}
                      </p>
                    </div>
                    <Figures t={w.totals} />
                    <span className="hidden w-[112px] lg:block" />
                  </li>
                ))}
              </ul>
              {d.ended.length > 5 && (
                <button
                  type="button"
                  onClick={() => setShowAllEnded((v) => !v)}
                  className="focus-ring w-full border-t border-line px-6 py-2.5 text-sm font-medium text-link hover:bg-raised/50"
                >
                  {showAllEnded ? "Show fewer" : `Show all ${d.ended.length} completed watches`}
                </button>
              )}
            </>
          )}
          <div className="h-1" />
        </>
      )}

      {ending && d && <EndWatchDialog watch={ending} today={d.today} onClose={() => setEnding(null)} />}
      {starting && d && <StartWatchDialog property={starting} today={d.today} onClose={() => setStarting(null)} />}
    </Card>
  );
};

const SectionLabel = ({ children }: { children: ReactNode }) => (
  <div className="px-5 pb-2 pt-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3 sm:px-6">{children}</div>
);

const Figures = ({ t }: { t: WatchTotals }) => {
  const m = marginOf(t);
  return (
    <div className="grid grid-cols-4 gap-3 text-sm">
      <Fig
        label="Hours"
        value={hrs(t.hours)}
        sub={t.pending_hours > 0 ? `+${hrs(t.pending_hours)} pending` : t.invoices > 0 ? `${hrs(t.billed_hours)} invoiced` : undefined}
        subMuted={t.pending_hours <= 0 && t.invoices > 0}
      />
      <Fig
        label="Revenue"
        value={t.revenue === 0 && t.unpriced_revenue_hours > 0 ? "—" : whole(t.revenue)}
        sub={
          t.unpriced_revenue_hours > 0
            ? "no client rate"
            : t.invoices > 0
              ? `${whole(t.billed)} invoiced`
              : undefined
        }
        subMuted={t.unpriced_revenue_hours <= 0 && t.invoices > 0}
      />
      <Fig label="Profit" value={signed(t.profit)} tone={t.revenue > 0 || t.profit !== 0 ? profitTone(t.profit) : undefined} />
      <Fig label="Margin" value={pctText(m)} />
    </div>
  );
};

const Fig = ({ label, value, sub, tone, subMuted }: { label: string; value: string; sub?: string; tone?: string; subMuted?: boolean }) => (
  <div className="min-w-0">
    <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3">{label}</div>
    <div className={cn("truncate font-semibold tabular-nums text-ink", tone)}>{value}</div>
    {sub && <div className={cn("truncate text-[11px]", subMuted ? "text-ink-3" : "text-status-follow")} title={sub}>{sub}</div>}
  </div>
);

// ─── End watch ──────────────────────────────────────────────────────────────

const EndWatchDialog = ({ watch, today, onClose }: { watch: ActiveWatch; today: string; onClose: () => void }) => {
  const qc = useQueryClient();
  const [start, setStart] = useState<string>(watch.started_on > today ? today : watch.started_on);
  const [end, setEnd] = useState<string>(today);
  const validDates = isDate(start) && isDate(end) && end >= start && end <= today;

  const preview = useQuery({
    queryKey: ["profit", "watch-preview", watch.id, start, end],
    enabled: validDates,
    queryFn: () => previewEndWatch(watch.id, start, end),
    placeholderData: (prev) => prev,
  });

  const emailCfg = useQuery({ queryKey: ["watch-emails", watch.property_id], queryFn: () => fetchWatchEmailStatus(watch.property_id), staleTime: 60_000 });
  const [notify, setNotify] = useState<boolean>(true);
  const [textNotify, setTextNotify] = useState<boolean>(false);
  const ec = emailCfg.data;
  useEffect(() => {
    if (ec) {
      setNotify(ec.property.send_end);
      setTextNotify(ec.property.text_end);
    }
  }, [ec]);
  const notifyTo = ec ? (ec.property.recipients.length ? ec.property.recipients.join(", ") : ec.auto?.recipient || "") : "";
  const textTo = ec ? (ec.property.text_phones.length ? ec.property.text_phones.join(", ") : ec.auto?.phone || "") : "";

  const afterEnd = async () => {
    try {
      if (!notify) await skipWatchEmail(watch.id, "end");
      // Texts only go out when switched on for the property AND ticked here.
      if (ec?.property.text_end && !textNotify) await skipWatchEmail(watch.id, "end", "text");
      if (!notify && !(ec?.property.text_end && textNotify)) return;
      const r = await runWatchEmails(watch.id);
      if (notify) {
        const sent = r.results.find((x) => x.kind === "end");
        if (sent?.status === "sent") toast.success(sent.test_mode ? "Completion notice sent to the test email" : "Completion notice emailed to the client");
        else if (sent?.status === "failed" || sent?.status === "skipped") toast.error("The completion notice didn't go out", { description: sent.error });
        else toast.message("Completion notice scheduled", { description: "It goes out automatically once the last shift is over." });
      }
      const txt = r.texts?.find((x) => x.kind === "end");
      if (txt?.status === "sent") toast.success(txt.test_mode ? "Completion text sent to the test phone" : "Completion text sent to the client");
      else if (txt?.status === "failed" || txt?.status === "skipped") toast.error("The completion text didn't go out", { description: txt.error });
    } catch (e) {
      toast.error("Couldn't send the completion notice", { description: friendlyError(e) });
    } finally {
      void qc.invalidateQueries({ queryKey: ["watch-emails"] });
    }
  };

  const save = useMutation({
    mutationFn: () => endWatch(watch.id, start, end),
    onSuccess: (r) => {
      if (ec) void afterEnd();
      toast.success(`${watch.name} watch ended`, {
        description: `${signed(r.totals.profit)} profit on ${whole(r.totals.revenue)} revenue${
          r.shifts_cleared > 0 ? ` · ${r.shifts_cleared} scheduled ${r.shifts_cleared === 1 ? "shift" : "shifts"} cleared` : ""
        }`,
      });
      void qc.invalidateQueries({ queryKey: ["profit"] });
      void qc.invalidateQueries({ queryKey: ["shifts"] });
      onClose();
    },
    onError: (e) => toast.error("Couldn't end the watch", { description: friendlyError(e) }),
  });

  const p = preview.data;
  const t = p?.totals;
  const cost = t ? t.labor + t.expenses + t.overhead : 0;
  const dateError = !isDate(start) || !isDate(end) ? "Pick both dates." : end < start ? "The end date must be on or after the start date." : end > today ? "The end date can't be in the future." : "";

  return (
    <Dialog open onOpenChange={(v) => !v && !save.isPending && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto border-line bg-surface text-ink sm:max-w-xl sm:rounded-xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">End watch · {watch.name}</DialogTitle>
          <DialogDescription className="text-ink-2">
            Closes out this fire watch, totals its revenue and profit, and clears the remaining scheduled shifts at this property.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <FieldLabel htmlFor="watch-start">Watch started</FieldLabel>
            <Input id="watch-start" type="date" value={start} max={end || today} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div>
            <FieldLabel htmlFor="watch-end">Last day of watch</FieldLabel>
            <Input id="watch-end" type="date" value={end} min={start} max={today} onChange={(e) => setEnd(e.target.value)} />
          </div>
          {dateError && <p className="text-sm text-status-incident-ink sm:col-span-2">{dateError}</p>}
        </div>

        <div className={cn("rounded-xl border border-line bg-raised/40 p-4 transition-opacity", preview.isFetching && "opacity-60")}>
          {preview.isError ? (
            <p className="text-sm text-status-incident-ink">{friendlyError(preview.error)}</p>
          ) : !t ? (
            <div className="flex items-center gap-2 text-sm text-ink-3">
              <Loader2 className="h-4 w-4 animate-spin" /> Adding up the watch…
            </div>
          ) : (
            <>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">
                  {validDates ? `${day(start)} – ${day(end, true)} · ${watchDays(start, end)} days` : "Watch total"}
                </span>
                <span className="text-xs text-ink-3">{hrs(t.hours)} {t.invoices > 0 ? "invoiced + approved" : "approved"}</span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-3">
                <BigFig label="Revenue" value={whole(t.revenue)} />
                <BigFig label="Cost" value={whole(cost)} />
                <BigFig label="Profit" value={signed(t.profit)} tone={profitTone(t.profit)} sub={pctText(marginOf(t))} />
              </div>
              {t.invoices > 0 && (
                <p className="mt-2 text-xs text-ink-3">
                  Revenue = {whole(t.billed)} on client invoices
                  {t.unbilled_revenue > 0 ? ` + ${whole(t.unbilled_revenue)} for ${hrs(t.unbilled_hours)} not invoiced yet` : ""}.
                </p>
              )}
              <p className="mt-2 text-xs text-ink-3">
                Cost = guard labor {whole(t.labor)}
                {t.labor_expenses > 0 && ` + recorded payroll ${whole(t.labor_expenses)}`}
                {t.expenses - t.labor_expenses > 0 && ` + property expenses ${whole(t.expenses - t.labor_expenses)}`}
                {t.overhead > 0 && ` + share of company overhead ${whole(t.overhead)}`}.
              </p>
            </>
          )}
        </div>

        {p && (
          <ul className="grid gap-2 text-sm">
            <Note icon={<CalendarX2 className="h-4 w-4" />} tone={p.clear.length > 0 ? "warn" : "quiet"}>
              {p.clear.length === 0 ? (
                "No scheduled shifts to clear."
              ) : (
                <>
                  <span className="font-medium text-ink">
                    Removes {p.clear.length} scheduled {p.clear.length === 1 ? "shift" : "shifts"}
                  </span>{" "}
                  from the schedule: {p.clear.slice(0, 6).map((c) => `${day(c.date)} ${time12(c.start)}`).join(", ")}
                  {p.clear.length > 6 && ` and ${p.clear.length - 6} more`}.
                </>
              )}
            </Note>
            {p.kept_shifts > 0 && (
              <Note icon={<Info className="h-4 w-4" />} tone="quiet">
                {p.kept_shifts} later {p.kept_shifts === 1 ? "shift stays" : "shifts stay"} on the schedule because it already has clock-ins, patrols or payments.
              </Note>
            )}
            {p.on_duty > 0 && (
              <Note icon={<AlertTriangle className="h-4 w-4" />} tone="warn">
                {p.on_duty === 1 ? "1 guard is" : `${p.on_duty} guards are`} still clocked in here. Clock them out so their hours are counted.
              </Note>
            )}
            {t && t.pending_hours > 0 && (
              <Note icon={<AlertTriangle className="h-4 w-4" />} tone="warn">
                {hrs(t.pending_hours)} still waiting for approval (about {whole(t.pending_revenue)} revenue) aren't in these totals yet. They'll be added to
                this watch once approved.
              </Note>
            )}
            {t && t.unpriced_revenue_hours > 0 && (
              <Note icon={<AlertTriangle className="h-4 w-4" />} tone="warn">
                {hrs(t.unpriced_revenue_hours)} have no client rate, so they count as $0 revenue.
              </Note>
            )}
            {p.later_entries > 0 && (
              <Note icon={<Info className="h-4 w-4" />} tone="quiet">
                {p.later_entries} {p.later_entries === 1 ? "timecard is" : "timecards are"} dated after the last day and won't count toward this watch.
              </Note>
            )}
          </ul>
        )}

        {ec && (
          <div className="rounded-lg border border-line bg-surface px-3 py-2.5">
            <CheckField
              label="Email the client the completion notice"
              checked={notify}
              onChange={setNotify}
              hint={
                ec.test_mode
                  ? `Test mode is on — it goes to ${ec.test_email || "the test email"} only. Sent once the last shift is over, with the real end time.`
                  : notifyTo
                    ? `To ${notifyTo}, once the last shift is over, with the real end time.`
                    : "No client email on file — add one under the property's Watch start & end notices."
              }
            />
            {ec.property.text_end && (
              <div className="mt-2.5 border-t border-line pt-2.5">
                <CheckField
                  label="Text the client the completion notice"
                  checked={textNotify}
                  onChange={setTextNotify}
                  hint={
                    ec.test_mode
                      ? `Test mode is on — it goes to ${ec.test_phone || "the test phone"} only.`
                      : textTo
                        ? `To ${textTo}, once the last shift is over.`
                        : "No client phone on file — add one under the property's Watch start & end notices."
                  }
                />
              </div>
            )}
          </div>
        )}

        <div className="mt-1 flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="font-semibold uppercase tracking-[0.08em]"
            disabled={!validDates || !p || preview.isFetching || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? <Loader2 className="animate-spin" /> : <Square className="fill-current" />}
            End watch
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};


const BigFig = ({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) => (
  <div className="min-w-0">
    <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3">{label}</div>
    <div className={cn("truncate font-display text-2xl font-bold tabular-nums text-ink", tone)}>{value}</div>
    {sub && <div className="text-xs text-ink-3">{sub} margin</div>}
  </div>
);

const Note = ({ icon, tone, children }: { icon: ReactNode; tone: "warn" | "quiet"; children: ReactNode }) => (
  <li
    className={cn(
      "flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-ink-2",
      tone === "warn" ? "border-status-follow/40 bg-status-follow/[0.07]" : "border-line bg-surface",
    )}
  >
    <span className={cn("mt-0.5 shrink-0", tone === "warn" ? "text-status-follow" : "text-ink-3")}>{icon}</span>
    <span className="min-w-0">{children}</span>
  </li>
);

// ─── Start watch ────────────────────────────────────────────────────────────

const StartWatchDialog = ({ property, today, onClose }: { property: IdleProperty; today: string; onClose: () => void }) => {
  const qc = useQueryClient();
  const [start, setStart] = useState<string>(today);
  const tooEarly = property.last_ended_on != null && start <= property.last_ended_on;

  const save = useMutation({
    mutationFn: () => startWatch(property.property_id, start),
    onSuccess: () => {
      toast.success(`${property.name} watch started`);
      void qc.invalidateQueries({ queryKey: ["profit"] });
      onClose();
    },
    onError: (e) => toast.error("Couldn't start the watch", { description: friendlyError(e) }),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && !save.isPending && onClose()}>
      <DialogContent className="border-line bg-surface text-ink sm:max-w-md sm:rounded-xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Start watch · {property.name}</DialogTitle>
          <DialogDescription className="text-ink-2">
            Starts a new fire watch here. Shifts can be scheduled at this property again from the start date on.
          </DialogDescription>
        </DialogHeader>
        <p className="flex items-start gap-2 rounded-lg border border-line bg-raised/40 px-3 py-2.5 text-sm text-ink-2">
          <Mail className="mt-0.5 h-4 w-4 shrink-0 text-link" />
          The client's start confirmation goes out automatically 24 hours before the first scheduled shift, with its real date and time.
        </p>
        <div>
          <FieldLabel htmlFor="watch-new-start">Start date</FieldLabel>
          <Input id="watch-new-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          {tooEarly && property.last_ended_on && (
            <p className="mt-1.5 text-sm text-status-incident-ink">Pick a day after the last watch ended ({day(property.last_ended_on, true)}).</p>
          )}
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="button" disabled={!isDate(start) || tooEarly || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? <Loader2 className="animate-spin" /> : <Play />}
            Start watch
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
