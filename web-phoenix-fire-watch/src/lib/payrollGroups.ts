import { supabase } from "@/lib/supabase";
import type { PayEstimate, PersonSummary } from "@/lib/timeclock";

export type PayGroup = "direct" | "agency";

export interface PersonType {
  group: PayGroup;
  /** Agency name for agency-placed workers; empty for direct staff. */
  agency: string;
}

export interface WorkerTypeIndex {
  byProfile: Map<string, PersonType>;
  byName: Map<string, PersonType>;
}

const nameKey = (n: string) => n.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Loads each Workforce worker's employment type (direct vs. temp agency) so Payroll can split gross pay.
 * Fails soft: if Workforce isn't set up or readable, everyone is treated as direct staff.
 */
export const loadWorkerTypes = async (): Promise<WorkerTypeIndex> => {
  const byProfile = new Map<string, PersonType>();
  const byName = new Map<string, PersonType>();
  const [w, a] = await Promise.all([
    supabase.from("wf_workers").select("profile_id, first_name, last_name, source, agency_id, archived_at"),
    supabase.from("wf_agencies").select("id, name"),
  ]);
  if (w.error) {
    console.warn("[payroll] worker types unavailable:", w.error.message);
    return { byProfile, byName };
  }
  const agencyName = new Map<string, string>((a.data ?? []).map((r) => [r.id, r.name]));
  // Active profiles win over archived ones when two share a name.
  const rows = [...(w.data ?? [])].sort((x, y) => Number(!!y.archived_at) - Number(!!x.archived_at));
  for (const r of rows) {
    const t: PersonType =
      r.source === "agency" ? { group: "agency", agency: (r.agency_id && agencyName.get(r.agency_id)) || "" } : { group: "direct", agency: "" };
    if (r.profile_id) byProfile.set(r.profile_id, t);
    byName.set(nameKey(`${r.first_name} ${r.last_name}`), t);
  }
  return { byProfile, byName };
};

const DIRECT: PersonType = { group: "direct", agency: "" };

/** Classifies a payroll row; team members without a Workforce profile count as direct staff. */
export const personType = (idx: WorkerTypeIndex | undefined, p: Pick<PersonSummary, "profileId" | "name">): PersonType => {
  if (!idx) return DIRECT;
  return (p.profileId ? idx.byProfile.get(p.profileId) : undefined) ?? idx.byName.get(nameKey(p.name)) ?? DIRECT;
};

export const GROUP_LABEL: Record<PayGroup, string> = { direct: "Direct staff", agency: "Temp agency workers" };

export interface GroupTotals {
  group: PayGroup;
  people: PersonSummary[];
  approvedMin: number;
  regularMin: number;
  overMin: number;
  pendingMin: number;
  grossCents: number;
}

/** Splits payroll rows into direct staff and agency workers with per-group subtotals (empty groups omitted). */
export const groupPeople = (people: PersonSummary[], typeOf: (p: PersonSummary) => PersonType, pay: Map<string, PayEstimate>): GroupTotals[] =>
  (["direct", "agency"] as PayGroup[])
    .map((group) => {
      const ps = people.filter((p) => typeOf(p).group === group);
      return {
        group,
        people: ps,
        approvedMin: ps.reduce((s, p) => s + p.approvedMin, 0),
        regularMin: ps.reduce((s, p) => s + p.regularMin, 0),
        overMin: ps.reduce((s, p) => s + p.overMin, 0),
        pendingMin: ps.reduce((s, p) => s + p.pendingMin, 0),
        grossCents: ps.reduce((s, p) => s + (pay.get(p.key)?.grossCents ?? 0), 0),
      };
    })
    .filter((g) => g.people.length > 0);
