import { AlertTriangle, CheckCircle2, CloudOff, CloudUpload, Loader2, RotateCw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fullDateTime, timeAgo } from "@/lib/format";
import type { OutboxOp } from "@/lib/offline-store";
import { cn } from "@/lib/utils";
import { useFireWatch } from "@/state/FireWatchProvider";

const describe = (op: OutboxOp): { title: string; detail: string } => {
  switch (op.kind) {
    case "patrol.create":
      return {
        title: "Patrol log",
        detail: `${op.patrol.officerName} · ${fullDateTime(op.patrol.dateTime)}${op.photos.length ? ` · ${op.uploaded.length}/${op.photos.length} photos uploaded` : ""}`,
      };
    case "property.create":
      return { title: "New property", detail: op.property.name };
    case "property.update":
      return { title: "Property edit", detail: op.property.name };
    case "note.create":
      return { title: "Watch note", detail: op.note.content.slice(0, 60) };
    case "note.resolve":
      return { title: "Resolve note", detail: "Mark note resolved" };
    case "note.restore":
      return { title: "Restore note", detail: op.note.content.slice(0, 60) };
  }
};

/** Connection + offline queue indicator with a detail popover. */
export const SyncStatus = ({ compact = false, iconOnly = false }: { compact?: boolean; iconOnly?: boolean }) => {
  const { sync } = useFireWatch();
  const { online, syncing, pendingCount, failedCount, queue, lastSyncedAt } = sync;
  const [open, setOpen] = useState<boolean>(false);

  const prevPending = useRef<number>(pendingCount);
  useEffect(() => {
    if (prevPending.current > 0 && pendingCount === 0 && online && failedCount === 0) {
      toast.success("All changes synced", { description: "Offline patrols, photos and notes are now uploaded." });
    }
    prevPending.current = pendingCount;
  }, [pendingCount, online, failedCount]);

  const prevOnline = useRef<boolean>(online);
  useEffect(() => {
    if (prevOnline.current && !online) {
      toast("You're offline", { description: "Keep logging — everything will upload when you reconnect." });
    }
    prevOnline.current = online;
  }, [online]);

  let tone = "text-status-clear";
  let label = "Synced";
  let Icon = CheckCircle2;
  if (failedCount > 0) {
    tone = "text-status-incident-ink";
    label = `${failedCount} need attention`;
    Icon = AlertTriangle;
  } else if (!online) {
    tone = "text-status-follow";
    label = pendingCount ? `Offline · ${pendingCount} waiting` : "Offline";
    Icon = CloudOff;
  } else if (syncing || pendingCount > 0) {
    tone = "text-link";
    label = pendingCount ? `Uploading ${pendingCount}…` : "Syncing…";
    Icon = syncing ? Loader2 : CloudUpload;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Sync status: ${label}`}
          className={cn(
            "focus-ring inline-flex items-center gap-2 rounded-lg border border-line bg-surface text-xs font-medium transition-colors hover:border-line-strong",
            iconOnly ? "h-11 w-11 justify-center" : compact ? "h-10 px-3" : "w-full px-3 py-2",
          )}
        >
          <Icon className={cn("h-4 w-4 shrink-0", tone, Icon === Loader2 && "animate-spin")} />
          {!iconOnly && <span className={cn("truncate", compact ? "hidden sm:inline" : "", tone)}>{label}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align={iconOnly ? "end" : compact ? "end" : "start"}
        side={iconOnly ? "right" : undefined}
        className="w-[320px] border-line bg-surface p-0 text-ink">
        <div className="border-b border-line px-4 py-3.5">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <span className={cn("h-2 w-2 rounded-full", online ? "bg-status-clear" : "bg-status-follow")} />
            {online ? "Online" : "Offline"}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-ink-2">
            {online
              ? lastSyncedAt
                ? `Last upload ${timeAgo(lastSyncedAt)}.`
                : "Changes upload instantly while you're connected."
              : "Patrols, photos and notes are saved on this device and upload automatically when you reconnect."}
          </p>
        </div>
        {queue.length === 0 ? (
          <div className="px-4 py-5 text-center text-xs text-ink-3">Nothing waiting to upload.</div>
        ) : (
          <ul className="max-h-72 divide-y divide-line overflow-y-auto">
            {queue.map((op) => {
              const d = describe(op);
              return (
                <li key={op.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className={cn("text-sm font-medium", op.failed ? "text-status-incident-ink" : "text-ink")}>
                        {d.title}
                      </div>
                      <div className="truncate text-xs text-ink-3">{d.detail}</div>
                      {op.error && <div className="mt-1 text-xs text-status-incident-ink/90">{op.error}</div>}
                    </div>
                    {op.failed && (
                      <div className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          aria-label="Retry"
                          onClick={() => void sync.retryOp(op.id)}
                          className="focus-ring flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-raised hover:text-ink"
                        >
                          <RotateCw className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label="Discard change"
                          onClick={() => void sync.discardOp(op.id)}
                          className="focus-ring flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-status-incident/10 hover:text-status-incident-ink"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {online && pendingCount > 0 && (
          <div className="border-t border-line p-3">
            <button
              type="button"
              onClick={() => void sync.syncNow()}
              disabled={syncing}
              className="focus-ring flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-60"
            >
              {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudUpload className="h-4 w-4" />}
              Upload now
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};
