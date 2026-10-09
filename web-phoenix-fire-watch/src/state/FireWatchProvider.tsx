import createContextHook from "@nkzw/create-context-hook";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useOnlineStatus } from "@/hooks/use-online";
import type { Database } from "@/integrations/supabase/types";
import { uid } from "@/lib/format";
import {
  deleteOp,
  loadOps,
  nextSeq,
  putOp,
  type OutboxOp,
  type OutboxPayload,
} from "@/lib/offline-store";
import { friendlyError, isDuplicateError, isRetryableError, PHOTO_BUCKET, supabase } from "@/lib/supabase";
import {
  DEFAULT_PATROL_INTERVAL,
  NO_GEOFENCE,
  type Geofence,
  type Patrol,
  type PatrolInput,
  type PatrolStatus,
  type Property,
  type PropertyInput,
  type SyncState,
  type WatchNote,
} from "@/lib/types";

import { useAuth } from "./AuthProvider";

type PropertyDbRow = Database["public"]["Tables"]["properties"]["Row"];
type PatrolDbRow = Database["public"]["Tables"]["patrols"]["Row"];
type NoteDbRow = Database["public"]["Tables"]["watch_notes"]["Row"];

const toStatus = (s: string): PatrolStatus => (s === "incident" || s === "follow-up" ? s : "clear");

const toProperty = (r: PropertyDbRow): Property => ({
  id: r.id,
  name: r.name,
  address: r.address,
  contactName: r.contact_name,
  contactPhone: r.contact_phone,
  contactEmail: r.contact_email,
  notes: r.notes,
  patrolIntervalMinutes: r.patrol_interval_minutes ?? DEFAULT_PATROL_INTERVAL,
  geofence: {
    enabled: !!r.geofence_enabled && r.geofence_lat != null && r.geofence_lng != null && r.geofence_radius_m != null,
    lat: r.geofence_lat,
    lng: r.geofence_lng,
    radiusM: r.geofence_radius_m,
  },
  createdAt: r.created_at,
});

const toPatrol = (r: PatrolDbRow): Patrol => ({
  id: r.id,
  propertyId: r.property_id,
  dateTime: r.date_time,
  officerName: r.officer_name,
  areas: r.areas ?? [],
  status: toStatus(r.status),
  notes: r.notes,
  photos: r.photos ?? [],
  loggedBy: r.logged_by,
  createdAt: r.created_at,
  location:
    r.latitude != null && r.longitude != null
      ? { lat: r.latitude, lng: r.longitude, accuracyM: r.location_accuracy_m ?? 0 }
      : null,
  geofenceDistanceM: r.geofence_distance_m,
});

const toNote = (r: NoteDbRow): WatchNote => ({
  id: r.id,
  content: r.content,
  author: r.author_name,
  authorId: r.author_id,
  createdAt: r.created_at,
});

const cleanProperty = (input: PropertyInput): PropertyInput => ({
  name: input.name.trim(),
  address: input.address.trim(),
  contactName: input.contactName.trim(),
  contactPhone: input.contactPhone.trim(),
  contactEmail: input.contactEmail.trim(),
  notes: input.notes.trim(),
});

const propertyPayload = (input: PropertyInput) => ({
  name: input.name,
  address: input.address,
  contact_name: input.contactName,
  contact_phone: input.contactPhone,
  contact_email: input.contactEmail,
  notes: input.notes,
});

const PAGE_SIZE = 1000;

async function fetchAllPatrols(): Promise<PatrolDbRow[]> {
  const rows: PatrolDbRow[] = [];
  for (let from = 0; from < 50000; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("patrols")
      .select("*")
      .order("date_time", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return rows;
}

const removePhotos = async (paths: string[]) => {
  const storagePaths = paths.filter((p) => !p.startsWith("data:") && !p.startsWith("http") && !p.startsWith("blob:"));
  if (storagePaths.length === 0) return;
  const { error } = await supabase.storage.from(PHOTO_BUCKET).remove(storagePaths);
  if (error) console.warn("[FireWatch] Photo cleanup failed", error.message);
};

const byNewest =
  <T,>(get: (t: T) => string) =>
  (a: T, b: T) =>
    Date.parse(get(b)) - Date.parse(get(a));

const syncStateOf = (op: OutboxOp): SyncState => (op.failed ? "failed" : "pending");

/** Sends one queued change to the server. Idempotent: safe to replay after a dropped connection. */
async function runOp(op: OutboxOp, saveProgress: (next: OutboxOp) => Promise<void>): Promise<OutboxOp> {
  switch (op.kind) {
    case "patrol.create": {
      const uploaded = [...op.uploaded];
      for (let i = uploaded.length; i < op.photos.length; i += 1) {
        const blob = await (await fetch(op.photos[i])).blob();
        const path = `${op.orgId}/${op.patrol.id}/${i + 1}.jpg`;
        const { error } = await supabase.storage
          .from(PHOTO_BUCKET)
          .upload(path, blob, { contentType: "image/jpeg", upsert: false });
        if (error && !/already exists|duplicate/i.test(error.message)) throw error;
        uploaded.push(path);
        await saveProgress({ ...op, uploaded });
      }
      const p = op.patrol;
      const { error } = await supabase.from("patrols").insert({
        id: p.id,
        property_id: p.propertyId,
        date_time: p.dateTime,
        officer_name: p.officerName,
        areas: p.areas,
        status: p.status,
        notes: p.notes,
        photos: uploaded,
        latitude: p.location?.lat ?? null,
        longitude: p.location?.lng ?? null,
        location_accuracy_m: p.location ? Math.round(p.location.accuracyM * 10) / 10 : null,
      });
      if (error && !isDuplicateError(error)) throw error;
      return { ...op, uploaded };
    }
    case "property.create": {
      const { id, ...input } = op.property;
      const { error } = await supabase.from("properties").insert({ id, ...propertyPayload(input) });
      if (error && !isDuplicateError(error)) throw error;
      return op;
    }
    case "property.update": {
      const { id, ...input } = op.property;
      const { error } = await supabase.from("properties").update(propertyPayload(input)).eq("id", id);
      if (error) throw error;
      return op;
    }
    case "note.create": {
      const n = op.note;
      const { error } = await supabase
        .from("watch_notes")
        .insert({ id: n.id, content: n.content, author_name: n.authorName, created_at: n.createdAt });
      if (error && !isDuplicateError(error)) throw error;
      return op;
    }
    case "note.resolve": {
      const { error } = await supabase.from("watch_notes").update({ resolved_at: op.resolvedAt }).eq("id", op.noteId);
      if (error) throw error;
      return op;
    }
    case "note.restore": {
      const { error } = await supabase.from("watch_notes").update({ resolved_at: null }).eq("id", op.note.id);
      if (error) throw error;
      return op;
    }
  }
}

const OFFLINE_ACTION = "You're offline. This action needs a connection — try again once you're back online.";

export const [FireWatchProvider, useFireWatch] = createContextHook(() => {
  const { user } = useAuth();
  const online = useOnlineStatus();
  const queryClient = useQueryClient();
  const orgId = user?.orgId ?? null;
  const userId = user?.id ?? null;

  const propertiesKey = useMemo(() => ["properties", orgId] as const, [orgId]);
  const patrolsKey = useMemo(() => ["patrols", orgId] as const, [orgId]);
  const notesKey = useMemo(() => ["notes", orgId] as const, [orgId]);

  const propertiesQuery = useQuery({
    queryKey: propertiesKey,
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase.from("properties").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data.map(toProperty);
    },
  });

  const patrolsQuery = useQuery({
    queryKey: patrolsKey,
    enabled: !!orgId,
    queryFn: async () => (await fetchAllPatrols()).map(toPatrol),
  });

  const notesQuery = useQuery({
    queryKey: notesKey,
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("watch_notes")
        .select("*")
        .is("resolved_at", null)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data.map(toNote);
    },
  });

  useEffect(() => {
    if (!orgId) return;
    const filter = `org_id=eq.${orgId}`;
    const channel = supabase
      .channel(`org-${orgId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "properties", filter }, () => {
        void queryClient.invalidateQueries({ queryKey: ["properties", orgId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "patrols", filter }, () => {
        void queryClient.invalidateQueries({ queryKey: ["patrols", orgId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "watch_notes", filter }, () => {
        void queryClient.invalidateQueries({ queryKey: ["notes", orgId] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [orgId, queryClient]);

  const setProperties = useCallback(
    (fn: (list: Property[]) => Property[]) =>
      queryClient.setQueryData<Property[]>(propertiesKey, (old) => fn(old ?? [])),
    [queryClient, propertiesKey],
  );
  const setPatrols = useCallback(
    (fn: (list: Patrol[]) => Patrol[]) => queryClient.setQueryData<Patrol[]>(patrolsKey, (old) => fn(old ?? [])),
    [queryClient, patrolsKey],
  );
  const setNotes = useCallback(
    (fn: (list: WatchNote[]) => WatchNote[]) =>
      queryClient.setQueryData<WatchNote[]>(notesKey, (old) => fn(old ?? [])),
    [queryClient, notesKey],
  );

  // ---------------------------------------------------------------------------
  // Offline outbox: every change is saved on the device first, then replayed to
  // the server in order whenever a connection is available.
  // ---------------------------------------------------------------------------
  const [ops, setOps] = useState<OutboxOp[]>([]);
  const opsRef = useRef<OutboxOp[]>([]);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const flushingRef = useRef<Promise<void> | null>(null);
  const rerunRef = useRef<boolean>(false);

  const commitOps = useCallback((next: OutboxOp[]) => {
    opsRef.current = next;
    setOps(next);
  }, []);

  const saveOp = useCallback(
    async (op: OutboxOp) => {
      await putOp(op);
      commitOps(opsRef.current.map((o) => (o.id === op.id ? op : o)));
    },
    [commitOps],
  );

  const dropOp = useCallback(
    async (id: string) => {
      await deleteOp(id);
      commitOps(opsRef.current.filter((o) => o.id !== id));
    },
    [commitOps],
  );

  /** Writes a synced change into the local cache so it never flickers out of view. */
  const applySynced = useCallback(
    (op: OutboxOp) => {
      switch (op.kind) {
        case "patrol.create":
          setPatrols((list) =>
            [
              {
                ...op.patrol,
                photos: op.uploaded,
                loggedBy: op.userId,
                createdAt: op.createdAt,
              },
              ...list.filter((x) => x.id !== op.patrol.id),
            ].sort(byNewest((x) => x.dateTime)),
          );
          break;
        case "property.create": {
          const { id, ...input } = op.property;
          setProperties((list) => [
            { id, ...input, patrolIntervalMinutes: DEFAULT_PATROL_INTERVAL, geofence: NO_GEOFENCE, createdAt: op.createdAt },
            ...list.filter((x) => x.id !== id),
          ]);
          break;
        }
        case "property.update": {
          const { id, ...input } = op.property;
          setProperties((list) => list.map((x) => (x.id === id ? { ...x, ...input } : x)));
          break;
        }
        case "note.create":
          setNotes((list) => [
            {
              id: op.note.id,
              content: op.note.content,
              author: op.note.authorName,
              authorId: op.userId,
              createdAt: op.note.createdAt,
            },
            ...list.filter((x) => x.id !== op.note.id),
          ]);
          break;
        case "note.resolve":
          setNotes((list) => list.filter((n) => n.id !== op.noteId));
          break;
        case "note.restore":
          setNotes((list) =>
            [{ ...op.note, syncState: undefined }, ...list.filter((n) => n.id !== op.note.id)].sort(
              byNewest((n) => n.createdAt),
            ),
          );
          break;
      }
    },
    [setNotes, setPatrols, setProperties],
  );

  const flushOnce = useCallback(async () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    const queue = opsRef.current.filter((o) => !o.failed);
    if (queue.length === 0) return;
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return;
    } catch {
      return;
    }

    setSyncing(true);
    const touched = new Set<string>();
    for (const queued of queue) {
      if (!navigator.onLine) break;
      const current = opsRef.current.find((o) => o.id === queued.id);
      if (!current || current.failed) continue;
      try {
        const done = await runOp(current, saveOp);
        applySynced(done);
        await dropOp(current.id);
        touched.add(current.kind.split(".")[0]);
      } catch (err) {
        const latest = opsRef.current.find((o) => o.id === queued.id) ?? current;
        const next: OutboxOp = { ...latest, attempts: latest.attempts + 1, error: friendlyError(err) };
        if (isRetryableError(err)) {
          await saveOp(next);
          break;
        }
        console.warn("[Sync] change rejected", current.kind, friendlyError(err));
        await saveOp({ ...next, failed: true });
      }
    }
    for (const t of touched) {
      const key = t === "property" ? "properties" : t === "patrol" ? "patrols" : "notes";
      void queryClient.invalidateQueries({ queryKey: [key, orgId] });
    }
    if (touched.size > 0) setLastSyncedAt(new Date().toISOString());
  }, [applySynced, dropOp, orgId, queryClient, saveOp]);

  const flush = useCallback((): Promise<void> => {
    if (flushingRef.current) {
      rerunRef.current = true;
      return flushingRef.current;
    }
    const run = (async () => {
      try {
        do {
          rerunRef.current = false;
          await flushOnce();
        } while (rerunRef.current);
      } catch (err) {
        console.warn("[Sync] flush failed", err);
      } finally {
        flushingRef.current = null;
        setSyncing(false);
      }
    })();
    flushingRef.current = run;
    return run;
  }, [flushOnce]);

  useEffect(() => {
    if (!userId) {
      commitOps([]);
      return;
    }
    let cancelled = false;
    void loadOps().then((all) => {
      if (cancelled) return;
      commitOps(all.filter((o) => o.userId === userId));
      void flush();
    });
    return () => {
      cancelled = true;
    };
  }, [userId, commitOps, flush]);

  const hasPending = ops.some((o) => !o.failed);

  useEffect(() => {
    if (!online || !userId) return;
    void flush();
    void queryClient.invalidateQueries({ queryKey: ["profile"] });
  }, [online, userId, flush, queryClient]);

  useEffect(() => {
    if (!hasPending || !online) return;
    const timer = window.setInterval(() => void flush(), 20_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void flush();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [hasPending, online, flush]);

  const enqueue = useCallback(
    async (payload: OutboxPayload): Promise<OutboxOp> => {
      if (!userId || !orgId) throw new Error("Please sign in again.");
      const op = {
        ...payload,
        id: uid(),
        seq: nextSeq(),
        userId,
        orgId,
        createdAt: new Date().toISOString(),
        attempts: 0,
      } as OutboxOp;
      await putOp(op);
      commitOps([...opsRef.current, op]);
      return op;
    },
    [userId, orgId, commitOps],
  );

  /**
   * Saves a change locally and tries to send it right away.
   * Returns "synced" or "queued"; throws (and discards the change) if the server rejects it.
   */
  const submit = useCallback(
    async (payload: OutboxPayload): Promise<"synced" | "queued"> => {
      const op = await enqueue(payload);
      if (navigator.onLine) await flush();
      const after = opsRef.current.find((o) => o.id === op.id);
      if (!after) return "synced";
      if (after.failed) {
        await dropOp(op.id);
        throw new Error(after.error ?? "Couldn't save this change.");
      }
      return "queued";
    },
    [enqueue, flush, dropOp],
  );

  // ---------------------------------------------------------------------------
  // Public mutations
  // ---------------------------------------------------------------------------
  const addProperty = useCallback(
    async (input: PropertyInput): Promise<Property> => {
      const property = { id: uid(), ...cleanProperty(input) };
      const result = await submit({ kind: "property.create", property });
      const { id, ...rest } = property;
      return {
        id,
        ...rest,
        patrolIntervalMinutes: DEFAULT_PATROL_INTERVAL,
        geofence: NO_GEOFENCE,
        createdAt: new Date().toISOString(),
        syncState: result === "queued" ? "pending" : undefined,
      };
    },
    [submit],
  );

  const updateProperty = useCallback(
    async ({ id, input }: { id: string; input: PropertyInput }): Promise<Property> => {
      const cleaned = cleanProperty(input);
      const result = await submit({ kind: "property.update", property: { id, ...cleaned } });
      const existing = queryClient.getQueryData<Property[]>(propertiesKey)?.find((p) => p.id === id);
      return {
        id,
        ...cleaned,
        patrolIntervalMinutes: existing?.patrolIntervalMinutes ?? DEFAULT_PATROL_INTERVAL,
        geofence: existing?.geofence ?? NO_GEOFENCE,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        syncState: result === "queued" ? "pending" : undefined,
      };
    },
    [submit, queryClient, propertiesKey],
  );

  /** Admin-only: changes how often a property must be patrolled. Needs a connection. */
  const setPatrolInterval = useCallback(
    async (id: string, minutes: number): Promise<void> => {
      if (opsRef.current.some((o) => o.kind === "property.create" && o.property.id === id)) {
        throw new Error("This property hasn't uploaded yet. Try again once it's synced.");
      }
      if (!navigator.onLine) throw new Error(OFFLINE_ACTION);
      const { error } = await supabase
        .from("properties")
        .update({ patrol_interval_minutes: minutes })
        .eq("id", id);
      if (error) throw error;
      setProperties((list) => list.map((p) => (p.id === id ? { ...p, patrolIntervalMinutes: minutes } : p)));
    },
    [setProperties],
  );

  /** Admin-only: sets or clears the area officers must be inside to log patrols. Needs a connection. */
  const setGeofence = useCallback(
    async (id: string, geofence: Geofence): Promise<void> => {
      if (opsRef.current.some((o) => o.kind === "property.create" && o.property.id === id)) {
        throw new Error("This property hasn't uploaded yet. Try again once it's synced.");
      }
      if (!navigator.onLine) throw new Error(OFFLINE_ACTION);
      const { error } = await supabase
        .from("properties")
        .update({
          geofence_enabled: geofence.enabled,
          geofence_lat: geofence.lat,
          geofence_lng: geofence.lng,
          geofence_radius_m: geofence.radiusM,
        })
        .eq("id", id);
      if (error) throw error;
      setProperties((list) => list.map((p) => (p.id === id ? { ...p, geofence } : p)));
    },
    [setProperties],
  );

  const deletePropertyMutation = useMutation({
    mutationFn: async (id: string) => {
      const pending = opsRef.current.find((o) => o.kind === "property.create" && o.property.id === id);
      if (pending) {
        const related = opsRef.current.filter(
          (o) =>
            o.id === pending.id ||
            (o.kind === "property.update" && o.property.id === id) ||
            (o.kind === "patrol.create" && o.patrol.propertyId === id),
        );
        for (const o of related) await dropOp(o.id);
        return id;
      }
      if (!navigator.onLine) throw new Error(OFFLINE_ACTION);
      const photos = (queryClient.getQueryData<Patrol[]>(patrolsKey) ?? [])
        .filter((p) => p.propertyId === id)
        .flatMap((p) => p.photos);
      const { error } = await supabase.from("properties").delete().eq("id", id);
      if (error) throw error;
      void removePhotos(photos);
      for (const o of opsRef.current) {
        if ((o.kind === "patrol.create" && o.patrol.propertyId === id) || (o.kind === "property.update" && o.property.id === id)) {
          await dropOp(o.id);
        }
      }
      return id;
    },
    onSuccess: (id) => {
      setProperties((list) => list.filter((p) => p.id !== id));
      setPatrols((list) => list.filter((p) => p.propertyId !== id));
    },
  });

  const addPatrol = useCallback(
    async (input: PatrolInput): Promise<Patrol> => {
      const patrol = {
        id: uid(),
        propertyId: input.propertyId,
        dateTime: input.dateTime,
        officerName: input.officerName.trim(),
        areas: input.areas,
        status: input.status,
        notes: input.notes.trim(),
        location: input.location ?? null,
      };
      const result = await submit({ kind: "patrol.create", patrol, photos: input.photos, uploaded: [] });
      return {
        ...patrol,
        photos: input.photos,
        loggedBy: userId,
        createdAt: new Date().toISOString(),
        syncState: result === "queued" ? "pending" : undefined,
      };
    },
    [submit, userId],
  );

  const deletePatrolMutation = useMutation({
    mutationFn: async (id: string) => {
      const pending = opsRef.current.find((o) => o.kind === "patrol.create" && o.patrol.id === id);
      if (pending) {
        await dropOp(pending.id);
        return id;
      }
      if (!navigator.onLine) throw new Error(OFFLINE_ACTION);
      const patrol = (queryClient.getQueryData<Patrol[]>(patrolsKey) ?? []).find((p) => p.id === id);
      const { error } = await supabase.from("patrols").delete().eq("id", id);
      if (error) throw error;
      if (patrol) void removePhotos(patrol.photos);
      return id;
    },
    onSuccess: (id) => setPatrols((list) => list.filter((p) => p.id !== id)),
  });

  const addNote = useCallback(
    async (content: string): Promise<WatchNote> => {
      const note = {
        id: uid(),
        content: content.trim(),
        authorName: user?.name ?? "Officer",
        createdAt: new Date().toISOString(),
      };
      const result = await submit({ kind: "note.create", note });
      return {
        id: note.id,
        content: note.content,
        author: note.authorName,
        authorId: userId,
        createdAt: note.createdAt,
        syncState: result === "queued" ? "pending" : undefined,
      };
    },
    [submit, user?.name, userId],
  );

  const resolveNote = useCallback(
    async (id: string): Promise<string> => {
      await submit({ kind: "note.resolve", noteId: id, resolvedAt: new Date().toISOString() });
      return id;
    },
    [submit],
  );

  const restoreNote = useCallback(
    async (note: WatchNote): Promise<WatchNote> => {
      await submit({ kind: "note.restore", note: { ...note, syncState: undefined } });
      return note;
    },
    [submit],
  );

  // ---------------------------------------------------------------------------
  // Views = server data + local changes still waiting to sync
  // ---------------------------------------------------------------------------
  const properties = useMemo<Property[]>(() => {
    let list = [...(propertiesQuery.data ?? [])];
    for (const op of ops) {
      if (op.kind === "property.create" && !list.some((p) => p.id === op.property.id)) {
        const { id, ...rest } = op.property;
        list.unshift({
          id,
          ...rest,
          patrolIntervalMinutes: DEFAULT_PATROL_INTERVAL,
          geofence: NO_GEOFENCE,
          createdAt: op.createdAt,
          syncState: syncStateOf(op),
        });
      } else if (op.kind === "property.update") {
        const { id, ...rest } = op.property;
        list = list.map((p) => (p.id === id ? { ...p, ...rest, syncState: syncStateOf(op) } : p));
      }
    }
    return list;
  }, [propertiesQuery.data, ops]);

  const patrols = useMemo<Patrol[]>(() => {
    const server = patrolsQuery.data ?? [];
    const local: Patrol[] = [];
    for (const op of ops) {
      if (op.kind !== "patrol.create" || server.some((p) => p.id === op.patrol.id)) continue;
      local.push({
        ...op.patrol,
        photos: op.photos,
        loggedBy: op.userId,
        createdAt: op.createdAt,
        syncState: syncStateOf(op),
      });
    }
    if (local.length === 0) return server;
    return [...local, ...server].sort(byNewest((p) => p.dateTime));
  }, [patrolsQuery.data, ops]);

  const notes = useMemo<WatchNote[]>(() => {
    let list = [...(notesQuery.data ?? [])];
    let changed = false;
    for (const op of ops) {
      if (op.kind === "note.create" && !list.some((n) => n.id === op.note.id)) {
        list.push({
          id: op.note.id,
          content: op.note.content,
          author: op.note.authorName,
          authorId: op.userId,
          createdAt: op.note.createdAt,
          syncState: syncStateOf(op),
        });
        changed = true;
      } else if (op.kind === "note.resolve") {
        list = list.filter((n) => n.id !== op.noteId);
        changed = true;
      } else if (op.kind === "note.restore" && !list.some((n) => n.id === op.note.id)) {
        list.push({ ...op.note, syncState: syncStateOf(op) });
        changed = true;
      }
    }
    return changed ? list.sort(byNewest((n) => n.createdAt)) : list;
  }, [notesQuery.data, ops]);

  const propertyById = useMemo<Map<string, Property>>(
    () => new Map(properties.map((p) => [p.id, p])),
    [properties],
  );

  const isLoading =
    !!orgId &&
    ((propertiesQuery.isPending && !propertiesQuery.data) ||
      (patrolsQuery.isPending && !patrolsQuery.data) ||
      (notesQuery.isPending && !notesQuery.data));
  const loadError =
    (!propertiesQuery.data ? propertiesQuery.error : null) ??
    (!patrolsQuery.data ? patrolsQuery.error : null) ??
    (!notesQuery.data ? notesQuery.error : null) ??
    null;

  const reload = useCallback(() => {
    void propertiesQuery.refetch();
    void patrolsQuery.refetch();
    void notesQuery.refetch();
  }, [propertiesQuery, patrolsQuery, notesQuery]);

  const retryOp = useCallback(
    async (id: string) => {
      const op = opsRef.current.find((o) => o.id === id);
      if (!op) return;
      await saveOp({ ...op, failed: false, attempts: 0, error: undefined });
      await flush();
    },
    [saveOp, flush],
  );

  const sync = useMemo(
    () => ({
      online,
      syncing,
      lastSyncedAt,
      queue: ops,
      pendingCount: ops.filter((o) => !o.failed).length,
      failedCount: ops.filter((o) => o.failed).length,
      syncNow: flush,
      retryOp,
      discardOp: dropOp,
    }),
    [online, syncing, lastSyncedAt, ops, flush, retryOp, dropOp],
  );

  return {
    user,
    properties,
    patrols,
    notes,
    propertyById,
    isLoading,
    loadError,
    reload,
    sync,
    addProperty,
    updateProperty,
    setPatrolInterval,
    setGeofence,
    deleteProperty: deletePropertyMutation.mutateAsync,
    addPatrol,
    deletePatrol: deletePatrolMutation.mutateAsync,
    addNote,
    resolveNote,
    restoreNote,
  };
});

/** Patrol counts for a set of patrols. */
export const usePatrolStats = (patrols: Patrol[]) =>
  useMemo(() => {
    const now = new Date();
    let thisMonth = 0;
    let clear = 0;
    let followUp = 0;
    let incidents = 0;
    for (const p of patrols) {
      const d = new Date(p.dateTime);
      if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) thisMonth += 1;
      if (p.status === "clear") clear += 1;
      else if (p.status === "follow-up") followUp += 1;
      else incidents += 1;
    }
    return { total: patrols.length, thisMonth, clear, followUp, incidents };
  }, [patrols]);
