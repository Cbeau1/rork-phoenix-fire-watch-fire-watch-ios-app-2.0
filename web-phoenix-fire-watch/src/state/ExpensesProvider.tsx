import createContextHook from "@nkzw/create-context-hook";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import * as api from "@/lib/expenses/api";
import { buildIndex } from "@/lib/expenses/derive";
import { supabase } from "@/lib/supabase";
import { wfError } from "@/lib/workforce/api";

import { useAuth } from "./AuthProvider";
import { useFireWatch } from "./FireWatchProvider";

const EMPTY: api.ExData = {
  expenditures: [],
  categories: [],
  reimbursements: [],
  payments: [],
  allocations: [],
  reversals: [],
  attachments: [],
  shiftLinks: [],
};

/**
 * Server-verified Expenditures access. Financial data lives only in memory under "ex" keys
 * (never in the offline cache — see PERSISTED_KEYS) and is cleared on sign-out.
 */
export const useExAccess = () => {
  const { user, isAdmin, online } = useAuth();
  return useQuery({
    queryKey: ["ex", "access", user?.id ?? ""],
    enabled: !!user && isAdmin && online,
    staleTime: 60_000,
    retry: 1,
    queryFn: api.checkAccess,
  });
};

const loadMembers = async () => {
  const { data, error } = await supabase.from("profiles").select("id, full_name").limit(1000);
  if (error) throw wfError(error);
  return data ?? [];
};

export const [ExpensesProvider, useExpenses] = createContextHook(() => {
  const { user } = useAuth();
  const { properties, propertyById } = useFireWatch();
  const qc = useQueryClient();
  const orgId = user?.orgId ?? "";

  const dataQ = useQuery({ queryKey: ["ex", "data", orgId], enabled: !!orgId, staleTime: 15_000, retry: 1, queryFn: api.loadAll });
  const lookQ = useQuery({ queryKey: ["ex", "lookups", orgId], enabled: !!orgId, staleTime: 60_000, retry: 1, queryFn: api.loadLookups });
  const membersQ = useQuery({ queryKey: ["ex", "members", orgId], enabled: !!orgId, staleTime: 120_000, queryFn: loadMembers });

  const data = dataQ.data ?? EMPTY;
  const index = useMemo(() => buildIndex(data), [data]);
  const lookups = useMemo<api.Lookups>(() => lookQ.data ?? { agencies: [], workers: [], placements: [], invoices: [] }, [lookQ.data]);

  const maps = useMemo(
    () => ({
      workerById: new Map(lookups.workers.map((w) => [w.id, w])),
      agencyById: new Map(lookups.agencies.map((a) => [a.id, a])),
      placementById: new Map(lookups.placements.map((p) => [p.id, p])),
      invoiceById: new Map(lookups.invoices.map((i) => [i.id, i])),
      memberById: new Map((membersQ.data ?? []).map((m) => [m.id, m.full_name])),
    }),
    [lookups, membersQ.data],
  );

  const propertyName = useCallback((id: string | null | undefined) => (id ? (propertyById.get(id)?.name ?? "Removed property") : ""), [propertyById]);
  const memberName = useCallback((id: string | null | undefined) => (id ? (maps.memberById.get(id) ?? "Former member") : "—"), [maps]);

  const invalidate = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["ex", "data"] });
    void qc.invalidateQueries({ queryKey: ["ex", "history"] });
  }, [qc]);

  const categories = useMemo(() => [...data.categories].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)), [data.categories]);

  return {
    user,
    orgId,
    loading: dataQ.isLoading,
    error: dataQ.error ?? null,
    retry: () => void dataQ.refetch(),
    data,
    index,
    categories,
    activeCategories: categories.filter((c) => c.active),
    lookups,
    lookupsLoading: lookQ.isLoading,
    properties,
    propertyById,
    propertyName,
    memberName,
    ...maps,
    invalidate,
  };
});

export type ExpensesApi = ReturnType<typeof useExpenses>;
