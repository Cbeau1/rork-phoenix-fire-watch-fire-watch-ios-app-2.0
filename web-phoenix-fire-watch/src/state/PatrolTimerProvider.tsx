import createContextHook from "@nkzw/create-context-hook";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  notificationPermission,
  primeAlertSound,
  requestNotificationPermission,
  type NotifyPermission,
} from "@/lib/alerts";
import { computeSchedule, type TimerSchedule } from "@/lib/patrol-timer";
import { DEFAULT_PATROL_INTERVAL, type Property } from "@/lib/types";

import { useAuth } from "./AuthProvider";
import { useFireWatch } from "./FireWatchProvider";

/** propertyId → timestamp the countdown is anchored to when the officer turned it on. */
type TimerMap = Record<string, number>;

interface TimerState {
  owner: string | null;
  timers: TimerMap;
  keepAwake: boolean;
}

const storageKey = (userId: string) => `pfw-patrol-timers:${userId}`;

const readSaved = (userId: string): Omit<TimerState, "owner"> => {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return { timers: {}, keepAwake: true };
    const parsed = JSON.parse(raw) as { timers?: Record<string, unknown>; keepAwake?: unknown };
    const timers: TimerMap = {};
    for (const [id, value] of Object.entries(parsed.timers ?? {})) {
      if (typeof value === "number" && Number.isFinite(value)) timers[id] = value;
    }
    return { timers, keepAwake: parsed.keepAwake !== false };
  } catch {
    return { timers: {}, keepAwake: true };
  }
};

export interface ActiveTimer {
  property: Property;
  startAt: number;
}

/**
 * Per-officer patrol timers. Each officer turns timers on/off for themselves on this device;
 * the interval comes from the property and can only be changed by an org admin.
 */
export const [PatrolTimerProvider, usePatrolTimers] = createContextHook(() => {
  const { user } = useAuth();
  const { patrols, propertyById } = useFireWatch();
  const userId = user?.id ?? null;
  const [state, setState] = useState<TimerState>({ owner: null, timers: {}, keepAwake: true });
  const [permission, setPermission] = useState<NotifyPermission>(() => notificationPermission());

  useEffect(() => {
    if (!userId) {
      setState({ owner: null, timers: {}, keepAwake: true });
      return;
    }
    setState({ owner: userId, ...readSaved(userId) });
  }, [userId]);

  useEffect(() => {
    if (!state.owner || state.owner !== userId) return;
    try {
      localStorage.setItem(
        storageKey(state.owner),
        JSON.stringify({ timers: state.timers, keepAwake: state.keepAwake }),
      );
    } catch {
      // storage full or unavailable — timers still work for this session
    }
  }, [state, userId]);

  const lastPatrolAt = useMemo<Map<string, number>>(() => {
    const now = Date.now();
    const map = new Map<string, number>();
    for (const p of patrols) {
      const t = Math.min(Date.parse(p.dateTime), now);
      if (!Number.isFinite(t)) continue;
      if (t > (map.get(p.propertyId) ?? 0)) map.set(p.propertyId, t);
    }
    return map;
  }, [patrols]);

  const activeTimers = useMemo<ActiveTimer[]>(() => {
    const list: ActiveTimer[] = [];
    for (const [id, startAt] of Object.entries(state.timers)) {
      const property = propertyById.get(id);
      if (property) list.push({ property, startAt });
    }
    return list;
  }, [state.timers, propertyById]);

  const isOn = useCallback((propertyId: string): boolean => propertyId in state.timers, [state.timers]);

  const scheduleFor = useCallback(
    (propertyId: string, now: number): TimerSchedule | null => {
      const startAt = state.timers[propertyId];
      const property = propertyById.get(propertyId);
      if (startAt === undefined || !property) return null;
      return computeSchedule({
        startAt,
        lastPatrolAt: lastPatrolAt.get(propertyId) ?? null,
        intervalMinutes: property.patrolIntervalMinutes,
        now,
      });
    },
    [state.timers, propertyById, lastPatrolAt],
  );

  /** Turns a property's timer on/off. Call from a tap so sound and notifications can be enabled. */
  const setTimerOn = useCallback(
    (propertyId: string, on: boolean) => {
      if (on) {
        primeAlertSound();
        void requestNotificationPermission().then(setPermission);
      }
      setState((prev) => {
        const timers = { ...prev.timers };
        if (on) {
          const now = Date.now();
          const last = lastPatrolAt.get(propertyId);
          const minutes = propertyById.get(propertyId)?.patrolIntervalMinutes ?? DEFAULT_PATROL_INTERVAL;
          // If a patrol was just logged, count from it; otherwise start the countdown now.
          timers[propertyId] = last !== undefined && now - last < minutes * 60_000 ? last : now;
        } else {
          delete timers[propertyId];
        }
        return { ...prev, timers };
      });
    },
    [lastPatrolAt, propertyById],
  );

  const setKeepAwake = useCallback((keepAwake: boolean) => setState((prev) => ({ ...prev, keepAwake })), []);

  const enableNotifications = useCallback(async () => {
    primeAlertSound();
    setPermission(await requestNotificationPermission());
  }, []);

  return {
    activeTimers,
    isOn,
    scheduleFor,
    setTimerOn,
    keepAwake: state.keepAwake,
    setKeepAwake,
    notifications: permission,
    enableNotifications,
  };
});
