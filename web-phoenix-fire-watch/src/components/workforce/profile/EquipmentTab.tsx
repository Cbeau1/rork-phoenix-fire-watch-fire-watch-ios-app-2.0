import { useMutation } from "@tanstack/react-query";
import { Pencil, Plus, Undo2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  AreaField,
  Empty,
  fmtDate,
  FormDialog,
  isDate,
  MetaPill,
  Pill,
  SectionCard,
  SelectField,
  TextField,
} from "@/components/workforce/kit";
import * as api from "@/lib/workforce/api";
import { EQUIP_STATUS, EQUIP_TYPE, OWNERSHIP, type Equipment, type Worker } from "@/lib/workforce/constants";
import { awaitingReturn, todayKey } from "@/lib/workforce/derive";
import { useWorkforce } from "@/state/WorkforceProvider";

const EquipmentDialog = ({
  open,
  onOpenChange,
  worker,
  item,
  returning,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  worker: Worker;
  item: Equipment | null;
  returning?: boolean;
}) => {
  const wf = useWorkforce();
  const init = useMemo(
    () => ({
      item_type: item?.item_type ?? "uniform",
      item_name: item?.item_name ?? "",
      asset_number: item?.asset_number ?? "",
      quantity: String(item?.quantity ?? 1),
      ownership: item?.ownership ?? (worker.source === "agency" ? "pfw" : "pfw"),
      issued_on: item?.issued_on ?? todayKey(),
      issued_by: item?.issued_by ?? wf.user?.id ?? "",
      condition_issued: item?.condition_issued ?? "",
      returned_on: item?.returned_on ?? (returning ? todayKey() : ""),
      condition_returned: item?.condition_returned ?? "",
      status: returning ? "returned" : (item?.status ?? "issued"),
      placement_id: item?.placement_id ?? "",
      notes: item?.notes ?? "",
    }),
    [item, returning, worker.source, wf.user],
  );
  const [d, setD] = useState(init);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (open) {
      setD(init);
      setErrors({});
    }
  }, [open, init]);
  const save = useMutation({
    mutationFn: () =>
      api.saveEquipment(item?.id ?? null, {
        org_id: wf.orgId,
        worker_id: worker.id,
        placement_id: d.placement_id || null,
        item_type: d.item_type,
        item_name: d.item_name.trim(),
        asset_number: d.asset_number.trim(),
        quantity: Number(d.quantity),
        ownership: d.ownership,
        issued_on: d.issued_on || null,
        issued_by: d.issued_by || null,
        condition_issued: d.condition_issued.trim(),
        returned_on: d.status === "returned" ? d.returned_on || todayKey() : d.returned_on || null,
        condition_returned: d.condition_returned.trim(),
        status: d.status,
        notes: d.notes.trim(),
      }),
    onSuccess: () => {
      wf.invalidate("equipment");
      toast.success(returning ? "Return recorded" : item ? "Equipment updated" : "Equipment issued");
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save."),
  });
  const placements = wf.placements.filter((p) => p.worker_id === worker.id);
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={returning ? `Return — ${item?.item_name}` : item ? "Edit equipment" : "Issue equipment"}
      dirty={JSON.stringify(d) !== JSON.stringify(init)}
      saving={save.isPending}
      onSubmit={() => {
        const e: Record<string, string> = {};
        if (!d.item_name.trim()) e.item_name = "Item name is required.";
        const q = Number(d.quantity);
        if (!Number.isInteger(q) || q < 1) e.quantity = "Whole number, 1 or more.";
        if (d.issued_on && !isDate(d.issued_on)) e.issued_on = "Use a valid date.";
        if (d.status === "returned" && !isDate(d.returned_on)) e.returned_on = "Return date is required.";
        if (d.returned_on && d.issued_on && d.returned_on < d.issued_on) e.returned_on = "Can't be before the issue date.";
        setErrors(e);
        if (Object.keys(e).length === 0) save.mutate();
      }}
      wide
    >
      {!returning && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SelectField label="Type" required value={d.item_type} onChange={(v) => setD({ ...d, item_type: v })} options={Object.entries(EQUIP_TYPE).map(([value, label]) => ({ value, label }))} />
          <TextField label="Item name" required value={d.item_name} onChange={(v) => setD({ ...d, item_name: v })} error={errors.item_name} placeholder="e.g. Hi-vis vest" />
          <TextField label="Asset / serial number" value={d.asset_number} onChange={(v) => setD({ ...d, asset_number: v })} />
          <TextField label="Quantity" required inputMode="numeric" value={d.quantity} onChange={(v) => setD({ ...d, quantity: v })} error={errors.quantity} />
          <SelectField label="Ownership" required value={d.ownership} onChange={(v) => setD({ ...d, ownership: v })} options={Object.entries(OWNERSHIP).map(([value, label]) => ({ value, label }))} />
          <TextField label="Issue date" type="date" value={d.issued_on} onChange={(v) => setD({ ...d, issued_on: v })} error={errors.issued_on} />
          <SelectField label="Issuing administrator" value={d.issued_by} onChange={(v) => setD({ ...d, issued_by: v })} allowNone noneLabel="Not recorded" options={wf.admins.map((m) => ({ value: m.id, label: m.full_name }))} />
          {placements.length > 0 && (
            <SelectField
              label="For placement"
              value={d.placement_id}
              onChange={(v) => setD({ ...d, placement_id: v })}
              allowNone
              noneLabel="Not tied to a placement"
              options={placements.map((p) => ({ value: p.id, label: `${p.property_name || "Placement"} · ${fmtDate(p.start_date)}` }))}
            />
          )}
          <TextField label="Condition when issued" value={d.condition_issued} onChange={(v) => setD({ ...d, condition_issued: v })} className="sm:col-span-2" />
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SelectField label="Status" required value={d.status} onChange={(v) => setD({ ...d, status: v })} options={Object.entries(EQUIP_STATUS).map(([value, m]) => ({ value, label: m.label }))} />
        <TextField label="Return date" type="date" value={d.returned_on} onChange={(v) => setD({ ...d, returned_on: v })} error={errors.returned_on} />
        <TextField label="Condition when returned" value={d.condition_returned} onChange={(v) => setD({ ...d, condition_returned: v })} className="sm:col-span-2" />
      </div>
      <AreaField label="Notes" value={d.notes} onChange={(v) => setD({ ...d, notes: v })} rows={2} />
    </FormDialog>
  );
};

export const EquipmentTab = ({ worker }: { worker: Worker }) => {
  const wf = useWorkforce();
  const [edit, setEdit] = useState<{ item: Equipment | null; returning?: boolean } | null>(null);
  const items = wf.equipment.filter((e) => e.worker_id === worker.id);
  const awaiting = useMemo(() => new Set(awaitingReturn(wf.equipment, wf.workers, wf.placements).map((e) => e.id)), [wf.equipment, wf.workers, wf.placements]);
  const outstanding = items.filter((e) => e.status === "issued");
  return (
    <SectionCard
      title="Equipment"
      subtitle={outstanding.length > 0 ? `${outstanding.length} item(s) currently issued` : "Nothing currently issued"}
      action={
        <Button size="sm" onClick={() => setEdit({ item: null })} disabled={!!worker.archived_at}>
          <Plus />
          Issue item
        </Button>
      }
    >
      {items.length === 0 ? (
        <Empty title="No equipment issued" description="Track uniforms, badges, radios, keys and other equipment." />
      ) : (
        <ul className="space-y-2">
          {items.map((e) => (
            <li key={e.id} className="rounded-lg border border-line bg-raised px-4 py-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">
                      {e.item_name}
                      {e.quantity > 1 && ` × ${e.quantity}`}
                    </span>
                    <MetaPill meta={EQUIP_STATUS} value={e.status} />
                    {awaiting.has(e.id) && <Pill tone="red">Awaiting return</Pill>}
                  </div>
                  <div className="mt-1 text-xs text-ink-3">
                    {EQUIP_TYPE[e.item_type]} · {OWNERSHIP[e.ownership]}
                    {e.asset_number && <> · #{e.asset_number}</>}
                  </div>
                  <div className="mt-1 text-xs text-ink-2">
                    Issued {fmtDate(e.issued_on)} by {wf.memberName(e.issued_by)}
                    {e.condition_issued && <> · {e.condition_issued}</>}
                    {e.returned_on && (
                      <>
                        {" "}
                        · Returned {fmtDate(e.returned_on)}
                        {e.condition_returned && <> ({e.condition_returned})</>}
                      </>
                    )}
                  </div>
                  {e.notes && <p className="mt-1 text-xs text-ink-2">{e.notes}</p>}
                </div>
                <div className="flex shrink-0 gap-1">
                  {e.status === "issued" && (
                    <Button size="sm" variant="outline" onClick={() => setEdit({ item: e, returning: true })}>
                      <Undo2 />
                      Return
                    </Button>
                  )}
                  <Button size="icon" variant="ghost" aria-label={`Edit ${e.item_name}`} onClick={() => setEdit({ item: e })}>
                    <Pencil />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <EquipmentDialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)} worker={worker} item={edit?.item ?? null} returning={edit?.returning} />
    </SectionCard>
  );
};
