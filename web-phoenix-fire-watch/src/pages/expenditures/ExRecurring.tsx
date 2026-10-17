import { useMutation } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { CalendarClock, Pause, Pencil, Play, Plus, Repeat, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { RecurringForm } from "@/components/expenses/RecurringForm";
import { PageHeader } from "@/components/fw/primitives";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Empty, Pill } from "@/components/workforce/kit";
import * as api from "@/lib/expenses/api";
import { METHOD, PAID_BY, type PaidBy, type Recurring } from "@/lib/expenses/constants";
import { addTo, fmtMoney, fmtTotals, toCents, type Totals } from "@/lib/expenses/money";
import { nextOccurrence, recurringStatus, scheduleLabel, todayKey, toSched, type RecurringStatus } from "@/lib/expenses/recurring";
import type { Tone } from "@/lib/workforce/constants";
import { cn } from "@/lib/utils";
import { useExpenses } from "@/state/ExpensesProvider";

const STATUS: Record<RecurringStatus, { label: string; tone: Tone }> = {
  active: { label: "Active", tone: "green" },
  scheduled: { label: "Starts later", tone: "blue" },
  paused: { label: "Paused", tone: "amber" },
  ended: { label: "Ended", tone: "slate" },
};

const fmt = (k: string, p = "MMM d, yyyy") => format(parseISO(k), p);

const ExRecurring = () => {
  const ex = useExpenses();
  const [editing, setEditing] = useState<Recurring | null>(null);
  const [formOpen, setFormOpen] = useState<boolean>(false);
  const [stopping, setStopping] = useState<Recurring | null>(null);
  const today = todayKey();

  const entries = useMemo(() => {
    const m = new Map<string, { count: number; lastId: string; lastDate: string }>();
    for (const e of ex.data.expenditures) {
      if (!e.recurring_id || e.archived_at) continue;
      const cur = m.get(e.recurring_id);
      if (!cur) m.set(e.recurring_id, { count: 1, lastId: e.id, lastDate: e.spent_on });
      else {
        cur.count += 1;
        if (e.spent_on > cur.lastDate) {
          cur.lastDate = e.spent_on;
          cur.lastId = e.id;
        }
      }
    }
    return m;
  }, [ex.data.expenditures]);

  const rows = useMemo(() => {
    const order: Record<RecurringStatus, number> = { active: 0, scheduled: 1, paused: 2, ended: 3 };
    return ex.data.recurring
      .map((r) => ({ r, status: recurringStatus(r, today), next: r.paused_at ? null : nextOccurrence(toSched(r), today) }))
      .sort((a, b) => order[a.status] - order[b.status] || (a.next ?? "9").localeCompare(b.next ?? "9") || a.r.vendor.localeCompare(b.r.vendor));
  }, [ex.data.recurring, today]);

  const monthly = useMemo(
    () => rows.filter((x) => x.status === "active" || x.status === "scheduled").reduce<Totals>((t, x) => addTo(t, x.r.currency, toCents(x.r.amount)), {}),
    [rows],
  );
  const activeCount = rows.filter((x) => x.status === "active" || x.status === "scheduled").length;

  const state = useMutation({
    mutationFn: (v: { r: Recurring; action: "pause" | "resume" | "delete" }) => api.setRecurringState(v.r.id, v.action),
    onSuccess: (res, v) => {
      ex.invalidate();
      setStopping(null);
      const msg = v.action === "pause" ? "Paused — nothing will be added until you resume" : v.action === "resume" ? "Resumed" : "Recurring expense stopped";
      toast.success(res.created > 0 ? `${msg} · ${res.created} added` : msg);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't update the recurring expense."),
  });

  const openForm = (r: Recurring | null) => {
    setEditing(r);
    setFormOpen(true);
  };

  return (
    <div>
      <PageHeader
        title="Monthly recurring"
        subtitle={
          rows.length === 0
            ? "Rent, insurance, phones, software — set them once and they're added to records every month."
            : `${activeCount} active · ${fmtTotals(monthly)} per month`
        }
        actions={
          <Button onClick={() => openForm(null)}>
            <Plus />
            Add monthly expense
          </Button>
        }
      />

      {rows.length === 0 ? (
        <Empty
          title="No recurring expenses yet"
          description="Pick the amount and the day of the month. On that day each month it's added to your expenditure records automatically."
          action={
            <Button onClick={() => openForm(null)}>
              <Plus />
              Add monthly expense
            </Button>
          }
        />
      ) : (
        <ul className="grid gap-3">
          {rows.map(({ r, status, next }) => {
            const meta = STATUS[status];
            const made = entries.get(r.id);
            const cat = ex.index.categoryById.get(r.category_id);
            const dim = status === "paused" || status === "ended";
            return (
              <li key={r.id} className="rounded-xl border border-line bg-surface p-3 shadow-card">
                <div className="flex flex-col gap-3 rounded-lg border border-line bg-raised p-3.5 sm:flex-row sm:items-center">
                  <div
                    className={cn(
                      "flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-xl border",
                      dim ? "border-line bg-surface text-ink-3" : "border-primary/30 bg-primary/10 text-link",
                    )}
                    aria-hidden
                  >
                    <span className="font-display text-2xl font-extrabold leading-none">{r.day_of_month}</span>
                    <span className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em]">monthly</span>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-semibold text-ink">{r.vendor}</span>
                      <Pill tone={meta.tone}>{meta.label}</Pill>
                    </div>
                    <div className="truncate text-sm text-ink-2">{r.description}</div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-3">
                      <span>{scheduleLabel(r.day_of_month)}</span>
                      {cat && <span>{cat.name}</span>}
                      <span>
                        {PAID_BY[r.paid_by as PaidBy] ?? r.paid_by} · {METHOD[r.payment_method] ?? r.payment_method}
                        {r.account_label ? ` · ${r.account_label}` : ""}
                      </span>
                      {r.property_id && <span>{ex.propertyName(r.property_id)}</span>}
                      {r.end_on && <span>Until {fmt(r.end_on)}</span>}
                    </div>
                  </div>

                  <div className="flex flex-row items-end justify-between gap-4 sm:flex-col sm:items-end sm:gap-1 sm:text-right">
                    <span className="font-mono text-lg font-semibold tabular-nums text-ink">{fmtMoney(toCents(r.amount), r.currency)}</span>
                    <span className="text-xs text-ink-2">
                      {status === "paused" ? (
                        "Paused"
                      ) : next ? (
                        <>
                          <CalendarClock className="mr-1 inline h-3 w-3 -translate-y-px" />
                          Next {fmt(next, "MMM d")}
                        </>
                      ) : (
                        "No more charges"
                      )}
                    </span>
                    {made && (
                      <Link to={`/expenditures/records/${made.lastId}`} className="focus-ring rounded text-xs text-link hover:underline">
                        {made.count} added · last {fmt(made.lastDate, "MMM d")}
                      </Link>
                    )}
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap justify-end gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => openForm(r)}>
                    <Pencil />
                    Edit
                  </Button>
                  {status !== "ended" &&
                    (r.paused_at ? (
                      <Button size="sm" variant="ghost" disabled={state.isPending} onClick={() => state.mutate({ r, action: "resume" })}>
                        <Play />
                        Resume
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" disabled={state.isPending} onClick={() => state.mutate({ r, action: "pause" })}>
                        <Pause />
                        Pause
                      </Button>
                    ))}
                  <Button size="sm" variant="ghost" className="text-status-incident hover:text-status-incident" onClick={() => setStopping(r)}>
                    <Trash2 />
                    Stop
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-6 flex items-start gap-2 text-xs text-ink-3">
        <Repeat className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Entries are added on the chosen day (the last day in shorter months) and are marked "Monthly recurring" in records. Each one can be edited, given a
        receipt, or archived like any other expenditure. Paused months are skipped, not added later.
      </p>

      <RecurringForm open={formOpen} onOpenChange={setFormOpen} recurring={editing} />
      <ConfirmDialog
        open={!!stopping}
        onOpenChange={(v) => !v && setStopping(null)}
        title="Stop this recurring expense?"
        description={
          stopping
            ? `${stopping.vendor} won't be added again. The ${entries.get(stopping.id)?.count ?? 0} entr${(entries.get(stopping.id)?.count ?? 0) === 1 ? "y" : "ies"} already in your records stay.`
            : undefined
        }
        confirmLabel="Stop recurring"
        destructive
        busy={state.isPending}
        onConfirm={() => stopping && state.mutate({ r: stopping, action: "delete" })}
      />
    </div>
  );
};

export default ExRecurring;
