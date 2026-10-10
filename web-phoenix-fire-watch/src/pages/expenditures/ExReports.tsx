import { format, parseISO } from "date-fns";
import { FileSpreadsheet, FileText } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/fw/primitives";
import { Button } from "@/components/ui/button";
import { CheckField, SelectField, TextField } from "@/components/workforce/kit";
import * as api from "@/lib/expenses/api";
import { PAID_BY, PAY_METHOD, PARTY_TYPE, statusMeta, type Direction } from "@/lib/expenses/constants";
import { group, inRange, payerLabel, PRESETS, type ExpRow, type Range } from "@/lib/expenses/derive";
import { exportPdf, exportTableCsv, recordRow, RECORD_HEAD } from "@/lib/expenses/exports";
import { addTo, centsToInput, fmtMoney, fmtTotals, toCents, type Totals } from "@/lib/expenses/money";
import { cn } from "@/lib/utils";
import { useExpenses } from "@/state/ExpensesProvider";

type Fmt = "csv" | "pdf";
interface Report {
  key: string;
  title: string;
  basis: string;
  description: string;
  head: string[];
  rows: string[][];
  summary?: [string, string][];
  /** Optional preview figures for the card. */
  preview?: { label: string; value: string }[];
}

/** Totals per currency → one row per currency so CSV numbers stay numeric. */
const totalsRows = (label: string, t: Totals, extra: (cur: string) => string[] = () => []): string[][] => {
  const entries = Object.entries(t).filter(([, c]) => c !== 0);
  if (entries.length === 0) return [[label, "0.00", "USD", ...extra("USD")]];
  return entries.map(([cur, c]) => [label, centsToInput(c), cur, ...extra(cur)]);
};

const ExReports = () => {
  const ex = useExpenses();
  const [preset, setPreset] = useState<string>("ytd");
  const [custom, setCustom] = useState<Range>({ from: "", to: "" });
  const [category, setCategory] = useState<string>("");
  const [property, setProperty] = useState<string>("");
  const [paidBy, setPaidBy] = useState<string>("");
  const [netCost, setNetCost] = useState<boolean>(false);
  const [busy, setBusy] = useState<string>("");

  const range: Range = preset === "custom" ? custom : (PRESETS.find((p) => p.id === preset) ?? PRESETS[0]).range();
  const rangeLabel = range.from || range.to ? `${range.from || "start"} to ${range.to || "today"}` : "all time";

  const spend = useMemo(
    () =>
      ex.index.rows.filter(
        (r) =>
          !r.e.archived_at &&
          inRange(r.e.spent_on, range) &&
          (!category || r.e.category_id === category) &&
          (!property || r.e.property_id === property) &&
          (!paidBy || (paidBy === "personal" ? r.e.paid_by !== "business" : r.e.paid_by === paidBy)),
      ),
    [ex.index.rows, range.from, range.to, category, property, paidBy], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const filterText = [
    `purchase date ${rangeLabel}`,
    category && `category ${ex.index.categoryById.get(category)?.name}`,
    property && `property ${ex.propertyName(property)}`,
    paidBy && `paid by ${paidBy === "personal" ? "anyone personally" : paidBy}`,
  ]
    .filter(Boolean)
    .join(", ");

  const reports = useMemo<Report[]>(() => {
    const gross = spend.reduce<Totals>((t, r) => addTo(t, r.e.currency, r.amount), {});
    // Recoveries received for the same filtered expenses (payment date not restricted, so net cost matches those expenses).
    const spendIds = new Set(spend.map((r) => r.e.id));
    const recoveredFor = ex.index.reimbs
      .filter((v) => v.r.direction === "from_client" && spendIds.has(v.r.expenditure_id))
      .reduce<Totals>((t, v) => addTo(t, v.currency, v.paid), {});

    const grouped = (key: (r: ExpRow) => string, label: string): string[][] => {
      const g = group(spend, key);
      const out: string[][] = [];
      for (const [k, list] of Array.from(g.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
        const t = list.reduce<Totals>((acc, r) => addTo(acc, r.e.currency, r.amount), {});
        const rec = list.reduce<Totals>((acc, r) => {
          const v = r.recovery.view;
          return v ? addTo(acc, v.currency, v.paid) : acc;
        }, {});
        for (const [cur, c] of Object.entries(t)) {
          const row = [k || `(no ${label})`, String(list.filter((r) => r.e.currency === cur).length), centsToInput(c), cur];
          if (netCost) row.push(centsToInput(rec[cur] ?? 0), centsToInput(c - (rec[cur] ?? 0)));
          out.push(row);
        }
      }
      return out;
    };
    const netHead = netCost ? ["Recovered from clients/agencies", "Net cost after recovery"] : [];
    const summary: [string, string][] = [
      ["Basis", "Purchase date"],
      ["Filters", filterText],
      ["Gross spending", fmtTotals(gross)],
      ["Expenditures", String(spend.length)],
      ["Note", "Reimbursements paid to the owner or employees are NOT subtracted — they only settle who paid."],
      ...(netCost ? ([["Recovered for these expenses (shown separately)", fmtTotals(recoveredFor)], ["Net cost after recovery", fmtTotals(Object.fromEntries(Object.entries(gross).map(([k, v]) => [k, v - (recoveredFor[k] ?? 0)])))]] as [string, string][]) : []),
    ];

    // Payments (payment-date basis).
    const pays = ex.index.payments.filter((p) => inRange(p.payment.paid_on, range));
    const personPays = pays.filter((p) => p.payment.direction === "to_person");
    const owedByPerson = group(
      ex.index.reimbs.filter((v) => v.r.direction === "to_person" && v.payable && v.remaining > 0 && !v.exp?.archived_at),
      (v) => v.r.party_name,
    );
    const recoveries = ex.index.reimbs.filter((v) => v.r.direction === "from_client" && v.payable && v.remaining > 0 && !v.exp?.archived_at);
    const missing = spend.filter((r) => !r.hasReceipt);
    const meta = (d: Direction, s: string) => statusMeta(d)[s]?.label ?? s;

    return [
      {
        key: "Spending_by_month",
        title: "Spending by month",
        basis: "Purchase date",
        description: "Gross recorded spending per calendar month.",
        head: ["Month", "Count", "Amount", "Currency", ...netHead],
        rows: grouped((r) => format(parseISO(r.e.spent_on), "yyyy-MM"), "month"),
        summary,
      },
      {
        key: "Spending_by_category",
        title: "Spending by category",
        basis: "Purchase date",
        description: "Organizational categories only — not tax classifications.",
        head: ["Category", "Count", "Amount", "Currency", ...netHead],
        rows: grouped((r) => r.category?.name ?? "", "category"),
        summary,
      },
      {
        key: "Spending_by_property",
        title: "Spending by property / client",
        basis: "Purchase date",
        description: "Grouped by linked property or client name.",
        head: ["Property / client", "Count", "Amount", "Currency", ...netHead],
        rows: grouped((r) => (r.e.property_id ? ex.propertyName(r.e.property_id) : r.e.property_name), "property"),
        summary,
      },
      {
        key: "Spending_by_payer",
        title: "Spending by payer",
        basis: "Purchase date",
        description: "Who originally paid: the business or a person.",
        head: ["Payer", "Count", "Amount", "Currency", ...netHead],
        rows: grouped((r) => (r.e.paid_by === "business" ? "Business" : `${payerLabel(r.e)} (${PAID_BY[r.e.paid_by as keyof typeof PAID_BY]})`), "payer"),
        summary,
      },
      {
        key: "Outstanding_owed_to_people",
        title: "Outstanding amounts owed to each person",
        basis: "Current balance (approved minus paid)",
        description: "Only approved requests. Drafts, pending, rejected and cancelled requests are excluded.",
        head: ["Person", "Open requests", "Remaining", "Currency"],
        rows: Array.from(owedByPerson.entries()).flatMap(([name, list]) =>
          totalsRows(
            name,
            list.reduce<Totals>((t, v) => addTo(t, v.currency, v.remaining), {}),
            (cur) => [String(list.filter((v) => v.currency === cur).length)],
          ).map((r) => [r[0], r[3], r[1], r[2]]),
        ),
        summary: [["Basis", "Current approved balances"], ["Total owed", fmtTotals(Array.from(owedByPerson.values()).flat().reduce<Totals>((t, v) => addTo(t, v.currency, v.remaining), {}))]],
      },
      {
        key: "Outstanding_recoveries",
        title: "Outstanding client/agency recoveries",
        basis: "Current balance (approved minus received)",
        description: "Shown separately from spending. No invoices are created or changed.",
        head: ["Request", "Expenditure", "From", "Type", "Approved", "Received", "Remaining", "Currency", "Due", "Client invoice ref"],
        rows: recoveries.map((v) => [
          v.r.code,
          v.exp?.code ?? "",
          v.r.party_name,
          PARTY_TYPE[v.r.party_type] ?? v.r.party_type,
          centsToInput(v.approved ?? 0),
          centsToInput(v.paid),
          centsToInput(v.remaining),
          v.currency,
          v.r.due_on ?? "",
          v.r.invoice_ref,
        ]),
        summary: [["Basis", "Current approved balances"], ["Total outstanding", fmtTotals(recoveries.reduce<Totals>((t, v) => addTo(t, v.currency, v.remaining), {}))]],
      },
      {
        key: "Reimbursement_payment_history",
        title: "Reimbursement payment history",
        basis: "Payment date",
        description: "Payments to the owner/employees. Reversed payments are listed but not totaled.",
        head: ["Payment", "Payment date", "Paid to", "Amount", "Currency", "Method", "Reference", "Applied to", "Status"],
        rows: personPays.map((p) => [
          p.payment.code,
          p.payment.paid_on,
          p.payment.party_name,
          String(p.payment.amount),
          p.payment.currency,
          PAY_METHOD[p.payment.method] ?? p.payment.method,
          p.payment.reference,
          p.allocations.map((a) => `${a.reimb?.r.code}: ${a.allocation.amount} (${a.reimb ? meta("to_person", a.reimb.r.status) : ""})`).join("; "),
          p.reversed ? `Reversed: ${p.reversed.reason}` : "Recorded",
        ]),
        summary: [
          ["Basis", `Payment date ${rangeLabel}`],
          ["Total reimbursed (excluding reversals)", fmtTotals(personPays.filter((p) => !p.reversed).reduce<Totals>((t, p) => addTo(t, p.payment.currency, toCents(p.payment.amount)), {}))],
          ["Note", "Not business spending — reimbursements settle who paid for already-recorded expenses."],
        ],
      },
      {
        key: "Missing_receipts",
        title: "Missing receipt report",
        basis: "Purchase date",
        description: "Expenditures with no receipt attached.",
        head: RECORD_HEAD,
        rows: missing.map((r) => recordRow(r, ex)),
        summary: [["Basis", "Purchase date"], ["Filters", filterText], ["Records without receipts", String(missing.length)], ["Amount", fmtTotals(missing.reduce<Totals>((t, r) => addTo(t, r.e.currency, r.amount), {}))]],
      },
    ];
  }, [spend, ex, netCost, filterText, range.from, range.to, rangeLabel]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (r: Report, fmt: Fmt) => {
    setBusy(r.key + fmt);
    try {
      await api.logEvent("export", `Exported ${r.title} (${fmt.toUpperCase()}, ${r.rows.length} rows; basis: ${r.basis}; ${filterText})`);
      if (fmt === "csv") exportTableCsv(r.key, r.head, r.rows);
      else
        exportPdf(ex, r.title, `Basis: ${r.basis} · ${filterText}`, [
          ...(r.summary ? [{ title: "Summary", fields: r.summary }] : []),
          { title: "Details", table: { head: r.head, body: r.rows }, emptyText: "No records match." },
        ]);
      toast.success(`${r.title} downloaded`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setBusy("");
    }
  };

  return (
    <div>
      <PageHeader title="Reports & exports" subtitle="Every export is permission-checked and logged. CSV cells are protected against spreadsheet formula injection." />

      <div className="mb-5 grid grid-cols-1 gap-3 rounded-xl border border-line bg-surface shadow-card p-4 sm:grid-cols-2 lg:grid-cols-4">
        <SelectField label="Period" value={preset} onChange={setPreset} options={[...PRESETS.map((p) => ({ value: p.id, label: p.label })), { value: "custom", label: "Custom range" }]} />
        {preset === "custom" ? (
          <div className="grid grid-cols-2 gap-2">
            <TextField label="From" type="date" value={custom.from} onChange={(v) => setCustom((c) => ({ ...c, from: v }))} />
            <TextField label="To" type="date" value={custom.to} onChange={(v) => setCustom((c) => ({ ...c, to: v }))} />
          </div>
        ) : (
          <div className="flex items-end pb-2 text-sm text-ink-2">{rangeLabel}</div>
        )}
        <SelectField label="Category" value={category} onChange={setCategory} options={ex.categories.map((c) => ({ value: c.id, label: c.name }))} allowNone noneLabel="All categories" />
        <SelectField label="Property / client" value={property} onChange={setProperty} options={ex.properties.map((p) => ({ value: p.id, label: p.name }))} allowNone noneLabel="All" />
        <SelectField
          label="Paid by"
          value={paidBy}
          onChange={setPaidBy}
          options={[{ value: "personal", label: "Anyone personally" }, ...Object.entries(PAID_BY).map(([value, label]) => ({ value, label }))]}
          allowNone
          noneLabel="Anyone"
        />
        <div className="sm:col-span-2 lg:col-span-3">
          <CheckField label="Add “net cost after recovery” columns to spending reports" hint="Recoveries are always shown in their own columns, never mixed into gross spending." checked={netCost} onChange={setNetCost} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {reports.map((r) => (
          <section key={r.key} className="flex flex-col rounded-xl border border-line bg-surface shadow-card p-3">
            <div className="flex-1 rounded-lg border border-line bg-raised p-4">
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-display text-lg font-bold text-ink">{r.title}</h2>
                <span className={cn("whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ring-inset", r.basis.startsWith("Payment") ? "bg-status-clear/12 text-status-clear ring-status-clear/35" : r.basis.startsWith("Purchase") ? "bg-primary/12 text-link ring-link/35" : "bg-info/12 text-info-ink ring-info/35")}>
                  {r.basis}
                </span>
              </div>
              <p className="mt-1 text-sm text-ink-2">{r.description}</p>
              <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto text-xs">
                {r.rows.slice(0, 6).map((row, i) => (
                  <li key={i} className="flex justify-between gap-3 border-b border-line/60 pb-1 last:border-0">
                    <span className="truncate text-ink-2">{row[0]}</span>
                    <span className="whitespace-nowrap font-mono text-ink">{r.head.includes("Amount") && r.head[2] === "Amount" ? fmtMoney(Math.round(Number(row[2]) * 100), row[3]) : row[r.head.indexOf("Remaining")] ? fmtMoney(Math.round(Number(row[r.head.indexOf("Remaining")]) * 100), row[r.head.indexOf("Currency")]) : row[1]}</span>
                  </li>
                ))}
                {r.rows.length === 0 && <li className="text-ink-3">No records for these filters.</li>}
                {r.rows.length > 6 && <li className="text-ink-3">+ {r.rows.length - 6} more in the export</li>}
              </ul>
            </div>
            <div className="flex flex-wrap gap-2 px-1 pb-1 pt-3">
              <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void run(r, "csv")}>
                <FileSpreadsheet />
                CSV
              </Button>
              <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void run(r, "pdf")}>
                <FileText />
                PDF summary
              </Button>
            </div>
          </section>
        ))}
      </div>
      <p className="mt-5 text-xs text-ink-3">These reports organize your own records. They are not tax or accounting advice; categories don't indicate deductibility.</p>
    </div>
  );
};

export default ExReports;
