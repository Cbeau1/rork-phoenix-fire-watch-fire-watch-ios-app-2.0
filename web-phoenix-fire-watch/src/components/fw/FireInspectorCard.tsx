import { BadgeCheck, Mail, Phone, Plus, Smartphone } from "lucide-react";
import { memo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { SelectField } from "@/components/workforce/kit";
import { Button } from "@/components/ui/button";
import { useInspectors } from "@/lib/inspectors";
import { friendlyError } from "@/lib/supabase";
import type { Property } from "@/lib/types";
import { useFireWatch } from "@/state/FireWatchProvider";

import { InspectorFormDialog } from "./InspectorFormDialog";

const telHref = (s: string) => `tel:${s.replace(/[^\d+]/g, "")}`;

/** The fire inspector responsible for this property, picked from the directory. */
export const FireInspectorCard = memo(({ property, isAdmin }: { property: Property; isAdmin: boolean }) => {
  const { data: inspectors = [], isLoading } = useInspectors();
  const { setPropertyInspector } = useFireWatch();
  const [saving, setSaving] = useState<boolean>(false);
  const [adding, setAdding] = useState<boolean>(false);
  const current = inspectors.find((i) => i.id === property.inspectorId) ?? null;

  if (!isAdmin && !current) return null;

  const assign = async (id: string | null) => {
    setSaving(true);
    try {
      await setPropertyInspector(property.id, id);
      toast.success(id ? "Inspector assigned" : "Inspector removed from property");
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mt-5 rounded-xl border border-line bg-surface p-6 shadow-card sm:p-7">
      <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <BadgeCheck className={current ? "mt-0.5 h-8 w-8 shrink-0 text-link" : "mt-0.5 h-8 w-8 shrink-0 text-ink-3"} strokeWidth={1.6} />
          <div className="min-w-0">
            <h2 className="font-display text-xl font-bold text-ink sm:text-[22px]">Fire Inspector</h2>
            {current ? (
              <>
                <p className="mt-1 text-[15px] font-medium text-ink">{current.name}</p>
                {(current.title || current.department || current.jurisdiction) && (
                  <p className="text-sm text-ink-2">
                    {[current.title, current.department, current.jurisdiction].filter(Boolean).join(" · ")}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
                  {current.phone && (
                    <a href={telHref(current.phone)} className="focus-ring inline-flex items-center gap-1.5 rounded font-mono text-ink hover:text-link">
                      <Phone className="h-4 w-4 text-ink-3" />
                      {current.phone}
                    </a>
                  )}
                  {current.mobile && (
                    <a href={telHref(current.mobile)} className="focus-ring inline-flex items-center gap-1.5 rounded font-mono text-ink hover:text-link">
                      <Smartphone className="h-4 w-4 text-ink-3" />
                      {current.mobile}
                    </a>
                  )}
                  {current.email && (
                    <a href={`mailto:${current.email}`} className="focus-ring inline-flex items-center gap-1.5 rounded text-ink hover:text-link">
                      <Mail className="h-4 w-4 text-ink-3" />
                      {current.email}
                    </a>
                  )}
                </div>
              </>
            ) : (
              <p className="mt-1 text-sm text-ink-2">
                No inspector assigned. Their contact fills the property's fire marshal details used in agreements.
              </p>
            )}
          </div>
        </div>

        {isAdmin && (
          <div className="flex w-full shrink-0 flex-col gap-2 md:w-72">
            <SelectField
              label="Assigned inspector"
              value={current?.id ?? ""}
              onChange={(v) => void assign(v || null)}
              options={inspectors.map((i) => ({
                value: i.id,
                label: i.jurisdiction ? `${i.name} — ${i.jurisdiction}` : i.name,
              }))}
              allowNone
              noneLabel="No inspector"
              placeholder={isLoading ? "Loading…" : "Choose an inspector"}
              disabled={saving || isLoading}
            />
            <div className="flex items-center justify-between gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(true)} className="-ml-2 text-link">
                <Plus />
                New inspector
              </Button>
              <Link to="/properties/inspectors" className="focus-ring rounded text-sm text-ink-2 hover:text-link">
                Directory
              </Link>
            </div>
          </div>
        )}
      </div>

      {isAdmin && (
        <InspectorFormDialog
          open={adding}
          inspector={null}
          onClose={() => setAdding(false)}
          onSaved={(saved) => void assign(saved.id)}
        />
      )}
    </section>
  );
});
FireInspectorCard.displayName = "FireInspectorCard";
