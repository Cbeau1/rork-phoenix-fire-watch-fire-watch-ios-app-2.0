import { useQuery } from "@tanstack/react-query";
import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import { AlertTriangle, FileStack, Paperclip } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Empty, ErrorBlock, FormDialog, isDate, Loading, SelectField, TextField } from "@/components/workforce/kit";
import { toDateKey, weekStartOf } from "@/lib/schedule";
import { supabase } from "@/lib/supabase";
import { fmtHours } from "@/lib/timeclock";
import { downloadPacket, loadPacket, packetCards, rangeLabel } from "@/lib/timeCardPacket";
import { cn } from "@/lib/utils";
import * as api from "@/lib/workforce/api";
import { useAuth } from "@/state/AuthProvider";
import { useFireWatch } from "@/state/FireWatchProvider";

const MAX_DAYS = 31;

const weekOf = (offset: number) => {
  const s = addDays(weekStartOf(new Date()), offset * 7);
  return { from: toDateKey(s), to: toDateKey(addDays(s, 6)) };
};

/**
 * Downloads one PDF for a date range: every temp-agency worker who worked, the days and hours of each shift,
 * and the signed time card for that shift on the following pages.
 */
export const TimeCardPacketDialog = ({
  open,
  onOpenChange,
  initialFrom,
  initialTo,
  initialAgencyId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialFrom?: string;
  initialTo?: string;
  initialAgencyId?: string;
}) => {
  const { user } = useAuth();
  const { propertyById } = useFireWatch();
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [agencyId, setAgencyId] = useState<string>("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const wk = weekOf(0);
    setFrom(initialFrom ?? wk.from);
    setTo(initialTo ?? wk.to);
    setAgencyId(initialAgencyId ?? "");
    setProgress(null);
  }, [open, initialFrom, initialTo, initialAgencyId]);

  const agenciesQ = useQuery({
    queryKey: ["packet-agencies", user?.orgId ?? ""],
    enabled: open,
    staleTime: 120_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("wf_agencies").select("id, name, archived_at").order("name");
      if (error) throw api.wfError(error);
      return data ?? [];
    },
  });

  const span = isDate(from) && isDate(to) ? differenceInCalendarDays(parseISO(to), parseISO(from)) + 1 : 0;
  const rangeError = !isDate(from) || !isDate(to) ? "Choose both dates." : span < 1 ? "End date must be on or after the start." : span > MAX_DAYS ? `Pick ${MAX_DAYS} days or fewer.` : "";
  const siteName = (id: string | null) => (id ? (propertyById.get(id)?.name ?? "Removed site") : "—");

  const packetQ = useQuery({
    queryKey: ["packet", user?.orgId ?? "", from, to, agencyId],
    enabled: open && !rangeError,
    staleTime: 15_000,
    queryFn: () => loadPacket({ from, to, agencyId: agencyId || undefined, siteName }),
  });
  const packet = packetQ.data;
  const cards = useMemo(() => (packet ? packetCards(packet) : []), [packet]);
  const agencyLabel = agencyId ? (agenciesQ.data?.find((a) => a.id === agencyId)?.name ?? "Agency") : "All agencies";
  const dayKeys = useMemo(
    () => (span > 0 && span <= 7 ? Array.from({ length: span }, (_, i) => toDateKey(addDays(parseISO(from), i))) : []),
    [from, span],
  );

  const presets = [
    { label: "This week", ...weekOf(0) },
    { label: "Last week", ...weekOf(-1) },
  ];

  const download = async () => {
    if (!packet || packet.workers.length === 0) return;
    setProgress({ done: 0, total: cards.length });
    try {
      await api.logEvent("export", "time_entries", `Downloaded temp time card packet ${from} to ${to}`, { perm: "finance" }).catch(() => undefined);
      await downloadPacket(packet, {
        orgName: user?.orgName ?? "",
        preparedBy: user?.name ?? "",
        agencyLabel,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      toast.success("Time card packet downloaded");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't build the packet.");
    } finally {
      setProgress(null);
    }
  };

  const missing = packet ? packet.workers.reduce((n, w) => n + w.shifts.filter((s) => s.cards.length === 0 && s.entry.clockOut).length, 0) : 0;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Temp time card packet"
      description="One PDF with each temp worker's days and hours, followed by the time card for every shift."
      dirty={false}
      saving={!!progress}
      submitLabel={progress ? (progress.total > 0 ? `Adding time cards ${progress.done}/${progress.total}…` : "Preparing…") : "Download PDF"}
      onSubmit={() => {
        if (rangeError) return;
        if (!packet || packet.workers.length === 0) {
          toast.error("No temp worker shifts in this period.");
          return;
        }
        void download();
      }}
      wide
    >
      <div className="flex flex-wrap gap-2">
        {presets.map((p) => {
          const on = p.from === from && p.to === to;
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => {
                setFrom(p.from);
                setTo(p.to);
              }}
              className={cn(
                "focus-ring rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
                on ? "border-primary bg-primary text-white" : "border-line bg-raised text-ink-2 hover:text-ink",
              )}
            >
              {p.label}
              <span className={cn("ml-1.5 text-xs", on ? "text-white/80" : "text-ink-3")}>{rangeLabel(p.from, p.to).replace(/, \d{4}$/, "")}</span>
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <TextField label="From" type="date" required value={from} onChange={setFrom} />
        <TextField label="To" type="date" required value={to} onChange={setTo} error={rangeError && isDate(from) && isDate(to) ? rangeError : undefined} />
        <SelectField
          label="Agency"
          value={agencyId}
          onChange={setAgencyId}
          allowNone
          noneLabel="All agencies"
          options={(agenciesQ.data ?? []).filter((a) => !a.archived_at || a.id === agencyId).map((a) => ({ value: a.id, label: a.name }))}
        />
      </div>

      <div className="rounded-lg border border-line">
        <div className="flex items-center justify-between gap-2 border-b border-line px-3.5 py-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">In this packet</span>
          {packet && packet.workers.length > 0 && (
            <span className="text-xs tabular-nums text-ink-3">
              {packet.workers.length} {packet.workers.length === 1 ? "worker" : "workers"} · {fmtHours(packet.workers.reduce((n, w) => n + w.minutes, 0))} hrs · {cards.length}{" "}
              {cards.length === 1 ? "time card" : "time cards"}
            </span>
          )}
        </div>
        {rangeError ? (
          <div className="px-3.5 py-6 text-center text-sm text-ink-3">{rangeError}</div>
        ) : packetQ.isLoading ? (
          <Loading label="Gathering shifts and time cards…" />
        ) : packetQ.isError ? (
          <ErrorBlock message={packetQ.error instanceof Error ? packetQ.error.message : "Couldn't load shifts."} onRetry={() => void packetQ.refetch()} />
        ) : !packet || packet.workers.length === 0 ? (
          <Empty title="No temp worker shifts" description={`Nobody from ${agencyId ? agencyLabel : "a temp agency"} clocked in between ${isDate(from) && isDate(to) ? rangeLabel(from, to) : "these dates"}.`} />
        ) : (
          <ul className="max-h-72 divide-y divide-line overflow-y-auto">
            {packet.workers.map((w) => {
              const attached = w.shifts.reduce((n, s) => n + s.cards.length, 0) + w.loose.length;
              const without = w.shifts.filter((s) => s.cards.length === 0 && s.entry.clockOut).length;
              return (
                <li key={w.key} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3.5 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink">{w.name}</div>
                    <div className="text-xs text-ink-3">
                      {w.agency || "Temp agency"} · {new Set(w.shifts.map((s) => s.day)).size} days · {w.shifts.length} {w.shifts.length === 1 ? "shift" : "shifts"}
                    </div>
                  </div>
                  {dayKeys.length > 0 && (
                    <div className="flex gap-1" aria-label="Days worked">
                      {dayKeys.map((d) => {
                        const s = w.shifts.filter((x) => x.day === d);
                        const worked = s.length > 0;
                        const carded = worked && s.every((x) => x.cards.length > 0 || !x.entry.clockOut);
                        return (
                          <span
                            key={d}
                            title={`${format(parseISO(d), "EEE MMM d")}${worked ? ` · ${fmtHours(s.reduce((n, x) => n + x.minutes, 0))} hrs${carded ? " · time card attached" : " · no time card"}` : " · off"}`}
                            className={cn(
                              "grid h-7 w-7 place-items-center rounded-md text-[11px] font-semibold",
                              !worked && "bg-raised text-ink-3/60",
                              worked && carded && "bg-primary text-white",
                              worked && !carded && "bg-status-follow/20 text-status-follow ring-1 ring-inset ring-status-follow/60",
                            )}
                          >
                            {format(parseISO(d), "EEEEE")}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  <div className="w-20 text-right">
                    <div className="font-mono text-sm font-semibold tabular-nums text-ink">{fmtHours(w.minutes)}</div>
                    <div className="text-[11px] text-ink-3">hrs</div>
                  </div>
                  <div className={cn("flex w-16 items-center justify-end gap-1 text-xs tabular-nums", without > 0 ? "text-status-follow" : "text-ink-2")}>
                    <Paperclip className="h-3.5 w-3.5" />
                    {attached}/{w.shifts.length}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {packet && missing > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-status-follow/50 bg-status-follow/10 px-3.5 py-2.5 text-sm text-ink">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-follow" />
          {missing} {missing === 1 ? "shift has" : "shifts have"} no time card yet. They're still listed, marked “Missing”. Attach tickets from Payroll with the paperclip.
        </div>
      )}
      {packet && packet.workers.length > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-ink-3">
          <FileStack className="h-3.5 w-3.5" />
          Each time card gets its own page, labeled with the worker, day and hours (TC-01, TC-02…). Large weeks can take a minute.
        </p>
      )}
    </FormDialog>
  );
};
