import { Crosshair, Loader2, LocateFixed, MapPinned, Search } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { currentPosition } from "@/hooks/use-geolocation";
import { formatDistance, geocodeAddress } from "@/lib/geo";
import { friendlyError } from "@/lib/supabase";
import { GEOFENCE_DEFAULT_M, GEOFENCE_MAX_M, GEOFENCE_MIN_M, type Property } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useFireWatch } from "@/state/FireWatchProvider";

import { GeofenceMap, type LatLng } from "./GeofenceMap";

const PRESETS = [50, 100, 250, 500, 1000];
const SLIDER_MAX = 1000;
const RATIO = GEOFENCE_MAX_M / GEOFENCE_MIN_M;

/** Log scale so small sites get fine control and large ones are still reachable. */
const toSlider = (m: number) => Math.round((Math.log(m / GEOFENCE_MIN_M) / Math.log(RATIO)) * SLIDER_MAX);
const fromSlider = (v: number) => {
  const raw = GEOFENCE_MIN_M * RATIO ** (v / SLIDER_MAX);
  const step = raw < 200 ? 5 : raw < 1000 ? 10 : 50;
  return Math.min(GEOFENCE_MAX_M, Math.max(GEOFENCE_MIN_M, Math.round(raw / step) * step));
};

interface GeofenceDialogProps {
  property: Property;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Admin editor: place a circular area on the map and size it. */
export const GeofenceDialog = ({ property, open, onOpenChange }: GeofenceDialogProps) => {
  const { setGeofence } = useFireWatch();
  const g = property.geofence;
  const [enabled, setEnabled] = useState<boolean>(true);
  const [center, setCenter] = useState<LatLng | null>(null);
  const [radius, setRadius] = useState<number>(GEOFENCE_DEFAULT_M);
  const [query, setQuery] = useState<string>("");
  const [searching, setSearching] = useState<boolean>(false);
  const [locating, setLocating] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [fitKey, setFitKey] = useState<number>(0);

  const search = useCallback(async (q: string, quiet = false) => {
    if (!q.trim()) return;
    setSearching(true);
    try {
      const hit = await geocodeAddress(q);
      if (!hit) {
        if (!quiet) toast.error("Address not found", { description: "Try a fuller address, or tap the map to place the area." });
        return;
      }
      setCenter({ lat: hit.lat, lng: hit.lng });
      setFitKey((k) => k + 1);
    } catch (err) {
      if (!quiet) toast.error(friendlyError(err, "Address lookup failed"));
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setEnabled(g.enabled || g.lat == null);
    setRadius(g.radiusM ?? GEOFENCE_DEFAULT_M);
    setQuery(property.address);
    setFitKey((k) => k + 1);
    if (g.lat != null && g.lng != null) {
      setCenter({ lat: g.lat, lng: g.lng });
    } else {
      setCenter(null);
      if (property.address.trim()) void search(property.address, true);
    }
    // Reset only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onMapChange = useCallback((c: LatLng, r: number) => {
    setCenter(c);
    setRadius(r);
  }, []);

  const locateMe = async () => {
    setLocating(true);
    try {
      const here = await currentPosition();
      setCenter({ lat: here.lat, lng: here.lng });
      setFitKey((k) => k + 1);
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setLocating(false);
    }
  };

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    void search(query);
  };

  const save = async () => {
    if (enabled && !center) {
      toast.error("Place the area first", { description: "Search the address or tap the map." });
      return;
    }
    setSaving(true);
    try {
      await setGeofence(property.id, {
        enabled,
        lat: center?.lat ?? null,
        lng: center?.lng ?? null,
        radiusM: center ? radius : null,
      });
      toast.success(enabled ? "Geofence saved" : "Geofence turned off", {
        description: enabled
          ? `Patrols at ${property.name} must be logged within ${formatDistance(radius)}.`
          : "Officers can log patrols from anywhere.",
      });
      onOpenChange(false);
    } catch (err) {
      toast.error(friendlyError(err, "Couldn't save the geofence"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto border-line bg-surface p-0 text-ink sm:max-w-3xl sm:rounded-xl">
        <DialogHeader className="px-6 pt-6 text-left">
          <DialogTitle className="flex items-center gap-2.5 font-display text-xl">
            <MapPinned className="h-5 w-5 text-link" />
            Patrol geofence
          </DialogTitle>
          <DialogDescription className="text-ink-2">
            Officers can only log patrols for {property.name} while they're inside this area.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-6 pb-6">
          <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-line bg-raised px-4 py-3">
            <span>
              <span className="block text-sm font-semibold text-ink">Require officers to be on site</span>
              <span className="block text-xs text-ink-3">
                {enabled ? "Patrols outside the area are blocked." : "Off — patrols can be logged from anywhere."}
              </span>
            </span>
            <Switch checked={enabled} onCheckedChange={setEnabled} className="data-[state=checked]:bg-primary" />
          </label>

          <div className={cn("space-y-4 transition-opacity", !enabled && "pointer-events-none opacity-45")} aria-disabled={!enabled}>
            <div className="flex flex-col gap-2 sm:flex-row">
              <form onSubmit={onSearch} className="flex flex-1 gap-2">
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search an address"
                  aria-label="Search an address"
                  className="flex-1"
                />
                <Button type="submit" variant="outline" disabled={searching || !query.trim()} aria-label="Find address">
                  {searching ? <Loader2 className="animate-spin" /> : <Search />}
                  <span className="hidden sm:inline">Find</span>
                </Button>
              </form>
              <Button type="button" variant="outline" onClick={() => void locateMe()} disabled={locating}>
                {locating ? <Loader2 className="animate-spin" /> : <LocateFixed />}
                Use my location
              </Button>
            </div>

            <div className="relative">
              <GeofenceMap
                center={center}
                radiusM={radius}
                editable={enabled}
                onChange={onMapChange}
                fitKey={fitKey}
                className="h-[42dvh] min-h-[280px]"
              />
              {!center && (
                <div className="pointer-events-none absolute inset-0 z-[500] flex items-center justify-center">
                  <span className="flex items-center gap-2 rounded-full bg-canvas/90 px-4 py-2 text-sm text-ink ring-1 ring-line">
                    <Crosshair className="h-4 w-4 text-link" />
                    {searching ? "Finding the address…" : "Tap the map to place the area"}
                  </span>
                </div>
              )}
            </div>
            <p className="text-xs text-ink-3">
              Tap the map to move the center, drag the red dot to reposition, or drag the{" "}
              <span className="font-semibold text-ink-2">↔</span> handle to make the area larger or smaller.
            </p>

            <div className="rounded-lg border border-line bg-raised px-4 py-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs font-medium uppercase tracking-[0.14em] text-ink-3">Radius</span>
                <span className="font-mono text-lg font-semibold tabular-nums text-ink">{formatDistance(radius, true)}</span>
              </div>
              <Slider
                className="mt-4 [&_[role=slider]]:h-6 [&_[role=slider]]:w-6 [&_[role=slider]]:border-primary [&>span:first-child>span]:bg-primary"
                min={0}
                max={SLIDER_MAX}
                step={1}
                value={[toSlider(radius)]}
                onValueChange={(v) => setRadius(fromSlider(v[0] ?? 0))}
                aria-label="Geofence radius"
              />
              <div className="mt-4 flex flex-wrap gap-2">
                {PRESETS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setRadius(m)}
                    className={cn(
                      "focus-ring h-9 rounded-full border px-3.5 font-mono text-xs font-medium transition-colors",
                      radius === m ? "border-primary bg-primary/15 text-link" : "border-line bg-surface text-ink-2 hover:text-ink",
                    )}
                  >
                    {formatDistance(m)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-col-reverse gap-3 border-t border-line pt-5 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void save()} disabled={saving}>
              {saving && <Loader2 className="animate-spin" />}
              {enabled ? "Save geofence" : g.enabled ? "Turn off geofence" : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
