import { corsHeaders, createAdminClient, handleError, HttpError, json, readString, requireAuth } from "../_shared/auth.ts";
import { emailConfigured, escapeHtml, isSafeOrigin, orgIdentity, randomToken, sendEmail, sha256Hex } from "../_shared/crm.ts";
import { EMAIL_RE } from "../_shared/auth.ts";
import { fmtTime, loadDispatchSettings, maskPhone, routeSms, sendSms, smsConfigured, toE164, twilioEnvNames } from "../_shared/sms.ts";

/**
 * No-login shift links.
 * Public (token is the only credential; only its SHA-256 hash is stored):
 *   view, check_in, patrol, incident, check_out, ping (live location while checked in, until shift end)
 * Admin (signed-in admin JWT): status, contact, send (new link, texted and/or emailed), revoke
 * Cron (x-cron-secret): auto — sends links 1 hour before start when the org switched auto-send on (default off)
 * Test mode (or no dispatch settings) sends texts ONLY to the test phone and emails ONLY to the test email.
 */

const BUCKET = "patrol-photos";
const TOKEN_RE = /^[A-Za-z0-9_-]{40,60}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PHOTOS = 3;
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

type Admin = ReturnType<typeof createAdminClient>;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const iso = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const uuid = (v: unknown): string => {
  if (typeof v !== "string" || !UUID_RE.test(v)) throw new HttpError(400, "Invalid request.");
  return v.toLowerCase();
};

function rpcError(error: { message: string; code?: string }): HttpError {
  if (error.code === "P0404") return new HttpError(404, error.message);
  if (error.code === "P0410") return new HttpError(410, error.message);
  if (error.code === "P0001") return new HttpError(400, error.message);
  console.error("shift-link rpc", error.code, error.message);
  return new HttpError(500, "Something went wrong. Please try again.");
}

async function rpc<T>(admin: Admin, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await admin.rpc(fn, args);
  if (error) throw rpcError(error);
  return data as T;
}

/** Org + shift for a token, without exposing anything else. */
async function linkScope(admin: Admin, hash: string): Promise<{ org_id: string; shift_id: string }> {
  const { data } = await admin
    .from("shift_links")
    .select("org_id, shift_id, revoked_at, expires_at")
    .eq("token_hash", hash)
    .maybeSingle();
  if (!data || data.revoked_at) throw new HttpError(404, "This shift link is no longer active. Ask your dispatcher for a new one.");
  if (new Date(data.expires_at).getTime() < Date.now()) throw new HttpError(410, "This shift link has expired.");
  return { org_id: data.org_id, shift_id: data.shift_id };
}

function decodePhoto(raw: unknown): Uint8Array {
  if (typeof raw !== "string") throw new HttpError(400, "Invalid photo.");
  const b64 = raw.includes(",") ? raw.slice(raw.indexOf(",") + 1) : raw;
  if (b64.length > MAX_PHOTO_BYTES * 1.4) throw new HttpError(413, "A photo is too large.");
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    throw new HttpError(400, "Invalid photo.");
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  if (out.length < 100 || out[0] !== 0xff || out[1] !== 0xd8) throw new HttpError(400, "Photos must be JPEG images.");
  return out;
}

async function uploadPhotos(admin: Admin, scope: { org_id: string; shift_id: string }, raw: unknown): Promise<string[]> {
  const list = Array.isArray(raw) ? raw.slice(0, MAX_PHOTOS) : [];
  const decoded = list.map(decodePhoto);
  const paths: string[] = [];
  for (const bytes of decoded) {
    const path = `${scope.org_id}/link/${scope.shift_id}/${crypto.randomUUID()}.jpg`;
    const { error } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: "image/jpeg", upsert: false });
    if (error) {
      await removePhotos(admin, paths);
      console.error("photo upload failed", error.message);
      throw new HttpError(500, "Couldn't upload a photo. Please try again.");
    }
    paths.push(path);
  }
  return paths;
}

async function removePhotos(admin: Admin, paths: string[]): Promise<void> {
  if (paths.length) await admin.storage.from(BUCKET).remove(paths);
}

async function guardAction(admin: Admin, action: string, body: Record<string, unknown>): Promise<Response> {
  const token = readString(body.token, 80);
  if (!TOKEN_RE.test(token)) throw new HttpError(404, "This shift link isn't valid.");
  const hash = await sha256Hex(token);
  const lat = num(body.lat);
  const lng = num(body.lng);
  const acc = num(body.accuracy);

  switch (action) {
    case "view":
      return json(await rpc(admin, "sl_view", { p_hash: hash }));

    case "check_in":
      return json(
        await rpc(admin, "sl_check_in", { p_hash: hash, p_lat: lat, p_lng: lng, p_acc: acc, p_note: readString(body.note, 500) }),
      );

    case "patrol": {
      const clientId = uuid(body.client_id);
      const scope = await linkScope(admin, hash);
      const photos = await uploadPhotos(admin, scope, body.photos);
      const areas = (Array.isArray(body.areas) ? body.areas : []).filter((a): a is string => typeof a === "string").slice(0, 20);
      const { data, error } = await admin.rpc("sl_patrol", {
        p_hash: hash,
        p_client_id: clientId,
        p_at: iso(body.at),
        p_lat: lat,
        p_lng: lng,
        p_acc: acc,
        p_areas: areas,
        p_status: readString(body.status, 20),
        p_notes: readString(body.notes, 2000),
        p_photos: photos,
        p_queued: body.queued === true,
      });
      if (error || (data as { duplicate?: boolean })?.duplicate) await removePhotos(admin, photos);
      if (error) throw rpcError(error);
      return json(data);
    }

    case "incident": {
      const clientId = uuid(body.client_id);
      const scope = await linkScope(admin, hash);
      const photos = await uploadPhotos(admin, scope, body.photos);
      const { data, error } = await admin.rpc("sl_incident", {
        p_hash: hash,
        p_client_id: clientId,
        p_at: iso(body.at),
        p_lat: lat,
        p_lng: lng,
        p_acc: acc,
        p_category: readString(body.category, 30),
        p_severity: readString(body.severity, 10),
        p_description: readString(body.description, 4000),
        p_photos: photos,
      });
      if (error || (data as { duplicate?: boolean })?.duplicate) await removePhotos(admin, photos);
      if (error) throw rpcError(error);
      return json(data);
    }

    case "ping":
      return json(
        await rpc(admin, "sl_ping", {
          p_hash: hash,
          p_lat: lat,
          p_lng: lng,
          p_acc: acc,
          p_heading: num(body.heading),
          p_speed: num(body.speed),
        }),
      );

    case "check_out":
      return json(
        await rpc(admin, "sl_check_out", {
          p_hash: hash,
          p_client_id: uuid(body.client_id),
          p_at: iso(body.at),
          p_lat: lat,
          p_lng: lng,
          p_acc: acc,
          p_handoff: readString(body.handoff, 2000),
        }),
      );
  }
  throw new HttpError(400, "Unknown action.");
}

/** "Thu, Oct 22 9:00 PM EDT" from the shift's local date/time. */
function shiftStartLabel(date: string, time: string, tz: string): string {
  const noon = new Date(`${date}T12:00:00Z`);
  const day = noon.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
  const [h, m] = time.split(":").map((x) => Number(x));
  const hh = ((h + 11) % 12) + 1;
  const zone = fmtTime(noon.toISOString(), tz).split(" ").pop() ?? "";
  return `${day} ${hh}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"} ${zone}`;
}

async function staffPhone(admin: Admin, staffId: string): Promise<string> {
  const { data: st } = await admin.from("staff").select("phone").eq("id", staffId).maybeSingle();
  if (st?.phone) return st.phone;
  const { data: wk } = await admin
    .from("wf_workers")
    .select("phone")
    .eq("staff_id", staffId)
    .is("archived_at", null)
    .limit(1)
    .maybeSingle();
  return wk?.phone ?? "";
}

/** Best known email for a guard: their worker record, then their app login. */
async function staffEmail(admin: Admin, staffId: string): Promise<string> {
  const [{ data: wk }, { data: st }] = await Promise.all([
    admin.from("wf_workers").select("email").eq("staff_id", staffId).is("archived_at", null).limit(1).maybeSingle(),
    admin.from("staff").select("profile_id").eq("id", staffId).maybeSingle(),
  ]);
  if (wk?.email && EMAIL_RE.test(wk.email)) return wk.email.toLowerCase();
  if (st?.profile_id) {
    const { data: pr } = await admin.from("profiles").select("email").eq("id", st.profile_id).maybeSingle();
    if (pr?.email && EMAIL_RE.test(pr.email)) return pr.email.toLowerCase();
  }
  return "";
}

const maskEmail = (e: string): string => {
  const [u, d] = e.split("@");
  return d ? `${u.slice(0, 1)}${"•".repeat(Math.max(1, Math.min(4, u.length - 1)))}@${d}` : e;
};

type ShiftRow = { id: string; org_id: string; staff_id: string; property_id: string; shift_date: string; start_time: string; end_time: string };

interface Delivery {
  sent_to: string;
  emailed_to: string;
  error: string;
  email_error: string;
  test_mode: boolean;
}

/** Texts and/or emails a freshly issued link. Test mode routes everything to the test phone/email only. */
async function deliverLink(
  admin: Admin,
  opts: { shift: ShiftRow; linkId: string; url: string; wantText: boolean; wantEmail: boolean; emailTo: string; actor: string; auto: boolean },
): Promise<Delivery> {
  const { shift, url, wantText, wantEmail } = opts;
  const [{ data: staff }, { data: prop }, identity, settings, phone, { data: tzRow }] = await Promise.all([
    admin.from("staff").select("name").eq("id", shift.staff_id).maybeSingle(),
    admin.from("properties").select("name").eq("id", shift.property_id).maybeSingle(),
    orgIdentity(admin, shift.org_id),
    loadDispatchSettings(admin, shift.org_id),
    staffPhone(admin, shift.staff_id),
    admin.rpc("org__tz", { p_org: shift.org_id }),
  ]);
  const tz = (tzRow as string | null) || "America/New_York";
  const guard = staff?.name ?? "Guard";
  const intended = toE164(phone);
  const testMode = !settings || settings.test_mode;
  const when = shiftStartLabel(String(shift.shift_date), String(shift.start_time), tz);
  const site = prop?.name ?? "your site";
  let error = "";
  let sentTo = "";
  let emailError = "";
  let emailedTo = "";

  if (wantEmail) {
    const typed = opts.emailTo.toLowerCase();
    const target = typed || (await staffEmail(admin, shift.staff_id));
    if (target && !EMAIL_RE.test(target)) emailError = "That email address isn't valid.";
    else if (!emailConfigured()) emailError = "Email sending isn't set up yet.";
    else {
      let to = target;
      if (testMode) {
        const t = (settings?.test_email ?? "").trim().toLowerCase();
        to = EMAIL_RE.test(t) ? t : "";
        if (!to) emailError = "Emails are in test mode and no test email is set.";
      } else if (!to) emailError = `${guard} has no email on file. Type one in, or text the link instead.`;
      if (to) {
        const note = testMode ? `[TEST MODE — would have gone to ${guard} at ${target || "no email on file"}]\n\n` : "";
        const subject = `${testMode ? "[TEST] " : ""}Your shift at ${site} — ${when}`;
        const text = `${note}Hi ${guard.split(/\s+/)[0]},\n\nYour shift at ${site} starts ${when}.\n\nUse this link to check in, log patrols and check out (no login needed):\n${url}\n\nThe link stops working 12 hours after the shift ends.\n\n${identity.name}`;
        const html = `<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#16171a;max-width:520px;">${
          testMode ? `<p style="padding:8px 10px;border:1px dashed #dc2626;border-radius:8px;font-size:12px;color:#991b1b;">Test mode — would have gone to ${escapeHtml(guard)} at ${escapeHtml(target || "no email on file")}</p>` : ""
        }<p>Hi ${escapeHtml(guard.split(/\s+/)[0])},</p><p>Your shift at <strong>${escapeHtml(site)}</strong> starts <strong>${escapeHtml(when)}</strong>.</p><p><a href="${escapeHtml(url)}" style="display:inline-block;background:#dc2626;color:#fff;text-decoration:none;font-weight:bold;padding:11px 18px;border-radius:8px;">Open my shift</a></p><p style="font-size:13px;color:#45474d;">Check in, log patrols and check out — no login needed. The link stops working 12 hours after the shift ends.</p><p style="font-size:13px;color:#8a8d94;">${escapeHtml(identity.name)}</p></div>`;
        const err = await sendEmail({ to: [to], subject, text, html, replyTo: identity.replyTo || undefined, fromName: identity.name });
        if (err) emailError = err;
        else emailedTo = testMode ? to : maskEmail(to);
      }
    }
  }

  if (!wantText) {
    // email only
  } else if (!intended && !testMode) {
    error = `${guard} has no valid mobile number. Add one in their profile, or copy the link instead.`;
  } else {
    const route = routeSms(settings, intended ? [intended] : [], `${guard} ${intended ? maskPhone(intended) : "(no phone)"}`);
    if (!route.to.length) error = route.reason;
    else {
      const msg = `${route.prefix}${identity.name}: Your shift at ${site} starts ${when}. Check in, log patrols and check out here (no login needed): ${url}`;
      const err = await sendSms(route.to[0], msg);
      if (err) error = err;
      else sentTo = maskPhone(route.to[0]);
    }
  }

  const delivered = [sentTo, emailedTo].filter(Boolean).join(", ");
  await admin
    .from("shift_links")
    .update({ sent_to: delivered, sent_at: delivered ? new Date().toISOString() : null, send_error: [error, emailError].filter(Boolean).join(" ") })
    .eq("id", opts.linkId);
  const tm = testMode ? " (test mode)" : "";
  const how = opts.auto ? "Auto-" : "";
  const events = [sentTo && `${how}${how ? "texted" : "Texted"}${tm} to ${sentTo}`, emailedTo && `${how}${how ? "emailed" : "Emailed"}${tm} to ${emailedTo}`].filter(Boolean) as string[];
  for (const note of events) {
    await admin.from("shift_events").insert({ org_id: shift.org_id, shift_id: shift.id, kind: "link_sent", actor_name: opts.actor, note });
  }
  return { sent_to: sentTo, emailed_to: emailedTo, error, email_error: emailError, test_mode: testMode };
}

/** Remembers the site address so automatic sends (from the server clock) can build links. Never creates a settings row. */
async function rememberOrigin(admin: Admin, orgId: string, raw: unknown): Promise<void> {
  const origin = readString(raw, 200).replace(/\/+$/, "");
  if (!origin || !isSafeOrigin(origin)) return;
  await admin.from("dispatch_settings").update({ link_origin: origin }).eq("org_id", orgId).neq("link_origin", origin);
}

const SHIFT_COLS = "id, org_id, staff_id, property_id, shift_date, start_time, end_time";

/** Cron: sends links for shifts starting within the hour when the org switched auto-send on. One attempt per shift. */
async function autoSend(req: Request, admin: Admin): Promise<Response> {
  const secret = req.headers.get("x-cron-secret") ?? "";
  const { data: valid } = await admin.rpc("verify_cron_secret", { p_secret: secret });
  if (!secret || valid !== true) throw new HttpError(401, "Unauthorized");

  const { data: due, error } = await admin.rpc("sl_auto__due", { p_limit: 20 });
  if (error) throw rpcError(error);
  let sent = 0;
  let failed = 0;
  for (const row of (due ?? []) as { shift_id: string; org_id: string }[]) {
    // Claim first so overlapping runs can never double-send.
    const { data: claim } = await admin
      .from("shift_link_auto")
      .upsert({ shift_id: row.shift_id, org_id: row.org_id, note: "Sending…" }, { onConflict: "shift_id", ignoreDuplicates: true })
      .select("shift_id");
    if (!claim?.length) continue;
    let ok = false;
    let note = "";
    try {
      const settings = await loadDispatchSettings(admin, row.org_id);
      const origin = (settings?.link_origin ?? "").replace(/\/+$/, "");
      const wantText = !!settings?.auto_link_text;
      const wantEmail = !!settings?.auto_link_email;
      if (!settings || (!wantText && !wantEmail)) note = "Auto-send is off.";
      else if (!origin || !isSafeOrigin(origin)) note = "Open the Dispatch board once so links know the site address.";
      else {
        const { data: shift } = await admin.from("shifts").select(SHIFT_COLS).eq("id", row.shift_id).maybeSingle();
        if (!shift) note = "Shift not found.";
        else {
          const token = randomToken();
          const issued = await rpc<{ id: string }>(admin, "sl_issue", { p_shift: row.shift_id, p_hash: await sha256Hex(token), p_admin: null });
          const d = await deliverLink(admin, {
            shift: shift as ShiftRow,
            linkId: issued.id,
            url: `${origin}/shift/${token}`,
            wantText,
            wantEmail,
            emailTo: "",
            actor: "Auto-send",
            auto: true,
          });
          ok = !!(d.sent_to || d.emailed_to);
          note = [d.sent_to && `Texted ${d.sent_to}`, d.emailed_to && `Emailed ${d.emailed_to}`, d.error, d.email_error].filter(Boolean).join(" · ");
        }
      }
    } catch (e) {
      note = e instanceof Error ? e.message : "Send failed.";
    }
    await admin.from("shift_link_auto").update({ ok, note: note.slice(0, 1000) }).eq("shift_id", row.shift_id);
    if (ok) sent += 1;
    else failed += 1;
  }
  return json({ ok: true, sent, failed });
}

async function adminAction(req: Request, admin: Admin, action: string, body: Record<string, unknown>): Promise<Response> {
  const caller = await requireAuth(req);
  const { data: me } = await admin.from("profiles").select("id, org_id, role, active, full_name").eq("id", caller.id).single();
  if (!me || !me.active || me.role !== "admin") throw new HttpError(403, "Only admins can manage shift links.");

  if (action === "status") {
    const settings = await loadDispatchSettings(admin, me.org_id);
    await rememberOrigin(admin, me.org_id, body.origin);
    const configured = smsConfigured();
    return json({
      sms_configured: configured,
      sms_env_names: configured ? undefined : twilioEnvNames(),
      email_configured: emailConfigured(),
      test_mode: settings?.test_mode ?? true,
      test_phone: settings?.test_phone ? maskPhone(toE164(settings.test_phone)) : "",
      test_email: settings?.test_email ?? "",
    });
  }

  if (action === "test_sms") {
    const settings = await loadDispatchSettings(admin, me.org_id);
    const route = routeSms(settings, settings?.alert_phones ?? [], "admins");
    if (!route.to.length) throw new HttpError(400, route.reason);
    const identity = await orgIdentity(admin, me.org_id);
    const results: string[] = [];
    for (const to of route.to) {
      const err = await sendSms(to, `${route.prefix}${identity.name}: Test text from the dispatch board, sent by ${me.full_name}. Alerts will look like this.`);
      if (err) throw new HttpError(502, err);
      results.push(maskPhone(to));
    }
    return json({ ok: true, sent_to: results, test_mode: settings?.test_mode ?? true });
  }

  const shiftId = uuid(body.shift_id);
  const { data: shift } = await admin.from("shifts").select(SHIFT_COLS).eq("id", shiftId).maybeSingle();
  if (!shift || shift.org_id !== me.org_id) throw new HttpError(404, "Shift not found.");

  if (action === "contact") {
    return json({ email: shift.staff_id ? await staffEmail(admin, shift.staff_id) : "" });
  }

  if (action === "revoke") {
    const { data: gone } = await admin
      .from("shift_links")
      .update({ revoked_at: new Date().toISOString() })
      .eq("shift_id", shiftId)
      .is("revoked_at", null)
      .select("id");
    if (gone?.length) {
      await admin.from("shift_events").insert({ org_id: me.org_id, shift_id: shiftId, kind: "link_revoked", actor_name: me.full_name, note: "Link revoked" });
    }
    return json({ ok: true });
  }

  if (action !== "send") throw new HttpError(400, "Unknown action.");

  const origin = readString(body.origin, 200).replace(/\/+$/, "");
  if (!isSafeOrigin(origin)) throw new HttpError(400, "Couldn't build the shift link for this site address.");
  await rememberOrigin(admin, me.org_id, origin);
  const token = randomToken();
  const issued = await rpc<{ id: string; expires_at: string }>(admin, "sl_issue", {
    p_shift: shiftId,
    p_hash: await sha256Hex(token),
    p_admin: me.id,
  });
  const url = `${origin}/shift/${token}`;

  const wantText = body.text === true;
  const wantEmail = body.email === true;
  if (!wantText && !wantEmail) return json({ url, expires_at: issued.expires_at, sent: false });

  const d = await deliverLink(admin, {
    shift: shift as ShiftRow,
    linkId: issued.id,
    url,
    wantText,
    wantEmail,
    emailTo: readString(body.email_to, 200),
    actor: me.full_name,
    auto: false,
  });
  return json({
    url,
    expires_at: issued.expires_at,
    sent: !!d.sent_to,
    sent_to: d.sent_to,
    emailed: !!d.emailed_to,
    emailed_to: d.emailed_to,
    email_error: d.email_error,
    test_mode: d.test_mode,
    error: d.error,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = readString(body.action, 20);
    const admin = createAdminClient();
    if (["view", "check_in", "patrol", "incident", "check_out", "ping"].includes(action)) return await guardAction(admin, action, body);
    if (action === "auto") return await autoSend(req, admin);
    return await adminAction(req, admin, action, body);
  } catch (err) {
    return handleError(err);
  }
});
