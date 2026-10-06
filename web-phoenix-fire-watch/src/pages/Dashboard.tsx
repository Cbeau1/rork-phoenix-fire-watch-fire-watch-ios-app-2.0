import { ArrowRight, Building2, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { PatrolRow } from "@/components/fw/PatrolRow";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/fw/primitives";
import { QuickNoteDialog } from "@/components/fw/QuickNoteDialog";
import { SiteCard } from "@/components/fw/SiteCard";
import { TimeClockCard } from "@/components/fw/TimeClockCard";
import { Button } from "@/components/ui/button";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { timeAgo } from "@/lib/format";
import type { Patrol } from "@/lib/types";
import { useFireWatch } from "@/state/FireWatchProvider";

const Dashboard = () => {
  useDocumentTitle("Dashboard");
  const { properties, patrols, notes, propertyById } = useFireWatch();

  const lastPatrolBySite = useMemo<Map<string, Patrol>>(() => {
    const m = new Map<string, Patrol>();
    for (const p of patrols) {
      const prev = m.get(p.propertyId);
      if (!prev || Date.parse(p.dateTime) > Date.parse(prev.dateTime)) m.set(p.propertyId, p);
    }
    return m;
  }, [patrols]);
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

      <div className="mb-6">
        <TimeClockCard />
      </div>

      <section aria-labelledby="sites-heading">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 id="sites-heading" className="font-display text-xl font-bold text-ink sm:text-[22px]">
              Sites
            </h2>
            <p className="mt-0.5 text-sm text-ink-2">
              {properties.length} {properties.length === 1 ? "site" : "sites"} available · tap to open
            </p>
          </div>
        </div>
        {properties.length === 0 ? (
          <Card>
            <EmptyState
              icon={Building2}
              title="No sites yet"
              description="Add your first monitored location to start logging fire watch patrols."
              action={
                <Button asChild>
                  <Link to="/properties/new">
                    <Plus />
                    Add Property
                  </Link>
                </Button>
              }
            />
          </Card>
        ) : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:gap-5 xl:grid-cols-3">
            {properties.map((p, i) => (
              <SiteCard key={p.id} property={p} lastPatrol={lastPatrolBySite.get(p.id)} delay={Math.min(i, 8) * 50} />
            ))}
          </ul>
        )}
      </section>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
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
            <ul className="mt-4 space-y-2.5 border-t border-line p-3 sm:p-4">
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
              <ul className="mt-4 space-y-2.5 border-t border-line p-3 sm:p-4">
                {recentNotes.map((n) => (
                  <li key={n.id} className="rounded-lg border border-line bg-raised px-4 py-3.5">
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
