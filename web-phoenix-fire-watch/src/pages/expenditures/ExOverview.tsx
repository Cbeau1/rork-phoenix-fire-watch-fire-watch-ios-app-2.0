import { AlertTriangle, Banknote, Building2, ClipboardCheck, HandCoins, Plus, ReceiptText, Scale, UserRound, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { THEME } from "@/lib/theme";

import { ExpenditureForm } from "@/components/expenses/ExpenditureForm";
import { MetricCard, ReceiptBadge } from "@/components/expenses/kit";
import { PageHeader } from "@/components/fw/primitives";
import { Button } from "@/components/ui/button";
import { Empty, fmtDate, SectionCard, TextField } from "@/components/workforce/kit";
import { PAID_BY } from "@/lib/expenses/constants";
import { PRESETS, summarize, type Range } from "@/lib/expenses/derive";
import { fmtMoney, fmtTotals } from "@/lib/expenses/money";
import { cn } from "@/lib/utils";
import { useExpenses } from "@/state/ExpensesProvider";

const qs = (o: Record<string, string>) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== "")).toString();

const ExOverview = () => {
  const ex = useExpenses();
  const [params, setParams] = useSearchParams();
  const preset = params.get("p") ?? (params.get("from") || params.get("to") ? "custom" : "month");
  const range: Range = useMemo(() => {
    if (preset === "custom") return { from: params.get("from") ?? "", to: params.get("to") ?? "" };
    return (PRESETS.find((p) => p.id === preset) ?? PRESETS[0]).range();
  }, [preset, params]);
  const [addOpen, setAddOpen] = useState<boolean>(false);
  const s = useMemo(() => summarize(ex.index, range), [ex.index, range]);
  const r = { from: range.from, to: range.to };

  const recent = ex.index.rows.filter((x) => !x.e.archived_at).slice(0, 6);
  const pending = ex.index.reimbs.filter((v) => v.r.status === "pending_review" && !v.exp?.archived_at).slice(0, 6);
  const dupCount = ex.index.rows.filter((x) => x.duplicates.length > 0).length;

  return (
    <div>
      <PageHeader
        title="Expenditures"
        subtitle="Business spending, receipts, reimbursements and client recoveries. Records only — nothing here sends money."
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <Plus />
            Add expenditure
          </Button>
        }
      />

      <div className="mb-5 flex flex-col gap-3 rounded-xl border border-line bg-surface shadow-card p-3 lg:flex-row lg:items-end">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Date range">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setParams({ p: p.id })}
              aria-pressed={preset === p.id}
              className={cn(
                "focus-ring rounded-full px-3.5 py-1.5 text-sm font-medium ring-1 ring-inset transition-colors",
                preset === p.id ? "bg-primary text-white ring-link" : "bg-raised text-ink-2 ring-line hover:text-ink",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 lg:ml-auto lg:w-80">
          <TextField label="From" type="date" value={range.from} onChange={(v) => setParams({ from: v, to: range.to })} />
          <TextField label="To" type="date" value={range.to} onChange={(v) => setParams({ from: range.from, to: v })} />
        </div>
      </div>

      <p className="mb-3 text-xs text-ink-3">
        Spending cards use <span className="text-ink-2">purchase dates</span>. “Reimbursements paid” uses <span className="text-ink-2">payment dates</span>. Balances
        and review queues are current, regardless of range.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total recorded spending" value={fmtTotals(s.spending)} sub={`${s.count} expenditure${s.count === 1 ? "" : "s"} · purchase date`} dot={THEME.primary} icon={ReceiptText} to={`/expenditures/records?${qs(r)}`} />
        <MetricCard label="Paid by the business" value={fmtTotals(s.business)} sub="Business cards, accounts & cash" dot={THEME.ink2} icon={Building2} to={`/expenditures/records?${qs({ ...r, paidBy: "business" })}`} delay={40} />
        <MetricCard label="Paid personally" value={fmtTotals(s.personal)} sub="Owner, employees or others — part of spending" dot={THEME.warning} icon={UserRound} to={`/expenditures/records?${qs({ ...r, paidBy: "personal" })}`} delay={80} />
        <MetricCard label="Reimbursements paid" value={fmtTotals(s.reimbursedPaid)} sub="Settles who paid · not extra spending" dot={THEME.success} icon={HandCoins} to={`/expenditures/reimbursements?${qs({ tab: "payments", dir: "to_person", ...r })}`} delay={120} />
        <MetricCard label="Outstanding reimbursements" value={fmtTotals(s.outstanding)} sub="Approved, not yet paid back" dot={THEME.link} icon={Wallet} to="/expenditures/reimbursements?dir=to_person&status=outstanding" delay={160} />
        <MetricCard label="Awaiting review" value={String(s.awaiting.count)} sub={s.awaiting.count ? `${fmtTotals(s.awaiting.totals)} requested` : "No requests waiting"} dot={THEME.warning} icon={ClipboardCheck} to="/expenditures/reimbursements?dir=to_person&status=pending_review" delay={200} />
        <MetricCard label="Missing receipts" value={String(s.missing.count)} sub={s.missing.count ? `${fmtTotals(s.missing.totals)} without a receipt` : "Every expense has a receipt"} dot={THEME.warning} icon={AlertTriangle} to={`/expenditures/records?${qs({ ...r, missing: "1" })}`} delay={240} />
        <MetricCard label="Client/agency recoveries" value={fmtTotals(s.recoveryOutstanding)} sub={`Outstanding · ${fmtTotals(s.recovered)} recovered in range (shown separately)`} dot="#38BDF8" icon={Scale} to="/expenditures/reimbursements?dir=from_client&status=outstanding" delay={280} />
      </div>

      {dupCount > 0 && (
        <Link
          to="/expenditures/records?duplicates=1"
          className="focus-ring mt-4 flex items-center gap-2 rounded-lg border border-status-follow/50 bg-status-follow/10 px-4 py-3 text-sm text-ink hover:bg-status-follow/15"
        >
          <AlertTriangle className="h-4 w-4 text-status-follow" />
          {dupCount} record{dupCount === 1 ? "" : "s"} flagged as possible duplicate{dupCount === 1 ? "" : "s"} — review
        </Link>
      )}

      <div className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-2">
        <SectionCard
          title="Recent expenditures"
          action={
            <Button asChild variant="outline" size="sm">
              <Link to="/expenditures/records">View all</Link>
            </Button>
          }
        >
          {recent.length === 0 ? (
            <Empty title="No expenditures yet" description="Record your first purchase — receipts are optional and can be added later." action={<Button onClick={() => setAddOpen(true)}><Plus />Add expenditure</Button>} />
          ) : (
            <ul className="space-y-2.5">
              {recent.map((x) => (
                <li key={x.e.id}>
                  <Link to={`/expenditures/records/${x.e.id}`} className="focus-ring flex items-center gap-3 rounded-lg border border-line bg-raised px-4 py-3 transition-colors hover:border-line-strong">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-ink">{x.e.vendor}</div>
                      <div className="truncate text-xs text-ink-3">
                        {fmtDate(x.e.spent_on)} · {x.category?.name} · {PAID_BY[x.e.paid_by as keyof typeof PAID_BY]}
                      </div>
                    </div>
                    <ReceiptBadge count={x.receipts.length} />
                    <span className="font-mono text-sm font-semibold tabular-nums text-ink">{fmtMoney(x.amount, x.e.currency)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
        <SectionCard
          title="Awaiting review"
          subtitle="Approve, adjust or reject. Approval alone is never payment."
          action={
            <Button asChild variant="outline" size="sm">
              <Link to="/expenditures/reimbursements">All requests</Link>
            </Button>
          }
        >
          {pending.length === 0 ? (
            <Empty title="Nothing waiting" description="Requests sent for review will appear here." />
          ) : (
            <ul className="space-y-2.5">
              {pending.map((v) => (
                <li key={v.r.id}>
                  <Link to={`/expenditures/records/${v.r.expenditure_id}`} className="focus-ring flex items-center gap-3 rounded-lg border border-line bg-raised px-4 py-3 transition-colors hover:border-line-strong">
                    <Banknote className="h-5 w-5 shrink-0 text-status-follow" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-ink">
                        {v.r.party_name} <span className="text-xs font-normal text-ink-3">· {v.r.direction === "to_person" ? "reimbursement" : "recovery"}</span>
                      </div>
                      <div className="truncate text-xs text-ink-3">
                        {v.r.code} · {v.exp?.vendor} · requested {fmtDate(v.r.requested_on)}
                      </div>
                    </div>
                    <span className="font-mono text-sm font-semibold tabular-nums text-ink">{fmtMoney(v.requested, v.currency)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <ExpenditureForm open={addOpen} onOpenChange={setAddOpen} expenditure={null} />
    </div>
  );
};

export default ExOverview;
