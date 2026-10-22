import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/** Twilio SMS with an org-level test mode that is enforced here, on the server. */

export interface DispatchSettings {
  org_id: string;
  alert_phones: string[];
  grace_minutes: number;
  late_minutes: number;
  sms_alerts: boolean;
  test_mode: boolean;
  test_phone: string;
  test_email: string;
}

export const smsConfigured = (): boolean =>
  !!(Deno.env.get("TWILIO_ACCOUNT_SID") && Deno.env.get("TWILIO_AUTH_TOKEN") && Deno.env.get("TWILIO_FROM_NUMBER"));

/** Normalizes a US/E.164 phone number; returns "" when it can't be used. */
export function toE164(raw: string): string {
  const s = (raw ?? "").trim();
  if (!s) return "";
  const digits = s.replace(/\D/g, "");
  if (s.startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : "";
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return "";
}

export const maskPhone = (e164: string): string => (e164.length > 4 ? `•••${e164.slice(-4)}` : e164);

export async function loadDispatchSettings(admin: SupabaseClient, orgId: string): Promise<DispatchSettings | null> {
  const { data } = await admin.from("dispatch_settings").select("*").eq("org_id", orgId).maybeSingle();
  return (data as DispatchSettings | null) ?? null;
}

/**
 * Resolves who a text actually goes to. While test mode is on (or the org has no settings yet)
 * every message is redirected to the org's test phone only; with no test phone nothing is sent.
 */
export function routeSms(settings: DispatchSettings | null, intended: string[], label: string): { to: string[]; prefix: string; reason: string } {
  if (!settings || settings.test_mode) {
    const test = toE164(settings?.test_phone ?? "");
    if (!test) return { to: [], prefix: "", reason: "Texting is in test mode and no test phone is set." };
    return { to: [test], prefix: `[TEST → ${label}] `, reason: "" };
  }
  const to = [...new Set(intended.map(toE164).filter(Boolean))];
  return { to, prefix: "", reason: to.length ? "" : "No valid phone number to text." };
}

/** Sends one SMS. Returns null on success or a short, user-safe reason. Never logs credentials. */
export async function sendSms(to: string, body: string): Promise<string | null> {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const token = Deno.env.get("TWILIO_AUTH_TOKEN");
  const from = Deno.env.get("TWILIO_FROM_NUMBER");
  if (!sid || !token || !from) return "Text messaging isn't set up yet (Twilio keys missing).";
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: toE164(from) || from, Body: body.slice(0, 1500) }),
    });
    if (res.ok) return null;
    const detail = await res.text();
    let msg = "";
    try {
      msg = (JSON.parse(detail) as { message?: string }).message ?? "";
    } catch {
      /* not json */
    }
    console.error("twilio send failed", res.status, msg.slice(0, 200));
    return msg ? `Text failed: ${msg.slice(0, 200)}` : `Text failed (status ${res.status}).`;
  } catch (e) {
    console.error("twilio network error", e instanceof Error ? e.message : "unknown");
    return "Couldn't reach the text messaging service.";
  }
}

export const fmtTime = (iso: string, timeZone: string): string => {
  const d = new Date(iso);
  const t = d.toLocaleString("en-US", { timeZone, hour: "numeric", minute: "2-digit" });
  const tz = d.toLocaleString("en-US", { timeZone, timeZoneName: "short" }).split(" ").pop() ?? "";
  return `${t} ${tz}`;
};
