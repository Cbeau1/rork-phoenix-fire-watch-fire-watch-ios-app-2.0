import { FileSpreadsheet, HandCoins, Undo2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { PaymentDialog, ReverseDialog } from "@/components/expenses/ReimbDialogs";
import { PageHeader } from "@/components/fw/primitives";
import { Button } from "@/components/ui/button";
import { Empty, fmtDate, Pill, SectionCard, SelectField, TextField } from "@/components/workforce/kit";
import * as api from "@/lib/expenses/api";
import { DIRECTION, PAY_METHOD, PARTY_TYPE, statusMeta, type Direction } from "@/lib/expenses/constants";
import { inRange, type PaymentView, type ReimbView } from "@/lib/expenses/derive";
import { exportTableCsv } from "@/lib/expenses/exports";
import { addTo, centsToInput, fmtMoney, fmtTotals, toCents, type Totals } from "@/lib/expenses/money";
import { cn } from "@/lib/utils";
import { useExpenses } from "@/state/ExpensesProvider";

const ExReimbursements = () => {
  const ex = useExpenses();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "payments" ? "payments" : "requests";
  const dir: Direction = params.get("dir") === "from_client" ? "from_client" : "to_person";
  const status = params.get("status") ?? "";
  const party = params.get("party") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [payOpen, setPayOpen] = useState<boolean>(false);
  const [reverse, setReverse] = useState<PaymentView | null>(null);

  const set = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    setParams(n, { replace: true });
    if (k === "dir") setSelected(new Set());
  };

  const all = useMemo(() => ex.index.reimbs.filter((v) => v.r.direction === dir && !v.exp?.archived_at), [ex.index.reimbs, dir]);
  const parties = useMemo(() => Array.from(new Set(all.map((v) => v.r.party_name))).sort(), [all]);
  const requests = useMemo(
    () =>
      all.filter(
        (v) =>
          (!party || v.r.party_name === party) &&
          (!status || (status === "outstanding" ? v.payable && v.remaining > 0 : status === "open" ? !["rejected", "cancelled", "fully_reimbursed"].includes(v.r.status) : v.r.status === status)) &&
          inRange(v.r.requested_on, { from, to }),
      ),
    [all, party, status, from, to],
  );
  const payments = useMemo(
    () => ex.index.payments.filter((p) => p.payment.direction === dir && inRange(p.payment.paid_on, { from, to }) && (!party || p.allocations.some((a) => a.reimb?.r.party_name === party))),
    [ex.index.payments, dir, from, to, party],
  );

  const outstanding = requests.reduce<Totals>((t, v) => (v.payable ? addTo(t, v.currency, v.remaining) : t), {});
  const chosen = requests.filter((v) => selected.has(v.r.id) && v.payable && v.remaining > 0);
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const meta = statusMeta(dir);
  const toPerson = dir === "to_person";

  const exportCsv = async () => {
    try {
      if (tab === "requests") {
        await api.logEvent("export", `Exported ${DIRECTION[dir].label.toLowerCase()} requests (CSV, ${requests.length} rows)`);
        exportTableCsv(
          `${toPerson ? "Reimbursements" : "Recoveries"}`,
          ["Request ID", "Expenditure ID", "Vendor", "Party", "Party type", "Status", "Requested", "Approved", "Paid", "Remaining", "Currency", "Request date", "Due date", "Reviewed by", "Reviewed at"],
          requests.map((v) => [
            v.r.code,
            v.exp?.code ?? "",
            v.exp?.vendor ?? "",
            v.r.party_name,
            PARTY_TYPE[v.r.party_type] ?? v.r.party_type,
            meta[v.r.status]?.label ?? v.r.status,
            centsToInput(v.requested),
            v.approved === null ? "" : centsToInput(v.approved),
            centsToInput(v.paid),
            v.payable ? centsToInput(v.remaining) : "",
            v.currency,
            v.r.requested_on,
            v.r.due_on ?? "",
            v.r.reviewed_by ? ex.memberName(v.r.reviewed_by) : "",
            v.r.reviewed_at ?? "",
          ]),
        );
      } else {
        await api.logEvent("export", `Exported ${toPerson ? "reimbursement" : "recovery"} payment history (CSV, ${payments.length} payments; basis: payment date)`);
        exportTableCsv(
          `${toPerson ? "Reimbursement" : "Recovery"}_payments`,
          ["Payment ID", "Payment date", "Party", "Amount", "Currency", "Method", "Reference", "Applied to", "Recorded by", "Recorded at", "Reversed", "Reversal reason"],
          payments.map((p) => [
            p.payment.code,
            p.payment.paid_on,
            p.payment.party_name,
            String(p.payment.amount),
            p.payment.currency,
            PAY_METHOD[p.payment.method] ?? p.payment.method,
            p.payment.reference,
            p.allocations.map((a) => `${a.reimb?.r.code ?? "?"}: ${a.allocation.amount}`).join("; "),
            ex.memberName(p.payment.recorded_by),
            p.payment.recorded_at,
            p.reversed ? "Yes" : "",
            p.reversed?.reason ?? "",
          ]),
        );
      }
      toast.success("Export downloaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed.");
    }
  };

  return (
    <div>
      <PageHeader
        title="Reimbursements"
        subtitle="Two independent directions. Approval is not payment — balances change only when a payment is recorded."
        actions={
          <>
            <Button variant="outline" onClick={() => void exportCsv()}>
              <FileSpreadsheet />
              CSV
            </Button>
            <Button onClick={() => setPayOpen(true)}>
              <HandCoins />
              {toPerson ? "Record payment" : "Record recovered"}
            </Button>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2" role="tablist" aria-label="Direction">
        {(["to_person", "from_client"] as Direction[]).map((d) => (
          <button
            key={d}
            type="button"
            role="tab"
            aria-selected={dir === d}
            onClick={() => set("dir", d)}
            className={cn(
              "focus-ring rounded-xl border px-4 py-3 text-left transition-colors",
              dir === d ? "border-primary bg-primary/[0.08]" : "border-line bg-surface hover:border-line-strong",
            )}
          >
            <div className={cn("font-medium", dir === d ? "text-link" : "text-ink")}>{DIRECTION[d].label}</div>
            <div className="text-xs text-ink-3">{DIRECTION[d].long}</div>
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-col gap-3 rounded-xl border border-line bg-surface shadow-card p-3 lg:flex-row lg:items-end">
        <div className="flex gap-1 rounded-lg border border-line bg-rail/60 p-1">
          {(["requests", "payments"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => set("tab", t === "payments" ? "payments" : "")}
              aria-pressed={tab === t}
              className={cn("focus-ring rounded-md px-3.5 py-1.5 text-sm font-medium", tab === t ? "bg-primary text-white" : "text-ink-2 hover:text-ink")}
            >
              {t === "requests" ? "Requests" : "Payment history"}
            </button>
          ))}
        </div>
        <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-4">
          <SelectField label={toPerson ? "Person" : "Client / agency"} value={party} onChange={(v) => set("party", v)} options={parties.map((p) => ({ value: p, label: p }))} allowNone noneLabel="Everyone" />
          {tab === "requests" ? (
            <SelectField
              label="Status"
              value={status}
              onChange={(v) => set("status", v)}
              options={[{ value: "outstanding", label: "Outstanding balance" }, { value: "open", label: "All open" }, ...Object.entries(meta).map(([value, m]) => ({ value, label: m.label }))]}
              allowNone
              noneLabel="All statuses"
            />
          ) : (
            <div className="hidden sm:block" />
          )}
          <TextField label={tab === "requests" ? "Requested from" : "Paid from"} type="date" value={from} onChange={(v) => set("from", v)} />
          <TextField label="To" type="date" value={to} onChange={(v) => set("to", v)} />
        </div>
      </div>

      {tab === "requests" ? (
        <SectionCard
          title={`${requests.length} request${requests.length === 1 ? "" : "s"}`}
          subtitle={`Outstanding: ${fmtTotals(outstanding)} · rejected and cancelled requests never count as payable.`}
          action={
            chosen.length > 0 ? (
              <Button size="sm" onClick={() => setPayOpen(true)}>
                <HandCoins />
                Pay {chosen.length} selected
              </Button>
            ) : undefined
          }
        >
          {requests.length === 0 ? (
            <Empty title="No requests" description={toPerson ? "Requests appear when an owner or employee paid for something personally." : "Expected client or agency recoveries appear here."} />
          ) : (
            <ul className="space-y-2">
              {requests.map((v) => (
                <RequestRow key={v.r.id} v={v} checked={selected.has(v.r.id)} onToggle={() => toggle(v.r.id)} />
              ))}
            </ul>
          )}
        </SectionCard>
      ) : (
        <SectionCard title={`${payments.length} payment${payments.length === 1 ? "" : "s"}`} subtitle="Basis: payment date. Reversed payments stay listed for the audit trail and don't count in totals.">
          {payments.length === 0 ? (
            <Empty title="No payments recorded" />
          ) : (
            <ul className="space-y-2">
              {payments.map((p) => (
                <li key={p.payment.id} className={cn("rounded-lg border border-line bg-raised px-4 py-3", p.reversed && "opacity-70")}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-link">{p.payment.code}</span>
                    <span className={cn("font-mono font-semibold tabular-nums text-ink", p.reversed && "line-through")}>{fmtMoney(toCents(p.payment.amount), p.payment.currency)}</span>
                    <span className="text-sm text-ink-2">
                      {toPerson ? "to" : "from"} {p.payment.party_name}
                    </span>
                    {p.reversed ? (
                      <Pill tone="red" className="ml-auto">Reversed</Pill>
                    ) : (
                      <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setReverse(p)}>
                        <Undo2 />
                        Reverse
                      </Button>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-ink-3">
                    {fmtDate(p.payment.paid_on)} · {PAY_METHOD[p.payment.method]}
                    {p.payment.reference && ` · #${p.payment.reference}`} · recorded by {ex.memberName(p.payment.recorded_by)}
                    {p.attachments.length > 0 && ` · ${p.attachments.length} attachment${p.attachments.length === 1 ? "" : "s"}`}
                  </div>
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {p.allocations.map((a) => (
                      <li key={a.allocation.id}>
                        <Link to={`/expenditures/records/${a.reimb?.r.expenditure_id ?? ""}`} className="focus-ring inline-flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-0.5 text-xs text-ink-2 ring-1 ring-line hover:text-ink">
                          {a.reimb?.r.code} · {a.reimb?.exp?.vendor} · {fmtMoney(toCents(a.allocation.amount), p.payment.currency)}
                        </Link>
                      </li>
                    ))}
                  </ul>
                  {p.reversed && <p className="mt-1.5 text-xs text-status-incident-ink">Reversed {fmtDate(p.reversed.reversed_at)} by {ex.memberName(p.reversed.reversed_by)}: {p.reversed.reason}</p>}
                  {p.payment.notes && <p className="mt-1 whitespace-pre-line text-xs text-ink-2">{p.payment.notes}</p>}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      )}

      <PaymentDialog open={payOpen} onOpenChange={setPayOpen} direction={dir} initial={chosen} />
      <ReverseDialog target={reverse} onClose={() => setReverse(null)} />
    </div>
  );
};

const RequestRow = ({ v, checked, onToggle }: { v: ReimbView; checked: boolean; onToggle: () => void }) => {
  const meta = statusMeta(v.r.direction as Direction)[v.r.status] ?? { label: v.r.status, tone: "slate" as const };
  const canPay = v.payable && v.remaining > 0;
  return (
    <li className="flex items-start gap-3 rounded-lg border border-line bg-raised px-4 py-3">
      <input type="checkbox" className="mt-1 h-4 w-4 accent-primary disabled:opacity-30" aria-label={`Select ${v.r.code} for payment`} checked={checked} disabled={!canPay} onChange={onToggle} />
      <Link to={`/expenditures/records/${v.r.expenditure_id}`} className="focus-ring min-w-0 flex-1 rounded">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-link">{v.r.code}</span>
          <span className="font-medium text-ink">{v.r.party_name}</span>
          <Pill tone={meta.tone}>{meta.label}</Pill>
        </div>
        <div className="mt-0.5 truncate text-xs text-ink-3">
          {v.exp?.code} · {v.exp?.vendor} · {v.exp?.description} · requested {fmtDate(v.r.requested_on)}
          {v.r.due_on && ` · due ${fmtDate(v.r.due_on)}`}
        </div>
      </Link>
      <div className="shrink-0 text-right text-xs">
        <div className="font-mono text-sm font-semibold tabular-nums text-ink">{fmtMoney(v.approved ?? v.requested, v.currency)}</div>
        <div className="text-ink-3">{v.approved === null ? "requested" : `approved · paid ${fmtMoney(v.paid, v.currency)}`}</div>
        {canPay && <div className="font-mono text-status-follow">{fmtMoney(v.remaining, v.currency)} left</div>}
      </div>
    </li>
  );
};

export default ExReimbursements;
