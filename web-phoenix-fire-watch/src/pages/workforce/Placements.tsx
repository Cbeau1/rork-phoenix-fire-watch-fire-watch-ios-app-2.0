import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { PageHeader } from "@/components/fw/primitives";
import { Button } from "@/components/ui/button";
import { Empty, SelectField } from "@/components/workforce/kit";
import { PlacementCard, PlacementDialog } from "@/components/workforce/placements";
import { PLACEMENT_STATUS } from "@/lib/workforce/constants";
import { inDays, todayKey } from "@/lib/workforce/derive";
import { useWorkforce } from "@/state/WorkforceProvider";

const Placements = () => {
  const wf = useWorkforce();
  const [params, setParams] = useSearchParams();
  const [addOpen, setAddOpen] = useState<boolean>(false);
  const view = params.get("view") ?? "";
  const status = params.get("status") ?? (view ? "" : "open");
  const agency = params.get("agency") ?? "";
  const property = params.get("property") ?? "";
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    if (k !== "view") n.delete("view");
    setParams(n, { replace: true });
  };
  const list = useMemo(() => {
    const soon = inDays(wf.settings?.placement_end_days ?? 14);
    const today = todayKey();
    return wf.placements.filter((p) => {
      if (view === "ending") return (p.status === "active" || p.status === "pending") && !!p.end_date && p.end_date <= soon && p.end_date >= today;
      if (status === "open" && !(p.status === "active" || p.status === "pending")) return false;
      if (status && status !== "open" && p.status !== status) return false;
      if (agency && p.agency_id !== agency) return false;
      if (property && p.property_id !== property) return false;
      return true;
    });
  }, [wf.placements, wf.settings, view, status, agency, property]);

  return (
    <div>
      <PageHeader
        title={view === "ending" ? "Assignments ending soon" : "Agency placements"}
        subtitle={`${list.length} ${list.length === 1 ? "placement" : "placements"}`}
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <Plus />
            New placement
          </Button>
        }
      />
      <div className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-line bg-surface p-3 sm:grid-cols-3 sm:p-4">
        <SelectField
          label="Status"
          value={view === "ending" ? "ending" : status}
          onChange={(v) => (v === "ending" ? setParams({ view: "ending" }, { replace: true }) : set("status", v || "all"))}
          options={[
            { value: "open", label: "Pending & active" },
            { value: "ending", label: "Ending soon" },
            { value: "all", label: "All placements" },
            ...Object.entries(PLACEMENT_STATUS).map(([value, m]) => ({ value, label: m.label })),
          ]}
        />
        <SelectField label="Agency" value={agency} onChange={(v) => set("agency", v)} allowNone noneLabel="All agencies" options={wf.agencies.map((a) => ({ value: a.id, label: a.name }))} />
        <SelectField label="Property" value={property} onChange={(v) => set("property", v)} allowNone noneLabel="All properties" options={wf.properties.map((p) => ({ value: p.id, label: p.name }))} />
      </div>
      {list.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface p-4">
          <Empty title="No placements match" />
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((p) => (
            <PlacementCard key={p.id} placement={p} showWorker />
          ))}
        </div>
      )}
      <PlacementDialog open={addOpen} onOpenChange={setAddOpen} placement={null} />
    </div>
  );
};

export default Placements;
