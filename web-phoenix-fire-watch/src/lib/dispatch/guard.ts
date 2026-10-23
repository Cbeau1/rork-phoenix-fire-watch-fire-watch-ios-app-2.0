import { createStore, del, entries, get, set, type UseStore } from "idb-keyval";

import type { IncidentCategory, PatrolStatus, Severity } from "./api";

/** Public, no-login API for the guard's shift link page, plus its on-device offline queue. */

const URL_BASE = import.meta.env.EXPO_PUBLIC_SUPABASE_URL as string;
const ANON = import.meta.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string;

export class GuardApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** True when the request never reached the server (offline / flaky signal). */
export const isNetworkError = (e: unknown): boolean => e instanceof GuardApiError && e.status === 0;

export async function guardCall<T>(body: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${URL_BASE}/functions/v1/shift-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: ANON, Authorization: `Bearer ${ANON}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new GuardApiError(0, "No connection. It will be sent when you're back online.");
  }
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    /* not json */
  }
  if (!res.ok) {
    const msg = (payload as { error?: string } | null)?.error;
    if (res.status >= 500 && !msg) throw new GuardApiError(0, "The server didn't respond. It will retry automatically.");
    throw new GuardApiError(res.status, msg || "Something went wrong. Please try again.");
  }
  return payload as T;
}

/* ---------------------------------------------------------------- view model */

export interface GuardView {
  company: string;
  tz: string;
  guard: string;
  shift: { id: string; date: string; start_time: string; end_time: string; starts_at: string; ends_at: string; notes: string };
  property: {
    id: string;
    name: string;
    address: string;
    access: string;
    interval: number;
    geofence: boolean;
    lat: number | null;
    lng: number | null;
    radius: number | null;
    contact: string;
    contact_phone: string;
  };
  entry: { id: string; clock_in: string; clock_out: string | null } | null;
  request: { id: string; status: "pending" | "approved"; distance_m: number | null; requested_at: string } | null;
  last_patrol_at: string | null;
  /** Latest patrol at the property by anyone (incl. the previous officer). Older cached views may lack it. */
  property_last_patrol_at?: string | null;
  patrols: { id: string; at: string; status: PatrolStatus; areas: string[]; notes: string; photos: number; outside: boolean; client_op_id: string | null }[];
  incidents: { id: string; at: string; category: IncidentCategory; severity: Severity; description: string; client_op_id: string | null }[];
  handoff: string | null;
  previous_handoff: { note: string; by: string; at: string } | null;
}

export interface CheckInResult {
  ok: boolean;
  already?: boolean;
  blocked?: boolean;
  distance_m?: number | null;
  radius_m?: number;
  overridden?: boolean;
  clock_in?: string;
}

export interface Fix {
  lat: number;
  lng: number;
  accuracy: number;
}

/* ---------------------------------------------------------------- offline queue */

export interface QueuedPatrolOp {
  kind: "patrol";
  areas: string[];
  status: PatrolStatus;
  notes: string;
  photos: string[];
}
export interface QueuedIncidentOp {
  kind: "incident";
  category: IncidentCategory;
  severity: Severity;
  description: string;
  photos: string[];
}
export interface QueuedCheckOutOp {
  kind: "check_out";
  handoff: string;
}

export type GuardOp = (QueuedPatrolOp | QueuedIncidentOp | QueuedCheckOutOp) & {
  client_id: string;
  token: string;
  at: string;
  fix: Fix | null;
  /** Set when the server refused it (kept so the guard sees why). */
  error?: string;
};

let opStore: UseStore | null = null;
let viewStore: UseStore | null = null;
const ops = (): UseStore => (opStore ??= createStore("pfw-shift-link", "ops"));
const views = (): UseStore => (viewStore ??= createStore("pfw-shift-link-views", "views"));

export async function queuedOps(token: string): Promise<GuardOp[]> {
  try {
    const all = await entries<string, GuardOp>(ops());
    return all
      .map(([, v]) => v)
      .filter((o) => o.token === token)
      .sort((a, b) => a.at.localeCompare(b.at));
  } catch {
    return [];
  }
}

export const putOp = (op: GuardOp): Promise<void> => set(op.client_id, op, ops());
export const dropOp = (clientId: string): Promise<void> => del(clientId, ops());

export async function cacheView(token: string, v: GuardView): Promise<void> {
  try {
    await set(token, { v, at: Date.now() }, views());
  } catch {
    /* storage full / private mode */
  }
}

export async function cachedView(token: string): Promise<{ v: GuardView; at: number } | null> {
  try {
    return (await get<{ v: GuardView; at: number }>(token, views())) ?? null;
  } catch {
    return null;
  }
}

/** Sends one queued op. Duplicate sends are safe (the server de-duplicates by client_id). */
export function sendOp(op: GuardOp, queued: boolean): Promise<unknown> {
  const base = {
    token: op.token,
    client_id: op.client_id,
    at: op.at,
    lat: op.fix?.lat ?? null,
    lng: op.fix?.lng ?? null,
    accuracy: op.fix?.accuracy ?? null,
  };
  if (op.kind === "patrol") {
    return guardCall({ ...base, action: "patrol", areas: op.areas, status: op.status, notes: op.notes, photos: op.photos, queued });
  }
  if (op.kind === "incident") {
    return guardCall({
      ...base,
      action: "incident",
      category: op.category,
      severity: op.severity,
      description: op.description,
      photos: op.photos,
    });
  }
  return guardCall({ ...base, action: "check_out", handoff: op.handoff });
}

/** Flushes the queue in order. Stops at the first network failure; server refusals are kept with their reason. */
export async function flushQueue(token: string): Promise<{ sent: number; failed: number; offline: boolean }> {
  let sent = 0;
  let failed = 0;
  for (const op of await queuedOps(token)) {
    if (op.error) continue;
    try {
      await sendOp(op, true);
      await dropOp(op.client_id);
      sent += 1;
    } catch (e) {
      if (isNetworkError(e)) return { sent, failed, offline: true };
      await putOp({ ...op, error: e instanceof Error ? e.message : "Couldn't be saved." });
      failed += 1;
    }
  }
  return { sent, failed, offline: false };
}

/* ---------------------------------------------------------------- location */

export function getFix(timeoutMs = 15000): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("This browser can't share location."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }),
      (err) =>
        reject(
          new Error(
            err.code === err.PERMISSION_DENIED
              ? "Location is blocked. Allow location for this site in your browser settings, then try again."
              : "Couldn't get your location. Step outside or near a window and try again.",
          ),
        ),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 15000 },
    );
  });
}
