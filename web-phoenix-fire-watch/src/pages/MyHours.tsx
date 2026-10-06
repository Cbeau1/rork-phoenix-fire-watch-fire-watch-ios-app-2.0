import { useQuery } from "@tanstack/react-query";
import { addDays, format } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";

import { PageHeader } from "@/components/fw/primitives";
import { TimeClockCard } from "@/components/fw/TimeClockCard";
import { Button } from "@/components/ui/button";
import { Empty, ErrorBlock, Loading, MetaPill, SectionCard } from "@/components/workforce/kit";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useNow } from "@/hooks/use-now";
import { timeOfDay } from "@/lib/format";
import { currentPeriod, ENTRY_STATUS, entryMinutes, fmtDuration, loadEntries, periodLabel, type PayPeriod } from "@/lib/timeclock";
import { useAuth } from "@/state/AuthProvider";

/** Employee view: clock in/out, and the clock-in, clock-out and hours worked for each shift. */
const MyHours = () => {
  useDocumentTitle("My Hours");
  const { user } = useAuth();
  const uid = user?.id ?? "";
  const [period, setPeriod] = useState<PayPeriod>(() => currentPeriod(7));
  const q = useQuery({
    queryKey: ["tc", "mine", uid, period.start.toISOString(), period.days],
    enabled: !!uid,
    queryFn: () => loadEntries(period, uid),
  });
  const entries = useMemo(() => [...(q.data ?? [])].reverse(), [q.data]);
  const hasOpen = entries.some((e) => !e.clockOut);
  const now = useNow(30_000, hasOpen);
  const total = entries.reduce((s, e) => s + (e.status === "rejected" ? 0 : entryMinutes(e, now)), 0);

  const shift = (dir: number) => setPeriod((p) => ({ ...p, start: addDays(p.start, dir * 7) }));
  const isCurrent = period.start.getTime() >= currentPeriod(7).start.getTime();

  return (
    <>
      <PageHeader title="My Hours" subtitle="Clock in when your shift starts and clock out when it ends." />
      <TimeClockCard showLink={false} />

      <SectionCard
        className="mt-5"
        title="Hours worked"
        subtitle={periodLabel(period)}
        action={
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" aria-label="Previous week" onClick={() => shift(-1)}>
              <ChevronLeft />
            </Button>
            <Button variant="outline" size="icon" aria-label="Next week" onClick={() => shift(1)} disabled={isCurrent}>
              <ChevronRight />
            </Button>
          </div>
        }
      >
        <div className="mb-3 flex items-baseline justify-between rounded-lg border border-line bg-raised px-4 py-3">
          <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-3">Week total</span>
          <span className="font-mono text-2xl font-bold tabular-nums text-ink">{fmtDuration(total)}</span>
        </div>
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <ErrorBlock message={q.error.message} onRetry={() => void q.refetch()} />
        ) : entries.length === 0 ? (
          <Empty title="No hours this week" description="Your clock-ins will appear here." />
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-raised">
            {entries.map((e) => (
              <li key={e.id} className="flex items-center gap-4 px-4 py-3.5">
                <div className="w-14 shrink-0 text-center">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">{format(new Date(e.clockIn), "EEE")}</div>
                  <div className="font-display text-xl font-bold text-ink">{format(new Date(e.clockIn), "d")}</div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-[15px] tabular-nums text-ink">
                    {timeOfDay(e.clockIn)} → {e.clockOut ? timeOfDay(e.clockOut) : "now"}
                  </div>
                  <div className="mt-1">
                    <MetaPill meta={ENTRY_STATUS} value={e.status} />
                  </div>
                </div>
                <div className="font-mono text-lg font-semibold tabular-nums text-ink">{fmtDuration(entryMinutes(e, now))}</div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </>
  );
};

export default MyHours;
