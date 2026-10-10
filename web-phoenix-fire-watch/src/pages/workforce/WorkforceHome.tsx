import {
  AlarmClock,
  Briefcase,
  CalendarClock,
  ClipboardList,
  FileWarning,
  Lock,
  Package,
  Receipt,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { PageHeader } from "@/components/fw/primitives";
import { Button } from "@/components/ui/button";
import { Empty, fmtDate, Pill, SectionCard } from "@/components/workforce/kit";
import { WorkerFormDialog } from "@/components/workforce/WorkerFormDialog";
import { REMINDER_KIND } from "@/lib/workforce/constants";
import { awaitingReturn, inDays, missingItems, todayKey } from "@/lib/workforce/derive";
import { cn } from "@/lib/utils";
import { useWorkforce } from "@/state/WorkforceProvider";

const MetricCard = ({
  label,
  value,
  icon: Icon,
  to,
  tone = "text-link",
  locked,
  delay,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  to: string;
  tone?: string;
  locked?: boolean;
  delay: number;
}) =>
  locked ? (
    <div className="flex flex-col justify-between rounded-xl border border-line bg-surface shadow-card p-5" style={{ animationDelay: `${delay}ms` }}>
      <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-2">{label}</div>
      <div className="mt-3 flex items-center gap-2 text-sm text-ink-3">
        <Lock className="h-4 w-4" />
        Needs extra permission
      </div>
    </div>
  ) : (
    <Link
      to={to}
      className="focus-ring group animate-fade-up rounded-xl border border-line bg-surface shadow-card p-5 transition-colors hover:border-line-strong hover:bg-surface-hover"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-2">{label}</span>
        <Icon className={cn("h-6 w-6 shrink-0 transition-transform group-hover:-translate-y-0.5", tone)} strokeWidth={1.7} />
      </div>
      <div className="mt-3 rounded-lg border border-line bg-raised px-3 py-2">
        <span className="font-display text-4xl font-extrabold tabular-nums text-ink">{value}</span>
      </div>
    </Link>
  );

const WorkforceHome = () => {
  const wf = useWorkforce();
  const [addOpen, setAddOpen] = useState<boolean>(false);

  const stats = useMemo(() => {
    const live = wf.workers.filter((w) => !w.archived_at);
    const today = todayKey();
    const soon = inDays(wf.settings?.placement_end_days ?? 14);
    return {
      direct: live.filter((w) => w.source === "direct" && w.status === "active").length,
      agency: live.filter((w) => w.source === "agency" && w.status === "active").length,
      intake: live.filter((w) => w.status === "onboarding" || w.status === "pending_placement").length,
      paperwork: live.filter((w) => missingItems(w.id, wf.checklist, wf.placements).length > 0).length,
      followups: wf.followups.filter((f) => f.followup_due && f.followup_due <= inDays(wf.settings?.followup_due_days ?? 7)).length,
      equipment: awaitingReturn(wf.equipment, wf.workers, wf.placements).length,
      ending: wf.placements.filter((p) => (p.status === "active" || p.status === "pending") && p.end_date && p.end_date <= soon && p.end_date >= today).length,
      invoices: wf.invoices.filter((i) => !i.archived_at && ["received", "under_review", "approved", "disputed"].includes(i.status)).length,
    };
  }, [wf.workers, wf.checklist, wf.placements, wf.followups, wf.equipment, wf.invoices, wf.settings]);

  const open = wf.reminders.filter((r) => r.status === "open").slice(0, 8);

  return (
    <div>
      <PageHeader
        title="Workforce Management"
        subtitle="Direct employees, temporary agency workers, paperwork and agency costs — visible to authorized admins only."
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <UserPlus />
            Add worker
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard delay={0} label="Active direct employees" value={stats.direct} icon={Users} to="/workforce/directory?source=direct&status=active" />
        <MetricCard delay={30} label="Active agency workers" value={stats.agency} icon={Briefcase} to="/workforce/directory?source=agency&status=active" />
        <MetricCard delay={60} label="Onboarding / pending placement" value={stats.intake} icon={ClipboardList} to="/workforce/directory?status=intake" tone="text-info-ink" />
        <MetricCard delay={90} label="Missing required paperwork" value={stats.paperwork} icon={FileWarning} to="/workforce/directory?flag=paperwork" tone="text-status-follow" />
        <MetricCard
          delay={120}
          label="Personnel follow-ups due"
          value={stats.followups}
          icon={AlarmClock}
          to="/workforce/reminders?kind=followup"
          tone="text-status-follow"
          locked={!wf.perms.personnel}
        />
        <MetricCard delay={150} label="Equipment awaiting return" value={stats.equipment} icon={Package} to="/workforce/directory?flag=equipment" tone="text-status-follow" />
        <MetricCard delay={180} label="Assignments ending soon" value={stats.ending} icon={CalendarClock} to="/workforce/placements?view=ending" tone="text-info-ink" />
        <MetricCard
          delay={210}
          label="Invoices awaiting review / payment"
          value={stats.invoices}
          icon={Receipt}
          to="/workforce/invoices?status=open"
          locked={!wf.perms.finance}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <SectionCard
          title="Open reminders"
          subtitle="In-app only — nothing is emailed or texted."
          action={
            <Button asChild variant="ghost" size="sm" className="text-link hover:text-link-hover">
              <Link to="/workforce/reminders">View all</Link>
            </Button>
          }
        >
          {wf.remindersLoading ? (
            <p className="px-2 py-6 text-sm text-ink-3">Checking reminders…</p>
          ) : open.length === 0 ? (
            <Empty title="All caught up" description="No open paperwork, expiration, equipment, placement or invoice reminders." />
          ) : (
            <ul className="space-y-2">
              {open.map((r) => (
                <li key={r.id}>
                  <Link
                    to={r.worker_id ? `/workforce/workers/${r.worker_id}` : r.entity_type === "invoice" ? `/workforce/invoices/${r.entity_id}` : "/workforce/reminders"}
                    className="focus-ring flex items-center justify-between gap-3 rounded-lg border border-line bg-raised px-4 py-3 hover:border-line-strong"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-ink">{r.title}</div>
                      <div className="text-xs text-ink-3">{REMINDER_KIND[r.kind] ?? r.kind}</div>
                    </div>
                    {r.due_date && (
                      <Pill tone={r.due_date < todayKey() ? "red" : "amber"}>{fmtDate(r.due_date, "MMM d")}</Pill>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Quick links">
          <div className="grid grid-cols-1 gap-2">
            {[
              { to: "/workforce/directory", label: "Workforce directory", sub: `${wf.workers.filter((w) => !w.archived_at).length} profiles` },
              { to: "/workforce/agencies", label: "Staffing agencies", sub: `${wf.agencies.filter((a) => !a.archived_at).length} agencies` },
              { to: "/workforce/placements", label: "Agency placements", sub: `${wf.placements.filter((p) => p.status === "active").length} active` },
              { to: "/workforce/reports", label: "Exports & reports", sub: "CSV and PDF, permission-aware" },
              { to: "/workforce/settings", label: "Settings & audit log", sub: "Checklists, reminders, permissions" },
            ].map((l) => (
              <Link key={l.to} to={l.to} className="focus-ring rounded-lg border border-line bg-raised px-4 py-3 hover:border-line-strong">
                <div className="text-sm font-medium text-ink">{l.label}</div>
                <div className="text-xs text-ink-3">{l.sub}</div>
              </Link>
            ))}
          </div>
        </SectionCard>
      </div>

      <WorkerFormDialog open={addOpen} onOpenChange={setAddOpen} worker={null} />
    </div>
  );
};

export default WorkforceHome;
