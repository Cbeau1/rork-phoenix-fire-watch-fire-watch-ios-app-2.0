import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, format } from "date-fns";
import {
  AlertTriangle,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileDown,
  History,
  Pencil,
  Plus,
  RotateCcw,
  ShieldAlert,
  Sheet,
  X,
} from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { THEME } from "@/lib/theme";

import { PageHeader } from "@/components/fw/primitives";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AreaField,
  ConfirmDialog,
  Empty,
  ErrorBlock,
  fmtDateTime,
  FormDialog,
  Loading,
  MetaPill,
  Pill,
  SectionCard,
  SelectField,
  TextField,
} from "@/components/workforce/kit";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useNow } from "@/hooks/use-now";
import { timeOfDay, toLocalInputValue } from "@/lib/format";
import { downloadPayrollCsv, downloadPayrollPdf } from "@/lib/payrollExport";
import { GROUP_LABEL, groupPeople, loadWorkerTypes, personType, type GroupTotals, type PayGroup } from "@/lib/payrollGroups";
import {
  currentPeriod,
  ENTRY_STATUS,
  entryMinutes,
  estimatePay,
  fmtCents,
  loadPayRates,
  rateKey,
  type PayEstimate,
  type PersonSummary,
  fmtDuration,
  fmtElapsed,
  fmtHours,
  loadEntries,
  loadEntryLog,
  loadOpenEntries,
  loadTeam,
  LOG_LABEL,
  periodLabel,
  reviewEntries,
  saveEntry,
  summarize,
  type PayPeriod,
  type TimeEntry,
} from "@/lib/timeclock";
import { cn } from "@/lib/utils";
import { useAuth } from "@/state/AuthProvider";
import { useFireWatch } from "@/state/FireWatchProvider";

const errMsg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

/** Admin-only Payroll: review, correct and approve clocked hours, then export the pay period. */
const Payroll = () => {
  useDocumentTitle("Payroll");
  const { user, isAdmin } = useAuth();
  const { propertyById, properties } = useFireWatch();
  const qc = useQueryClient();
  const [period, setPeriod] = useState<PayPeriod>(() => currentPeriod(14));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<TimeEntry | "new" | null>(null);
  const [rejecting, setRejecting] = useState<string[] | null>(null);
  const [historyFor, setHistoryFor] = useState<TimeEntry | null>(null);
  const [exportWarn, setExportWarn] = useState<boolean>(false);

  const key = ["tc", "payroll", user?.orgId ?? "", period.start.toISOString(), period.days];
  const entriesQ = useQuery({ queryKey: key, enabled: isAdmin, queryFn: () => loadEntries(period) });
  const openQ = useQuery({ queryKey: ["tc", "open-all", user?.orgId ?? ""], enabled: isAdmin, queryFn: () => loadOpenEntries() });
  const teamQ = useQuery({ queryKey: ["tc", "team", user?.orgId ?? ""], enabled: isAdmin, staleTime: 120_000, queryFn: loadTeam });
  const ratesQ = useQuery({ queryKey: ["tc", "rates", user?.orgId ?? ""], enabled: isAdmin, staleTime: 60_000, queryFn: loadPayRates });
  const typesQ = useQuery({ queryKey: ["wf", "pay-types", user?.orgId ?? ""], enabled: isAdmin, staleTime: 60_000, queryFn: loadWorkerTypes });

  const now = useNow(1000, (openQ.data?.length ?? 0) > 0);
  const teamName = useMemo(() => new Map((teamQ.data ?? []).map((m) => [m.id, m.name])), [teamQ.data]);
  const nameFor = (id: string | null, fallback: string) => (id ? (teamName.get(id) ?? fallback) : fallback || "Former member");
  const siteName = (id: string | null) => (id ? (propertyById.get(id)?.name ?? "Removed site") : "—");

  const entries = useMemo(() => entriesQ.data ?? [], [entriesQ.data]);
  const people = useMemo(() => summarize(entries, period, nameFor), [entries, period, teamName]); // eslint-disable-line react-hooks/exhaustive-deps
  const showPay = (ratesQ.data?.size ?? 0) > 0;
  const pay = useMemo(() => {
    const m = new Map<string, PayEstimate>();
    if (!ratesQ.data) return m;
    for (const p of people) m.set(p.key, estimatePay(p, period, ratesQ.data.get(rateKey(p.profileId, p.name))));
    return m;
  }, [people, period, ratesQ.data]);
  const grossTotal = [...pay.values()].reduce((s, e) => s + e.grossCents, 0);
  const typeOf = useMemo(() => (p: Pick<PersonSummary, "profileId" | "name">) => personType(typesQ.data, p), [typesQ.data]);
  const groups = useMemo(() => groupPeople(people, typeOf, pay), [people, typeOf, pay]);
  const groupOf = (g: PayGroup) => groups.find((x) => x.group === g);
  const missingRate = people.filter((p) => p.approvedMin > 0 && (pay.get(p.key)?.unpricedMin ?? 0) > 0).map((p) => p.name);
  const pending = entries.filter((e) => e.status === "pending");
  const openInPeriod = entries.filter((e) => e.status === "open");
  const totals = {
    approved: people.reduce((s, p) => s + p.approvedMin, 0),
    pending: people.reduce((s, p) => s + p.pendingMin, 0),
    overtime: people.reduce((s, p) => s + p.overMin, 0),
  };

  const review = useMutation({
    mutationFn: (v: { ids: string[]; action: "approve" | "reject" | "reopen"; note?: string }) => reviewEntries(v.ids, v.action, v.note ?? ""),
    onSuccess: (n, v) => {
      toast.success(
        v.action === "approve" ? `Approved ${n} ${n === 1 ? "entry" : "entries"}` : v.action === "reject" ? `Rejected ${n} ${n === 1 ? "entry" : "entries"}` : "Moved back to review",
      );
      setSelected(new Set());
      setRejecting(null);
      void qc.invalidateQueries({ queryKey: ["tc"] });
    },
    onError: (e) => toast.error(errMsg(e, "Couldn't update these hours.")),
  });

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleAll = (ids: string[], on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      for (const id of ids) {
        if (on) n.add(id);
        else n.delete(id);
      }
      return n;
    });
  const toggleExpand = (k: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const colCount = (period.days > 7 ? 8 : 6) + (showPay ? 1 : 0);
  const selectedIds = [...selected].filter((id) => entries.some((e) => e.id === id && e.status !== "open"));
  const shift = (dir: number) => {
    setSelected(new Set());
    setPeriod((p) => ({ ...p, start: addDays(p.start, dir * p.days) }));
  };

  const doPdf = () => {
    void downloadPayrollPdf({ period, people, orgName: user?.orgName ?? "", preparedBy: user?.name ?? "", siteName, pay: showPay ? pay : undefined, typeOf });
    setExportWarn(false);
  };

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-lg py-20 text-center">
        <ShieldAlert className="mx-auto h-12 w-12 text-link" strokeWidth={1.5} />
        <h1 className="mt-5 font-display text-3xl font-extrabold text-ink">Administrators only</h1>
        <p className="mt-2 text-ink-2">Payroll is limited to organization admins. You can see your own hours on My Hours.</p>
        <Button asChild className="mt-7">
          <Link to="/hours">Go to My Hours</Link>
        </Button>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Payroll"
        subtitle="Review clocked hours, fix missed punches, approve, and download the pay period."
        actions={
          <>
            <Button variant="outline" onClick={() => setEditing("new")}>
              <Plus />
              Add entry
            </Button>
            <Button variant="outline" onClick={() => downloadPayrollCsv(period, people, siteName, showPay ? pay : undefined, typeOf)} disabled={entries.length === 0}>
              <Sheet />
              CSV
            </Button>
            <Button onClick={() => (pending.length + openInPeriod.length > 0 ? setExportWarn(true) : doPdf())} disabled={entries.length === 0}>
              <FileDown />
              Download PDF
            </Button>
          </>
        }
      />

      {/* Period controls */}
      <div className="mb-5 flex flex-col gap-3 rounded-xl border border-line bg-surface shadow-card p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" aria-label="Previous period" onClick={() => shift(-1)}>
            <ChevronLeft />
          </Button>
          <div className="min-w-[200px] text-center">
            <div className="font-display text-lg font-bold text-ink">{periodLabel(period)}</div>
            <div className="text-xs text-ink-3">Weeks run Monday – Sunday</div>
          </div>
          <Button variant="outline" size="icon" aria-label="Next period" onClick={() => shift(1)}>
            <ChevronRight />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setPeriod(currentPeriod(period.days))}>
            Current
          </Button>
        </div>
        <div className="flex gap-1 rounded-lg border border-line bg-rail/60 p-1" role="tablist" aria-label="Pay period length">
          {[7, 14].map((d) => (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={period.days === d}
              onClick={() => {
                setSelected(new Set());
                setPeriod({ start: period.start, days: d });
              }}
              className={cn(
                "focus-ring rounded-md px-4 py-2 text-sm font-medium transition-colors",
                period.days === d ? "bg-primary text-white" : "text-ink-2 hover:bg-raised hover:text-ink",
              )}
            >
              {d === 7 ? "1 week" : "2 weeks"}
            </button>
          ))}
        </div>
      </div>

      {/* Metrics */}
      {showPay && (
        <GrossSplit
          total={grossTotal}
          direct={groupOf("direct")}
          agency={groupOf("agency")}
        />
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Approved hours" value={fmtHours(totals.approved)} dot={THEME.success} />
        <Metric label="Awaiting approval" value={fmtHours(totals.pending)} dot={THEME.warning} sub={`${pending.length} ${pending.length === 1 ? "entry" : "entries"}`} />
        <Metric label="Overtime (approved)" value={fmtHours(totals.overtime)} dot={THEME.warning} sub="Over 40 hrs / week" />
        <Metric label="On the clock now" value={String(openQ.data?.length ?? 0)} dot={THEME.success} pulse={(openQ.data?.length ?? 0) > 0} />
      </div>

      {showPay && missingRate.length > 0 && (
        <div className="mb-5 flex items-start gap-3 rounded-lg border border-status-follow/40 bg-status-follow/10 px-4 py-3 text-sm text-ink" role="status">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-follow" />
          <span>
            No pay rate on file for {missingRate.join(", ")} — those hours aren't in the gross pay total.{" "}
            <Link to="/team" className="font-medium text-link underline-offset-2 hover:underline">
              Set rates on the Team page or their Workforce profile
            </Link>
          </span>
        </div>
      )}

      {(openQ.data?.length ?? 0) > 0 && (
        <SectionCard className="mb-5" title="On the clock now" subtitle="Live — updates as people clock in and out">
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {(openQ.data ?? []).map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 rounded-lg border border-status-clear/35 bg-raised px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate font-medium text-ink">{nameFor(e.profileId, e.workerName)}</div>
                  <div className="text-xs text-ink-3">Since {format(new Date(e.clockIn), "EEE h:mm a")}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-lg font-semibold tabular-nums text-status-clear">{fmtElapsed(now - Date.parse(e.clockIn))}</span>
                  <Button variant="ghost" size="icon" aria-label="Edit entry" onClick={() => setEditing(e)}>
                    <Pencil />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      <SectionCard
        title="Hours by employee"
        subtitle="Only approved hours count toward payroll totals. Edits send an entry back for approval."
        action={
          pending.length > 0 ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => review.mutate({ ids: pending.map((e) => e.id), action: "approve" })}
              disabled={review.isPending}
            >
              <Check />
              Approve all pending ({pending.length})
            </Button>
          ) : undefined
        }
      >
        {selectedIds.length > 0 && (
          <div className="sticky top-16 z-10 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/40 bg-rail/95 px-4 py-2.5 backdrop-blur lg:top-2">
            <span className="text-sm text-ink">
              {selectedIds.length} selected
            </span>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => review.mutate({ ids: selectedIds, action: "approve" })} disabled={review.isPending}>
                <Check />
                Approve
              </Button>
              <Button size="sm" variant="outline" onClick={() => setRejecting(selectedIds)}>
                <X />
                Reject
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
            </div>
          </div>
        )}

        {entriesQ.isLoading ? (
          <Loading />
        ) : entriesQ.error ? (
          <ErrorBlock message={entriesQ.error.message} onRetry={() => void entriesQ.refetch()} />
        ) : people.length === 0 ? (
          <Empty
            title="No hours in this period"
            description="When employees clock in on the website or iPhone app, their hours show up here for approval."
          />
        ) : (
          <div className="overflow-hidden rounded-lg border border-line">
            <table className="w-full text-sm">
              <thead className="hidden bg-rail/70 text-left text-[11px] uppercase tracking-[0.12em] text-ink-3 md:table-header-group">
                <tr>
                  <th className="px-4 py-3 font-medium">Employee</th>
                  {period.days > 7 && <th className="px-3 py-3 text-right font-medium">Week 1</th>}
                  {period.days > 7 && <th className="px-3 py-3 text-right font-medium">Week 2</th>}
                  <th className="px-3 py-3 text-right font-medium">Regular</th>
                  <th className="px-3 py-3 text-right font-medium">OT</th>
                  <th className="px-3 py-3 text-right font-medium">Approved</th>
                  <th className="px-3 py-3 text-right font-medium">Pending</th>
                  {showPay && <th className="px-3 py-3 text-right font-medium">Gross pay</th>}
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {groups.map((g) => (
                  <Fragment key={g.group}>
                    <GroupHeader g={g} colSpan={colCount} showPay={showPay} />
                {g.people.map((p) => {
                  const open = expanded.has(p.key);
                  const reviewable = p.entries.filter((e) => e.status !== "open").map((e) => e.id);
                  const allSel = reviewable.length > 0 && reviewable.every((id) => selected.has(id));
                  const est = pay.get(p.key);
                  return (
                    <Fragment key={p.key}>
                      <tr className="cursor-pointer bg-raised transition-colors hover:bg-raised/70" onClick={() => toggleExpand(p.key)}>
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-3">
                            <input
                              type="checkbox"
                              aria-label={`Select all entries for ${p.name}`}
                              checked={allSel}
                              disabled={reviewable.length === 0}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => toggleAll(reviewable, e.target.checked)}
                              className="h-4 w-4 accent-primary"
                            />
                            <div className="min-w-0">
                              <div className="truncate font-medium text-ink">
                                {p.name}
                                {showPay && est && (
                                  <span className="ml-2 font-mono text-xs font-normal text-ink-3">{est.rate !== null ? `$${est.rate.toFixed(2)}/hr` : "no rate"}</span>
                                )}
                              </div>
                              <div className="mt-0.5 flex flex-wrap gap-1.5 md:hidden">
                                <span className="font-mono text-xs text-ink-2">{fmtHours(p.approvedMin)} approved</span>
                                {p.pendingMin > 0 && <span className="font-mono text-xs text-status-follow">· {fmtHours(p.pendingMin)} pending</span>}
                                {showPay && est && <span className="font-mono text-xs text-status-clear">· {fmtCents(est.grossCents)}</span>}
                              </div>
                              {g.group === "agency" && (
                                <div className="mt-0.5 text-xs text-ink-3">{typeOf(p).agency ? `via ${typeOf(p).agency}` : "Agency placed"}</div>
                              )}
                              {p.openCount > 0 && (
                                <Pill tone="green" className="mt-1">
                                  Clocked in
                                </Pill>
                              )}
                            </div>
                          </div>
                        </td>
                        {period.days > 7 &&
                          p.weeks.map((w) => (
                            <td key={w.start} className="hidden px-3 py-3.5 text-right font-mono tabular-nums text-ink-2 md:table-cell">
                              {fmtHours(w.approvedMin)}
                            </td>
                          ))}
                        <td className="hidden px-3 py-3.5 text-right font-mono tabular-nums text-ink-2 md:table-cell">{fmtHours(p.regularMin)}</td>
                        <td className={cn("hidden px-3 py-3.5 text-right font-mono tabular-nums md:table-cell", p.overMin > 0 ? "text-link" : "text-ink-3")}>
                          {fmtHours(p.overMin)}
                        </td>
                        <td className="hidden px-3 py-3.5 text-right font-mono font-semibold tabular-nums text-ink md:table-cell">{fmtHours(p.approvedMin)}</td>
                        <td className={cn("hidden px-3 py-3.5 text-right font-mono tabular-nums md:table-cell", p.pendingMin > 0 ? "text-status-follow" : "text-ink-3")}>
                          {fmtHours(p.pendingMin)}
                        </td>
                        {showPay && (
                          <td className="hidden px-3 py-3.5 text-right font-mono font-semibold tabular-nums text-status-clear md:table-cell">
                            {est ? fmtCents(est.grossCents) : "—"}
                            {est && est.overtimePremiumCents > 0 && (
                              <div className="text-[11px] font-normal text-ink-3">incl. {fmtCents(est.overtimePremiumCents)} OT</div>
                            )}
                          </td>
                        )}
                        <td className="px-2 text-right">
                          <ChevronDown className={cn("ml-auto h-4 w-4 text-ink-3 transition-transform", open && "rotate-180")} />
                        </td>
                      </tr>
                      {open && (
                        <tr>
                          <td colSpan={colCount} className="bg-canvas/40 p-2 sm:p-3">
                            <ul className="space-y-1.5">
                              {p.entries.map((e) => (
                                <EntryRow
                                  key={e.id}
                                  entry={e}
                                  now={now}
                                  site={siteName(e.propertyId)}
                                  selected={selected.has(e.id)}
                                  onSelect={() => toggle(e.id)}
                                  onApprove={() => review.mutate({ ids: [e.id], action: "approve" })}
                                  onReject={() => setRejecting([e.id])}
                                  onReopen={() => review.mutate({ ids: [e.id], action: "reopen" })}
                                  onEdit={() => setEditing(e)}
                                  onHistory={() => setHistoryFor(e)}
                                  busy={review.isPending}
                                />
                              ))}
                            </ul>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {editing && (
        <EntryDialog
          entry={editing === "new" ? null : editing}
          team={(teamQ.data ?? []).filter((m) => m.active || (editing !== "new" && m.id === editing.profileId))}
          sites={properties.map((s) => ({ value: s.id, label: s.name }))}
          onClose={() => setEditing(null)}
        />
      )}

      <RejectDialog
        ids={rejecting}
        busy={review.isPending}
        onClose={() => setRejecting(null)}
        onConfirm={(note) => rejecting && review.mutate({ ids: rejecting, action: "reject", note })}
      />

      <HistoryDialog entry={historyFor} onClose={() => setHistoryFor(null)} />

      <ConfirmDialog
        open={exportWarn}
        onOpenChange={setExportWarn}
        title="Some hours aren't approved yet"
        description={`${pending.length} pending and ${openInPeriod.length} still-open ${openInPeriod.length === 1 ? "entry" : "entries"} won't count toward the totals. Download anyway?`}
        confirmLabel="Download PDF"
        onConfirm={doPdf}
      />
    </>
  );
};

const GrossSplit = ({ total, direct, agency }: { total: number; direct?: GroupTotals; agency?: GroupTotals }) => {
  const cells: { key: string; label: string; cents: number; sub: string; color: string; share: number }[] = [
    {
      key: "direct",
      label: GROUP_LABEL.direct,
      cents: direct?.grossCents ?? 0,
      sub: `${direct?.people.length ?? 0} ${direct?.people.length === 1 ? "employee" : "employees"} · ${fmtHours(direct?.approvedMin ?? 0)} hrs`,
      color: THEME.primary,
      share: total > 0 ? (direct?.grossCents ?? 0) / total : 0,
    },
    {
      key: "agency",
      label: GROUP_LABEL.agency,
      cents: agency?.grossCents ?? 0,
      sub: `${agency?.people.length ?? 0} ${agency?.people.length === 1 ? "worker" : "workers"} · ${fmtHours(agency?.approvedMin ?? 0)} hrs`,
      color: THEME.warning,
      share: total > 0 ? (agency?.grossCents ?? 0) / total : 0,
    },
  ];
  return (
    <section aria-label="Estimated gross pay" className="mb-3 rounded-xl border border-line bg-surface p-4 shadow-card sm:p-5">
      <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end sm:gap-6">
        {cells.map((c) => (
          <div key={c.key} className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c.color }} aria-hidden />
              <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-2">{c.label} · gross</span>
            </div>
            <div className="mt-2 font-display text-3xl font-extrabold tabular-nums text-ink sm:text-4xl">{fmtCents(c.cents)}</div>
            <div className="mt-1 text-xs text-ink-3">{c.sub}</div>
          </div>
        ))}
        <div className="border-t border-line pt-3 sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0 sm:text-right">
          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-2">Combined</div>
          <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-status-clear">{fmtCents(total)}</div>
          <div className="mt-0.5 text-xs text-ink-3">Approved hours × rate, before taxes</div>
        </div>
      </div>
      <div className="mt-4 flex h-1.5 overflow-hidden rounded-full bg-rail" aria-hidden>
        {cells.map((c) => (
          <div key={c.key} className="h-full transition-[width] duration-700 ease-out" style={{ width: `${c.share * 100}%`, backgroundColor: c.color }} />
        ))}
      </div>
    </section>
  );
};

const GroupHeader = ({ g, colSpan, showPay }: { g: GroupTotals; colSpan: number; showPay: boolean }) => (
  <tr className="bg-rail/60">
    <td colSpan={colSpan} className="px-4 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: g.group === "direct" ? THEME.primary : THEME.warning }} aria-hidden />
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink">{GROUP_LABEL[g.group]}</span>
          <span className="text-xs text-ink-3">{g.people.length}</span>
        </div>
        <div className="flex items-center gap-4 font-mono text-xs tabular-nums text-ink-2">
          <span>{fmtHours(g.approvedMin)} hrs approved</span>
          {g.overMin > 0 && <span className="text-link">{fmtHours(g.overMin)} OT</span>}
          {showPay && <span className="font-semibold text-status-clear">{fmtCents(g.grossCents)}</span>}
        </div>
      </div>
    </td>
  </tr>
);

const Metric = ({ label, value, dot, sub, pulse }: { label: string; value: string; dot: string; sub?: string; pulse?: boolean }) => (
  <div className="rounded-xl border border-line bg-surface shadow-card p-4 sm:p-5">
    <div className="flex items-center gap-2">
      <span className={cn("h-2 w-2 rounded-full", pulse && "animate-pulse")} style={{ backgroundColor: dot }} aria-hidden />
      <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-2">{label}</span>
    </div>
    <div className="mt-2 font-display text-3xl font-extrabold tabular-nums text-ink sm:text-4xl">{value}</div>
    {sub && <div className="mt-1 text-xs text-ink-3">{sub}</div>}
  </div>
);

const EntryRow = ({
  entry: e,
  now,
  site,
  selected,
  onSelect,
  onApprove,
  onReject,
  onReopen,
  onEdit,
  onHistory,
  busy,
}: {
  entry: TimeEntry;
  now: number;
  site: string;
  selected: boolean;
  onSelect: () => void;
  onApprove: () => void;
  onReject: () => void;
  onReopen: () => void;
  onEdit: () => void;
  onHistory: () => void;
  busy: boolean;
}) => {
  const isOpen = e.status === "open";
  return (
    <li className={cn("flex flex-col gap-3 rounded-lg border bg-raised px-3 py-3 sm:flex-row sm:items-center", selected ? "border-primary/60" : "border-line")}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <input
          type="checkbox"
          aria-label="Select entry"
          checked={selected}
          disabled={isOpen}
          onChange={onSelect}
          className="h-4 w-4 shrink-0 accent-primary"
        />
        <div className="w-20 shrink-0">
          <div className="text-sm font-semibold text-ink">{format(new Date(e.clockIn), "EEE")}</div>
          <div className="text-xs text-ink-3">{format(new Date(e.clockIn), "MMM d")}</div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-sm tabular-nums text-ink">
            {timeOfDay(e.clockIn)} → {e.clockOut ? timeOfDay(e.clockOut) : "now"}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <MetaPill meta={ENTRY_STATUS} value={e.status} />
            {e.shiftId && e.source === "manual" ? (
              <Pill tone="blue">From schedule</Pill>
            ) : (
              e.edited && <Pill tone="blue">{e.source === "manual" ? "Added by admin" : "Edited"}</Pill>
            )}
            {e.scheduledLabel && (
              <span className="inline-flex items-center gap-1 text-xs text-ink-3">
                <CalendarDays className="h-3 w-3" />
                Scheduled {e.scheduledLabel}
              </span>
            )}
            {site !== "—" && <span className="text-xs text-ink-3">{site}</span>}
          </div>
          {(e.adminNote || e.employeeNote) && (
            <p className="mt-1 line-clamp-2 text-xs text-ink-3">{e.adminNote ? `Admin: ${e.adminNote}` : `Note: ${e.employeeNote}`}</p>
          )}
        </div>
        <div className="shrink-0 text-right font-mono text-base font-semibold tabular-nums text-ink">{fmtDuration(entryMinutes(e, now))}</div>
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-1">
        {e.status === "pending" && (
          <>
            <Button size="sm" onClick={onApprove} disabled={busy}>
              <Check />
              Approve
            </Button>
            <Button size="sm" variant="ghost" onClick={onReject} aria-label="Reject">
              <X />
            </Button>
          </>
        )}
        {(e.status === "approved" || e.status === "rejected") && (
          <Button size="sm" variant="ghost" onClick={onReopen} disabled={busy}>
            <RotateCcw />
            Undo
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onEdit} aria-label="Edit times">
          <Pencil />
        </Button>
        <Button size="sm" variant="ghost" onClick={onHistory} aria-label="History">
          <History />
        </Button>
      </div>
    </li>
  );
};

const EntryDialog = ({
  entry,
  team,
  sites,
  onClose,
}: {
  entry: TimeEntry | null;
  team: { id: string; name: string }[];
  sites: { value: string; label: string }[];
  onClose: () => void;
}) => {
  const qc = useQueryClient();
  const initialIn = entry ? toLocalInputValue(new Date(entry.clockIn)) : "";
  const initialOut = entry?.clockOut ? toLocalInputValue(new Date(entry.clockOut)) : entry ? toLocalInputValue(new Date()) : "";
  const [profileId, setProfileId] = useState<string>(entry?.profileId ?? "");
  const [clockIn, setClockIn] = useState<string>(initialIn);
  const [clockOut, setClockOut] = useState<string>(initialOut);
  const [siteId, setSiteId] = useState<string>(entry?.propertyId ?? "");
  const [reason, setReason] = useState<string>("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const inD = clockIn ? new Date(clockIn) : null;
  const outD = clockOut ? new Date(clockOut) : null;
  const mins = inD && outD && outD > inD ? Math.floor((outD.getTime() - inD.getTime()) / 60000) : 0;

  const save = useMutation({
    mutationFn: () =>
      saveEntry({ id: entry?.id ?? null, profileId, clockIn: inD as Date, clockOut: outD as Date, propertyId: siteId || null, reason: reason.trim() }),
    onSuccess: () => {
      toast.success(entry ? "Entry updated — waiting for approval" : "Entry added — waiting for approval");
      void qc.invalidateQueries({ queryKey: ["tc"] });
      onClose();
    },
    onError: (e) => toast.error(errMsg(e, "Couldn't save this entry.")),
  });

  const submit = () => {
    const e: Record<string, string> = {};
    if (!profileId) e.profileId = "Choose a team member.";
    if (!inD || Number.isNaN(inD.getTime())) e.clockIn = "Enter the clock-in time.";
    if (!outD || Number.isNaN(outD.getTime())) e.clockOut = "Enter the clock-out time.";
    else if (inD && outD <= inD) e.clockOut = "Clock-out must be after clock-in.";
    else if (mins > 24 * 60) e.clockOut = "A single entry can't be longer than 24 hours.";
    if (!reason.trim()) e.reason = "Add a reason — it's saved in the audit history.";
    setErrors(e);
    if (Object.keys(e).length === 0) save.mutate();
  };

  return (
    <FormDialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={entry ? (entry.clockOut ? "Edit hours" : "Clock out / correct entry") : "Add missed punch"}
      description={entry ? "Changes send the entry back for approval and are recorded in its history." : "Add hours for someone who forgot to clock in or out."}
      dirty={clockIn !== initialIn || clockOut !== initialOut || reason !== "" || profileId !== (entry?.profileId ?? "")}
      saving={save.isPending}
      onSubmit={submit}
      submitLabel={entry ? "Save changes" : "Add entry"}
    >
      <SelectField
        label="Team member"
        required
        value={profileId}
        onChange={setProfileId}
        options={team.map((m) => ({ value: m.id, label: m.name }))}
        error={errors.profileId}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Clock in" type="datetime-local" required value={clockIn} onChange={setClockIn} error={errors.clockIn} />
        <TextField label="Clock out" type="datetime-local" required value={clockOut} onChange={setClockOut} error={errors.clockOut} />
      </div>
      <div className="flex items-center justify-between rounded-lg border border-line bg-raised px-4 py-3">
        <span className="flex items-center gap-2 text-sm text-ink-2">
          <Clock className="h-4 w-4" />
          Hours
        </span>
        <span className="font-mono text-lg font-semibold tabular-nums text-ink">{fmtDuration(mins)}</span>
      </div>
      <SelectField label="Site" value={siteId} onChange={setSiteId} options={sites} allowNone noneLabel="No site" />
      <AreaField label="Reason for change" required value={reason} onChange={setReason} rows={2} placeholder="e.g. Forgot to clock out — confirmed with supervisor" error={errors.reason} />
    </FormDialog>
  );
};

const RejectDialog = ({ ids, busy, onClose, onConfirm }: { ids: string[] | null; busy: boolean; onClose: () => void; onConfirm: (note: string) => void }) => {
  const [note, setNote] = useState<string>("");
  return (
    <ConfirmDialog
      open={!!ids}
      onOpenChange={(v) => {
        if (!v) {
          setNote("");
          onClose();
        }
      }}
      title={`Reject ${ids?.length ?? 0} ${ids?.length === 1 ? "entry" : "entries"}?`}
      description="Rejected hours are kept for the record but never count toward payroll. You can undo this later."
      confirmLabel="Reject"
      destructive
      busy={busy}
      disabled={!note.trim()}
      onConfirm={() => onConfirm(note.trim())}
    >
      <AreaField label="Reason" required value={note} onChange={setNote} rows={2} placeholder="e.g. Duplicate entry" />
    </ConfirmDialog>
  );
};

const HistoryDialog = ({ entry, onClose }: { entry: TimeEntry | null; onClose: () => void }) => {
  const q = useQuery({ queryKey: ["tc", "log", entry?.id ?? ""], enabled: !!entry, queryFn: () => loadEntryLog(entry?.id ?? "") });
  const fmtSnap = (v: unknown): string => {
    const o = (v ?? {}) as { clock_in?: string; clock_out?: string | null };
    if (!o.clock_in) return "";
    return `${format(new Date(o.clock_in), "MMM d h:mm a")} → ${o.clock_out ? format(new Date(o.clock_out), "h:mm a") : "open"}`;
  };
  return (
    <Dialog open={!!entry} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto border-line bg-surface text-ink sm:max-w-lg sm:rounded-xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Entry history</DialogTitle>
          <DialogDescription className="text-ink-2">{entry ? `${entry.workerName} · ${format(new Date(entry.clockIn), "EEE MMM d")}` : ""}</DialogDescription>
        </DialogHeader>
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <ErrorBlock message={q.error.message} />
        ) : (
          <ol className="space-y-2">
            {(q.data ?? []).map((l) => (
              <li key={l.id} className="rounded-lg border border-line bg-raised px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-ink">{LOG_LABEL[l.action] ?? l.action}</span>
                  <span className="text-xs text-ink-3">{fmtDateTime(l.createdAt)}</span>
                </div>
                <div className="mt-0.5 text-xs text-ink-2">by {l.actorName || "Unknown"}</div>
                {l.action === "edit" && (
                  <div className="mt-1.5 font-mono text-xs text-ink-2">
                    <div className="line-through opacity-70">{fmtSnap(l.detail.before)}</div>
                    <div>{fmtSnap(l.detail.after)}</div>
                  </div>
                )}
                {typeof l.detail.reason === "string" && l.detail.reason && <p className="mt-1 text-xs text-ink-3">Reason: {l.detail.reason}</p>}
                {typeof l.detail.note === "string" && l.detail.note && <p className="mt-1 text-xs text-ink-3">Note: {l.detail.note}</p>}
              </li>
            ))}
            {(q.data ?? []).length === 0 && (
              <li className="flex items-center gap-2 text-sm text-ink-3">
                <AlertTriangle className="h-4 w-4" />
                No history recorded.
              </li>
            )}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default Payroll;
