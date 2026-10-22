import { useMutation, useQuery } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/fw/primitives";
import { Button } from "@/components/ui/button";
import { CheckField, ErrorBlock, FormDialog, Loading, Pill, SectionCard, SelectField, TextField } from "@/components/workforce/kit";
import * as api from "@/lib/expenses/api";
import { CATEGORY_KIND, type Category } from "@/lib/expenses/constants";
import { fmtTotals, addTo, type Totals } from "@/lib/expenses/money";
import { useExpenses } from "@/state/ExpensesProvider";

import { HistoryList } from "./ExDetail";

const CategoryDialog = ({ open, onOpenChange, category }: { open: boolean; onOpenChange: (v: boolean) => void; category: Category | null }) => {
  const ex = useExpenses();
  const init = { name: category?.name ?? "", kind: category?.kind ?? "general", active: category?.active ?? true };
  const [d, setD] = useState(init);
  const [err, setErr] = useState<string>("");
  useEffect(() => {
    if (open) {
      setD({ name: category?.name ?? "", kind: category?.kind ?? "general", active: category?.active ?? true });
      setErr("");
    }
  }, [open, category]);
  const save = useMutation({
    mutationFn: () =>
      api.saveCategory(category?.id ?? null, d.name.trim(), d.kind, d.active, category?.sort ?? Math.max(0, ...ex.categories.map((c) => c.sort)) + 1),
    onSuccess: () => {
      ex.invalidate();
      toast.success(category ? "Category saved" : "Category added");
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save."),
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={category ? "Edit category" : "Add category"}
      dirty={JSON.stringify(d) !== JSON.stringify(init)}
      saving={save.isPending}
      onSubmit={() => {
        if (!d.name.trim()) {
          setErr("Name is required.");
          return;
        }
        save.mutate();
      }}
    >
      <TextField label="Name" required value={d.name} onChange={(v) => setD((p) => ({ ...p, name: v }))} error={err} maxLength={80} />
      <SelectField
        label="Linking behavior"
        value={d.kind}
        onChange={(v) => setD((p) => ({ ...p, kind: v }))}
        options={Object.entries(CATEGORY_KIND).map(([value, label]) => ({ value, label }))}
        hint="Payroll categories link existing schedule shifts; agency categories link existing agency invoices — so the same cost isn't entered twice."
      />
      <CheckField label="Active" hint="Inactive categories stay on past records but can't be chosen for new ones." checked={d.active} onChange={(v) => setD((p) => ({ ...p, active: v }))} />
    </FormDialog>
  );
};

const ExSettings = () => {
  const ex = useExpenses();
  const [edit, setEdit] = useState<Category | null>(null);
  const [addOpen, setAddOpen] = useState<boolean>(false);
  const history = useQuery({ queryKey: ["ex", "history", "org"], queryFn: () => api.loadHistory({ limit: 300 }) });
  const usage = new Map<string, { count: number; totals: Totals }>();
  for (const r of ex.index.rows) {
    if (r.e.archived_at) continue;
    const u = usage.get(r.e.category_id) ?? { count: 0, totals: {} };
    u.count++;
    addTo(u.totals, r.e.currency, r.amount);
    usage.set(r.e.category_id, u);
  }

  return (
    <div>
      <PageHeader title="Categories & history" subtitle="Categories organize records only. They never label an expense as tax-deductible." />
      <div className="space-y-5">
        <SectionCard
          title="Expense categories"
          action={
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus />
              Add category
            </Button>
          }
        >
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {ex.categories.map((c) => {
              const u = usage.get(c.id);
              return (
                <li key={c.id} className="flex items-center gap-3 rounded-lg border border-line bg-raised px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink">{c.name}</span>
                      {c.kind !== "general" && <Pill tone="blue">{c.kind === "payroll" ? "Links shifts" : "Links agency invoices & shifts"}</Pill>}
                      {!c.active && <Pill tone="slate">Inactive</Pill>}
                    </div>
                    <div className="text-xs text-ink-3">{u ? `${u.count} record${u.count === 1 ? "" : "s"} · ${fmtTotals(u.totals)}` : "Not used yet"}</div>
                  </div>
                  <Button variant="ghost" size="icon" aria-label={`Edit ${c.name}`} onClick={() => setEdit(c)}>
                    <Pencil />
                  </Button>
                </li>
              );
            })}
          </ul>
        </SectionCard>

        <SectionCard title="Activity history" subtitle="Append-only log of every change, approval, payment, correction, file download and export (latest 300).">
          {history.isLoading ? <Loading /> : history.error ? <ErrorBlock message={(history.error as Error).message} onRetry={() => void history.refetch()} /> : <HistoryList entries={history.data ?? []} />}
        </SectionCard>

        <SectionCard title="Access & data handling">
          <div className="space-y-2 text-sm text-ink-2">
            <p className="rounded-lg border border-line bg-raised px-4 py-3">
              <span className="font-medium text-ink">Who can see this:</span> only active admins with the <em>Expenditures</em> permission (Workforce settings →
              Permissions). It's enforced by the database and file server, not just hidden menus. Officers and the mobile apps never receive this data.
            </p>
            <p className="rounded-lg border border-line bg-raised px-4 py-3">
              <span className="font-medium text-ink">Receipts</span> are stored privately and opened only through 60-second links. Records are archived, never routinely
              deleted, and payments are corrected by reversal so the original stays in the history.
            </p>
            <p className="rounded-lg border border-line bg-raised px-4 py-3">
              <span className="font-medium text-ink">No payments are sent.</span> This module records spending and reimbursements that happened elsewhere. Receipts
              are entered manually — there's no automatic receipt reading.
            </p>
          </div>
        </SectionCard>
      </div>
      <CategoryDialog open={addOpen || !!edit} onOpenChange={(o) => { if (!o) { setAddOpen(false); setEdit(null); } }} category={edit} />
    </div>
  );
};

export default ExSettings;
