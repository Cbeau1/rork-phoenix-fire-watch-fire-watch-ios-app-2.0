import { corsHeaders, createAdminClient, handleError, HttpError, json } from "../_shared/auth.ts";
import { orgIdentity } from "../_shared/crm.ts";
import { type DispatchSettings, fmtTime, loadDispatchSettings, routeSms, sendSms } from "../_shared/sms.ts";

/**
 * Runs every 2 minutes (pg_cron). Finds overdue patrols and guards who haven't checked in,
 * records each alert once, and texts the org's alert phones (test phone only while in test mode).
 */

interface NewAlert {
  id: string;
  org_id: string;
  kind: "patrol_overdue" | "no_check_in";
  due_at: string;
  property: string;
  guard: string;
  tz: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const admin = createAdminClient();
    const secret = req.headers.get("x-cron-secret") ?? "";
    const { data: valid } = await admin.rpc("verify_cron_secret", { p_secret: secret });
    if (!secret || valid !== true) throw new HttpError(401, "Unauthorized");

    const { data, error } = await admin.rpc("dispatch__scan");
    if (error) throw new Error(error.message);
    const alerts = (data ?? []) as NewAlert[];

    const settingsCache = new Map<string, DispatchSettings | null>();
    const nameCache = new Map<string, string>();
    let sent = 0;
    let failed = 0;

    for (const a of alerts) {
      if (!settingsCache.has(a.org_id)) settingsCache.set(a.org_id, await loadDispatchSettings(admin, a.org_id));
      const settings = settingsCache.get(a.org_id) ?? null;
      if (!settings) continue; // org hasn't set up dispatch alerts: board only
      if (!settings.sms_alerts) {
        await admin.from("dispatch_alerts").update({ notify_error: "Text alerts are turned off." }).eq("id", a.id);
        continue;
      }
      if (!nameCache.has(a.org_id)) nameCache.set(a.org_id, (await orgIdentity(admin, a.org_id)).name);
      const company = nameCache.get(a.org_id)!;
      const route = routeSms(settings, settings.alert_phones ?? [], "admins");
      if (!route.to.length) {
        await admin.from("dispatch_alerts").update({ notify_error: route.reason }).eq("id", a.id);
        failed += 1;
        continue;
      }
      const when = fmtTime(a.due_at, a.tz || "America/New_York");
      const text =
        a.kind === "patrol_overdue"
          ? `${route.prefix}${company} ALERT: Patrol overdue at ${a.property}. ${a.guard}'s patrol was due ${when}. Check the dispatch board.`
          : `${route.prefix}${company} ALERT: ${a.guard} hasn't checked in at ${a.property} (shift started ${when}). Check the dispatch board.`;
      const errors: string[] = [];
      for (const to of route.to) {
        const err = await sendSms(to, text);
        if (err) errors.push(err);
      }
      await admin
        .from("dispatch_alerts")
        .update({
          notified_at: errors.length < route.to.length ? new Date().toISOString() : null,
          notify_error: errors[0] ?? "",
        })
        .eq("id", a.id);
      if (errors.length) failed += 1;
      else sent += 1;
    }

    if (alerts.length) console.log(`dispatch-tick: ${alerts.length} new alerts, ${sent} texted, ${failed} failed`);
    return json({ ok: true, alerts: alerts.length, sent, failed });
  } catch (err) {
    return handleError(err);
  }
});
