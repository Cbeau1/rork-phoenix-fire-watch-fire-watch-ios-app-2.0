import { Loader2, LocateFixed, LocateOff, MapPinCheck, MapPinX, RefreshCw } from "lucide-react";
import { memo } from "react";

import { Button } from "@/components/ui/button";
import type { GeoState } from "@/hooks/use-geolocation";
import { formatDistance, insideGeofence } from "@/lib/geo";
import type { Property } from "@/lib/types";
import { cn } from "@/lib/utils";

import { GeofenceMap } from "./GeofenceMap";

export type GeofenceVerdict = "checking" | "inside" | "outside" | "blocked";

/** Pass/fail for the Log Patrol form, using the same rule the server enforces. */
export const geofenceVerdict = (property: Property, geo: GeoState): GeofenceVerdict => {
  if (geo.status === "ready") return insideGeofence(property.geofence, geo.location).inside ? "inside" : "outside";
  if (geo.status === "denied" || geo.status === "unavailable") return "blocked";
  return "checking";
};

interface GeofenceStatusProps {
  property: Property;
  geo: GeoState;
  onRetry: () => void;
}

/** Live "are you on site?" panel shown at the top of Log Patrol when a geofence is on. */
export const GeofenceStatus = memo(({ property, geo, onRetry }: GeofenceStatusProps) => {
  const g = property.geofence;
  const radius = g.radiusM ?? 0;
  const verdict = geofenceVerdict(property, geo);
  const you = geo.status === "ready" ? geo.location : null;
  const distance = you ? insideGeofence(g, you).distance : null;

  const tone =
    verdict === "inside"
      ? "border-status-clear/40 bg-status-clear/[0.07]"
      : verdict === "checking"
        ? "border-status-follow/40 bg-status-follow/[0.07]"
        : "border-status-incident/45 bg-status-incident/[0.08]";

  let icon = <Loader2 className="h-5 w-5 animate-spin text-status-follow" />;
  let title = "Checking your location…";
  let detail = `You need to be within ${formatDistance(radius)} of ${property.name} to log a patrol.`;

  if (verdict === "inside") {
    icon = <MapPinCheck className="h-5 w-5 text-status-clear" />;
    title = "You're on site";
    detail = `${formatDistance(distance ?? 0)} from the center · GPS ±${formatDistance(you?.accuracyM ?? 0)}`;
  } else if (verdict === "outside") {
    icon = <MapPinX className="h-5 w-5 text-status-incident-ink" />;
    title = "Outside the geofence";
    detail = `You're about ${formatDistance(distance ?? 0)} away. Move within ${formatDistance(radius)} of ${property.name} to log this patrol.`;
    if ((you?.accuracyM ?? 0) > 100) detail += ` GPS accuracy is low (±${formatDistance(you?.accuracyM ?? 0)}) — try near a window or outside.`;
  } else if (geo.status === "denied") {
    icon = <LocateOff className="h-5 w-5 text-status-incident-ink" />;
    title = "Location access is blocked";
    detail = "This property requires you to be on site. Allow location for this site in your browser settings, then retry.";
  } else if (geo.status === "unavailable") {
    icon = <LocateOff className="h-5 w-5 text-status-incident-ink" />;
    title = "Can't get your location";
    detail = geo.message;
  }

  return (
    <div className={cn("overflow-hidden rounded-xl border transition-colors", tone)} role="status" aria-live="polite">
      <div className="flex items-start gap-3 px-4 py-3.5 sm:px-5">
        <span className="mt-0.5 shrink-0">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-ink">{title}</div>
          <p className="mt-0.5 text-sm text-ink-2">{detail}</p>
        </div>
        {(verdict === "blocked" || verdict === "outside") && (
          <Button type="button" size="sm" variant="outline" onClick={onRetry} className="shrink-0">
            {verdict === "outside" ? <LocateFixed /> : <RefreshCw />}
            {verdict === "outside" ? "Recheck" : "Retry"}
          </Button>
        )}
      </div>
      {g.lat != null && g.lng != null && (
        <GeofenceMap
          center={{ lat: g.lat, lng: g.lng }}
          radiusM={radius}
          you={you}
          tone={verdict === "inside" ? "clear" : verdict === "checking" ? "primary" : "incident"}
          className="h-44 rounded-none border-x-0 border-b-0 sm:h-52"
        />
      )}
    </div>
  );
});
GeofenceStatus.displayName = "GeofenceStatus";
