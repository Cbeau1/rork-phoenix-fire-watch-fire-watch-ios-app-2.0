import "leaflet/dist/leaflet.css";

import * as L from "leaflet";
import { memo, useEffect, useRef, useState } from "react";

import { GEOFENCE_MAX_M, GEOFENCE_MIN_M, type PatrolLocation } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface LatLng {
  lat: number;
  lng: number;
}

interface GeofenceMapProps {
  center: LatLng | null;
  radiusM: number;
  /** Lets admins drag the center, drag the edge handle to resize, and tap to move. */
  editable?: boolean;
  onChange?: (center: LatLng, radiusM: number) => void;
  /** Officer's live position (shown with its GPS accuracy ring). */
  you?: PatrolLocation | null;
  /** Fit color: ember while editing, green/red when showing an inside/outside result. */
  tone?: "ember" | "clear" | "incident" | "muted";
  /** Change to re-frame the map around the area (e.g. after an address search). */
  fitKey?: number | string;
  className?: string;
  interactive?: boolean;
}

const TONE: Record<NonNullable<GeofenceMapProps["tone"]>, string> = {
  ember: "#DC2626",
  clear: "#22C55E",
  incident: "#EF4444",
  muted: "#9AA3B2",
};

/** Esri basemaps: free for low-volume use and need no API key. */
const esri = (service: string) => `https://server.arcgisonline.com/ArcGIS/rest/services/${service}/MapServer/tile/{z}/{y}/{x}`;
const TILE_ATTRIBUTION = "Tiles &copy; Esri, Maxar, Earthstar Geographics, HERE, Garmin, OpenStreetMap contributors";

type BaseStyle = "satellite" | "map";

const buildLayers = (style: BaseStyle): L.TileLayer[] =>
  style === "satellite"
    ? [
        L.tileLayer(esri("World_Imagery"), { attribution: TILE_ATTRIBUTION, maxZoom: 20, maxNativeZoom: 19 }),
        L.tileLayer(esri("Reference/World_Transportation"), { maxZoom: 20, maxNativeZoom: 19, opacity: 0.7 }),
        L.tileLayer(esri("Reference/World_Boundaries_and_Places"), { maxZoom: 20, maxNativeZoom: 19 }),
      ]
    : [
        L.tileLayer(esri("Canvas/World_Dark_Gray_Base"), { attribution: TILE_ATTRIBUTION, maxZoom: 20, maxNativeZoom: 16 }),
        L.tileLayer(esri("Canvas/World_Dark_Gray_Reference"), { maxZoom: 20, maxNativeZoom: 16 }),
      ];

const clampRadius = (m: number) => Math.round(Math.min(GEOFENCE_MAX_M, Math.max(GEOFENCE_MIN_M, m)));

/** Point on the east edge of the circle — where the resize handle sits. */
const edgePoint = (c: LatLng, r: number): L.LatLngExpression => [
  c.lat,
  c.lng + r / (111320 * Math.max(0.01, Math.cos((c.lat * Math.PI) / 180))),
];

const centerIcon = (color: string) =>
  L.divIcon({
    className: "",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    html: `<div style="width:28px;height:28px;border-radius:9999px;background:${color};border:3px solid #fff;box-shadow:0 0 0 6px ${color}33;cursor:grab"></div>`,
  });

const handleIcon = (color: string) =>
  L.divIcon({
    className: "",
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    html: `<div style="width:30px;height:30px;border-radius:9999px;background:#fff;border:3px solid ${color};display:flex;align-items:center;justify-content:center;cursor:ew-resize;color:${color};font:700 14px/1 system-ui">&harr;</div>`,
  });

const youIcon = L.divIcon({
  className: "",
  iconSize: [18, 18],
  iconAnchor: [9, 9],
  html: `<div style="width:18px;height:18px;border-radius:9999px;background:#3B82F6;border:3px solid #fff;box-shadow:0 0 0 5px #3B82F633"></div>`,
});

/** Dark map showing a property's circular geofence; optionally editable. */
export const GeofenceMap = memo(
  ({ center, radiusM, editable, onChange, you, tone = "ember", fitKey, className, interactive = true }: GeofenceMapProps) => {
    const el = useRef<HTMLDivElement>(null);
    const map = useRef<L.Map | null>(null);
    const circle = useRef<L.Circle | null>(null);
    const centerMarker = useRef<L.Marker | null>(null);
    const handle = useRef<L.Marker | null>(null);
    const youMarker = useRef<L.Marker | null>(null);
    const youRing = useRef<L.Circle | null>(null);
    const resizing = useRef<boolean>(false);
    const baseLayers = useRef<L.TileLayer[]>([]);
    const [style, setStyle] = useState<BaseStyle>("satellite");
    const state = useRef<{ center: LatLng | null; radius: number }>({ center, radius: radiusM });
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    useEffect(() => {
      if (!el.current || map.current) return;
      const m = L.map(el.current, {
        zoomControl: interactive,
        attributionControl: true,
        dragging: interactive,
        scrollWheelZoom: interactive,
        doubleClickZoom: interactive,
        touchZoom: interactive,
        boxZoom: interactive,
        keyboard: interactive,
      }).setView(center ? [center.lat, center.lng] : [39.5, -98.35], center ? 16 : 4);
      map.current = m;
      const ro = new ResizeObserver(() => m.invalidateSize());
      ro.observe(el.current);
      return () => {
        ro.disconnect();
        m.remove();
        map.current = null;
        circle.current = null;
        centerMarker.current = null;
        handle.current = null;
        youMarker.current = null;
        youRing.current = null;
        baseLayers.current = [];
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Base map (satellite or dark street map).
    useEffect(() => {
      const m = map.current;
      if (!m) return;
      baseLayers.current.forEach((l) => l.remove());
      baseLayers.current = buildLayers(style).map((l) => l.addTo(m));
    }, [style]);

    // Circle, center and resize handle.
    useEffect(() => {
      const m = map.current;
      if (!m) return;
      state.current = { center, radius: radiusM };
      const color = TONE[tone];
      if (!center) {
        circle.current?.remove();
        centerMarker.current?.remove();
        handle.current?.remove();
        circle.current = centerMarker.current = handle.current = null;
        return;
      }
      const ll: L.LatLngExpression = [center.lat, center.lng];
      if (!circle.current) {
        circle.current = L.circle(ll, {
          radius: radiusM,
          color,
          weight: 2,
          fillColor: color,
          fillOpacity: 0.14,
          interactive: false,
        }).addTo(m);
      } else {
        circle.current.setLatLng(ll).setRadius(radiusM).setStyle({ color, fillColor: color });
      }

      if (editable) {
        if (!centerMarker.current) {
          const cm = L.marker(ll, { draggable: true, icon: centerIcon(color), keyboard: false, title: "Drag to move the area" }).addTo(m);
          cm.on("drag", () => {
            const p = cm.getLatLng();
            const r = state.current.radius;
            circle.current?.setLatLng(p);
            handle.current?.setLatLng(edgePoint(p, r));
          });
          cm.on("dragend", () => {
            const p = cm.getLatLng();
            onChangeRef.current?.({ lat: p.lat, lng: p.lng }, state.current.radius);
          });
          centerMarker.current = cm;
        } else {
          centerMarker.current.setLatLng(ll).setIcon(centerIcon(color));
        }
        if (!handle.current) {
          const h = L.marker(edgePoint(center, radiusM), {
            draggable: true,
            icon: handleIcon(color),
            keyboard: false,
            title: "Drag to resize",
          }).addTo(m);
          h.on("dragstart", () => {
            resizing.current = true;
          });
          h.on("drag", () => {
            const c = state.current.center;
            if (!c) return;
            const r = clampRadius(m.distance([c.lat, c.lng], h.getLatLng()));
            circle.current?.setRadius(r);
            state.current.radius = r;
            onChangeRef.current?.(c, r);
          });
          h.on("dragend", () => {
            resizing.current = false;
            const c = state.current.center;
            if (c) h.setLatLng(edgePoint(c, state.current.radius));
          });
          handle.current = h;
        } else if (!resizing.current) {
          handle.current.setLatLng(edgePoint(center, radiusM));
        }
      } else {
        centerMarker.current?.remove();
        handle.current?.remove();
        centerMarker.current = handle.current = null;
      }
    }, [center, radiusM, editable, tone]);

    // Tap to move the area (edit mode).
    useEffect(() => {
      const m = map.current;
      if (!m || !editable) return;
      const onClick = (e: L.LeafletMouseEvent) => {
        onChangeRef.current?.({ lat: e.latlng.lat, lng: e.latlng.lng }, state.current.radius);
      };
      m.on("click", onClick);
      return () => {
        m.off("click", onClick);
      };
    }, [editable]);

    // Officer position.
    useEffect(() => {
      const m = map.current;
      if (!m) return;
      if (!you) {
        youMarker.current?.remove();
        youRing.current?.remove();
        youMarker.current = youRing.current = null;
        return;
      }
      const ll: L.LatLngExpression = [you.lat, you.lng];
      if (!youMarker.current) {
        youRing.current = L.circle(ll, {
          radius: you.accuracyM,
          color: "#3B82F6",
          weight: 1,
          fillColor: "#3B82F6",
          fillOpacity: 0.12,
          interactive: false,
        }).addTo(m);
        youMarker.current = L.marker(ll, { icon: youIcon, interactive: false, keyboard: false }).addTo(m);
      } else {
        youMarker.current.setLatLng(ll);
        youRing.current?.setLatLng(ll).setRadius(you.accuracyM);
      }
    }, [you]);

    // Frame the area (and the officer when known).
    const hasYou = !!you;
    useEffect(() => {
      const m = map.current;
      const c = state.current.center;
      if (!m || !c) return;
      const bounds = L.latLng(c.lat, c.lng).toBounds(state.current.radius * 2.4);
      if (youMarker.current) bounds.extend(youMarker.current.getLatLng());
      m.fitBounds(bounds, { padding: [24, 24], maxZoom: 18, animate: false });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fitKey, hasYou, !!center]);

    return (
      <div className={cn("relative z-0 overflow-hidden rounded-lg border border-line bg-[#1b1e23]", className)}>
        <div
          ref={el}
          className="fw-map absolute inset-0"
          role="application"
          aria-label={editable ? "Geofence map. Tap to move the area; drag the edge handle to resize." : "Geofence map"}
        />
        <div className="absolute right-2 top-2 z-[500] flex overflow-hidden rounded-md border border-line bg-canvas/90 text-[11px] font-bold uppercase tracking-wider">
          {(["satellite", "map"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setStyle(s);
              }}
              aria-pressed={style === s}
              className={cn(
                "min-h-[32px] px-2.5 transition-colors",
                style === s ? "bg-ember text-white" : "text-ink-3 hover:text-ink",
              )}
            >
              {s === "satellite" ? "Satellite" : "Map"}
            </button>
          ))}
        </div>
      </div>
    );
  },
);
GeofenceMap.displayName = "GeofenceMap";
