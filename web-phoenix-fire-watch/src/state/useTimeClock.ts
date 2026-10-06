import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import * as tc from "@/lib/timeclock";
import { supabase } from "@/lib/supabase";

import { useAuth } from "./AuthProvider";

/** Time-clock data lives under "tc" keys (never persisted offline) and refreshes live. */
export const useTimeClockRealtime = () => {
  const { user } = useAuth();
  const qc = useQueryClient();
  const orgId = user?.orgId;
  useEffect(() => {
    if (!orgId) return;
    const channel = supabase
      .channel(`timeclock-${orgId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "time_entries", filter: `org_id=eq.${orgId}` }, () => {
        void qc.invalidateQueries({ queryKey: ["tc"] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [orgId, qc]);
};

/** The signed-in person's punch state + this week's own entries, with clock in/out actions. */
export const useMyClock = () => {
  const { user, online } = useAuth();
  const qc = useQueryClient();
  const uid = user?.id ?? "";

  const openQ = useQuery({
    queryKey: ["tc", "open", uid],
    enabled: !!uid,
    staleTime: 15_000,
    queryFn: async () => (await tc.loadOpenEntries(uid))[0] ?? null,
  });

  const period = tc.currentPeriod(7);
  const weekKey = period.start.toISOString();
  const weekQ = useQuery({
    queryKey: ["tc", "mine", uid, weekKey, 7],
    enabled: !!uid,
    staleTime: 30_000,
    queryFn: () => tc.loadEntries(period, uid),
  });

  const refresh = () => void qc.invalidateQueries({ queryKey: ["tc"] });
  const requireOnline = () => {
    if (!online) throw new Error("You're offline. Clocking in or out needs a connection.");
  };

  const clockIn = useMutation({
    mutationFn: async (note: string) => {
      requireOnline();
      return tc.clockIn(note);
    },
    onSuccess: (e) => {
      qc.setQueryData(["tc", "open", uid], e);
      refresh();
    },
  });

  const clockOut = useMutation({
    mutationFn: async (note: string) => {
      requireOnline();
      return tc.clockOut(note);
    },
    onSuccess: () => {
      qc.setQueryData(["tc", "open", uid], null);
      refresh();
    },
  });

  return {
    open: openQ.data ?? null,
    loading: openQ.isLoading,
    error: openQ.error,
    week: weekQ.data ?? [],
    clockIn,
    clockOut,
  };
};
