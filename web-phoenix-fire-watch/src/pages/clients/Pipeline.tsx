import { formatDistanceToNowStrict } from "date-fns";
import { ArrowRight, Building2, ChevronDown, Loader2, MoreHorizontal, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { PageHeader } from "@/components/fw/primitives";
import { ConfirmDialog, Empty, ErrorBlock, Loading, Pill, TextField } from "@/components/workforce/kit";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { crm, useBoard, useInvalidateCrm } from "@/lib/crm/api";
import { type BoardDeal, COVERAGE_LABEL, dealWeekly, money, NEXT_ACTION, STAGE_META, STAGES, type Stage } from "@/lib/crm/types";
import { friendlyError } from "@/lib/supabase";
import { cn } from "@/lib/utils";

import { IntakeDialog } from "./IntakeDialog";

export const useStageMove = () => {
  const invalidate = useInvalidateCrm();
  const [busy, setBusy] = useState<string | null>(null);
  const move = async (deal: Pick<BoardDeal, "id">, stage: Stage, lostReason?: string) => {
    setBusy(deal.id);
    try {
      await crm.updateDeal(deal.id, stage === "lost" ? { stage, lost_reason: lostReason ?? "" } : { stage, lost_reason: "" });
      await invalidate();
      toast.success(`Moved to ${STAGE_META[stage].label}`);
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setBusy(null);
    }
  };
  return { move, busy };
};

export const LostDialog = ({
  open,
  onOpenChange,
  onConfirm,
  busy,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (reason: string) => void;
  busy?: boolean;
}) => {
  const [reason, setReason] = useState("");
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(v) => {
        if (!v) setReason("");
        onOpenChange(v);
      }}
      title="Mark this lead lost?"
      description="It leaves the pipeline but stays on the client's record. You can reopen it any time."
      confirmLabel="Mark lost"
      destructive
      busy={busy}
      onConfirm={() => onConfirm(reason.trim())}
    >
      <TextField label="Reason (optional)" value={reason} onChange={setReason} placeholder="e.g. Went with another company, price, job cancelled" />
    </ConfirmDialog>
  );
};

const DealCard = ({ deal, onMove, onLost, busy }: { deal: BoardDeal; onMove: (s: Stage) => void; onLost: () => void; busy: boolean }) => {
  const { rate, hours, weekly } = dealWeekly(deal);
  const next = NEXT_ACTION[deal.stage];
  const quote = deal.quotes.length ? [...deal.quotes].sort((a, b) => b.created_at.localeCompare(a.created_at))[0] : null;
  const contract = deal.contracts.length ? [...deal.contracts].sort((a, b) => b.created_at.localeCompare(a.created_at))[0] : null;
  return (
    <li className="group relative rounded-xl border border-line bg-surface p-3.5 shadow-sm transition-colors hover:border-line-strong">
      <Link to={`/clients/deals/${deal.id}`} className="focus-ring block rounded-lg after:absolute after:inset-0 after:content-['']">
        <p className="truncate font-display text-[15px] font-bold leading-tight text-ink">{deal.client?.name ?? "Client"}</p>
        <p className="mt-1 flex items-center gap-1.5 truncate text-xs text-ink-2">
          <Building2 className="h-3.5 w-3.5 shrink-0 text-ink-3" />
          <span className="truncate">{deal.property?.name || deal.property?.address || "No property yet"}</span>
        </p>
      </Link>
      <div className="mt-3 flex items-end justify-between gap-2">
        <div>
          <p className="font-mono text-[15px] font-semibold tabular-nums text-ink">{weekly != null ? `${money(weekly, false)}/wk` : "—"}</p>
          <p className="text-[11px] text-ink-3">
            {rate != null ? `${money(rate)}/hr` : "No rate"} · {hours ? `${hours} h/wk` : COVERAGE_LABEL[deal.coverage]}
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-1">
          {contract && contract.status !== "void" && <Pill tone={contract.status === "signed" ? "green" : contract.status === "sent" ? "amber" : "slate"}>C-{contract.number}</Pill>}
          {!contract && quote && <Pill tone={quote.status === "accepted" ? "green" : quote.status === "declined" ? "red" : "slate"}>Q-{quote.number}</Pill>}
        </div>
      </div>
      <div className="relative z-10 mt-3 flex items-center gap-1.5 border-t border-line pt-2.5">
        <span className="mr-auto text-[11px] text-ink-3">{formatDistanceToNowStrict(new Date(deal.stage_changed_at), { addSuffix: true })}</span>
        {next && (
          <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs text-link" disabled={busy} onClick={() => onMove(next.to)}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
            {STAGE_META[next.to].label}
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Move or close" disabled={busy}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="border-line bg-surface text-ink">
            <DropdownMenuLabel className="text-xs text-ink-3">Move to</DropdownMenuLabel>
            {STAGES.filter((s) => s !== deal.stage).map((s) => (
              <DropdownMenuItem key={s} onSelect={() => onMove(s)}>
                <span className={cn("mr-2 h-2 w-2 rounded-full", STAGE_META[s].dot)} />
                {STAGE_META[s].label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            {deal.stage === "lost" ? (
              <DropdownMenuItem onSelect={() => onMove("lead")}>Reopen as lead</DropdownMenuItem>
            ) : (
              <DropdownMenuItem className="text-status-incident-ink focus:text-status-incident-ink" onSelect={onLost}>
                Mark lost…
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
};

const Pipeline = () => {
  const board = useBoard();
  const { move, busy } = useStageMove();
  const [intake, setIntake] = useState(false);
  const [search, setSearch] = useState("");
  const [showLost, setShowLost] = useState(false);
  const [lostFor, setLostFor] = useState<BoardDeal | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (board.data ?? []).filter(
      (d) => !q || [d.client?.name, d.property?.name, d.property?.address, d.reason].some((s) => (s ?? "").toLowerCase().includes(q)),
    );
  }, [board.data, search]);

  const columns = useMemo(() => {
    const cols = (showLost ? [...STAGES, "lost" as Stage] : STAGES).map((stage) => {
      const deals = filtered.filter((d) => d.stage === stage);
      const value = deals.reduce((s, d) => s + (dealWeekly(d).weekly ?? 0), 0);
      return { stage, deals, value };
    });
    return cols;
  }, [filtered, showLost]);

  const openValue = columns
    .filter((c) => c.stage === "lead" || c.stage === "quoted" || c.stage === "contract_sent")
    .reduce((s, c) => s + c.value, 0);
  const activeValue = columns.filter((c) => c.stage === "signed" || c.stage === "active").reduce((s, c) => s + c.value, 0);
  const lostCount = (board.data ?? []).filter((d) => d.stage === "lost").length;

  return (
    <div>
      <PageHeader
        title="Pipeline"
        subtitle="Every fire watch request from first call to finished job."
        actions={
          <Button onClick={() => setIntake(true)}>
            <Plus />
            New intake
          </Button>
        }
      />

      {board.isLoading ? (
        <Loading label="Loading pipeline…" />
      ) : board.error ? (
        <ErrorBlock message={friendlyError(board.error)} onRetry={() => void board.refetch()} />
      ) : (board.data ?? []).length === 0 ? (
        <Empty
          title="No leads yet"
          description="When a property manager calls for fire watch, add them here. You'll quote, send the contract for e-signature, and track the job in one place."
          action={
            <Button onClick={() => setIntake(true)}>
              <Plus />
              Add first intake
            </Button>
          }
        />
      ) : (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-line bg-surface px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-3">Open pipeline</p>
              <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-ink">{money(openValue, false)}<span className="text-sm text-ink-3">/wk</span></p>
            </div>
            <div className="rounded-xl border border-line bg-surface px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-3">Signed & active</p>
              <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-status-clear">{money(activeValue, false)}<span className="text-sm text-ink-3">/wk</span></p>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2">
              <Search className="h-4 w-4 shrink-0 text-ink-3" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search client or property"
                aria-label="Search pipeline"
                className="h-9 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
              />
            </div>
          </div>

          <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0">
            <div className="flex w-max gap-3 lg:grid lg:w-full lg:auto-cols-fr lg:grid-flow-col">
              {columns.map(({ stage, deals, value }) => (
                <section key={stage} aria-label={STAGE_META[stage].label} className="flex w-[268px] flex-col rounded-2xl border border-line bg-rail/50 lg:w-auto lg:min-w-[200px]">
                  <header className="border-b border-line px-3.5 py-3">
                    <div className="flex items-center gap-2">
                      <span className={cn("h-2 w-2 rounded-full", STAGE_META[stage].dot)} />
                      <h2 className="font-display text-sm font-bold uppercase tracking-[0.06em] text-ink">{STAGE_META[stage].label}</h2>
                      <span className="ml-auto rounded-full bg-raised px-2 py-0.5 font-mono text-xs tabular-nums text-ink-2">{deals.length}</span>
                    </div>
                    <p className="mt-1 font-mono text-xs tabular-nums text-ink-3">{value > 0 ? `${money(value, false)}/wk` : STAGE_META[stage].hint}</p>
                  </header>
                  <ul className="flex flex-1 flex-col gap-2.5 p-2.5">
                    {deals.length === 0 ? (
                      <li className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-xs text-ink-3">Nothing here</li>
                    ) : (
                      deals.map((d) => (
                        <DealCard key={d.id} deal={d} busy={busy === d.id} onMove={(s) => void move(d, s)} onLost={() => setLostFor(d)} />
                      ))
                    )}
                  </ul>
                </section>
              ))}
            </div>
          </div>
          {lostCount > 0 && (
            <button
              type="button"
              onClick={() => setShowLost((v) => !v)}
              className="focus-ring mt-1 inline-flex items-center gap-1.5 rounded text-sm text-ink-2 hover:text-ink"
            >
              <ChevronDown className={cn("h-4 w-4 transition-transform", showLost && "rotate-180")} />
              {showLost ? "Hide" : "Show"} lost ({lostCount})
            </button>
          )}
        </>
      )}

      <IntakeDialog open={intake} onOpenChange={setIntake} />
      <LostDialog
        open={!!lostFor}
        onOpenChange={(v) => !v && setLostFor(null)}
        busy={!!lostFor && busy === lostFor.id}
        onConfirm={(reason) => {
          if (!lostFor) return;
          void move(lostFor, "lost", reason).then(() => setLostFor(null));
        }}
      />
    </div>
  );
};

export default Pipeline;
