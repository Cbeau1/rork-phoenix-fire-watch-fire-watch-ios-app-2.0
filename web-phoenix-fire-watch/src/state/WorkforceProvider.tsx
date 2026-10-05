import createContextHook from "@nkzw/create-context-hook";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import * as api from "@/lib/workforce/api";
import { NO_PERMS, type WfPerms } from "@/lib/workforce/constants";
import type { ShiftRow } from "@/lib/workforce/derive";
import { supabase } from "@/lib/supabase";

import { useAuth } from "./AuthProvider";
import { useFireWatch } from "./FireWatchProvider";

/**
 * Workforce data is never persisted to the offline cache (keys start with "wf" — not in PERSISTED_KEYS)
 * and is cleared from memory on sign-out.
 */
export const useWfPerms = () => {
  const { user, isAdmin } = useAuth();
  return useQuery({
    queryKey: ["wf", "perms", user?.id ?? ""],
    enabled: !!user && isAdmin,
    staleTime: 60_000,
    retry: 1,
    queryFn: api.loadPermissions,
  });
};

const useWfQuery = <T,>(key: string, orgId: string, enabled: boolean, fn: () => Promise<T>) =>
  useQuery({ queryKey: ["wf", key, orgId], enabled: enabled && !!orgId, staleTime: 20_000, retry: 1, queryFn: fn });

const loadShifts = async (): Promise<ShiftRow[]> => {
  const { data, error } = await supabase
    .from("shifts")
    .select("id, staff_id, property_id, shift_date, start_time, end_time, notes, shift_payments(paid_at)")
    .order("shift_date", { ascending: false })
    .limit(5000);
  if (error) throw api.wfError(error);
  return (data ?? []).map((r) => {
    const raw = r.shift_payments as unknown;
    const paid = Array.isArray(raw) ? raw.length > 0 : !!raw;
    return {
      id: r.id,
      staff_id: r.staff_id,
      property_id: r.property_id,
      shift_date: r.shift_date,
      start_time: r.start_time,
      end_time: r.end_time,
      notes: r.notes,
      paid,
    };
  });
};

export const [WorkforceProvider, useWorkforce] = createContextHook(() => {
  const { user } = useAuth();
  const { properties, patrols, propertyById } = useFireWatch();
  const qc = useQueryClient();
  const orgId = user?.orgId ?? "";
  const permsQ = useWfPerms();
  const perms: WfPerms = permsQ.data ?? NO_PERMS;
  const on = perms.manage;

  const workers = useWfQuery("workers", orgId, on, api.listWorkers);
  const agencies = useWfQuery("agencies", orgId, on, api.listAgencies);
  const placements = useWfQuery("placements", orgId, on, api.listPlacements);
  const rates = useWfQuery("rates", orgId, on && perms.finance, api.listPlacementRates);
  const hours = useWfQuery("hours", orgId, on, api.listHours);
  const checklist = useWfQuery("checklist", orgId, on, api.listChecklist);
  const templates = useWfQuery("templates", orgId, on, api.listTemplates);
  const equipment = useWfQuery("equipment", orgId, on, api.listEquipment);
  const documents = useWfQuery("documents", orgId, on, api.listDocuments);
  const versions = useWfQuery("versions", orgId, on, api.listVersions);
  const invoices = useWfQuery("invoices", orgId, on && perms.finance, api.listInvoices);
  const lines = useWfQuery("lines", orgId, on && perms.finance, api.listInvoiceLines);
  const followups = useWfQuery("followups", orgId, on && perms.personnel, api.listFollowups);
  const members = useWfQuery("members", orgId, on, api.listMembers);
  const staff = useWfQuery("staff", orgId, on, api.listStaff);
  const shifts = useWfQuery("shifts", orgId, on, loadShifts);
  const settings = useWfQuery("settings", orgId, on, api.getSettings);
  const reminders = useWfQuery("reminders", orgId, on, api.refreshReminders);

  const invalidate = useCallback(
    (...keys: string[]) => {
      const list = keys.length > 0 ? keys : ["workers"];
      for (const k of list) void qc.invalidateQueries({ queryKey: ["wf", k] });
      // Most changes can open or clear a reminder.
      if (!list.includes("reminders")) void qc.invalidateQueries({ queryKey: ["wf", "reminders"] });
      void qc.invalidateQueries({ queryKey: ["wf", "audit"] });
    },
    [qc],
  );

  const workerList = useMemo(() => workers.data ?? [], [workers.data]);
  const agencyList = useMemo(() => agencies.data ?? [], [agencies.data]);
  const placementList = useMemo(() => placements.data ?? [], [placements.data]);
  const memberList = useMemo(() => members.data ?? [], [members.data]);
  const staffList = useMemo(() => staff.data ?? [], [staff.data]);

  const maps = useMemo(
    () => ({
      workerById: new Map(workerList.map((w) => [w.id, w])),
      agencyById: new Map(agencyList.map((a) => [a.id, a])),
      placementById: new Map(placementList.map((p) => [p.id, p])),
      memberById: new Map(memberList.map((m) => [m.id, m])),
      staffById: new Map(staffList.map((s) => [s.id, s])),
    }),
    [workerList, agencyList, placementList, memberList, staffList],
  );

  const memberName = useCallback((id: string | null | undefined) => (id ? (maps.memberById.get(id)?.full_name ?? "Former member") : "—"), [maps]);

  const coreLoading = permsQ.isLoading || (on && (workers.isLoading || agencies.isLoading || placements.isLoading));
  const coreError = permsQ.error ?? workers.error ?? agencies.error ?? placements.error ?? null;

  return {
    user,
    orgId,
    perms,
    permsLoading: permsQ.isLoading,
    coreLoading,
    coreError,
    retry: () => {
      void permsQ.refetch();
      invalidate("workers", "agencies", "placements");
    },
    properties,
    propertyById,
    patrols,
    workers: workerList,
    agencies: agencyList,
    placements: placementList,
    rates: rates.data ?? [],
    hours: hours.data ?? [],
    checklist: checklist.data ?? [],
    templates: templates.data ?? [],
    equipment: equipment.data ?? [],
    documents: documents.data ?? [],
    versions: versions.data ?? [],
    invoices: invoices.data ?? [],
    lines: lines.data ?? [],
    followups: followups.data ?? [],
    members: memberList,
    admins: memberList.filter((m) => m.role === "admin" && m.active),
    staff: staffList,
    shifts: shifts.data ?? [],
    settings: settings.data ?? null,
    reminders: reminders.data ?? [],
    remindersLoading: reminders.isLoading,
    ...maps,
    memberName,
    invalidate,
  };
});

export type WorkforceApi = ReturnType<typeof useWorkforce>;
