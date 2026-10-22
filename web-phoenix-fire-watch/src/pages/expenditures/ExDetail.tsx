import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Ban,
  Briefcase,
  Check,
  CheckCircle2,
  HandCoins,
  Pencil,
  Plus,
  Repeat,
  RotateCcw,
  Send,
  Undo2,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";

import { ExpenditureForm } from "@/components/expenses/ExpenditureForm";
import { AttachmentList, UploadButton } from "@/components/expenses/kit";
import { PaymentDialog, ReimbursementDialog, ReverseDialog, ReviewDialog, type ReviewMode } from "@/components/expenses/ReimbDialogs";
import { PageHeader } from "@/components/fw/primitives";
import { Button } from "@/components/ui/button";
import { AreaField, ConfirmDialog, DataTile, Empty, ErrorBlock, fmtDate, fmtDateTime, Loading, Pill, SectionCard } from "@/components/workforce/kit";
import * as api from "@/lib/expenses/api";
import { DIRECTION, FLAG, HISTORY_ACTION, METHOD, PAID_BY, PARTY_TYPE, PAY_METHOD, statusMeta, type Direction, type HistoryEntry } from "@/lib/expenses/constants";
import type { PaymentView, ReimbView } from "@/lib/expenses/derive";
import { fmtMoney, toCents } from "@/lib/expenses/money";
import { formatShiftRange } from "@/lib/schedule";
import { cn } from "@/lib/utils";
import NotFound from "@/pages/NotFound";
import { useExpenses } from "@/state/ExpensesProvider";

const FIELD_LABEL: Record<string, string> = {
  spent_on: "date",
  vendor: "vendor",
  description: "description",
  purpose: "purpose",
  category_id: "category",
  amount: "amount",
  currency: "currency",
  tax_amount: "tax",
  paid_by: "paid by",
  payer_name: "payer",
  payer_worker_id: "workforce profile",
  payment_method: "payment method",
  account_label: "account label",
  property_id: "property",
  property_name: "client",
  agency_id: "agency",
  placement_id: "assignment",
  agency_invoice_id: "agency invoice",
  invoice_ref: "receipt #",
  notes: "notes",
  person_reimb_flag: "reimbursement tracking",
  client_recovery_flag: "recovery tracking",
  duplicate_reviewed_at: "duplicate review",
  duplicate_reviewed_by: "duplicate reviewer",
  duplicate_note: "duplicate note",
  requested_amount: "requested amount",
  approved_amount: "approved amount",
  status: "status",
  shift_ids: "linked shifts",
};

const shortVal = (k: string, v: unknown): string => {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? "" : "s"}`;
  const s = String(v);
  if (/_id$/.test(k) || k === "duplicate_reviewed_by") return "changed";
  return s.length > 60 ? `${s.slice(0, 57)}…` : s.replace(/_/g, " ");
};

export const HistoryList = ({ entries }: { entries: HistoryEntry[] }) =>
  entries.length === 0 ? (
    <Empty title="No history yet" />
  ) : (
    <ol className="space-y-2">
      {entries.map((h) => {
        const before = (h.before ?? {}) as Record<string, unknown>;
        const after = (h.after ?? {}) as Record<string, unknown>;
        const fields = h.changed_fields.filter((f) => f in after || f in before);
        const passive = ["view", "preview", "download", "export", "print"].includes(h.action);
        return (
          <li key={h.id} className="rounded-lg border border-line bg-raised px-4 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className={cn("text-sm font-medium", passive ? "text-info-ink" : h.action.includes("reversed") || h.action === "archive" ? "text-status-incident-ink" : "text-ink")}>
                {HISTORY_ACTION[h.action] ?? h.action.replace(/_/g, " ")}
              </span>
              <span className="text-xs text-ink-3">{fmtDateTime(h.created_at)}</span>
            </div>
            <div className="mt-0.5 text-xs text-ink-2">
              {h.actor_name || "System"}
              {h.summary && <> · {h.summary}</>}
            </div>
            {h.action !== "create" && fields.length > 0 && (
              <ul className="mt-1.5 space-y-0.5 text-xs text-ink-3">
                {fields.map((f) => (
                  <li key={f}>
                    <span className="text-ink-2">{FIELD_LABEL[f] ?? f.replace(/_/g, " ")}:</span> {shortVal(f, before[f])} → {shortVal(f, after[f])}
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );

/** One reimbursement direction panel — tracked independently from the other direction. */
const DirectionPanel = ({
  dir,
  views,
  flag,
  canCreate,
  createBlocked,
  onCreate,
  onEdit,
  onReview,
  onPay,
  onReverse,
}: {
  dir: Direction;
  views: ReimbView[];
  flag: string;
  canCreate: boolean;
  createBlocked?: string;
  onCreate: () => void;
  onEdit: (v: ReimbView) => void;
  onReview: (v: ReimbView, m: ReviewMode) => void;
  onPay: (v: ReimbView) => void;
  onReverse: (p: PaymentView) => void;
}) => {
  const ex = useExpenses();
  const meta = statusMeta(dir);
  const toPerson = dir === "to_person";
  const open = views.filter((v) => !["rejected", "cancelled"].includes(v.r.status));
  return (
    <SectionCard
      title={DIRECTION[dir].label}
      subtitle={DIRECTION[dir].long}
      action={
        canCreate && open.length === 0 ? (
          <Button size="sm" variant="outline" onClick={onCreate}>
            <Plus />
            {toPerson ? "Request reimbursement" : "Add expected recovery"}
          </Button>
        ) : undefined
      }
    >
      {views.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line px-4 py-5 text-center text-sm text-ink-2">
          {createBlocked ?? (FLAG[flag as keyof typeof FLAG]?.label ?? "Not applicable")}
          {!createBlocked && <span className="block text-xs text-ink-3">{toPerson ? "No reimbursement request." : "No recovery expected."}</span>}
        </div>
      ) : (
        <div className="space-y-3">
          {views.map((v) => {
            const m = meta[v.r.status] ?? { label: v.r.status, tone: "slate" as const };
            const closed = ["rejected", "cancelled"].includes(v.r.status);
            return (
              <div key={v.r.id} className={cn("rounded-lg border border-line bg-raised p-4", closed && "opacity-70")}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-link">{v.r.code}</span>
                      <Pill tone={m.tone}>{m.label}</Pill>
                    </div>
                    <div className="mt-1 text-sm font-medium text-ink">
                      {v.r.party_name}{" "}
                      <span className="text-xs font-normal text-ink-3">
                        · {PARTY_TYPE[v.r.party_type] ?? v.r.party_type}
                        {v.r.party_worker_id && ex.workerById.get(v.r.party_worker_id) && (
                          <>
                            {" · "}
                            <Link to={`/workforce/workers/${v.r.party_worker_id}`} className="text-link hover:underline">
                              {ex.workerById.get(v.r.party_worker_id)?.code}
                            </Link>
                          </>
                        )}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {v.r.status === "draft" && (
                      <Button size="sm" variant="outline" onClick={() => onReview(v, "submit")}>
                        <Send />
                        Send for review
                      </Button>
                    )}
                    {(v.r.status === "draft" || v.r.status === "pending_review") && (
                      <>
                        <Button size="sm" onClick={() => onReview(v, "approve")}>
                          <Check />
                          Approve
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => onReview(v, "reject")}>
                          <XCircle />
                          Reject
                        </Button>
                      </>
                    )}
                    {v.payable && v.remaining > 0 && (
                      <Button size="sm" onClick={() => onPay(v)}>
                        <HandCoins />
                        {toPerson ? "Record payment" : "Record recovered"}
                      </Button>
                    )}
                    {!closed && v.r.status !== "fully_reimbursed" && (
                      <Button size="sm" variant="ghost" onClick={() => onEdit(v)} aria-label={`Edit ${v.r.code}`}>
                        <Pencil />
                      </Button>
                    )}
                    {["approved", "partially_reimbursed", "fully_reimbursed"].includes(v.r.status) && (
                      <Button size="sm" variant="ghost" onClick={() => onReview(v, "adjust")}>
                        Correct amount
                      </Button>
                    )}
                    {!closed && v.paid === 0 && v.r.status !== "draft" && v.r.status !== "pending_review" && (
                      <Button size="sm" variant="ghost" onClick={() => onReview(v, "cancel")}>
                        <Ban />
                        Cancel
                      </Button>
                    )}
                    {closed && canCreate && open.length === 0 && (
                      <Button size="sm" variant="ghost" onClick={() => onReview(v, "reopen")}>
                        <RotateCcw />
                        Reopen
                      </Button>
                    )}
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <DataTile label="Requested">{fmtMoney(v.requested, v.currency)}</DataTile>
                  <DataTile label="Approved">{v.approved === null ? <span className="text-ink-3">Not yet</span> : fmtMoney(v.approved, v.currency)}</DataTile>
                  <DataTile label={toPerson ? "Reimbursed" : "Recovered"}>{fmtMoney(v.paid, v.currency)}</DataTile>
                  <DataTile label="Remaining">
                    <span className={cn(v.remaining > 0 ? "text-status-follow" : "text-ink")}>{v.payable ? fmtMoney(v.remaining, v.currency) : "—"}</span>
                  </DataTile>
                </div>
                <div className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-xs text-ink-3 sm:grid-cols-2">
                  <span>Requested {fmtDate(v.r.requested_on)}{v.r.due_on && ` · due ${fmtDate(v.r.due_on)}`}</span>
                  {v.r.reviewed_at && (
                    <span>
                      Reviewed by {ex.memberName(v.r.reviewed_by)} · {fmtDateTime(v.r.reviewed_at)}
                    </span>
                  )}
                  {v.r.invoice_ref && <span>Client invoice ref #{v.r.invoice_ref}</span>}
                  {v.r.agency_invoice_id && ex.invoiceById.get(v.r.agency_invoice_id) && <span>Agency invoice #{ex.invoiceById.get(v.r.agency_invoice_id)?.number}</span>}
                  {v.r.review_note && <span className="sm:col-span-2">Review note: {v.r.review_note}</span>}
                  {v.r.notes && <span className="whitespace-pre-line sm:col-span-2">Notes: {v.r.notes}</span>}
                </div>
                {v.r.status === "approved" && v.paid === 0 && (
                  <p className="mt-2 text-xs text-info-ink">Approved — not paid. It only shows as paid after a payment is recorded.</p>
                )}

                {v.payments.length > 0 && (
                  <div className="mt-3 border-t border-line pt-3">
                    <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-ink-3">Payments</div>
                    <ul className="space-y-1.5">
                      {v.payments.map((p) => {
                        const pv = ex.index.paymentById.get(p.payment.id);
                        return (
                          <li key={p.payment.id} className={cn("flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-sm", p.reversed && "opacity-60")}>
                            <span className="font-mono text-xs text-link">{p.payment.code}</span>
                            <span className={cn("font-mono tabular-nums text-ink", p.reversed && "line-through")}>{fmtMoney(p.amount, v.currency)}</span>
                            <span className="text-xs text-ink-2">
                              {fmtDate(p.payment.paid_on)} · {PAY_METHOD[p.payment.method] ?? p.payment.method}
                              {p.payment.reference && ` · #${p.payment.reference}`}
                              {pv && pv.allocations.length > 1 && ` · batch of ${pv.allocations.length}`}
                            </span>
                            <span className="text-xs text-ink-3">recorded by {ex.memberName(p.payment.recorded_by)}</span>
                            {p.reversed ? (
                              <Pill tone="red" className="ml-auto">Reversed · {p.reversed.reason}</Pill>
                            ) : (
                              pv && (
                                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => onReverse(pv)}>
                                  <Undo2 />
                                  Reverse
                                </Button>
                              )
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
};

const ExDetail = () => {
  const { id = "" } = useParams();
  const ex = useExpenses();
  const row = ex.index.rowById.get(id);
  const [edit, setEdit] = useState<boolean>(false);
  const [archiveOpen, setArchiveOpen] = useState<boolean>(false);
  const [reason, setReason] = useState<string>("");
  const [reimbDialog, setReimbDialog] = useState<{ dir: Direction; existing: ReimbView | null } | null>(null);
  const [review, setReview] = useState<{ v: ReimbView; mode: ReviewMode } | null>(null);
  const [pay, setPay] = useState<ReimbView | null>(null);
  const [reverse, setReverse] = useState<PaymentView | null>(null);
  const [dupNote, setDupNote] = useState<string>("");
  const [dupOpen, setDupOpen] = useState<boolean>(false);

  const history = useQuery({ queryKey: ["ex", "history", id], enabled: !!row, queryFn: () => api.loadHistory({ expenditureId: id, limit: 400 }) });
  const shiftIds = useMemo(() => ex.data.shiftLinks.filter((l) => l.expenditure_id === id).map((l) => l.shift_id), [ex.data.shiftLinks, id]);
  const shifts = useQuery({ queryKey: ["ex", "linked-shifts", id, shiftIds.join(",")], enabled: shiftIds.length > 0, queryFn: () => api.loadShiftsByIds(shiftIds) });

  const archive = useMutation({
    mutationFn: () => api.archiveExpenditure(id, !row?.e.archived_at, reason),
    onSuccess: () => {
      ex.invalidate();
      toast.success(row?.e.archived_at ? "Expenditure restored" : "Expenditure archived");
      setArchiveOpen(false);
      setReason("");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't update."),
  });
  const confirmDup = useMutation({
    mutationFn: () => api.confirmDuplicate(id, dupNote),
    onSuccess: () => {
      ex.invalidate();
      toast.success("Marked as a legitimate, separate expense");
      setDupOpen(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't update."),
  });

  if (!row) return <NotFound embedded />;
  const e = row.e;
  const archived = !!e.archived_at;
  const views = (dir: Direction) => ex.index.reimbs.filter((v) => v.r.expenditure_id === id && v.r.direction === dir).sort((a, b) => b.r.created_at.localeCompare(a.r.created_at));
  const inv = e.agency_invoice_id ? ex.invoiceById.get(e.agency_invoice_id) : undefined;
  const placement = e.placement_id ? ex.placementById.get(e.placement_id) : undefined;
  const worker = e.payer_worker_id ? ex.workerById.get(e.payer_worker_id) : undefined;
  const payAttachments = Array.from(
    new Map(
      ex.index.reimbs
        .filter((v) => v.r.expenditure_id === id)
        .flatMap((v) => v.payments.map((p) => ex.index.paymentById.get(p.payment.id)))
        .filter((p): p is PaymentView => !!p)
        .flatMap((p) => p.attachments.map((a) => [a.id, a] as const)),
    ).values(),
  );

  return (
    <div>
      <PageHeader
        backTo="/expenditures/records"
        backLabel="Expenditure records"
        title={e.vendor}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm text-link">{e.code}</span>
            <span>{fmtDate(e.spent_on)}</span>
            <span>· {row.category?.name}</span>
            {archived && <Pill tone="slate">Archived</Pill>}
            {e.recurring_id && (
              <Link to="/expenditures/recurring" className="focus-ring rounded">
                <Pill tone="blue">
                  <Repeat className="h-3 w-3" />
                  Monthly recurring
                </Pill>
              </Link>
            )}
            {!row.hasReceipt && <Pill tone="amber">Missing receipt</Pill>}
          </span>
        }
        actions={
          <>
            {!archived && (
              <Button variant="outline" onClick={() => setEdit(true)}>
                <Pencil />
                Edit
              </Button>
            )}
            <Button variant="ghost" onClick={() => setArchiveOpen(true)}>
              {archived ? <ArchiveRestore /> : <Archive />}
              {archived ? "Restore" : "Archive"}
            </Button>
          </>
        }
      />

      {archived && (
        <div className="mb-4 rounded-lg border border-line bg-raised px-4 py-3 text-sm text-ink-2">
          Archived {fmtDateTime(e.archived_at)} by {ex.memberName(e.archived_by)} — {e.archive_reason}. Excluded from totals and reports.
        </div>
      )}
      {row.duplicates.length > 0 && (
        <div className="mb-4 flex flex-col gap-3 rounded-lg border border-status-follow/50 bg-status-follow/10 px-4 py-3 text-sm text-ink sm:flex-row sm:items-center" role="alert">
          <AlertTriangle className="h-4 w-4 shrink-0 text-status-follow" />
          <span className="flex-1">
            Possible duplicate of{" "}
            {row.duplicates.map((d, i) => (
              <span key={d.id}>
                {i > 0 && ", "}
                <Link to={`/expenditures/records/${d.id}`} className="font-mono text-link hover:underline">
                  {d.code}
                </Link>
              </span>
            ))}{" "}
            (same vendor, matching amount within 3 days or same receipt #).
          </span>
          <Button size="sm" variant="outline" onClick={() => setDupOpen(true)}>
            <CheckCircle2 />
            Not a duplicate
          </Button>
        </div>
      )}
      {e.duplicate_reviewed_at && (
        <p className="mb-4 text-xs text-ink-3">
          Duplicate check reviewed by {ex.memberName(e.duplicate_reviewed_by)} · {fmtDateTime(e.duplicate_reviewed_at)} — {e.duplicate_note}
        </p>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          <SectionCard title="Expenditure">
            <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
              <DataTile label="Total amount">
                <span className="font-display text-2xl font-extrabold tabular-nums">{fmtMoney(row.amount, e.currency)}</span>
              </DataTile>
              <DataTile label="Tax included">{e.tax_amount != null ? fmtMoney(toCents(e.tax_amount), e.currency) : ""}</DataTile>
              <DataTile label="Currency">{e.currency}</DataTile>
              <DataTile label="Description" className="col-span-2 lg:col-span-3">{e.description}</DataTile>
              {e.purpose && <DataTile label="Business purpose" className="col-span-2 lg:col-span-3"><span className="whitespace-pre-line">{e.purpose}</span></DataTile>}
              <DataTile label="Paid by">{PAID_BY[e.paid_by as keyof typeof PAID_BY]}</DataTile>
              <DataTile label="Payer">
                {e.paid_by === "business" ? "Business" : e.payer_name}
                {worker && (
                  <Link to={`/workforce/workers/${worker.id}`} className="ml-1.5 inline-flex items-center gap-1 text-xs text-link hover:underline">
                    <Briefcase className="h-3 w-3" />
                    {worker.code}
                  </Link>
                )}
              </DataTile>
              <DataTile label="Payment method">
                {METHOD[e.payment_method]}
                {e.account_label && <span className="ml-1 font-mono text-xs text-ink-2">· {e.account_label}</span>}
              </DataTile>
              <DataTile label="Receipt / invoice #">{e.invoice_ref}</DataTile>
              <DataTile label="Property / client">
                {e.property_id ? (
                  <Link to={`/properties/${e.property_id}`} className="text-link hover:underline">
                    {ex.propertyName(e.property_id)}
                  </Link>
                ) : (
                  e.property_name
                )}
              </DataTile>
              <DataTile label="Agency">{e.agency_id ? ex.agencyById.get(e.agency_id)?.name : ""}</DataTile>
              {placement && (
                <DataTile label="Assignment" className="col-span-2">
                  {ex.workerById.get(placement.workerId)?.name} · {placement.propertyId ? ex.propertyName(placement.propertyId) : placement.propertyName} · from {fmtDate(placement.startDate)}
                </DataTile>
              )}
              {e.agency_invoice_id && (
                <DataTile label="Linked agency invoice" className="col-span-2 lg:col-span-3">
                  {inv ? (
                    <span>
                      <Link to={`/workforce/invoices/${inv.id}`} className="text-link hover:underline">
                        #{inv.number}
                      </Link>{" "}
                      · {fmtMoney(toCents(inv.total))} · {inv.status.replace(/_/g, " ")}
                      {inv.paidOn && ` · paid ${fmtDate(inv.paidOn)}`}
                      {toCents(inv.total) !== row.amount && (
                        <span className="ml-2 text-status-follow">Invoice total differs from this expenditure — check the amount.</span>
                      )}
                      <span className="mt-1 block text-xs text-ink-3">This invoice and this record are the same cost — it's counted once in spending.</span>
                    </span>
                  ) : (
                    "Linked invoice (requires agency financials permission to open)"
                  )}
                </DataTile>
              )}
              {e.notes && <DataTile label="Notes" className="col-span-2 lg:col-span-3"><span className="whitespace-pre-line">{e.notes}</span></DataTile>}
              <DataTile label="Created">{ex.memberName(e.created_by)} · {fmtDateTime(e.created_at)}</DataTile>
              <DataTile label="Last edited" className="col-span-2 lg:col-span-1">{ex.memberName(e.updated_by)} · {fmtDateTime(e.updated_at)}</DataTile>
            </div>
          </SectionCard>

          {shiftIds.length > 0 && (
            <SectionCard title="Linked shifts" subtitle="Schedule shifts this labor expense covers. Profit uses this amount for them instead of the calculated labor cost.">
              {shifts.isLoading ? (
                <Loading />
              ) : shifts.error ? (
                <ErrorBlock message={(shifts.error as Error).message} />
              ) : (
                <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {(shifts.data ?? []).map((s) => (
                    <li key={s.id} className="rounded-md border border-line bg-raised px-3 py-2 text-sm text-ink">
                      {s.staffName} · <span className="font-mono text-xs">{s.date} {formatShiftRange({ start: s.start, end: s.end })}</span>
                      <span className="block text-xs text-ink-3">{ex.propertyName(s.propertyId)}{s.paid && " · marked paid in Schedule"}</span>
                    </li>
                  ))}
                  {shiftIds.length > (shifts.data?.length ?? 0) && <li className="text-xs text-ink-3">{shiftIds.length - (shifts.data?.length ?? 0)} shift(s) were deleted from the schedule.</li>}
                </ul>
              )}
            </SectionCard>
          )}

          <DirectionPanel
            dir="to_person"
            views={views("to_person")}
            flag={e.person_reimb_flag}
            canCreate={!archived && e.paid_by !== "business"}
            createBlocked={e.paid_by === "business" ? "Not applicable — paid by the business." : undefined}
            onCreate={() => setReimbDialog({ dir: "to_person", existing: null })}
            onEdit={(v) => setReimbDialog({ dir: "to_person", existing: v })}
            onReview={(v, mode) => setReview({ v, mode })}
            onPay={setPay}
            onReverse={setReverse}
          />
          <DirectionPanel
            dir="from_client"
            views={views("from_client")}
            flag={e.client_recovery_flag}
            canCreate={!archived}
            onCreate={() => setReimbDialog({ dir: "from_client", existing: null })}
            onEdit={(v) => setReimbDialog({ dir: "from_client", existing: v })}
            onReview={(v, mode) => setReview({ v, mode })}
            onPay={setPay}
            onReverse={setReverse}
          />
        </div>

        <div className="space-y-5">
          <SectionCard title="Receipts" subtitle="Private PDF, JPG or PNG · up to 10 MB each" action={!archived ? <UploadButton target={{ expenditureId: id }} /> : undefined}>
            <AttachmentList
              items={row.receipts}
              allowArchive={!archived}
              emptyText={
                <>
                  <span className="font-medium text-status-follow">Missing receipt</span>
                  <span className="block text-xs text-ink-3">The expense is still recorded. Upload a receipt when you have it.</span>
                </>
              }
            />
          </SectionCard>
          {payAttachments.length > 0 && (
            <SectionCard title="Payment attachments">
              <AttachmentList items={payAttachments} emptyText="" />
            </SectionCard>
          )}
          <SectionCard title="Revision history" subtitle="Append-only: edits, approvals, payments, corrections, downloads and exports.">
            {history.isLoading ? <Loading /> : history.error ? <ErrorBlock message={(history.error as Error).message} onRetry={() => void history.refetch()} /> : <HistoryList entries={history.data ?? []} />}
          </SectionCard>
        </div>
      </div>

      <ExpenditureForm open={edit} onOpenChange={setEdit} expenditure={e} />
      {reimbDialog && (
        <ReimbursementDialog
          open={!!reimbDialog}
          onOpenChange={(o) => !o && setReimbDialog(null)}
          expenditure={e}
          direction={reimbDialog.dir}
          existing={reimbDialog.existing?.r ?? null}
        />
      )}
      <ReviewDialog target={review?.v ?? null} mode={review?.mode ?? "approve"} onClose={() => setReview(null)} />
      <PaymentDialog open={!!pay} onOpenChange={(o) => !o && setPay(null)} direction={(pay?.r.direction as Direction) ?? "to_person"} initial={pay ? [pay] : []} />
      <ReverseDialog target={reverse} onClose={() => setReverse(null)} />
      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={archived ? "Restore this expenditure?" : "Archive this expenditure?"}
        description={
          archived
            ? "It will count in totals and reports again."
            : "Archived records are excluded from totals and reports but never deleted. Open reimbursement requests without payments will be cancelled; requests with payments must have them reversed first."
        }
        confirmLabel={archived ? "Restore" : "Archive"}
        destructive={!archived}
        busy={archive.isPending}
        disabled={!archived && reason.trim().length < 3}
        onConfirm={() => archive.mutate()}
      >
        <AreaField label={archived ? "Note (optional)" : "Reason (required)"} rows={2} value={reason} onChange={setReason} />
      </ConfirmDialog>
      <ConfirmDialog
        open={dupOpen}
        onOpenChange={setDupOpen}
        title="Confirm legitimate expense?"
        description="Clears the duplicate flag on this record. The confirmation is logged."
        confirmLabel="Confirm"
        busy={confirmDup.isPending}
        onConfirm={() => confirmDup.mutate()}
      >
        <AreaField label="Note (optional)" rows={2} value={dupNote} onChange={setDupNote} placeholder="e.g. Two separate purchases on the same day" />
      </ConfirmDialog>
    </div>
  );
};

export default ExDetail;
