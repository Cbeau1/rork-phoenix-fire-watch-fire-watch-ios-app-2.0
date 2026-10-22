import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeDollarSign, FileSignature, Loader2, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ConfirmDialog, ErrorBlock, FormDialog, fmtDate, isDate, Pill, TextField, toNum } from "@/components/workforce/kit";
import { useOrgTimezone } from "@/lib/crm/api";
import { money } from "@/lib/crm/types";
import { addBillRate, type BillRate, deleteBillRate, fetchBillRates, rateInEffect, todayIn } from "@/lib/profit/api";
import { friendlyError } from "@/lib/supabase";
import { cn } from "@/lib/utils";

/** Admin-only: what the client pays per guard-hour at this property, with dated history. Feeds the Profit page. */
export const ClientRateCard = ({ propertyId }: { propertyId: string }) => {
  const qc = useQueryClient();
  const tz = useOrgTimezone();
  const today = todayIn(tz);
  const key = ["profit", "bill-rates", propertyId] as const;
  const rates = useQuery({ queryKey: key, queryFn: () => fetchBillRates(propertyId) });
  const [adding, setAdding] = useState<boolean>(false);
  const [removing, setRemoving] = useState<BillRate | null>(null);
  const { hash } = useLocation();

  // Arriving from the Profit page's "Set a rate" link: bring this card into view once it has rendered.
  useEffect(() => {
    if (hash !== "#client-rate" || rates.isLoading) return;
    const t = window.setTimeout(() => document.getElementById("client-rate")?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
    return () => window.clearTimeout(t);
  }, [hash, rates.isLoading]);

  const remove = useMutation({
    mutationFn: (id: string) => deleteBillRate(id),
    onSuccess: () => {
      toast.success("Rate removed");
      setRemoving(null);
      void qc.invalidateQueries({ queryKey: ["profit"] });
    },
    onError: (e) => toast.error("Couldn't remove the rate", { description: friendlyError(e) }),
  });

  const list = rates.data ?? [];
  const current = rateInEffect(list, today);
  const upcoming = list.filter((r) => r.effective_date > today).sort((a, b) => a.effective_date.localeCompare(b.effective_date))[0];

  return (
    <section
      id="client-rate"
      className="mt-5 scroll-mt-24 overflow-hidden rounded-xl border border-line bg-surface shadow-card"
      aria-labelledby="client-rate-title"
    >
      <div className="flex flex-col gap-5 p-6 sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <BadgeDollarSign className={cn("mt-0.5 h-8 w-8 shrink-0", current ? "text-link" : "text-ink-3")} strokeWidth={1.6} />
            <div className="min-w-0">
              <h2 id="client-rate-title" className="font-display text-xl font-bold text-ink sm:text-[22px]">
                Client billing rate
              </h2>
              <p className="mt-1 text-sm text-ink-2">
                What the client pays per guard-hour here. Used for revenue and margin on the{" "}
                <Link to="/profit" className="text-link hover:underline">
                  Profit
                </Link>{" "}
                page. A signed contract's rate is added automatically.
              </p>
            </div>
          </div>
          <Button variant="outline" onClick={() => setAdding(true)} className="sm:shrink-0">
            <Plus />
            {list.length ? "Change rate" : "Set rate"}
          </Button>
        </div>

        {rates.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-ink-2">
            <Loader2 className="h-4 w-4 animate-spin text-link" /> Loading rates…
          </div>
        ) : rates.isError ? (
          <ErrorBlock message={friendlyError(rates.error)} onRetry={() => void rates.refetch()} />
        ) : !current ? (
          <div className="rounded-lg border border-dashed border-status-follow/50 bg-status-follow/5 px-4 py-4 text-sm text-ink-2">
            <span className="font-medium text-ink">No rate yet.</span> Hours worked here show as cost only, with no revenue, until
            you set one.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <div className="rounded-lg border border-line bg-raised px-4 py-3">
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-3">Current rate</div>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="font-display text-[32px] font-extrabold leading-none tabular-nums text-ink">{money(current.hourly_rate)}</span>
                <span className="text-sm text-ink-2">/ hour</span>
              </div>
              <div className="mt-2 text-xs text-ink-3">
                {current.effective_date <= today ? `Since ${fmtDate(current.effective_date)}` : `Starts ${fmtDate(current.effective_date)}`}
                {upcoming && upcoming.id !== current.id && ` · ${money(upcoming.hourly_rate)} from ${fmtDate(upcoming.effective_date)}`}
              </div>
            </div>
            <div className="min-w-0 rounded-lg border border-line bg-raised">
              <div className="px-4 pt-3 text-[11px] font-medium uppercase tracking-[0.14em] text-ink-3">History</div>
              <ul className="mt-1 max-h-48 divide-y divide-line overflow-y-auto">
                {list.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 px-4 py-2">
                    <span className="w-24 shrink-0 font-mono text-[13px] text-ink-2">{fmtDate(r.effective_date, "MMM d, yyyy")}</span>
                    <span className="font-medium tabular-nums text-ink">{money(r.hourly_rate)}</span>
                    {r.source === "contract" ? (
                      <Pill tone="blue">
                        <FileSignature className="h-3 w-3" />
                        Contract
                      </Pill>
                    ) : r.id === current.id ? (
                      <Pill tone="green">In effect</Pill>
                    ) : null}
                    <span className="min-w-0 flex-1 truncate text-xs text-ink-3">{r.note}</span>
                    <button
                      type="button"
                      onClick={() => setRemoving(r)}
                      className="focus-ring rounded p-1.5 text-ink-3 transition-colors hover:bg-status-incident/10 hover:text-status-incident-ink"
                      aria-label={`Remove ${money(r.hourly_rate)} rate from ${fmtDate(r.effective_date)}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>

      <AddRateDialog open={adding} onOpenChange={setAdding} propertyId={propertyId} today={today} />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(v) => !v && setRemoving(null)}
        title="Remove this rate?"
        description={
          removing
            ? `${money(removing.hourly_rate)}/hr from ${fmtDate(removing.effective_date)} will be removed. Revenue for those dates will use the rate before it instead.`
            : undefined
        }
        confirmLabel="Remove"
        destructive
        busy={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id)}
      />
    </section>
  );
};

const AddRateDialog = ({
  open,
  onOpenChange,
  propertyId,
  today,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  propertyId: string;
  today: string;
}) => {
  const qc = useQueryClient();
  const [rate, setRate] = useState<string>("");
  const [from, setFrom] = useState<string>(today);
  const [note, setNote] = useState<string>("");
  const [errors, setErrors] = useState<{ rate?: string; from?: string }>({});

  const reset = () => {
    setRate("");
    setFrom(today);
    setNote("");
    setErrors({});
  };

  const save = useMutation({
    mutationFn: () => addBillRate(propertyId, toNum(rate) ?? 0, from, note),
    onSuccess: () => {
      toast.success("Client rate saved");
      void qc.invalidateQueries({ queryKey: ["profit"] });
      reset();
      onOpenChange(false);
    },
    onError: (e) => toast.error("Couldn't save the rate", { description: friendlyError(e) }),
  });

  const submit = () => {
    const r = toNum(rate);
    const next: typeof errors = {};
    if (r == null || r <= 0 || r >= 10000) next.rate = "Enter an hourly rate above $0.";
    if (!isDate(from)) next.from = "Pick the date this rate starts.";
    setErrors(next);
    if (Object.keys(next).length === 0) save.mutate();
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
      title="Set client rate"
      description="Hours worked on or after the start date are billed at this rate. Earlier hours keep their old rate."
      dirty={rate !== "" || note !== "" || from !== today}
      saving={save.isPending}
      onSubmit={submit}
      submitLabel="Save rate"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Hourly rate ($)" value={rate} onChange={setRate} inputMode="decimal" placeholder="38.00" required error={errors.rate} />
        <TextField label="Starts on" type="date" value={from} onChange={setFrom} required error={errors.from} />
      </div>
      <TextField label="Note (optional)" value={note} onChange={setNote} placeholder="e.g. 2027 rate increase" maxLength={300} />
    </FormDialog>
  );
};
