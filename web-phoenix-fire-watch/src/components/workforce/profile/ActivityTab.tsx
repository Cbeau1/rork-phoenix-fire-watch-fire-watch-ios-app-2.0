import { useQuery } from "@tanstack/react-query";

import { Empty, ErrorBlock, fmtDateTime, Loading, SectionCard } from "@/components/workforce/kit";
import * as api from "@/lib/workforce/api";
import { AUDIT_ACTION, ENTITY_LABEL, type AuditEntry } from "@/lib/workforce/constants";
import { cn } from "@/lib/utils";

const FIELD_HIDE = new Set(["id", "org_id", "created_at", "created_by", "updated_at"]);

export const AuditList = ({ entries }: { entries: AuditEntry[] }) =>
  entries.length === 0 ? (
    <Empty title="No activity yet" />
  ) : (
    <ol className="space-y-2">
      {entries.map((a) => {
        const fields = a.changed_fields.filter((f) => !FIELD_HIDE.has(f));
        const label = (a.meta as { label?: string } | null)?.label;
        return (
          <li key={a.id} className="rounded-lg border border-line bg-raised px-4 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm text-ink">
                <span
                  className={cn(
                    "font-medium",
                    ["view", "preview", "download", "export"].includes(a.action) ? "text-sky-300" : a.action === "purge" || a.action === "delete" ? "text-status-incident" : "text-ink",
                  )}
                >
                  {AUDIT_ACTION[a.action] ?? a.action}
                </span>{" "}
                · {ENTITY_LABEL[a.entity_type] ?? a.entity_type}
                {label && <span className="text-ink-2"> — {label}</span>}
              </span>
              <span className="text-xs text-ink-3">{fmtDateTime(a.created_at)}</span>
            </div>
            <div className="mt-0.5 text-xs text-ink-2">
              {a.actor_name || "System"}
              {a.summary && <> · {a.summary.replace(/_/g, " ")}</>}
              {fields.length > 0 && a.action !== "create" && <> · Fields: {fields.map((f) => f.replace(/_/g, " ")).join(", ")}</>}
            </div>
          </li>
        );
      })}
    </ol>
  );

/** Worker activity from the append-only audit log (entries are filtered by the viewer's permissions server-side). */
export const ActivityTab = ({ workerId }: { workerId: string }) => {
  const q = useQuery({ queryKey: ["wf", "audit", "worker", workerId], queryFn: () => api.listAudit({ workerId, limit: 300 }) });
  return (
    <SectionCard title="Activity" subtitle="Append-only audit history: who created, changed, viewed, downloaded or exported what, and when.">
      {q.isLoading ? <Loading /> : q.error ? <ErrorBlock message={(q.error as Error).message} onRetry={() => void q.refetch()} /> : <AuditList entries={q.data ?? []} />}
    </SectionCard>
  );
};
