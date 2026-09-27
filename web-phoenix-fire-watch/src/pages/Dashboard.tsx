import { AlertTriangle, ArrowRight, Building2, CalendarDays, PersonStanding, Plus, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { PatrolRow } from "@/components/fw/PatrolRow";
import { Card, CardHeader, EmptyState, PageHeader, StatCard } from "@/components/fw/primitives";
import { QuickNoteDialog } from "@/components/fw/QuickNoteDialog";
import { Button } from "@/components/ui/button";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { timeAgo } from "@/lib/format";
import { usePatrolStats, useFireWatch } from "@/state/FireWatchProvider";

const Dashboard = () => {
  useDocumentTitle("Dashboard");
  const { patrols, notes, propertyById } = useFireWatch();
  const stats = usePatrolStats(patrols);
  const [noteOpen, setNoteOpen] = useState<boolean>(false);
  const recent = patrols.slice(0, 6);
  const recentNotes = notes.slice(0, 5);

  return (
    <>
      <PageHeader
        title="Fire Watch Dashboard"
        subtitle="Real-time patrol monitoring and activity overview"
        actions={
          <>
            <Button asChild>
              <Link to="/properties/new">
                <Plus />
                Add Property
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/properties">
                <Building2 />
                All Properties
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:gap-5 xl:grid-cols-4">
        <StatCard label="Total Patrols" value={stats.total} icon={PersonStanding} dot="#DC2626" delay={0} />
        <StatCard label="This Month" value={stats.thisMonth} icon={CalendarDays} dot="#DC2626" delay={60} />
        <StatCard
          label="Clear Status"
          value={stats.clear}
          icon={ShieldCheck}
          dot="#22C55E"
          delay={120}
        />
        <StatCard label="Incidents" value={stats.incidents} icon={AlertTriangle} dot="#DC2626" delay={180} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card className="flex min-h-[420px] flex-col">
          <CardHeader
            title="Recent Patrols"
            subtitle="Latest patrol activity across all properties"
            action={
              <Link
                to="/patrols"
                className="focus-ring inline-flex shrink-0 items-center gap-1.5 rounded pt-1 text-sm font-medium text-ember hover:text-ember-hover"
              >
                View All
                <ArrowRight className="h-4 w-4" />
              </Link>
            }
          />
          {recent.length === 0 ? (
            <EmptyState
              className="flex-1"
              title="No recent patrols"
              description="Patrol logs will appear here once created"
            />
          ) : (
            <ul className="mt-4 divide-y divide-line border-t border-line">
              {recent.map((p) => (
                <PatrolRow
                  key={p.id}
                  patrol={p}
                  showDate
                  propertyName={propertyById.get(p.propertyId)?.name ?? "Removed property"}
                  propertyId={propertyById.has(p.propertyId) ? p.propertyId : undefined}
                />
              ))}
            </ul>
          )}
        </Card>

        <Card className="flex min-h-[420px] flex-col">
          <CardHeader
            title="Watch Notes"
            subtitle="Active shift notes"
            action={
              <button
                type="button"
                onClick={() => setNoteOpen(true)}
                aria-label="Add watch note"
                className="focus-ring -mr-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-ember transition-colors hover:bg-ember/10"
              >
                <Plus className="h-6 w-6" />
              </button>
            }
          />
          {recentNotes.length === 0 ? (
            <EmptyState className="flex-1" title="No watch notes" />
          ) : (
            <>
              <ul className="mt-4 divide-y divide-line border-t border-line">
                {recentNotes.map((n) => (
                  <li key={n.id} className="px-6 py-4 sm:px-7">
                    <p className="line-clamp-3 whitespace-pre-wrap text-sm leading-relaxed text-ink">{n.content}</p>
                    <p className="mt-2 text-xs text-ink-3">
                      {n.author} · {timeAgo(n.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
              <Link
                to="/notes"
                className="focus-ring mt-auto flex items-center justify-center gap-1.5 border-t border-line py-3.5 text-sm font-medium text-ember hover:text-ember-hover"
              >
                All watch notes
                <ArrowRight className="h-4 w-4" />
              </Link>
            </>
          )}
        </Card>
      </div>

      <QuickNoteDialog open={noteOpen} onOpenChange={setNoteOpen} />
    </>
  );
};

export default Dashboard;
