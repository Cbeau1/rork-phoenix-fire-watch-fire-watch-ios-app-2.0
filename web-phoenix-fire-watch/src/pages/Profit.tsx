import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO, startOfISOWeek } from "date-fns";
import {
  AlertTriangle,
  Building2,
  ChevronRight,
  Clock,
  Hourglass,
  Info,
  Loader2,
  Lock,
  RadioTower,
  RefreshCw,
  Settings2,
  TrendingDown,
  TrendingUp,
  UserX,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { Card, PageHeader } from "@/components/fw/primitives";
import { Button } from "@/components/ui/button";
import { Empty, ErrorBlock, FormDialog, Loading, TextField, toNum } from "@/components/workforce/kit";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { money } from "@/lib/crm/types";
import {
  fetchProfit,
  laborCost,
  marginOf,
  PERIODS,
  pct,
  type ProfitDashboard,
  type ProfitPeriod,
  type ProfitProperty,
  profitOf,
  saveBurden,
  totalsOf,
} from "@/lib/profit/api";
import { friendlyError } from "@/lib/supabase";
import { THEME, tint } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useAuth } from "@/state/AuthProvider";
import { useWfPerms } from "@/state/WorkforceProvider";

const tzLabel = (tz: string): string =>
  new Date().toLocaleString("en-US", { timeZone: tz, timeZoneName: "short" }).split(" ").pop() ?? tz;

const hrs = (n: number): string => `${n.toLocaleString("en-US", { maximumFractionDigits: 1 })} h`;
const whole = (n: number): string => money(n, false);
const signed = (n: number): string => (n < 0 ? `−${money(Math.abs(n), false)}` : money(n, false));

/** Margin health: green ≥ 25%, amber 10–25%, red below 10% or a loss. */
const marginTone = (m: number | null): { text: string; bar: string; color: string } => {
  if (m == null) return { text: "text-ink-3", bar: "bg-ink-3/40", color: THEME.ink3 };
  if (m >= 0.25) return { text: "text-status-clear", bar: "bg-status-clear", color: THEME.success };
  if (m >= 0.1) return { text: "text-status-follow", bar: "bg-status-follow", color: THEME.warning };
  return { text: "text-status-incident-ink", bar: "bg-status-incident", color: THEME.danger };
};

const Profit = () => {
  useDocumentTitle("Profit");
  const { isAdmin } = useAuth();
  const perms = useWfPerms();
  const canSee = isAdmin && perms.data?.pay === true;
  const [period, setPeriod] = useState<ProfitPeriod>("month");
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);

  const q = useQuery({
    queryKey: ["profit", "dashboard", period],
    enabled: canSee,
    queryFn: () => fetchProfit(period),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });

  if (!isAdmin || perms.isLoading) {
    return perms.isLoading ? <Loading label="Checking access…" /> : <NoAccess admin={false} />;
  }
  if (!canSee) return <NoAccess admin />;

  const d = q.data;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Profit"
        subtitle={
          <>
            What each property earns after guard wages and expenses, updated live.
            {d && <span className="text-ink-3"> Dates in {tzLabel(d.tz)}.</span>}
          </>
        }
        actions={
          <>
            <LiveStamp at={d?.generated_at} fetching={q.isFetching} onRefresh={() => void q.refetch()} />
            <Button variant="outline" onClick={() => setSettingsOpen(true)} disabled={!d}>
              <Settings2 />
              Cost settings
            </Button>
          </>
        }
      />

      <PeriodPicker value={period} onChange={setPeriod} />

      {q.isLoading ? (
        <Loading label="Adding up revenue and costs…" />
      ) : q.isError && !d ? (
        <ErrorBlock message={friendlyError(q.error)} onRetry={() => void q.refetch()} />
      ) : d ? (
        <div className={cn("grid gap-6 transition-opacity", q.isFetching && q.isPlaceholderData && "opacity-60")}>
          <Body d={d} />
        </div>
      ) : null}

      {d && settingsOpen && <CostSettingsDialog open onOpenChange={setSettingsOpen} burden={d.burden_pct} />}
    </div>
  );
};

const Body = ({ d }: { d: ProfitDashboard }) => {
  const t = useMemo(() => totalsOf(d), [d]);
  const noRate = d.properties.filter((p) => p.current_rate == null);
  const unpricedRev = d.properties.filter((p) => p.unpriced_revenue_hours > 0);
  const nothing = t.hours === 0 && t.pendingHours === 0 && t.cost === 0;
  const showLive = d.end >= d.today && d.live.on_duty > 0;

  return (
    <>
      <Hero d={d} t={t} />

      {showLive && <LiveStrip live={d.live} />}

      {(noRate.length > 0 || d.missing_pay.length > 0 || t.unassignedCost > 0) && (
        <div className="grid gap-3">
          {noRate.length > 0 && (
            <SetupNotice icon={<Building2 className="h-5 w-5" />}>
              <span className="font-medium text-ink">
                {noRate.length === 1 ? "1 property has" : `${noRate.length} properties have`} no client rate
              </span>
              {unpricedRev.length > 0 && <> — {hrs(t.unpricedRevenueHours)} worked this period aren't counted as revenue</>}. Set a rate:{" "}
              {noRate.map((p, i) => (
                <span key={p.id}>
                  {i > 0 && ", "}
                  <Link to={`/properties/${p.id}#client-rate`} className="font-medium text-link hover:underline">
                    {p.name}
                  </Link>
                </span>
              ))}
            </SetupNotice>
          )}
          {d.missing_pay.length > 0 && (
            <SetupNotice icon={<UserX className="h-5 w-5" />}>
              <span className="font-medium text-ink">No pay rate on file</span> for {d.missing_pay.map((m) => `${m.name} (${hrs(m.hours)})`).join(", ")}{" "}
              — their hours count as $0 wages. Add a rate in{" "}
              <Link to="/team" className="font-medium text-link hover:underline">
                Team
              </Link>
              .
            </SetupNotice>
          )}
          {t.unassignedCost > 0 && (
            <SetupNotice icon={<Info className="h-5 w-5" />} quiet>
              {hrs(d.unassigned.hours)} of timecards ({whole(d.unassigned.cost)} in wages) aren't linked to a property, so they count toward the
              company total only.
            </SetupNotice>
          )}
        </div>
      )}

      {nothing ? (
        <Card className="p-4">
          <Empty
            title="Nothing to add up for this period"
            description="Once guards clock in and timecards are approved, revenue, wages and margin show up here automatically."
          />
        </Card>
      ) : (
        <>
          <TrendChart d={d} />
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
            <PropertyTable d={d} />
            <Breakdown d={d} t={t} />
          </div>
        </>
      )}
    </>
  );
};

// ─── Hero ───────────────────────────────────────────────────────────────────

const Hero = ({ d, t }: { d: ProfitDashboard; t: ReturnType<typeof totalsOf> }) => {
  const tone = marginTone(t.margin);
  const loss = t.profit < 0;
  const range =
    d.start === d.end ? format(parseISO(d.start), "EEE, MMM d") : `${format(parseISO(d.start), "MMM d")} – ${format(parseISO(d.end), "MMM d, yyyy")}`;
  const pendingProfit = t.pendingRevenue - t.pendingCost;
  const marginPct = t.margin == null ? 0 : Math.max(0, Math.min(1, t.margin));

  return (
    <Card className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full blur-3xl"
        style={{ background: tint(loss ? THEME.danger : THEME.success, 14) }}
      />
      <div className="relative grid gap-6 p-6 sm:p-7 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-center">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className={cn("h-2.5 w-2.5 rounded-full", loss ? "bg-status-incident" : "bg-status-clear")} aria-hidden />
            <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-ink-2 sm:text-xs">Profit · {range}</span>
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-2">
            <span
              className={cn(
                "font-display text-[52px] font-extrabold leading-none tabular-nums sm:text-[64px]",
                loss ? "text-status-incident-ink" : "text-ink",
              )}
            >
              {signed(t.profit)}
            </span>
            <span className={cn("mb-1.5 inline-flex items-center gap-1 text-lg font-semibold tabular-nums", tone.text)}>
              {loss ? <TrendingDown className="h-5 w-5" /> : <TrendingUp className="h-5 w-5" />}
              {pct(t.margin)} margin
            </span>
          </div>
          <p className="mt-3 text-sm text-ink-2">
            From {hrs(t.hours)} of approved timecards
            {t.revenue === 0 && t.hours > 0 ? " — set client rates to see revenue." : "."}
          </p>
          {t.pendingHours > 0 && (
            <p className="mt-2 inline-flex flex-wrap items-center gap-1.5 rounded-lg border border-line bg-raised px-3 py-1.5 text-sm text-ink-2">
              <Hourglass className="h-4 w-4 text-status-follow" />
              <span>
                <span className="font-medium text-ink">{hrs(t.pendingHours)}</span> waiting for approval or still on the clock ≈{" "}
                <span className="font-medium text-ink">{signed(pendingProfit)}</span> more ({whole(t.pendingRevenue)} revenue, {whole(t.pendingCost)}{" "}
                cost)
              </span>
              <Link to="/payroll" className="font-medium text-link hover:underline">
                Approve
              </Link>
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <HeroTile label="Revenue" value={whole(t.revenue)} dot="bg-link" />
          <HeroTile label="Total cost" value={whole(t.cost)} dot="bg-ink-3" />
          <HeroTile label="Labor" value={whole(t.labor)} sub={t.revenue > 0 ? `${pct(t.labor / t.revenue)} of revenue` : undefined} dot="bg-info" />
          <div className="rounded-lg border border-line bg-raised px-4 py-3">
            <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-3">Margin</div>
            <div className={cn("mt-1 font-display text-2xl font-extrabold tabular-nums", tone.text)}>{pct(t.margin)}</div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line" aria-hidden>
              <div className={cn("h-full rounded-full transition-[width] duration-700", tone.bar)} style={{ width: `${marginPct * 100}%` }} />
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
};

const HeroTile = ({ label, value, sub, dot }: { label: string; value: string; sub?: string; dot: string }) => (
  <div className="rounded-lg border border-line bg-raised px-4 py-3">
    <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-ink-3">
      <span className={cn("h-1.5 w-1.5 rounded-full", dot)} aria-hidden />
      {label}
    </div>
    <div className="mt-1 font-display text-2xl font-extrabold tabular-nums text-ink">{value}</div>
    {sub && <div className="mt-0.5 text-xs text-ink-3">{sub}</div>}
  </div>
);

// ─── Live strip ─────────────────────────────────────────────────────────────

const LiveStrip = ({ live }: { live: ProfitDashboard["live"] }) => {
  const net = live.revenue_per_hour - live.cost_per_hour;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-status-clear/30 bg-status-clear/[0.06] px-5 py-4 sm:flex-row sm:items-center sm:gap-5">
      <div className="flex items-center gap-3">
        <span className="relative flex h-3 w-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-status-clear opacity-60" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-status-clear" />
        </span>
        <span className="text-sm font-medium text-ink">
          {live.on_duty} {live.on_duty === 1 ? "guard" : "guards"} on the clock at {live.sites} {live.sites === 1 ? "site" : "sites"}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-ink-2 sm:ml-auto">
        <span>
          Earning <span className="font-mono font-medium text-ink">{money(live.revenue_per_hour)}/h</span>
        </span>
        <span>
          Costing <span className="font-mono font-medium text-ink">{money(live.cost_per_hour)}/h</span>
        </span>
        <span className={cn("font-medium", net >= 0 ? "text-status-clear" : "text-status-incident-ink")}>
          {net >= 0 ? "+" : "−"}
          {money(Math.abs(net))}/h right now
        </span>
        <Link to="/dispatch" className="inline-flex items-center gap-1 font-medium text-link hover:underline">
          <RadioTower className="h-4 w-4" />
          Dispatch
        </Link>
      </div>
    </div>
  );
};

// ─── Chart ──────────────────────────────────────────────────────────────────

interface ChartRow {
  label: string;
  revenue: number;
  cost: number;
  profit: number;
}

const TrendChart = ({ d }: { d: ProfitDashboard }) => {
  const weekly = d.daily.length > 45;
  const rows = useMemo<ChartRow[]>(() => {
    const map = new Map<string, ChartRow>();
    for (const r of d.daily) {
      const day = parseISO(r.day);
      const key = weekly ? format(startOfISOWeek(day), "yyyy-MM-dd") : r.day;
      const label = weekly ? format(startOfISOWeek(day), "MMM d") : format(day, d.daily.length > 10 ? "MMM d" : "EEE d");
      const row = map.get(key) ?? { label, revenue: 0, cost: 0, profit: 0 };
      row.revenue += Number(r.revenue);
      row.cost += Number(r.cost);
      row.profit = row.revenue - row.cost;
      map.set(key, row);
    }
    return [...map.values()];
  }, [d.daily, weekly]);

  if (rows.length < 2) return null;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-2 px-5 pt-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <h2 className="font-display text-lg font-bold text-ink sm:text-xl">{weekly ? "Week by week" : "Day by day"}</h2>
        <div className="flex flex-wrap items-center gap-4 text-xs text-ink-2">
          <LegendDot color={THEME.link} label="Revenue" />
          <LegendDot color={THEME.ink3} label="Cost" />
          <LegendDot color={THEME.success} label="Profit" line />
        </div>
      </div>
      <div className="h-64 px-2 pb-3 pt-4 sm:h-72 sm:px-4">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} barGap={2}>
            <CartesianGrid vertical={false} stroke={THEME.line} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: THEME.ink3, fontSize: 11 }} minTickGap={12} />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={56}
              tick={{ fill: THEME.ink3, fontSize: 11 }}
              tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v}`)}
            />
            <Tooltip cursor={{ fill: tint(THEME.ink3, 10) }} content={<ChartTip />} />
            <Bar dataKey="revenue" fill={THEME.link} radius={[4, 4, 0, 0]} maxBarSize={22} />
            <Bar dataKey="cost" fill={THEME.ink3} fillOpacity={0.55} radius={[4, 4, 0, 0]} maxBarSize={22} />
            <Line dataKey="profit" type="monotone" stroke={THEME.success} strokeWidth={2.25} dot={false} activeDot={{ r: 4 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="border-t border-line px-5 py-3 text-xs text-ink-3 sm:px-6">Approved hours only. Expenses land on the day they were spent.</p>
    </Card>
  );
};

const LegendDot = ({ color, label, line }: { color: string; label: string; line?: boolean }) => (
  <span className="inline-flex items-center gap-1.5">
    <span className={cn(line ? "h-0.5 w-3.5 rounded-full" : "h-2.5 w-2.5 rounded-sm")} style={{ background: color }} aria-hidden />
    {label}
  </span>
);

const ChartTip = ({ active, payload, label }: { active?: boolean; payload?: { payload: ChartRow }[]; label?: string }) => {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-pop">
      <div className="mb-1 font-medium text-ink">{label}</div>
      <div className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 tabular-nums">
        <span className="text-ink-2">Revenue</span>
        <span className="text-right text-ink">{money(r.revenue)}</span>
        <span className="text-ink-2">Cost</span>
        <span className="text-right text-ink">{money(r.cost)}</span>
        <span className="text-ink-2">Profit</span>
        <span className={cn("text-right font-medium", r.profit < 0 ? "text-status-incident-ink" : "text-status-clear")}>{signed(r.profit)}</span>
      </div>
    </div>
  );
};

// ─── Property table ─────────────────────────────────────────────────────────

const PropertyTable = ({ d }: { d: ProfitDashboard }) => {
  const rows = d.properties.filter((p) => p.hours > 0 || p.pending_hours > 0 || p.expenses > 0 || p.revenue > 0);
  const idle = d.properties.length - rows.length;
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 pt-5 sm:px-6">
        <h2 className="font-display text-lg font-bold text-ink sm:text-xl">By property</h2>
        {idle > 0 && <span className="text-xs text-ink-3">{idle} with no activity hidden</span>}
      </div>
      {rows.length === 0 ? (
        <div className="p-4">
          <Empty title="No property activity yet" description="Hours and expenses tagged to a property show up here." />
        </div>
      ) : (
        <>
          <div className="mt-3 hidden grid-cols-[minmax(0,1.8fr)_repeat(4,minmax(0,1fr))_minmax(0,1.1fr)] gap-3 border-y border-line bg-raised/60 px-6 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3 md:grid">
            <span>Property</span>
            <span className="text-right">Revenue</span>
            <span className="text-right">Labor</span>
            <span className="text-right">Expenses</span>
            <span className="text-right">Profit</span>
            <span className="text-right">Margin</span>
          </div>
          <ul className="mt-3 divide-y divide-line border-t border-line md:mt-0 md:border-t-0">
            {rows.map((p) => (
              <PropertyRow key={p.id} p={p} />
            ))}
          </ul>
        </>
      )}
    </Card>
  );
};

const PropertyRow = ({ p }: { p: ProfitProperty }) => {
  const profit = profitOf(p);
  const m = marginOf(p.revenue, profit);
  const tone = marginTone(m);
  const noRate = p.unpriced_revenue_hours > 0;
  return (
    <li>
      <Link
        to={`/properties/${p.id}`}
        className="group grid grid-cols-2 gap-x-3 gap-y-2 px-5 py-4 transition-colors hover:bg-raised/50 sm:px-6 md:grid-cols-[minmax(0,1.8fr)_repeat(4,minmax(0,1fr))_minmax(0,1.1fr)] md:items-center"
      >
        <div className="col-span-2 min-w-0 md:col-span-1">
          <div className="flex items-center gap-1.5">
            <span className="line-clamp-2 break-words font-medium leading-snug text-ink">{p.name}</span>
            <ChevronRight className="h-4 w-4 shrink-0 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100" />
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-3">
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {hrs(p.hours)}
            </span>
            {p.current_rate != null ? <span className="font-mono">{money(p.current_rate)}/h</span> : <span className="text-status-follow">No client rate</span>}
            {p.overtime_hours > 0 && <span>{hrs(p.overtime_hours)} overtime</span>}
            {p.pending_hours > 0 && <span className="text-status-follow">+{hrs(p.pending_hours)} pending</span>}
          </div>
        </div>
        <Cell label="Revenue">{noRate && p.revenue === 0 ? <span className="text-ink-3">—</span> : whole(p.revenue)}</Cell>
        <Cell label="Labor">{whole(laborCost(p))}</Cell>
        <Cell label="Expenses">{p.expenses ? whole(p.expenses) : <span className="text-ink-3">—</span>}</Cell>
        <Cell label="Profit">
          <span className={cn("font-semibold", profit < 0 ? "text-status-incident-ink" : "text-ink")}>{signed(profit)}</span>
        </Cell>
        <div className="col-span-2 flex items-center gap-3 md:col-span-1 md:justify-end">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line md:hidden" aria-hidden>
            <div className={cn("h-full rounded-full", tone.bar)} style={{ width: `${Math.max(0, Math.min(1, m ?? 0)) * 100}%` }} />
          </div>
          <span className={cn("w-14 text-right text-sm font-semibold tabular-nums", tone.text)}>{pct(m)}</span>
        </div>
      </Link>
    </li>
  );
};

const Cell = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="min-w-0 md:text-right">
    <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3 md:hidden">{label}</div>
    <div className="truncate text-[15px] tabular-nums text-ink">{children}</div>
  </div>
);

// ─── Cost breakdown ─────────────────────────────────────────────────────────

const Breakdown = ({ d, t }: { d: ProfitDashboard; t: ReturnType<typeof totalsOf> }) => {
  const lines: { label: string; value: number; hint?: string }[] = [
    { label: "Direct staff wages", value: t.wages, hint: "Includes weekly overtime premium" },
    ...(d.burden_pct > 0 ? [{ label: `Payroll tax & insurance (${d.burden_pct}%)`, value: t.burden }] : []),
    { label: "Temp agency charges", value: t.agency, hint: "Agency bill rate, or pay rate when none is set" },
    ...(t.unassignedCost > 0 ? [{ label: "Hours not linked to a property", value: t.unassignedCost }] : []),
    { label: "Property expenses", value: t.siteExpenses },
    ...d.overhead.map((o) => ({ label: o.category, value: o.amount, hint: "Company overhead" })),
  ].filter((l) => l.value > 0 || l.label === "Direct staff wages");
  const max = Math.max(1, ...lines.map((l) => l.value));

  return (
    <Card className="overflow-hidden">
      <div className="px-5 pt-5 sm:px-6">
        <h2 className="font-display text-lg font-bold text-ink sm:text-xl">Where the money goes</h2>
        <p className="mt-1 text-sm text-ink-2">
          {whole(t.cost)} total cost{t.revenue > 0 ? ` · ${pct(t.cost / t.revenue)} of revenue` : ""}
        </p>
      </div>
      <ul className="grid gap-3 px-5 py-5 sm:px-6">
        {lines.map((l) => (
          <li key={l.label}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-ink">{l.label}</span>
              <span className="shrink-0 font-medium tabular-nums text-ink">{money(l.value)}</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line" aria-hidden>
              <div className="h-full rounded-full bg-link/70" style={{ width: `${(l.value / max) * 100}%` }} />
            </div>
            {l.hint && <div className="mt-1 text-[11px] text-ink-3">{l.hint}</div>}
          </li>
        ))}
      </ul>
      {(d.excluded_labor_expenses > 0 || d.burden_pct === 0) && (
        <div className="grid gap-2 border-t border-line px-5 py-4 text-xs text-ink-3 sm:px-6">
          {d.excluded_labor_expenses > 0 && (
            <p className="flex gap-2">
              <Info className="mt-px h-3.5 w-3.5 shrink-0" />
              {money(d.excluded_labor_expenses)} in payroll and agency-staffing expenses isn't counted again — wages already come from timecards.
            </p>
          )}
          {d.burden_pct === 0 && (
            <p className="flex gap-2">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-status-follow" />
              Payroll tax & insurance isn't included yet. Add your percentage in Cost settings for a truer margin.
            </p>
          )}
        </div>
      )}
    </Card>
  );
};

// ─── Bits ───────────────────────────────────────────────────────────────────

const PeriodPicker = ({ value, onChange }: { value: ProfitPeriod; onChange: (p: ProfitPeriod) => void }) => (
  <div className="-mx-4 mb-6 overflow-x-auto px-4 sm:mx-0 sm:px-0">
    <div role="radiogroup" aria-label="Period" className="inline-flex gap-1 rounded-xl border border-line bg-surface p-1 shadow-card">
      {PERIODS.map((p) => (
        <button
          key={p.id}
          type="button"
          role="radio"
          aria-checked={value === p.id}
          onClick={() => onChange(p.id)}
          className={cn(
            "focus-ring whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-medium transition-colors",
            value === p.id ? "bg-primary text-white shadow-sm" : "text-ink-2 hover:bg-raised hover:text-ink",
          )}
        >
          {p.label}
        </button>
      ))}
    </div>
  </div>
);

const LiveStamp = ({ at, fetching, onRefresh }: { at?: string; fetching: boolean; onRefresh: () => void }) => (
  <button
    type="button"
    onClick={onRefresh}
    className="focus-ring inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-ink-3 transition-colors hover:text-ink"
    aria-label="Refresh now"
  >
    {fetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
    {at ? `Updated ${format(new Date(at), "h:mm a")}` : "Loading"}
    <span className="text-ink-3/70">· refreshes every minute</span>
  </button>
);

const SetupNotice = ({ icon, children, quiet }: { icon: ReactNode; children: ReactNode; quiet?: boolean }) => (
  <div
    className={cn(
      "flex items-start gap-3 rounded-xl border px-4 py-3 text-sm text-ink-2",
      quiet ? "border-line bg-surface" : "border-status-follow/40 bg-status-follow/[0.07]",
    )}
  >
    <span className={cn("mt-0.5 shrink-0", quiet ? "text-ink-3" : "text-status-follow")}>{icon}</span>
    <p className="min-w-0">{children}</p>
  </div>
);

const NoAccess = ({ admin }: { admin: boolean }) => (
  <div className="mx-auto max-w-lg py-20 text-center">
    <Lock className="mx-auto h-12 w-12 text-link" strokeWidth={1.5} />
    <h1 className="mt-5 font-display text-3xl font-extrabold text-ink">{admin ? "Pay permission needed" : "Administrators only"}</h1>
    <p className="mt-2 text-ink-2">
      {admin
        ? "Profit uses wages, so it's limited to admins with the Employee pay permission. An admin who manages permissions can grant it in Workforce settings."
        : "Profit and margin are only visible to administrators."}
    </p>
    <Button asChild className="mt-7">
      <Link to="/">Return to Dashboard</Link>
    </Button>
  </div>
);

const CostSettingsDialog = ({ open, onOpenChange, burden }: { open: boolean; onOpenChange: (v: boolean) => void; burden: number }) => {
  const qc = useQueryClient();
  const [value, setValue] = useState<string>(String(burden));
  const [error, setError] = useState<string>("");

  const save = useMutation({
    mutationFn: (n: number) => saveBurden(n),
    onSuccess: () => {
      toast.success("Cost settings saved");
      void qc.invalidateQueries({ queryKey: ["profit", "dashboard"] });
      onOpenChange(false);
    },
    onError: (e) => toast.error("Couldn't save", { description: friendlyError(e) }),
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Cost settings"
      description="Applied to every property and period on this page."
      dirty={value !== String(burden)}
      saving={save.isPending}
      onSubmit={() => {
        const n = toNum(value);
        if (n == null || n < 0 || n > 100) {
          setError("Enter a percentage from 0 to 100.");
          return;
        }
        save.mutate(n);
      }}
    >
      <TextField
        label="Payroll tax & insurance (% of direct staff wages)"
        value={value}
        onChange={setValue}
        inputMode="decimal"
        placeholder="15"
        error={error}
        hint="Employer payroll taxes, workers' comp and other insurance on your own employees. Often 10–20%. Not applied to temp agency workers — their agency rate already covers it."
      />
    </FormDialog>
  );
};

export default Profit;
