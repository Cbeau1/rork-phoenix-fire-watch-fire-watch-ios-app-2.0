import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Link2, Loader2, MessageSquareText, ShieldAlert, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { FieldLabel } from "@/components/fw/primitives";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { linkStatus, revokeShiftLink, saveStaffPhone, sendShiftLink, type SendLinkResult } from "@/lib/dispatch/api";
import { friendlyError } from "@/lib/supabase";

export interface ShiftLinkTarget {
  shiftId: string;
  staffId: string;
  staffName: string;
  phone: string;
  propertyName: string;
  whenLabel: string;
  /** True when a link was already issued for this shift (sending again replaces it). */
  hasLink: boolean;
}

const digits = (s: string): string => s.replace(/\D/g, "");
const validPhone = (s: string): boolean => {
  const d = digits(s);
  return d.length === 10 || (d.length === 11 && d.startsWith("1"));
};

/** Admin dialog: text or copy a no-login shift link for one guard's shift. */
export const ShiftLinkDialog = ({ target, onClose }: { target: ShiftLinkTarget | null; onClose: () => void }) => {
  const qc = useQueryClient();
  const [phone, setPhone] = useState<string>("");
  const [result, setResult] = useState<SendLinkResult | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [confirmRevoke, setConfirmRevoke] = useState<boolean>(false);

  useEffect(() => {
    setPhone(target?.phone ?? "");
    setResult(null);
    setCopied(false);
    setConfirmRevoke(false);
  }, [target]);

  const status = useQuery({ queryKey: ["dispatch", "link-status"], enabled: !!target, staleTime: 60_000, queryFn: linkStatus });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["dispatch", "board"] });
    void qc.invalidateQueries({ queryKey: ["staff"] });
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Link copied");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy — select the link and copy it manually.");
    }
  };

  const send = useMutation({
    mutationFn: async (text: boolean) => {
      if (!target) throw new Error("No shift selected.");
      if (text) {
        if (!validPhone(phone)) throw new Error("Enter a 10-digit US mobile number.");
        if (digits(phone) !== digits(target.phone)) await saveStaffPhone(target.staffId, phone);
      }
      return sendShiftLink(target.shiftId, text);
    },
    onSuccess: (res, text) => {
      setResult(res);
      refresh();
      if (!text) void copy(res.url);
      else if (res.sent) toast.success(res.test_mode ? `Test text sent to ${res.sent_to}` : `Link texted to ${res.sent_to}`);
      else toast.error(res.error || "The link was created but the text didn't send.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : friendlyError(e)),
  });

  const revoke = useMutation({
    mutationFn: () => revokeShiftLink(target?.shiftId ?? ""),
    onSuccess: () => {
      toast.success("Link turned off");
      refresh();
      onClose();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const smsReady = status.data?.sms_configured === true;
  const busy = send.isPending || revoke.isPending;

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto border-line bg-surface text-ink sm:max-w-lg sm:rounded-xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Shift link</DialogTitle>
          <DialogDescription className="text-ink-2">
            {target?.staffName} · {target?.propertyName} · {target?.whenLabel}
          </DialogDescription>
        </DialogHeader>

        <p className="text-sm text-ink-2">
          The guard opens this link to check in with GPS, log patrols with photos, report incidents and check out — no login needed. It
          stops working 12 hours after the shift ends.
        </p>

        {status.data?.test_mode && (
          <div className="flex items-start gap-2.5 rounded-lg border border-status-follow/40 bg-status-follow/10 px-3.5 py-3 text-sm text-ink">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-status-follow" />
            <span>
              Test mode is on: texts go only to {status.data.test_phone || "the test phone"}, not to the guard. Turn it off in Dispatch
              settings when you're ready.
            </span>
          </div>
        )}
        {status.isSuccess && !smsReady && (
          <div className="rounded-lg border border-line bg-raised px-3.5 py-3 text-sm text-ink-2">
            Text messaging isn't set up yet. You can still copy the link and send it yourself.
          </div>
        )}

        {result ? (
          <div className="grid gap-3">
            <div
              className={
                result.sent || !result.error
                  ? "rounded-lg border border-status-clear/40 bg-status-clear/10 px-3.5 py-3 text-sm text-ink"
                  : "rounded-lg border border-status-incident/40 bg-status-incident/10 px-3.5 py-3 text-sm text-ink"
              }
              role="status"
            >
              {result.sent
                ? `Texted to ${result.sent_to}${result.test_mode ? " (test mode)" : ""}.`
                : result.error
                  ? `Link created, but the text failed: ${result.error}`
                  : "New link ready. Any earlier link for this shift no longer works."}
            </div>
            <div className="flex gap-2">
              <Input readOnly value={result.url} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
              <Button type="button" variant="outline" onClick={() => void copy(result.url)} aria-label="Copy link">
                {copied ? <Check /> : <Copy />}
              </Button>
            </div>
            <div className="flex justify-end">
              <Button type="button" onClick={onClose}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-4">
            <div>
              <FieldLabel htmlFor="sl-phone">Guard's mobile number</FieldLabel>
              <Input
                id="sl-phone"
                type="tel"
                inputMode="tel"
                autoComplete="off"
                placeholder="(555) 555-0123"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                disabled={busy}
              />
              {!target?.phone && <p className="mt-1.5 text-xs text-ink-3">Saved to their profile for next time.</p>}
            </div>
            <p className="text-xs text-ink-3">
              {target?.hasLink ? "A link was already sent for this shift. " : ""}Each new link turns off any earlier link for this shift.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="button" className="flex-1" disabled={busy || !smsReady} onClick={() => send.mutate(true)}>
                {send.isPending && send.variables === true ? <Loader2 className="animate-spin" /> : <MessageSquareText />}
                Text link
              </Button>
              <Button type="button" variant="outline" className="flex-1" disabled={busy} onClick={() => send.mutate(false)}>
                {send.isPending && send.variables === false ? <Loader2 className="animate-spin" /> : <Link2 />}
                Copy link only
              </Button>
            </div>
            {target?.hasLink && (
              <div className="border-t border-line pt-3">
                {confirmRevoke ? (
                  <div className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
                    Turn off the current link?
                    <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={() => revoke.mutate()}>
                      {revoke.isPending && <Loader2 className="animate-spin" />}
                      Turn off
                    </Button>
                    <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmRevoke(false)}>
                      Keep it
                    </Button>
                  </div>
                ) : (
                  <Button type="button" size="sm" variant="ghost" className="text-ink-2" onClick={() => setConfirmRevoke(true)}>
                    <XCircle />
                    Turn off current link
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
