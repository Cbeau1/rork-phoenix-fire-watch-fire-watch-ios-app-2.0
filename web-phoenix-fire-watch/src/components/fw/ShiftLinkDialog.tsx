import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Link2, Loader2, Send, ShieldAlert, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { FieldLabel } from "@/components/fw/primitives";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CheckField } from "@/components/workforce/kit";
import { linkStatus, revokeShiftLink, saveStaffPhone, sendShiftLink, shiftLinkContact, type SendLinkResult } from "@/lib/dispatch/api";
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
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Admin dialog: text or copy a no-login shift link for one guard's shift. */
export const ShiftLinkDialog = ({ target, onClose }: { target: ShiftLinkTarget | null; onClose: () => void }) => {
  const qc = useQueryClient();
  const [phone, setPhone] = useState<string>("");
  const [result, setResult] = useState<SendLinkResult | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [confirmRevoke, setConfirmRevoke] = useState<boolean>(false);
  // Text is the default way to send; email is an optional extra.
  const [viaText, setViaText] = useState<boolean>(true);
  const [viaEmail, setViaEmail] = useState<boolean>(false);
  const [email, setEmail] = useState<string>("");

  useEffect(() => {
    setPhone(target?.phone ?? "");
    setResult(null);
    setCopied(false);
    setConfirmRevoke(false);
    setViaText(true);
    setViaEmail(false);
    setEmail("");
  }, [target]);

  const status = useQuery({ queryKey: ["dispatch", "link-status"], enabled: !!target, staleTime: 60_000, queryFn: linkStatus });
  const contact = useQuery({
    queryKey: ["dispatch", "link-contact", target?.shiftId],
    enabled: !!target,
    staleTime: 60_000,
    queryFn: () => shiftLinkContact(target?.shiftId ?? ""),
  });
  useEffect(() => {
    if (contact.data?.email) setEmail((e) => e || contact.data.email);
  }, [contact.data]);

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

  /** mode "send" uses the ticked channels; "copy" just creates a link to copy. */
  const send = useMutation({
    mutationFn: async (mode: "send" | "copy") => {
      if (!target) throw new Error("No shift selected.");
      const text = mode === "send" && viaText;
      const mail = mode === "send" && viaEmail;
      if (mode === "send" && !text && !mail) throw new Error("Tick Text or Email.");
      if (text) {
        if (!validPhone(phone)) throw new Error("Enter a 10-digit US mobile number.");
        if (digits(phone) !== digits(target.phone)) await saveStaffPhone(target.staffId, phone);
      }
      if (mail && !EMAIL_RE.test(email.trim())) throw new Error("Enter a valid email address.");
      return sendShiftLink(target.shiftId, { text, email: mail, emailTo: mail ? email.trim().toLowerCase() : "" });
    },
    onSuccess: (res, mode) => {
      setResult(res);
      refresh();
      if (mode === "copy") return void copy(res.url);
      const tm = res.test_mode ? " (test mode)" : "";
      const ok = [res.sent && `texted to ${res.sent_to}`, res.emailed && `emailed to ${res.emailed_to}`].filter(Boolean).join(" and ");
      if (ok) toast.success(`Link ${ok}${tm}`);
      const fails = [res.error, res.email_error].filter(Boolean).join(" ");
      if (fails) toast.error(ok ? `Partly sent: ${fails}` : fails);
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
  const emailReady = status.data?.email_configured !== false;
  const busy = send.isPending || revoke.isPending;
  const canSend = (viaText && smsReady) || (viaEmail && emailReady);

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
              Test mode is on: texts go only to {status.data.test_phone || "the test phone"} and emails only to{" "}
              {status.data.test_email || "the test email"}, not to the guard. Turn it off with the Test mode switch in the menu when you're ready.
            </span>
          </div>
        )}
        {status.isSuccess && !smsReady && (
          <div className="rounded-lg border border-line bg-raised px-3.5 py-3 text-sm text-ink-2">
            Text messaging isn't set up yet. You can email the link or copy it and send it yourself.
          </div>
        )}

        {result ? (
          <div className="grid gap-3">
            <div
              className={
                !result.error && !result.email_error
                  ? "rounded-lg border border-status-clear/40 bg-status-clear/10 px-3.5 py-3 text-sm text-ink"
                  : "rounded-lg border border-status-incident/40 bg-status-incident/10 px-3.5 py-3 text-sm text-ink"
              }
              role="status"
            >
              {!result.sent && !result.emailed && !result.error && !result.email_error ? (
                "New link ready. Any earlier link for this shift no longer works."
              ) : (
                <ul className="grid gap-0.5">
                  {result.sent && <li>Texted to {result.sent_to}{result.test_mode ? " (test mode)" : ""}.</li>}
                  {result.error && <li>Text failed: {result.error}</li>}
                  {result.emailed && <li>Emailed to {result.emailed_to}{result.test_mode ? " (test mode)" : ""}.</li>}
                  {result.email_error && <li>Email failed: {result.email_error}</li>}
                </ul>
              )}
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
            <div className="grid gap-2">
              <CheckField label="Text the link" checked={viaText} onChange={setViaText} disabled={busy} hint={smsReady ? "Default" : "Text messaging isn't set up yet"} />
              {viaText && (
                <div className="pl-1">
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
              )}
              <CheckField
                label="Also email the link"
                checked={viaEmail}
                onChange={setViaEmail}
                disabled={busy || !emailReady}
                hint={emailReady ? "Optional" : "Email sending isn't set up yet"}
              />
              {viaEmail && (
                <div className="pl-1">
                  <FieldLabel htmlFor="sl-email">Guard's email</FieldLabel>
                  <Input
                    id="sl-email"
                    type="email"
                    inputMode="email"
                    autoComplete="off"
                    placeholder={contact.isLoading ? "Looking up…" : "name@example.com"}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={busy}
                  />
                  <p className="mt-1.5 text-xs text-ink-3">
                    {contact.data?.email ? "From their worker profile or app login." : "No email on file — type one in for this send."}
                  </p>
                </div>
              )}
            </div>
            <p className="text-xs text-ink-3">
              {target?.hasLink ? "A link was already sent for this shift. " : ""}Each new link turns off any earlier link for this shift.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="button" className="flex-1" disabled={busy || !canSend} onClick={() => send.mutate("send")}>
                {send.isPending && send.variables === "send" ? <Loader2 className="animate-spin" /> : <Send />}
                {viaText && viaEmail ? "Text & email link" : viaEmail ? "Email link" : "Text link"}
              </Button>
              <Button type="button" variant="outline" className="flex-1" disabled={busy} onClick={() => send.mutate("copy")}>
                {send.isPending && send.variables === "copy" ? <Loader2 className="animate-spin" /> : <Link2 />}
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
