import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays } from "date-fns";
import { useEffect, useMemo } from "react";

import type { Database } from "@/integrations/supabase/types";
import { fromDbTime, toDateKey, type Shift, type ShiftInput, type Staff } from "@/lib/schedule";
import { supabase } from "@/lib/supabase";
import type { Member } from "@/lib/types";

import { useAuth } from "./AuthProvider";

type StaffRow = Database["public"]["Tables"]["staff"]["Row"];
type ShiftRow = Database["public"]["Tables"]["shifts"]["Row"];

const OFFLINE = "You're offline. Schedule changes need a connection — try again once you're back online.";

const requireOnline = () => {
  if (typeof navigator !== "undefined" && !navigator.onLine) throw new Error(OFFLINE);
};

const toStaff = (r: StaffRow): Staff => ({ id: r.id, name: r.name, profileId: r.profile_id, createdAt: r.created_at });

const toShift = (r: ShiftRow & { shift_payments?: unknown }): Shift => {
  const raw = r.shift_payments as { paid_at: string } | { paid_at: string }[] | null | undefined;
  const pay = Array.isArray(raw) ? raw[0] : raw;
  return {
    id: r.id,
    propertyId: r.property_id,
    staffId: r.staff_id,
    date: r.shift_date,
    start: fromDbTime(r.start_time),
    end: fromDbTime(r.end_time),
    notes: r.notes,
    paidAt: pay?.paid_at ?? null,
  };
};

const shiftPayload = (input: ShiftInput) => ({
  staff_id: input.staffId,
  property_id: input.propertyId,
  start_time: input.start,
  end_time: input.end,
  notes: input.notes.trim(),
});

/**
 * Staff roster + one week of shifts for the signed-in organization.
 * Admins can edit everything and see pay status; officers get a read-only view (pay data is hidden by RLS).
 */
export const useSchedule = (weekStart: Date) => {
  const { user, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const orgId = user?.orgId ?? null;
  const from = toDateKey(weekStart);
  const to = toDateKey(addDays(weekStart, 6));

  const staffKey = useMemo(() => ["staff", orgId] as const, [orgId]);
  const shiftsKey = useMemo(() => ["shifts", orgId, from] as const, [orgId, from]);
  const membersKey = useMemo(() => ["members", orgId ?? ""] as const, [orgId]);

  const staffQuery = useQuery({
    queryKey: staffKey,
    enabled: !!orgId,
    queryFn: async (): Promise<Staff[]> => {
      const { data, error } = await supabase.from("staff").select("*").order("name", { ascending: true });
      if (error) throw error;
      return data.map(toStaff);
    },
  });

  const shiftsQuery = useQuery({
    queryKey: shiftsKey,
    enabled: !!orgId,
    queryFn: async (): Promise<Shift[]> => {
      const { data, error } = await supabase
        .from("shifts")
        .select("*, shift_payments(paid_at)")
        .gte("shift_date", from)
        .lte("shift_date", to)
        .order("shift_date", { ascending: true })
        .order("start_time", { ascending: true });
      if (error) throw error;
      return data.map(toShift);
    },
  });

  /** Team logins (admin only) so staff can be linked to an account. Same cache as the Team page. */
  const membersQuery = useQuery({
    queryKey: membersKey,
    enabled: !!orgId && isAdmin,
    queryFn: async (): Promise<Member[]> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, role, active, created_at")
        .eq("org_id", orgId ?? "")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data.map((r) => ({
        id: r.id,
        name: r.full_name,
        email: r.email,
        role: r.role === "admin" ? "admin" : "officer",
        active: r.active,
        createdAt: r.created_at,
      }));
    },
  });

  useEffect(() => {
    if (!orgId) return;
    const filter = `org_id=eq.${orgId}`;
    const refreshShifts = () => void queryClient.invalidateQueries({ queryKey: ["shifts", orgId] });
    const channel = supabase
      .channel(`schedule-${orgId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "staff", filter }, () => {
        void queryClient.invalidateQueries({ queryKey: ["staff", orgId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "shifts", filter }, refreshShifts)
      .on("postgres_changes", { event: "*", schema: "public", table: "shift_payments", filter }, refreshShifts)
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [orgId, queryClient]);

  const invalidateStaff = () => queryClient.invalidateQueries({ queryKey: ["staff", orgId] });
  const invalidateShifts = () => queryClient.invalidateQueries({ queryKey: ["shifts", orgId] });

  const addStaff = useMutation({
    mutationFn: async (input: { name: string; profileId: string | null }): Promise<Staff> => {
      requireOnline();
      const { data, error } = await supabase
        .from("staff")
        .insert({ name: input.name.trim(), profile_id: input.profileId })
        .select("*")
        .single();
      if (error) throw error;
      return toStaff(data);
    },
    onSuccess: (s) => {
      queryClient.setQueryData<Staff[]>(staffKey, (old) =>
        [...(old ?? []).filter((x) => x.id !== s.id), s].sort((a, b) => a.name.localeCompare(b.name)),
      );
      void invalidateStaff();
    },
  });

  const updateStaff = useMutation({
    mutationFn: async (input: { id: string; name: string; profileId: string | null }) => {
      requireOnline();
      const { error } = await supabase
        .from("staff")
        .update({ name: input.name.trim(), profile_id: input.profileId })
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: () => void invalidateStaff(),
  });

  const deleteStaff = useMutation({
    mutationFn: async (id: string) => {
      requireOnline();
      const { error } = await supabase.from("staff").delete().eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => {
      queryClient.setQueryData<Staff[]>(staffKey, (old) => (old ?? []).filter((s) => s.id !== id));
      void invalidateStaff();
      void invalidateShifts();
    },
  });

  const addShifts = useMutation({
    mutationFn: async ({ input, dates }: { input: ShiftInput; dates: string[] }) => {
      requireOnline();
      const rows = dates.map((d) => ({ ...shiftPayload(input), shift_date: d }));
      const { error } = await supabase.from("shifts").insert(rows);
      if (error) throw error;
      return dates.length;
    },
    onSuccess: () => void invalidateShifts(),
  });

  const updateShift = useMutation({
    mutationFn: async ({ id, date, input }: { id: string; date: string; input: ShiftInput }) => {
      requireOnline();
      const { error } = await supabase
        .from("shifts")
        .update({ ...shiftPayload(input), shift_date: date })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => void invalidateShifts(),
  });

  const deleteShift = useMutation({
    mutationFn: async (id: string) => {
      requireOnline();
      const { error } = await supabase.from("shifts").delete().eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => {
      queryClient.setQueryData<Shift[]>(shiftsKey, (old) => (old ?? []).filter((s) => s.id !== id));
      void invalidateShifts();
    },
  });

  /** Marks shifts paid / unpaid. Optimistic so the shift turns green instantly. */
  const setPaid = useMutation({
    mutationFn: async ({ ids, paid }: { ids: string[]; paid: boolean }) => {
      requireOnline();
      if (ids.length === 0) return;
      if (paid) {
        const { error } = await supabase
          .from("shift_payments")
          .upsert(
            ids.map((shift_id) => ({ shift_id })),
            { onConflict: "shift_id", ignoreDuplicates: true },
          );
        if (error) throw error;
      } else {
        const { error } = await supabase.from("shift_payments").delete().in("shift_id", ids);
        if (error) throw error;
      }
    },
    onMutate: async ({ ids, paid }) => {
      await queryClient.cancelQueries({ queryKey: shiftsKey });
      const previous = queryClient.getQueryData<Shift[]>(shiftsKey);
      const stamp = new Date().toISOString();
      const idSet = new Set(ids);
      queryClient.setQueryData<Shift[]>(shiftsKey, (old) =>
        (old ?? []).map((s) => (idSet.has(s.id) ? { ...s, paidAt: paid ? (s.paidAt ?? stamp) : null } : s)),
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(shiftsKey, ctx.previous);
    },
    onSettled: () => void invalidateShifts(),
  });

  const staff = useMemo<Staff[]>(() => staffQuery.data ?? [], [staffQuery.data]);
  const shifts = useMemo<Shift[]>(() => shiftsQuery.data ?? [], [shiftsQuery.data]);
  const staffById = useMemo<Map<string, Staff>>(() => new Map(staff.map((s) => [s.id, s])), [staff]);

  return {
    isAdmin,
    staff,
    staffById,
    shifts,
    members: membersQuery.data ?? [],
    isLoading: (staffQuery.isPending && !staffQuery.data) || (shiftsQuery.isPending && !shiftsQuery.data),
    error: (!staffQuery.data ? staffQuery.error : null) ?? (!shiftsQuery.data ? shiftsQuery.error : null) ?? null,
    isFetching: shiftsQuery.isFetching,
    refetch: () => {
      void staffQuery.refetch();
      void shiftsQuery.refetch();
    },
    addStaff,
    updateStaff,
    deleteStaff,
    addShifts,
    updateShift,
    deleteShift,
    setPaid,
  };
};

export type ScheduleApi = ReturnType<typeof useSchedule>;
