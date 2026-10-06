import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Copy, FileSpreadsheet, FileText, Filter, Plus, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { ExpenditureForm } from "@/components/expenses/ExpenditureForm";
import { DirectionBadge, ReceiptBadge } from "@/components/expenses/kit";
import { PageHeader } from "@/components/fw/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckField, Empty, fmtDate, Pill, SelectField, TextField } from "@/components/workforce/kit";
import * as api from "@/lib/expenses/api";
import { DIRECTION, METHOD, PAID_BY, REIMB_STATUS } from "@/lib/expenses/constants";
import { FILTER_KEYS, filterRows, payerLabel, readFilters, sortRows, type ExpRow, type Filters, type SortKey } from "@/lib/expenses/derive";
import { exportRecordsCsv, exportRecordsPdf } from "@/lib/expenses/exports";
import { addTo, fmtMoney, fmtTotals, type Totals } from "@/lib/expenses/money";
import { cn } from "@/lib/utils";
import { useExpenses } from "@/state/ExpensesProvider";

const PAGE = 25;

const SortHead = ({ k, label, sort, dir, onSort, className }: { k: SortKey; label: string; sort: SortKey; dir: "asc" | "desc"; onSort: (k: SortKey) => void; className?: string }) => (
  <th scope="col" className={cn("px-3 py-2.5 text-left font-medium", className)} aria-sort={sort === k ? (dir === "asc" ? "ascending" : "descending") : "none"}>
    <button type="button" className="focus-ring inline-flex items-center gap-1 rounded hover:text-ink" onClick={() => onSort(k)}>
      {label}
      {sort === k && (dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
    </button>
  </th>
);

const ExRecords = () => {
  const ex = useExpenses();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const f = readFilters(params);
  const [showFilters, setShowFilters] = useState<boolean>(() => FILTER_KEYS.some((k) => k !== "q" && params.has(k)));
  const [addOpen, setAddOpen] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const sort = (params.get("sort") as SortKey) || "date";
  const dir = (params.get("dir") as "asc" | "desc") || "desc";
  const page = Math.max(1, Number(params.get("page") ?? "1") || 1);

  const setF = (k: keyof Filters | "sort" | "dir" | "page", v: string | boolean) => {
    const n = new URLSearchParams(params);
    const s = typeof v === "boolean" ? (v ? "1" : "") : v;
    if (s) n.set(k, s);
    else n.delete(k);
    if (k !== "page") n.delete("page");
    setParams(n, { replace: true });
  };
  const onSort = (k: SortKey) => {
    const n = new URLSearchParams(params);
    n.set("sort", k);
    n.set("dir", sort === k && dir === "desc" ? "asc" : "desc");
    n.delete("page");
    setParams(n, { replace: true });
  };

  const rows = useMemo(() => sortRows(filterRows(ex.index.rows, f, ex.propertyName), sort, dir), [ex.index.rows, params.toString(), ex.propertyName]); // eslint-disable-line react-hooks/exhaustive-deps
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const cur = Math.min(page, pages);
  const shown = rows.slice((cur - 1) * PAGE, cur * PAGE);
  const total = useMemo(() => rows.reduce<Totals>((t, r) => addTo(t, r.e.currency, r.amount), {}), [rows]);

  const vendors = useMemo(() => Array.from(new Set(ex.data.expenditures.map((e) => e.vendor.trim()))).sort((a, b) => a.localeCompare(b)), [ex.data.expenditures]);
  const payers = useMemo(() => Array.from(new Set(ex.data.expenditures.map(payerLabel))).filter((p) => p !== "—").sort(), [ex.data.expenditures]);
  const activeCount = FILTER_KEYS.filter((k) => k !== "q" && params.get(k)).length;

  const doExport = async (fmt: "csv" | "pdf") => {
    setBusy(true);
    try {
      const desc = describeFilters(f, ex);
      await api.logEvent("export", `Exported expenditure records (${fmt.toUpperCase()}, ${rows.length} rows)${desc ? ` — ${desc}` : ""}`);
      if (fmt === "csv") exportRecordsCsv(rows, ex);
      else exportRecordsPdf(rows, ex, desc);
      toast.success("Export downloaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setBusy(false);
    }
  };

  const statusOptions = [
    { value: "outstanding", label: "Outstanding balance" },
    ...Object.entries(REIMB_STATUS).map(([value, m]) => ({ value, label: m.label })),
    { value: "not_requested", label: "Not requested" },
    { value: "not_applicable", label: "Not applicable" },
  ];

  return (
    <div>
      <PageHeader
        title="Expenditure records"
        subtitle={`${rows.length} record${rows.length === 1 ? "" : "s"} · ${fmtTotals(total)}${f.archived ? " · archived" : ""}`}
        actions={
          <>
            <Button variant="outline" disabled={busy || rows.length === 0} onClick={() => void doExport("csv")}>
              <FileSpreadsheet />
              CSV
            </Button>
            <Button variant="outline" disabled={busy || rows.length === 0} onClick={() => void doExport("pdf")}>
              <FileText />
              PDF
            </Button>
            <Button onClick={() => setAddOpen(true)}>
              <Plus />
              Add expenditure
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
          <Input value={f.q} onChange={(e) => setF("q", e.target.value)} placeholder="Search vendor, description, ID, receipt #, payer…" aria-label="Search expenditures" className="pl-10" />
        </div>
        <Button variant={showFilters ? "secondary" : "outline"} onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters}>
          <Filter />
          Filters{activeCount > 0 && ` (${activeCount})`}
        </Button>
        {activeCount > 0 && (
          <Button variant="ghost" onClick={() => setParams({}, { replace: true })}>
            <X />
            Clear
          </Button>
        )}
      </div>

      {showFilters && (
        <div className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-4">
          <TextField label="From (purchase date)" type="date" value={f.from} onChange={(v) => setF("from", v)} />
          <TextField label="To" type="date" value={f.to} onChange={(v) => setF("to", v)} />
          <SelectField label="Category" value={f.category} onChange={(v) => setF("category", v)} options={ex.categories.map((c) => ({ value: c.id, label: c.name }))} allowNone noneLabel="All categories" />
          <SelectField label="Vendor" value={f.vendor} onChange={(v) => setF("vendor", v)} options={vendors.map((v) => ({ value: v, label: v }))} allowNone noneLabel="All vendors" />
          <SelectField
            label="Paid by"
            value={f.paidBy}
            onChange={(v) => setF("paidBy", v)}
            options={[{ value: "personal", label: "Anyone personally" }, ...Object.entries(PAID_BY).map(([value, label]) => ({ value, label }))]}
            allowNone
            noneLabel="Anyone"
          />
          <SelectField label="Payer" value={f.payer} onChange={(v) => setF("payer", v)} options={payers.map((p) => ({ value: p, label: p }))} allowNone noneLabel="All payers" />
          <SelectField label="Payment method" value={f.method} onChange={(v) => setF("method", v)} options={Object.entries(METHOD).map(([value, label]) => ({ value, label }))} allowNone noneLabel="All methods" />
          <SelectField label="Property / client" value={f.property} onChange={(v) => setF("property", v)} options={ex.properties.map((p) => ({ value: p.id, label: p.name }))} allowNone noneLabel="All" />
          <SelectField label="Agency" value={f.agency} onChange={(v) => setF("agency", v)} options={ex.lookups.agencies.map((a) => ({ value: a.id, label: a.name }))} allowNone noneLabel="All agencies" />
          <SelectField
            label="Reimbursement direction"
            value={f.direction}
            onChange={(v) => setF("direction", v)}
            options={[
              { value: "to_person", label: DIRECTION.to_person.label },
              { value: "from_client", label: DIRECTION.from_client.label },
            ]}
            allowNone
            noneLabel="Either"
          />
          <SelectField label="Reimbursement status" value={f.status} onChange={(v) => setF("status", v)} options={statusOptions} allowNone noneLabel="Any status" />
          <div className="grid gap-2 sm:col-span-2 lg:col-span-1">
            <CheckField label="Missing receipts only" checked={f.missing} onChange={(v) => setF("missing", v)} />
            <CheckField label="Possible duplicates only" checked={f.duplicates} onChange={(v) => setF("duplicates", v)} />
            <CheckField label="Show archived instead" checked={f.archived} onChange={(v) => setF("archived", v)} />
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <Empty
          title={ex.index.rows.length === 0 ? "No expenditures yet" : "No records match"}
          description={ex.index.rows.length === 0 ? "Add your first expenditure to start tracking spending." : "Try clearing filters or widening the date range."}
          action={
            ex.index.rows.length === 0 ? (
              <Button onClick={() => setAddOpen(true)}>
                <Plus />
                Add expenditure
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-xl border border-line bg-surface lg:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] text-sm">
                <caption className="sr-only">Expenditures, page {cur} of {pages}</caption>
                <thead className="border-b border-line bg-rail/50 text-xs uppercase tracking-[0.08em] text-ink-2">
                  <tr>
                    <SortHead k="date" label="Date" sort={sort} dir={dir} onSort={onSort} />
                    <SortHead k="vendor" label="Vendor" sort={sort} dir={dir} onSort={onSort} />
                    <th scope="col" className="px-3 py-2.5 text-left font-medium">Description</th>
                    <SortHead k="category" label="Category" sort={sort} dir={dir} onSort={onSort} />
                    <SortHead k="amount" label="Amount" sort={sort} dir={dir} onSort={onSort} className="text-right" />
                    <SortHead k="paidBy" label="Paid by" sort={sort} dir={dir} onSort={onSort} />
                    <th scope="col" className="px-3 py-2.5 text-left font-medium">Property / client</th>
                    <th scope="col" className="px-3 py-2.5 text-left font-medium">Receipt</th>
                    <th scope="col" className="px-3 py-2.5 text-left font-medium">Owed to person</th>
                    <th scope="col" className="px-3 py-2.5 text-left font-medium">Recovery</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <TableRow key={r.e.id} row={r} onOpen={() => navigate(`/expenditures/records/${r.e.id}`)} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile cards */}
          <ul className="space-y-2.5 lg:hidden">
            {shown.map((r) => (
              <li key={r.e.id}>
                <Link to={`/expenditures/records/${r.e.id}`} className="focus-ring block rounded-xl border border-line bg-surface p-3">
                  <div className="rounded-lg border border-line bg-raised px-3.5 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-ink">{r.e.vendor}</div>
                        <div className="truncate text-xs text-ink-3">
                          {fmtDate(r.e.spent_on)} · {r.category?.name} · <span className="font-mono">{r.e.code}</span>
                        </div>
                      </div>
                      <span className="font-mono font-semibold tabular-nums text-ink">{fmtMoney(r.amount, r.e.currency)}</span>
                    </div>
                    <div className="mt-1 truncate text-sm text-ink-2">{r.e.description}</div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-ink-2">{payerLabel(r.e)}</span>
                      <ReceiptBadge count={r.receipts.length} />
                      {r.person.view && <DirectionBadge state={r.person} dir="to_person" compact />}
                      {r.recovery.view && <DirectionBadge state={r.recovery} dir="from_client" compact />}
                      {r.duplicates.length > 0 && <Pill tone="amber"><Copy className="h-3 w-3" />Possible duplicate</Pill>}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          <nav aria-label="Pagination" className="mt-4 flex items-center justify-between text-sm text-ink-2">
            <span>
              {(cur - 1) * PAGE + 1}–{Math.min(cur * PAGE, rows.length)} of {rows.length}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={cur <= 1} onClick={() => setF("page", String(cur - 1))} aria-label="Previous page">
                <ChevronLeft />
              </Button>
              <span className="px-2 py-1.5">
                Page {cur} / {pages}
              </span>
              <Button variant="outline" size="sm" disabled={cur >= pages} onClick={() => setF("page", String(cur + 1))} aria-label="Next page">
                <ChevronRight />
              </Button>
            </div>
          </nav>
        </>
      )}

      <ExpenditureForm open={addOpen} onOpenChange={setAddOpen} expenditure={null} />
    </div>
  );
};

const TableRow = ({ row: r, onOpen }: { row: ExpRow; onOpen: () => void }) => {
  const ex = useExpenses();
  const client = r.e.property_id ? ex.propertyName(r.e.property_id) : r.e.property_name;
  return (
    <tr className="cursor-pointer border-b border-line/60 transition-colors last:border-0 hover:bg-[#4A5260]" onClick={onOpen}>
      <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-ink-2">{fmtDate(r.e.spent_on, "MM/dd/yyyy")}</td>
      <td className="max-w-[180px] px-3 py-3">
        <Link to={`/expenditures/records/${r.e.id}`} className="focus-ring block truncate font-medium text-ink hover:text-ember" onClick={(e) => e.stopPropagation()}>
          {r.e.vendor}
        </Link>
        <span className="flex items-center gap-1.5 font-mono text-[11px] text-ink-3">
          {r.e.code}
          {r.duplicates.length > 0 && <Copy className="h-3 w-3 text-status-follow" aria-label="Possible duplicate" />}
        </span>
      </td>
      <td className="max-w-[220px] truncate px-3 py-3 text-ink-2">{r.e.description}</td>
      <td className="max-w-[160px] truncate px-3 py-3 text-ink-2">{r.category?.name}</td>
      <td className="whitespace-nowrap px-3 py-3 text-right font-mono font-semibold tabular-nums text-ink">{fmtMoney(r.amount, r.e.currency)}</td>
      <td className="max-w-[140px] truncate px-3 py-3 text-ink-2">{payerLabel(r.e)}</td>
      <td className="max-w-[160px] truncate px-3 py-3 text-ink-2">{client || <span className="text-ink-3">—</span>}</td>
      <td className="px-3 py-3">
        <ReceiptBadge count={r.receipts.length} />
      </td>
      <td className="px-3 py-3">
        <DirectionBadge state={r.person} dir="to_person" />
      </td>
      <td className="px-3 py-3">
        <DirectionBadge state={r.recovery} dir="from_client" />
      </td>
    </tr>
  );
};

/** Human-readable description of the active filters (used in export logs and PDF subtitles). */
export const describeFilters = (f: Filters, ex: ReturnType<typeof useExpenses>): string => {
  const parts: string[] = [];
  if (f.from || f.to) parts.push(`purchase date ${f.from || "…"} to ${f.to || "…"}`);
  if (f.category) parts.push(`category ${ex.index.categoryById.get(f.category)?.name ?? ""}`);
  if (f.vendor) parts.push(`vendor ${f.vendor}`);
  if (f.paidBy) parts.push(`paid by ${f.paidBy === "personal" ? "anyone personally" : f.paidBy}`);
  if (f.payer) parts.push(`payer ${f.payer}`);
  if (f.method) parts.push(`method ${METHOD[f.method] ?? f.method}`);
  if (f.property) parts.push(`property ${ex.propertyName(f.property)}`);
  if (f.agency) parts.push(`agency ${ex.agencyById.get(f.agency)?.name ?? ""}`);
  if (f.direction) parts.push(DIRECTION[f.direction as keyof typeof DIRECTION]?.label ?? f.direction);
  if (f.status) parts.push(`status ${f.status.replace(/_/g, " ")}`);
  if (f.missing) parts.push("missing receipts");
  if (f.duplicates) parts.push("possible duplicates");
  if (f.archived) parts.push("archived");
  if (f.q) parts.push(`search “${f.q}”`);
  return parts.join(", ");
};

export default ExRecords;
