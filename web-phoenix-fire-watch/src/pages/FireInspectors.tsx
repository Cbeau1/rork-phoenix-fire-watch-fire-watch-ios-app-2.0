import { Building2, Mail, MapPin, Pencil, Phone, Plus, Search, Smartphone, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { InspectorFormDialog } from "@/components/fw/InspectorFormDialog";
import { Card, EmptyState, PageHeader } from "@/components/fw/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog, ErrorBlock, Loading } from "@/components/workforce/kit";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useDeleteInspector, useInspectors, type FireInspector } from "@/lib/inspectors";
import { friendlyError } from "@/lib/supabase";
import { useAuth } from "@/state/AuthProvider";
import { useFireWatch } from "@/state/FireWatchProvider";

const telHref = (s: string) => `tel:${s.replace(/[^\d+]/g, "")}`;

const FireInspectors = () => {
  useDocumentTitle("Fire Inspectors");
  const { isAdmin } = useAuth();
  const { properties } = useFireWatch();
  const { data, isLoading, error, refetch } = useInspectors();
  const remove = useDeleteInspector();
  const [query, setQuery] = useState<string>("");
  const [form, setForm] = useState<{ open: boolean; inspector: FireInspector | null }>({ open: false, inspector: null });
  const [pendingDelete, setPendingDelete] = useState<FireInspector | null>(null);

  const assigned = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const p of properties) {
      if (!p.inspectorId) continue;
      m.set(p.inspectorId, [...(m.get(p.inspectorId) ?? []), p.name]);
    }
    return m;
  }, [properties]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = data ?? [];
    if (!q) return all;
    return all.filter((i) =>
      [i.name, i.title, i.department, i.jurisdiction, i.email, i.phone, i.mobile].some((v) => v.toLowerCase().includes(q)),
    );
  }, [data, query]);

  return (
    <>
      <PageHeader
        backTo="/properties"
        backLabel="Back to Properties"
        title="Fire Inspectors"
        subtitle="Inspector and fire marshal contacts for the jurisdictions you work in"
        actions={
          isAdmin && (
            <Button size="lg" onClick={() => setForm({ open: true, inspector: null })}>
              <Plus />
              Add inspector
            </Button>
          )
        }
      />

      {(data?.length ?? 0) > 0 && (
        <div className="relative mb-5 max-w-md">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, department, jurisdiction…"
            aria-label="Search inspectors"
            className="h-11 border-line-strong bg-field pl-10 text-ink"
          />
        </div>
      )}

      {isLoading ? (
        <Loading label="Loading inspectors…" />
      ) : error ? (
        <ErrorBlock message={friendlyError(error)} onRetry={() => void refetch()} />
      ) : list.length === 0 ? (
        <Card>
          <EmptyState
            title={(data?.length ?? 0) === 0 ? "No inspectors yet" : "No matches"}
            description={
              (data?.length ?? 0) === 0
                ? isAdmin
                  ? "Add the fire inspectors you deal with, then assign them to properties."
                  : "An admin can add the fire inspectors your team works with."
                : "Try a different name or department."
            }
            action={
              isAdmin && (data?.length ?? 0) === 0 ? (
                <Button size="lg" onClick={() => setForm({ open: true, inspector: null })}>
                  <Plus />
                  Add first inspector
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((i) => {
            const sites = assigned.get(i.id) ?? [];
            return (
              <li key={i.id} className="flex flex-col rounded-xl border border-line bg-surface p-5 shadow-card">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate font-display text-lg font-bold text-ink">{i.name}</h2>
                    {(i.title || i.department) && (
                      <p className="mt-0.5 truncate text-sm text-ink-2">{[i.title, i.department].filter(Boolean).join(" · ")}</p>
                    )}
                  </div>
                  {isAdmin && (
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        onClick={() => setForm({ open: true, inspector: i })}
                        aria-label={`Edit ${i.name}`}
                        className="focus-ring flex h-9 w-9 items-center justify-center rounded-lg text-ink-3 transition-colors hover:bg-raised hover:text-ink"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingDelete(i)}
                        aria-label={`Delete ${i.name}`}
                        className="focus-ring flex h-9 w-9 items-center justify-center rounded-lg text-ink-3 transition-colors hover:bg-raised hover:text-status-incident-ink"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>

                <div className="mt-4 space-y-2 text-sm">
                  {i.jurisdiction && (
                    <div className="flex items-center gap-2 text-ink-2">
                      <Building2 className="h-4 w-4 shrink-0 text-ink-3" />
                      <span className="truncate">{i.jurisdiction}</span>
                    </div>
                  )}
                  {i.phone && (
                    <a href={telHref(i.phone)} className="focus-ring flex items-center gap-2 rounded font-mono text-ink hover:text-link">
                      <Phone className="h-4 w-4 shrink-0 text-ink-3" />
                      {i.phone}
                    </a>
                  )}
                  {i.mobile && (
                    <a href={telHref(i.mobile)} className="focus-ring flex items-center gap-2 rounded font-mono text-ink hover:text-link">
                      <Smartphone className="h-4 w-4 shrink-0 text-ink-3" />
                      {i.mobile}
                    </a>
                  )}
                  {i.email && (
                    <a href={`mailto:${i.email}`} className="focus-ring flex min-w-0 items-center gap-2 rounded text-ink hover:text-link">
                      <Mail className="h-4 w-4 shrink-0 text-ink-3" />
                      <span className="truncate">{i.email}</span>
                    </a>
                  )}
                  {i.address && (
                    <div className="flex items-start gap-2 text-ink-2">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />
                      <span>{i.address}</span>
                    </div>
                  )}
                </div>

                {i.notes && <p className="mt-3 whitespace-pre-wrap rounded-lg bg-raised p-3 text-sm text-ink-2">{i.notes}</p>}

                <div className="mt-auto pt-4 text-xs text-ink-3">
                  {sites.length === 0
                    ? "Not assigned to any property"
                    : `Assigned to ${sites.length === 1 ? sites[0] : `${sites.length} properties`}`}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {isAdmin && (
        <InspectorFormDialog
          open={form.open}
          inspector={form.inspector}
          onClose={() => setForm({ open: false, inspector: null })}
        />
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(v) => !v && setPendingDelete(null)}
        title={`Remove ${pendingDelete?.name ?? "inspector"}?`}
        description={
          pendingDelete && (assigned.get(pendingDelete.id)?.length ?? 0) > 0
            ? "They'll be unassigned from their properties. The fire marshal contact already saved on those properties stays."
            : "They'll be removed from the directory."
        }
        confirmLabel="Remove"
        destructive
        busy={remove.isPending}
        onConfirm={() => {
          const target = pendingDelete;
          if (!target) return;
          remove.mutate(target.id, {
            onSuccess: () => {
              toast.success("Inspector removed");
              setPendingDelete(null);
            },
            onError: (e) => toast.error(friendlyError(e)),
          });
        }}
      />
    </>
  );
};

export default FireInspectors;
