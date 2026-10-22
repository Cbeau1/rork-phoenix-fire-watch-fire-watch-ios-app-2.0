import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { Database } from "@/integrations/supabase/types";
import { supabase } from "@/lib/supabase";

export type FireInspector = Database["public"]["Tables"]["fire_inspectors"]["Row"];

export interface InspectorInput {
  name: string;
  title: string;
  department: string;
  jurisdiction: string;
  phone: string;
  mobile: string;
  email: string;
  address: string;
  notes: string;
}

export const EMPTY_INSPECTOR: InspectorInput = {
  name: "",
  title: "",
  department: "",
  jurisdiction: "",
  phone: "",
  mobile: "",
  email: "",
  address: "",
  notes: "",
};

export const INSPECTORS_KEY = ["fire-inspectors"] as const;

const clean = (i: InspectorInput): InspectorInput => ({
  name: i.name.trim(),
  title: i.title.trim(),
  department: i.department.trim(),
  jurisdiction: i.jurisdiction.trim(),
  phone: i.phone.trim(),
  mobile: i.mobile.trim(),
  email: i.email.trim().toLowerCase(),
  address: i.address.trim(),
  notes: i.notes.trim(),
});

export const useInspectors = () =>
  useQuery({
    queryKey: INSPECTORS_KEY,
    queryFn: async (): Promise<FireInspector[]> => {
      const { data, error } = await supabase.from("fire_inspectors").select("*").order("name");
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 60_000,
  });

export const useSaveInspector = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id?: string; input: InspectorInput }): Promise<FireInspector> => {
      const row = clean(input);
      const q = id
        ? supabase.from("fire_inspectors").update(row).eq("id", id).select("*").single()
        : supabase.from("fire_inspectors").insert(row).select("*").single();
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
    onSuccess: (saved) => {
      qc.setQueryData<FireInspector[]>(INSPECTORS_KEY, (old) => {
        const list = (old ?? []).filter((i) => i.id !== saved.id);
        return [...list, saved].sort((a, b) => a.name.localeCompare(b.name));
      });
    },
  });
};

export const useDeleteInspector = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("fire_inspectors").delete().eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => qc.setQueryData<FireInspector[]>(INSPECTORS_KEY, (old) => (old ?? []).filter((i) => i.id !== id)),
  });
};

export const toInput = (i: FireInspector): InspectorInput => ({
  name: i.name,
  title: i.title,
  department: i.department,
  jurisdiction: i.jurisdiction,
  phone: i.phone,
  mobile: i.mobile,
  email: i.email,
  address: i.address,
  notes: i.notes,
});

export const isEmail = (s: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
