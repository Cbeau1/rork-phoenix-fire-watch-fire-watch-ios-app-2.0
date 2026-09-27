import { useMemo, useState } from "react";

import { PatrolRow } from "@/components/fw/PatrolRow";
import { Card, EmptyState, PageHeader } from "@/components/fw/primitives";
import { STATUS_META, type PatrolStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useFireWatch } from "@/state/FireWatchProvider";

type Filter = "all" | PatrolStatus;
const FILTERS: Filter[] = ["all", "clear", "follow-up", "incident"];

const AllPatrols = () => {
  useDocumentTitle("All Patrols");
  const { patrols, propertyById } = useFireWatch();
  const [filter, setFilter] = useState<Filter>("all");

  const counts = useMemo<Record<Filter, number>>(() => {
    const c: Record<Filter, number> = { all: patrols.length, clear: 0, "follow-up": 0, incident: 0 };
    for (const p of patrols) c[p.status] += 1;
    return c;
  }, [patrols]);

  const list = useMemo(() => (filter === "all" ? patrols : patrols.filter((p) => p.status === filter)), [patrols, filter]);

  return (
    <>
      <PageHeader
        backTo="/"
        backLabel="Back to Dashboard"
        title="All Patrols"
        subtitle="Every patrol log across all properties"
      />

      <div className="mb-5 flex flex-wrap gap-2" role="tablist" aria-label="Filter by status">
        {FILTERS.map((f) => {
          const active = filter === f;
          const color = f === "all" ? "#DC2626" : STATUS_META[f].color;
          return (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setFilter(f)}
              className={cn(
                "focus-ring inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition-colors",
                active ? "border-ember/60 bg-ember/10 text-ink" : "border-line text-ink-2 hover:text-ink",
              )}
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
              {f === "all" ? "All" : STATUS_META[f].label}
              <span className="tabular-nums text-ink-3">{counts[f]}</span>
            </button>
          );
        })}
      </div>

      <Card>
        {list.length === 0 ? (
          <EmptyState
            title={patrols.length === 0 ? "No patrols logged yet" : "Nothing here"}
            description={
              patrols.length === 0
                ? "Open a property and tap Log Patrol to record the first one."
                : "No patrols match this status."
            }
          />
        ) : (
          <ul className="divide-y divide-line">
            {list.map((p) => (
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
    </>
  );
};

export default AllPatrols;
