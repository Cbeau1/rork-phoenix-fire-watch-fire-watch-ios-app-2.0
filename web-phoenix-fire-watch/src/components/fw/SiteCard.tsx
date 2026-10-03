import { AlarmClock, Building2, ChevronRight, Clock, MapPin, Plus } from "lucide-react";
import { memo } from "react";
import { Link } from "react-router-dom";

import { useNow } from "@/hooks/use-now";
import { timeAgo } from "@/lib/format";
import { formatCountdown } from "@/lib/patrol-timer";
import { STATUS_META, type Patrol, type Property } from "@/lib/types";
import { cn } from "@/lib/utils";
import { usePatrolTimers } from "@/state/PatrolTimerProvider";

/** Dashboard tile for one site: opens the property, with a one-tap Log Patrol shortcut and live timer state. */
export const SiteCard = memo(
  ({ property, lastPatrol, delay = 0 }: { property: Property; lastPatrol?: Patrol; delay?: number }) => {
    const { isOn, scheduleFor } = usePatrolTimers();
    const on = isOn(property.id);
    const now = useNow(1000, on);
    const schedule = on ? scheduleFor(property.id, now) : null;
    const overdue = !!schedule && schedule.overdueSince !== null;
    const warning = !!schedule && !overdue && schedule.isWarning;

    return (
      <li
        className={cn(
          "group relative flex animate-fade-up flex-col overflow-hidden rounded-xl border bg-surface transition-colors",
          overdue
            ? "border-status-incident/50"
            : warning
              ? "border-status-follow/50"
              : on
                ? "border-ember/35"
                : "border-line hover:border-[#454954]",
        )}
        style={{ animationDelay: `${delay}ms` }}
      >
        <Link
          to={`/properties/${property.id}`}
          className="focus-ring flex flex-1 items-start gap-4 p-5 pb-4 sm:p-6 sm:pb-4"
          aria-label={`Open ${property.name}`}
        >
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-raised ring-1 ring-line transition-colors group-hover:ring-ember/30">
            <Building2 className="h-6 w-6 text-silver" strokeWidth={1.5} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="line-clamp-2 font-display text-lg font-bold leading-snug text-ink">{property.name}</h3>
            {property.address && (
              <p className="mt-1 flex items-start gap-1.5 text-sm text-ink-2">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-3" />
                <span className="line-clamp-1">{property.address}</span>
              </p>
            )}
            <p className="mt-2.5 flex items-center gap-2 text-xs text-ink-3">
              {lastPatrol ? (
                <>
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: STATUS_META[lastPatrol.status].color }}
                    aria-hidden
                  />
                  Last patrol {timeAgo(lastPatrol.dateTime)}
                </>
              ) : (
                <>
                  <Clock className="h-3.5 w-3.5" />
                  No patrols yet
                </>
              )}
            </p>
          </div>
          <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-ink-3 transition-transform group-hover:translate-x-0.5 group-hover:text-ember" />
        </Link>

        <div className="flex items-center gap-3 border-t border-line px-5 py-3 sm:px-6">
          {schedule ? (
            <span
              className={cn(
                "inline-flex min-w-0 items-center gap-1.5 text-sm font-medium tabular-nums",
                overdue ? "text-status-incident" : warning ? "text-status-follow" : "text-ink-2",
              )}
            >
              <AlarmClock className="h-4 w-4 shrink-0" />
              {overdue ? "Patrol overdue" : `Due in ${formatCountdown(schedule.remaining)}`}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-sm text-ink-3">
              <AlarmClock className="h-4 w-4" />
              Timer off
            </span>
          )}
          <Link
            to={`/properties/${property.id}/log`}
            className="focus-ring ml-auto inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg bg-ember px-4 text-sm font-semibold text-white transition-colors hover:bg-ember-hover active:scale-[0.97]"
          >
            <Plus className="h-4 w-4" />
            Log Patrol
          </Link>
        </div>
      </li>
    );
  },
);
SiteCard.displayName = "SiteCard";
