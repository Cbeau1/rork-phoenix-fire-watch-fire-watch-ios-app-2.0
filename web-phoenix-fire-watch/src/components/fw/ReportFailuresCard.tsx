import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileWarning, Loader2, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { Card } from "@/components/fw/primitives";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/workforce/kit";
import { fetchRecentFailures, fmtInTz, reportDayLabel, retryReport } from "@/lib/reports/api";
import { friendlyError } from "@/lib/supabase";

export const REPORT_FAILURES_KEY = ["daily-report", "failures"] as const;

/** Daily patrol report emails that failed in the last 7 days. Renders nothing when there are none. */
export const ReportFailuresCard = () => {
  const qc = useQueryClient();
  const failures = useQuery({ queryKey: REPORT_FAILURES_KEY, queryFn: fetchRecentFailures, refetchInterval: 120_000 });

  const retry = useMutation({
    mutationFn: (runId: string) => retryReport(runId),
    onSuccess: (r) => {
      if (r.status === "sent") toast.success(r.test_mode ? "Sent to the test email" : "Report sent");
      else toast.error("Still failing", { description: r.error });
      void qc.invalidateQueries({ queryKey: ["daily-report"] });
    },
    onError: (e) => {
      toast.error("Couldn't retry", { description: friendlyError(e) });
      void qc.invalidateQueries({ queryKey: ["daily-report"] });
    },
  });

  const rows = failures.data ?? [];
  if (rows.length === 0) return null;

  return (
    <Card className="overflow-hidden border-status-follow/40">
      <div className="flex items-center gap-2.5 border-b border-line px-5 py-4 sm:px-6">
        <FileWarning className="h-5 w-5 text-status-follow" />
        <h2 className="font-display text-lg font-bold text-ink">Daily reports that didn't send</h2>
      </div>
      <ul className="divide-y divide-line">
        {rows.map((r) => {
          const autoRetry = r.trigger === "schedule" && r.attempts < 3 && !!r.next_retry_at;
          const busy = retry.isPending && retry.variables === r.id;
          return (
            <li key={r.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:px-6">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={`/properties/${r.property_id}`} className="font-medium text-ink hover:underline">
                    {r.property_name}
                  </Link>
                  <Pill tone="red">Failed</Pill>
                  {autoRetry && <Pill tone="amber">Retrying automatically</Pill>}
                </div>
                <div className="mt-0.5 text-sm text-ink-2">
                  {reportDayLabel(r)} report · {r.attempts} {r.attempts === 1 ? "attempt" : "attempts"}
                  {autoRetry && r.next_retry_at ? ` · next try ${fmtInTz(r.next_retry_at, r.tz, false)}` : ""}
                </div>
                {r.error && <div className="mt-0.5 text-xs text-ink-3">{r.error}</div>}
              </div>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => retry.mutate(r.id)}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Retry now
              </Button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
};
