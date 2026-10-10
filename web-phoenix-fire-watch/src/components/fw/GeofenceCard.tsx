import { MapPinned, Pencil, Plus } from "lucide-react";
import { memo, useState } from "react";

import { Button } from "@/components/ui/button";
import { formatDistance, isGeofenceActive } from "@/lib/geo";
import type { Property } from "@/lib/types";
import { cn } from "@/lib/utils";

import { GeofenceDialog } from "./GeofenceDialog";
import { GeofenceMap } from "./GeofenceMap";

/** Property geofence summary; admins can set it up or adjust it. */
export const GeofenceCard = memo(({ property, isAdmin }: { property: Property; isAdmin: boolean }) => {
  const [editing, setEditing] = useState<boolean>(false);
  const g = property.geofence;
  const active = isGeofenceActive(g);
  if (!active && !isAdmin) return null;

  return (
    <section className="mt-5 overflow-hidden rounded-xl border border-line bg-surface shadow-card">
      <div className={cn("grid", active && "md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]")}>
        <div className="flex flex-col justify-between gap-5 p-6 sm:p-7">
          <div className="flex items-start gap-4">
            <MapPinned className={cn("mt-0.5 h-8 w-8 shrink-0", active ? "text-link" : "text-ink-3")} strokeWidth={1.6} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-xl font-bold text-ink sm:text-[22px]">Geofence</h2>
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] ring-1 ring-inset",
                    active
                      ? "bg-status-clear/10 text-status-clear ring-status-clear/30"
                      : "bg-raised text-ink-3 ring-line",
                  )}
                >
                  <span className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-status-clear" : "bg-ink-3")} />
                  {active ? "On" : "Off"}
                </span>
              </div>
              <p className="mt-1 text-sm text-ink-2">
                {active
                  ? "Patrols can only be logged by officers inside this area."
                  : "Require officers to be on site before they can log a patrol."}
              </p>
            </div>
          </div>
          {active && (
            <div className="flex items-end justify-between gap-4">
              <div>
                <div className="text-xs font-medium uppercase tracking-[0.14em] text-ink-3">Radius</div>
                <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-ink">
                  {formatDistance(g.radiusM ?? 0)}
                </div>
                <div className="font-mono text-xs text-ink-3">{formatDistance(g.radiusM ?? 0, true).split(" · ")[1]}</div>
              </div>
            </div>
          )}
          {isAdmin && (
            <Button variant={active ? "outline" : "default"} className="w-full sm:w-auto sm:self-start" onClick={() => setEditing(true)}>
              {active ? <Pencil /> : <Plus />}
              {active ? "Adjust geofence" : "Set up geofence"}
            </Button>
          )}
        </div>
        {active && g.lat != null && g.lng != null && (
          <GeofenceMap
            center={{ lat: g.lat, lng: g.lng }}
            radiusM={g.radiusM ?? 0}
            interactive={false}
            fitKey={`${g.lat},${g.lng},${g.radiusM}`}
            className="h-56 rounded-none border-0 border-t border-line md:h-full md:min-h-[240px] md:border-l md:border-t-0"
          />
        )}
      </div>
      {isAdmin && <GeofenceDialog property={property} open={editing} onOpenChange={setEditing} />}
    </section>
  );
});
GeofenceCard.displayName = "GeofenceCard";
