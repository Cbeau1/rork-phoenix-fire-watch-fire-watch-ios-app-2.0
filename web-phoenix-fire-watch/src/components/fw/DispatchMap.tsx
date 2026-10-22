import "leaflet/dist/leaflet.css";

import * as L from "leaflet";
import { Crosshair, MapPinned, Navigation } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { buildLayers, type BaseStyle } from "@/components/fw/GeofenceMap";
import { Card } from "@/components/fw/primitives";
import { fmtMeters, type BoardShift } from "@/lib/dispatch/api";
import { RAW } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useTheme } from "@/state/ThemeProvider";

/** A guard's dot turns grey when their page hasn't reported in this long (phone locked, page closed, no signal). */
export const STALE_MS = 3 * 60_000;

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "?";

const agoShort = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.floor(m / 60)}h ${m % 60}m ago`;
};

const guardIcon = (label: string, color: string, live: boolean, selected: boolean) =>
  L.divIcon({
    className: "",
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    html: `<div style="position:relative;width:34px;height:34px">${
      live ? `<span class="fw-ping" style="position:absolute;inset:0;border-radius:9999px;background:${color}"></span>` : ""
    }<div style="position:relative;width:34px;height:34px;border-radius:9999px;background:${color};border:${selected ? 3 : 2}px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;color:#fff;font:700 12px/1 system-ui;letter-spacing:.02em">${esc(label)}</div></div>`,
  });

const siteIcon = L.divIcon({
  className: "",
  iconSize: [12, 12],
  iconAnchor: [6, 6],
  html: `<div style="width:12px;height:12px;border-radius:3px;background:#fff;border:3px solid ${RAW.primary};transform:rotate(45deg)"></div>`,
});

interface Guard {
  shift: BoardShift;
  lat: number;
  lng: number;
  live: boolean;
  outside: boolean;
  ageMs: number;
}

/**
 * Live dispatch map: each site's geofence plus every checked-in guard's latest position from their shift link
 * (with a short breadcrumb trail). Locations only arrive while the guard is checked in and before the shift ends.
 */
export const DispatchMap = ({ shifts, now }: { shifts: BoardShift[]; now: number }) => {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const baseLayers = useRef<L.TileLayer[]>([]);
  const fitted = useRef<string>("");
  const [style, setStyle] = useState<BaseStyle>("map");
  const [selected, setSelected] = useState<string | null>(null);
  const { resolved: theme } = useTheme();

  const guards = useMemo<Guard[]>(
    () =>
      shifts
        .filter((s) => s.location && s.entry && !s.entry.clock_out && now < new Date(s.ends_at).getTime())
        .map((s) => {
          const loc = s.location!;
          const ageMs = now - new Date(loc.at).getTime();
          const r = s.property.radius ?? 0;
          return {
            shift: s,
            lat: loc.lat,
            lng: loc.lng,
            live: ageMs < STALE_MS,
            outside: s.property.geofence && loc.distance_m != null && r > 0 && loc.distance_m > r,
            ageMs,
          };
        }),
    [shifts, now],
  );

  const sites = useMemo(() => {
    const seen = new Map<string, BoardShift["property"]>();
    for (const s of shifts) {
      const active = s.entry ? !s.entry.clock_out : now >= new Date(s.starts_at).getTime() - 60 * 60_000;
      if (active && s.property.lat != null && s.property.lng != null) seen.set(s.property.id, s.property);
    }
    return [...seen.values()];
  }, [shifts, now]);

  const onDutyNoLocation = shifts.filter((s) => s.entry && !s.entry.clock_out && !s.location).length;

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: true, attributionControl: true }).setView([39.5, -98.35], 4);
    map.current = m;
    layer.current = L.layerGroup().addTo(m);
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
      layer.current = null;
      baseLayers.current = [];
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    baseLayers.current.forEach((l) => l.remove());
    baseLayers.current = buildLayers(style, theme).map((l) => l.addTo(m));
    baseLayers.current.forEach((l) => l.bringToBack());
  }, [style, theme]);

  // Redraw sites, trails and guards on every board refresh.
  useEffect(() => {
    const g = layer.current;
    if (!g) return;
    g.clearLayers();
    for (const p of sites) {
      const ll: L.LatLngExpression = [p.lat!, p.lng!];
      if (p.radius) {
        L.circle(ll, { radius: p.radius, color: RAW.primary, weight: 1.5, dashArray: "4 4", fillColor: RAW.primary, fillOpacity: 0.08, interactive: false }).addTo(g);
      }
      L.marker(ll, { icon: siteIcon, keyboard: false })
        .bindTooltip(esc(p.name), { direction: "top", offset: [0, -8] })
        .addTo(g);
    }
    for (const x of guards) {
      const color = !x.live ? RAW.muted : x.outside ? RAW.warning : RAW.success;
      const trail = x.shift.trail ?? [];
      if (trail.length > 1) L.polyline(trail, { color, weight: 3, opacity: 0.55, interactive: false }).addTo(g);
      const acc = x.shift.location?.accuracy_m;
      if (acc && acc < 500) L.circle([x.lat, x.lng], { radius: acc, color, weight: 1, fillColor: color, fillOpacity: 0.1, interactive: false }).addTo(g);
      const d = x.shift.location?.distance_m;
      L.marker([x.lat, x.lng], { icon: guardIcon(initials(x.shift.staff.name), color, x.live, selected === x.shift.id), keyboard: false, zIndexOffset: 1000 })
        .bindTooltip(
          `<strong>${esc(x.shift.staff.name)}</strong><br/>${esc(x.shift.property.name)}<br/>${x.live ? "Seen" : "Last seen"} ${agoShort(x.ageMs)}${
            d != null ? ` · ${esc(fmtMeters(d))} from site` : ""
          }`,
          { direction: "top", offset: [0, -16] },
        )
        .on("click", () => setSelected(x.shift.id))
        .addTo(g);
    }
  }, [guards, sites, selected]);

  const fitAll = (force = false) => {
    const m = map.current;
    if (!m) return;
    const pts: L.LatLngExpression[] = [...guards.map((x) => [x.lat, x.lng] as L.LatLngTuple), ...sites.map((p) => [p.lat!, p.lng!] as L.LatLngTuple)];
    const key = [...guards.map((x) => x.shift.id), ...sites.map((p) => p.id)].sort().join(",");
    if (!force && key === fitted.current) return;
    fitted.current = key;
    if (!pts.length) return;
    m.fitBounds(L.latLngBounds(pts).pad(0.25), { maxZoom: 17, animate: !force ? false : true });
  };

  // Re-frame only when who/what is on the map changes, so a dispatcher's pan/zoom isn't undone by every refresh.
  useEffect(() => {
    fitAll(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guards.map((x) => x.shift.id).join(","), sites.map((p) => p.id).join(",")]);

  const focus = (x: Guard) => {
    setSelected(x.shift.id);
    map.current?.flyTo([x.lat, x.lng], Math.max(map.current.getZoom(), 17), { duration: 0.6 });
  };

  const live = guards.filter((x) => x.live).length;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-1 border-b border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-center gap-2.5">
          <MapPinned className="h-5 w-5 text-link" />
          <h2 className="font-display text-lg font-bold text-ink">Live map</h2>
          {guards.length > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-status-clear/12 px-2 py-0.5 text-xs font-semibold text-status-clear">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-status-clear" />
              {live} live
            </span>
          )}
        </div>
        <p className="text-xs text-ink-3">From guards' shift links · only while checked in · stops at shift end</p>
      </div>

      <div className="relative h-[340px] sm:h-[420px]">
        <div ref={el} className="fw-map absolute inset-0 z-0" role="application" aria-label="Live map of guards and sites" />
        <div className="absolute right-2 top-2 z-[500] flex overflow-hidden rounded-md border border-line bg-canvas/90 text-[11px] font-bold uppercase tracking-wider">
          {(["map", "satellite"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStyle(s)}
              aria-pressed={style === s}
              className={cn("min-h-[32px] px-2.5 transition-colors", style === s ? "bg-primary text-white" : "text-ink-3 hover:text-ink")}
            >
              {s === "satellite" ? "Satellite" : "Map"}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => fitAll(true)}
          className="focus-ring absolute bottom-6 right-2 z-[500] inline-flex min-h-[32px] items-center gap-1.5 rounded-md border border-line bg-canvas/90 px-2.5 text-xs font-semibold text-ink hover:bg-raised"
        >
          <Crosshair className="h-3.5 w-3.5" />
          Fit all
        </button>
        {guards.length === 0 && (
          <div className="pointer-events-none absolute inset-x-0 top-1/2 z-[400] mx-auto w-fit max-w-[90%] -translate-y-1/2 rounded-lg border border-line bg-canvas/90 px-4 py-3 text-center text-sm text-ink-2 shadow-card">
            {onDutyNoLocation
              ? `${onDutyNoLocation} guard${onDutyNoLocation === 1 ? " is" : "s are"} on duty without location sharing (app check-in, or the link page isn't open).`
              : "Guards appear here once they check in with their shift link."}
          </div>
        )}
      </div>

      {guards.length > 0 && (
        <ul className="flex gap-2 overflow-x-auto border-t border-line px-5 py-3 sm:px-6">
          {guards.map((x) => {
            const d = x.shift.location?.distance_m;
            return (
              <li key={x.shift.id} className="shrink-0">
                <button
                  type="button"
                  onClick={() => focus(x)}
                  className={cn(
                    "focus-ring flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors hover:bg-raised",
                    selected === x.shift.id ? "border-link bg-link/10" : "border-line",
                  )}
                >
                  <span className={cn("h-2.5 w-2.5 rounded-full", !x.live ? "bg-ink-3" : x.outside ? "bg-status-follow" : "bg-status-clear")} />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-ink">{x.shift.staff.name}</span>
                    <span className="block text-xs text-ink-3">
                      {x.live ? "Seen" : "Last seen"} {agoShort(x.ageMs)}
                      {d != null && (
                        <>
                          {" · "}
                          <span className={cn(x.outside && "font-semibold text-status-follow")}>{fmtMeters(d)} from site</span>
                        </>
                      )}
                    </span>
                  </span>
                  <Navigation className="h-3.5 w-3.5 text-ink-3" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
};
