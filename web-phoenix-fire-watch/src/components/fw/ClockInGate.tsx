import createContextHook from "@nkzw/create-context-hook";
import { Clock, Loader2, LogIn } from "lucide-react";
import { useCallback, useState, type MouseEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useFireWatch } from "@/state/FireWatchProvider";
import { useMyClock } from "@/state/useTimeClock";

const logPath = (propertyId: string): string => `/properties/${propertyId}/log`;

/**
 * Every "Log Patrol" entry point goes through here: if the officer isn't clocked in, a prompt offers
 * to clock in first and then continues to the patrol form.
 */
export const [LogPatrolGateProvider, useLogPatrolGate] = createContextHook(() => {
  const navigate = useNavigate();
  const { open, loading } = useMyClock();
  const [pendingId, setPendingId] = useState<string | null>(null);

  /** Returns true when the prompt was shown instead of navigating (use to cancel a link click). */
  const intercept = useCallback(
    (propertyId: string): boolean => {
      if (loading || open) return false;
      setPendingId(propertyId);
      return true;
    },
    [loading, open],
  );

  const openLogPatrol = useCallback(
    (propertyId: string) => {
      if (!intercept(propertyId)) navigate(logPath(propertyId));
    },
    [intercept, navigate],
  );

  /** onClick for <Link to=".../log"> — opens the prompt and cancels navigation when not clocked in. */
  const linkGuard = useCallback(
    (propertyId: string) => (e: MouseEvent) => {
      if (intercept(propertyId)) e.preventDefault();
    },
    [intercept],
  );

  return { pendingId, setPendingId, openLogPatrol, linkGuard };
});

/** Wraps the signed-in app so any screen can trigger the clock-in prompt. */
export const LogPatrolGate = ({ children }: { children: ReactNode }) => (
  <LogPatrolGateProvider>
    {children}
    <ClockInPrompt />
  </LogPatrolGateProvider>
);

const ClockInPrompt = () => {
  const navigate = useNavigate();
  const { pendingId, setPendingId } = useLogPatrolGate();
  const { propertyById } = useFireWatch();
  const { clockIn } = useMyClock();
  const property = pendingId ? propertyById.get(pendingId) : undefined;

  const close = () => {
    if (!clockIn.isPending) setPendingId(null);
  };

  const clockInAndContinue = () => {
    if (!pendingId) return;
    const id = pendingId;
    clockIn.mutate("", {
      onSuccess: () => {
        toast.success("Clocked in", { description: "Your shift has started." });
        setPendingId(null);
        navigate(logPath(id));
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : "Couldn't clock in."),
    });
  };

  return (
    <Dialog open={!!pendingId} onOpenChange={(o) => !o && close()}>
      <DialogContent className="w-[calc(100%-2rem)] rounded-xl border-line bg-surface text-ink sm:max-w-md">
        <DialogHeader className="items-center text-center sm:items-center sm:text-center">
          <div className="mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-status-follow/12 ring-1 ring-status-follow/35">
            <Clock className="h-7 w-7 text-status-follow" strokeWidth={1.8} />
          </div>
          <DialogTitle className="font-display text-xl">Clock in first</DialogTitle>
          <DialogDescription className="text-ink-2">
            You need to be on the clock to log a patrol
            {property ? (
              <>
                {" "}
                at <span className="font-medium text-ink">{property.name}</span>
              </>
            ) : null}
            . Clock in now to start your shift and continue to the patrol log.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-2 flex flex-col gap-2.5">
          <Button size="lg" autoFocus disabled={clockIn.isPending} onClick={clockInAndContinue}>
            {clockIn.isPending ? <Loader2 className="animate-spin" /> : <LogIn />}
            Clock In &amp; Log Patrol
          </Button>
          <Button size="lg" variant="outline" disabled={clockIn.isPending} onClick={close}>
            Not now
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
