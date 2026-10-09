import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { createStore, del, entries, get, set, type UseStore } from "idb-keyval";

import type { PatrolLocation, PatrolStatus, PropertyInput, WatchNote } from "./types";

export interface OpBase {
  /** Unique id of the queued operation. */
  id: string;
  /** Monotonic ordering key — operations replay in the order they were made. */
  seq: number;
  userId: string;
  orgId: string;
  createdAt: string;
  attempts: number;
  error?: string;
  /** Set when the server rejected the change; needs a manual retry or discard. */
  failed?: boolean;
}

export interface QueuedPatrol {
  id: string;
  propertyId: string;
  dateTime: string;
  officerName: string;
  areas: string[];
  status: PatrolStatus;
  notes: string;
  /** Captured when the patrol was logged, so offline uploads are checked against where the officer actually was. */
  location?: PatrolLocation | null;
}

export type OutboxOp = OpBase &
  (
    | {
        kind: "patrol.create";
        patrol: QueuedPatrol;
        /** Compressed JPEG data URLs captured on the device. */
        photos: string[];
        /** Storage paths of photos already uploaded (resumes where it left off). */
        uploaded: string[];
      }
    | { kind: "property.create"; property: PropertyInput & { id: string } }
    | { kind: "property.update"; property: PropertyInput & { id: string } }
    | { kind: "note.create"; note: { id: string; content: string; authorName: string; createdAt: string } }
    | { kind: "note.resolve"; noteId: string; resolvedAt: string }
    | { kind: "note.restore"; note: WatchNote }
  );

export type OutboxOpKind = OutboxOp["kind"];

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** An outbox operation before bookkeeping fields are attached. */
export type OutboxPayload = DistributiveOmit<OutboxOp, keyof OpBase>;

const hasIdb = typeof indexedDB !== "undefined";
let outboxDb: UseStore | null = null;
let cacheDb: UseStore | null = null;
const outboxStore = (): UseStore => (outboxDb ??= createStore("pfw-outbox", "ops"));
const cacheStore = (): UseStore => (cacheDb ??= createStore("pfw-cache", "queries"));

/** In-memory fallback when IndexedDB is unavailable (e.g. some private browsing modes). */
const memoryOutbox = new Map<string, OutboxOp>();
let idbBroken = !hasIdb;

const warnOnce = (() => {
  let warned = false;
  return (err: unknown) => {
    if (warned) return;
    warned = true;
    console.warn("[Offline] IndexedDB unavailable — offline queue kept in memory only", err);
  };
})();

let seqCounter = 0;
/** Ordering key that stays increasing even for ops created in the same millisecond. */
export const nextSeq = (): number => Date.now() * 1000 + (seqCounter++ % 1000);

export async function loadOps(): Promise<OutboxOp[]> {
  if (!idbBroken) {
    try {
      const all = await entries<string, OutboxOp>(outboxStore());
      for (const [, op] of all) memoryOutbox.set(op.id, op);
    } catch (err) {
      idbBroken = true;
      warnOnce(err);
    }
  }
  return Array.from(memoryOutbox.values()).sort((a, b) => a.seq - b.seq);
}

export async function putOp(op: OutboxOp): Promise<void> {
  memoryOutbox.set(op.id, op);
  if (idbBroken) return;
  try {
    await set(op.id, op, outboxStore());
  } catch (err) {
    idbBroken = true;
    warnOnce(err);
  }
}

export async function deleteOp(id: string): Promise<void> {
  memoryOutbox.delete(id);
  if (idbBroken) return;
  try {
    await del(id, outboxStore());
  } catch (err) {
    warnOnce(err);
  }
}

/** Removes every queued change that belongs to a user (used after account deletion). */
export async function clearOpsForUser(userId: string): Promise<void> {
  const all = await loadOps();
  await Promise.all(all.filter((o) => o.userId === userId).map((o) => deleteOp(o.id)));
}

/** Persists the React Query cache so the last-downloaded data is available offline. */
export const queryPersister = createAsyncStoragePersister({
  key: "pfw-query-cache",
  throttleTime: 1500,
  storage: hasIdb
    ? {
        getItem: async (key: string) => {
          try {
            return (await get<string>(key, cacheStore())) ?? null;
          } catch {
            return null;
          }
        },
        setItem: async (key: string, value: string) => {
          try {
            await set(key, value, cacheStore());
          } catch (err) {
            warnOnce(err);
          }
        },
        removeItem: async (key: string) => {
          try {
            await del(key, cacheStore());
          } catch {
            // ignore
          }
        },
      }
    : undefined,
});

/** Wipes the offline data cache for this device. */
export const clearOfflineCache = async (): Promise<void> => {
  try {
    await queryPersister.removeClient();
  } catch (err) {
    console.warn("[Offline] could not clear cache", err);
  }
};
