import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { useAuth } from "@/state/AuthProvider";

import { fetchBoard, type Board, type BoardShift } from "./api";

export const BOARD_KEY = ["dispatch", "board"] as const;

/** Live dispatch board for admins (polls every 15 s, pauses in background tabs). */
export const useDispatchBoard = (enabled = true) => {
  const { isAdmin } = useAuth();
  return useQuery<Board>({
    queryKey: BOARD_KEY,
    enabled: enabled && isAdmin,
    queryFn: fetchBoard,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  });
};

/** Re-renders every `ms` so countdowns stay current between polls. */
export const useNow = (ms = 30_000): number => {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
};

export type ShiftPhase = "upcoming" | "starting" | "late" | "missed" | "on_duty" | "done";

export interface ShiftState {
  phase: ShiftPhase;
  /** Minutes until the next patrol is due (negative = overdue). Only while on duty. */
  dueIn: number | null;
  /** Minutes until the shift starts (upcoming) or since it started (late). */
  startDelta: number;
}

export const shiftState = (s: BoardShift, now: number, lateMinutes = 15): ShiftState => {
  const start = new Date(s.starts_at).getTime();
  const end = new Date(s.ends_at).getTime();
  const startDelta = Math.round((start - now) / 60000);
  if (s.entry && !s.entry.clock_out) {
    const inAt = new Date(s.entry.clock_in).getTime();
    const base = Math.max(inAt, s.last_patrol_at ? new Date(s.last_patrol_at).getTime() : 0);
    const due = base + Math.max(1, s.property.interval || 60) * 60000;
    return { phase: "on_duty", dueIn: Math.round((due - now) / 60000), startDelta };
  }
  if (s.entry?.clock_out) return { phase: "done", dueIn: null, startDelta };
  if (now >= end) return { phase: "missed", dueIn: null, startDelta };
  if (now >= start + lateMinutes * 60000) return { phase: "late", dueIn: null, startDelta };
  if (now >= start - 60 * 60000) return { phase: "starting", dueIn: null, startDelta };
  return { phase: "upcoming", dueIn: null, startDelta };
};
