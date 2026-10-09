import type { Geofence, PatrolLocation } from "./types";

/** Max GPS uncertainty (meters) credited in the officer's favour — mirrors the server rule. */
export const GPS_SLACK_MAX_M = 50;

/** Great-circle distance in meters. */
export const distanceM = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
  const r = (d: number) => (d * Math.PI) / 180;
  const a =
    Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(a)));
};

export const isGeofenceActive = (g: Geofence): g is Geofence & { lat: number; lng: number; radiusM: number } =>
  g.enabled && g.lat != null && g.lng != null && g.radiusM != null;

/** Same pass/fail rule the database enforces on every patrol insert. */
export const insideGeofence = (g: Geofence, loc: PatrolLocation): { inside: boolean; distance: number } => {
  if (!isGeofenceActive(g)) return { inside: true, distance: 0 };
  const distance = distanceM(loc.lat, loc.lng, g.lat, g.lng);
  const slack = Math.min(Math.max(loc.accuracyM, 0), GPS_SLACK_MAX_M);
  return { inside: distance - slack <= g.radiusM, distance };
};

/** "150 m" / "1.2 km" with feet for US readers. */
export const formatDistance = (m: number, withFeet = false): string => {
  const metric = m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : `${Math.round(m)} m`;
  if (!withFeet) return metric;
  const ft = m * 3.28084;
  const imperial = ft >= 5280 ? `${(ft / 5280).toFixed(1)} mi` : `${Math.round(ft / 5) * 5} ft`;
  return `${metric} · ${imperial}`;
};

export interface GeocodeHit {
  lat: number;
  lng: number;
  label: string;
}

/** Looks up an address with OpenStreetMap Nominatim. Returns null when nothing matches. */
export async function geocodeAddress(query: string, signal?: AbortSignal): Promise<GeocodeHit | null> {
  const q = query.trim();
  if (!q) return null;
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("Address lookup is unavailable right now.");
  const rows = (await res.json()) as { lat: string; lon: string; display_name: string }[];
  const hit = rows[0];
  if (!hit) return null;
  return { lat: Number(hit.lat), lng: Number(hit.lon), label: hit.display_name };
}
