import { corsHeaders, createAdminClient, handleError, HttpError, json, requireAuth } from "../_shared/auth.ts";
import { emailConfigured, emailShell, escapeHtml, orgIdentity, sendEmail } from "../_shared/crm.ts";
import { loadDispatchSettings, type DispatchSettings } from "../_shared/sms.ts";
import {
  buildDailyReportPdf,
  clock,
  type DailyReportInput,
  day,
  fmtDuration,
  longDay,
  type ReportHandoff,
  type ReportIncident,
  type ReportPatrol,
  type ReportPhoto,
  type ReportTime,
  summarize,
  tzAbbr,
} from "../_shared/dailyReportPdf.ts";

/**
 * Daily patrol report PDFs.
 * Cron (x-cron-secret, every 5 min via pg_cron): claims runs due at each property's send time (default 9 a.m.,
 * property-local) + retries and sends them.
 * Admin (signed-in admin JWT): status, preview (PDF only, no email), send_now, retry, download.
 * Test mode (dispatch_settings.test_mode, or no settings) sends every report ONLY to the org's test email.
 */

type Admin = ReturnType<typeof createAdminClient>;
const PHOTO_BUCKET = "patrol-photos";
const REPORT_BUCKET = "daily-reports";
const MAX_PHOTOS = 18;
const MAX_PHOTO_BYTES_TOTAL = 7 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Run {
  id: string;
  org_id: string;
  property_id: string;
  report_date: string;
  tz: string;
  window_start: string;
  window_end: string;
  trigger: "schedule" | "manual";
  status: string;
  attempts: number;
}
interface Settings {
  property_id: string;
  org_id: string;
  enabled: boolean;
  recipients: string[];
  include_photos: boolean;
  send_when_empty: boolean;
  timezone: string;
  send_time?: string;
}

const uuid = (v: unknown): string => {
  if (typeof v !== "string" || !UUID_RE.test(v)) throw new HttpError(400, "Invalid request.");
  return v.toLowerCase();
};
const toBase64 = (bytes: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const safeName = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "Property";

/* ---------------------------------------------------------------- time windows */

/** UTC instant for a wall-clock time in an IANA zone (DST-safe). */
function zonedToUtc(ymd: string, hh: number, tz: string, mm = 0): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm, 0);
  const offset = (t: number) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(t));
    const g = (k: string) => Number(parts.find((p) => p.type === k)?.value);
    return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - t;
  };
  let t = guess - offset(guess);
  t = guess - offset(t);
  return new Date(t);
}
const localYmd = (t: Date, tz: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(t);
const addDays = (ymd: string, n: number) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

/** "HH:MM[:SS]" → [hour, minute]; anything else falls back to 9:00. */
const parseSendTime = (v: unknown): [number, number] => {
  const m = typeof v === "string" ? /^(\d{1,2}):(\d{2})/.exec(v) : null;
  const h = m ? Number(m[1]) : 9;
  const mi = m ? Number(m[2]) : 0;
  return h >= 0 && h < 24 && mi >= 0 && mi < 60 ? [h, mi] : [9, 0];
};

/** The most recent complete send-time-to-send-time (24 h) period in the property's zone. */
function latestWindow(tz: string, at: [number, number] = [9, 0], now = new Date()): { report_date: string; start: string; end: string } {
  let date = localYmd(now, tz);
  if (zonedToUtc(date, at[0], tz, at[1]).getTime() > now.getTime()) date = addDays(date, -1);
  return {
    report_date: date,
    start: zonedToUtc(addDays(date, -1), at[0], tz, at[1]).toISOString(),
    end: zonedToUtc(date, at[0], tz, at[1]).toISOString(),
  };
}

/** The 24 hours ending right now — used by Preview and Send now so today's patrols always show up. */
function rollingWindow(tz: string, now = new Date()): { report_date: string; start: string; end: string } {
  return {
    report_date: localYmd(now, tz),
    start: new Date(now.getTime() - 24 * 3600 * 1000).toISOString(),
    end: now.toISOString(),
  };
}

/** A real, non-trivial PDF (header present and more than a bare page). */
const validPdf = (b: Uint8Array) =>
  b.length > 1500 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46; // "%PDF"

/* ---------------------------------------------------------------- data + pdf */

async function loadSettings(admin: Admin, propertyId: string): Promise<Settings | null> {
  const { data } = await admin.from("daily_report_settings").select("*").eq("property_id", propertyId).maybeSingle();
  return (data as Settings | null) ?? null;
}
async function propertyTz(admin: Admin, propertyId: string): Promise<string> {
  const { data } = await admin.rpc("daily_report__tz", { p_property: propertyId });
  const tz = typeof data === "string" && data ? data : "America/New_York";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "America/New_York";
  }
}

interface Built {
  pdf: Uint8Array;
  input: DailyReportInput;
  empty: boolean;
  filename: string;
}

async function buildReport(admin: Admin, opts: { orgId: string; propertyId: string; tz: string; start: string; end: string; includePhotos: boolean }): Promise<Built> {
  const { data, error } = await admin.rpc("daily_report__data", { p_property: opts.propertyId, p_start: opts.start, p_end: opts.end });
  if (error || !data) {
    console.error("daily_report__data", error?.message);
    throw new Error("Couldn't load this property's patrol data.");
  }
  const d = data as {
    property: DailyReportInput["property"];
    patrols: ReportPatrol[];
    incidents: ReportIncident[];
    time: ReportTime[];
    handoffs: ReportHandoff[];
  };
  const { name: company } = await orgIdentity(admin, opts.orgId);

  // Photos: incidents first, then follow-ups/incidents from patrols, then the rest (chronological within each).
  const wanted: { path: string; at: string; caption: string; status: ReportPhoto["status"]; rank: number }[] = [];
  for (const i of d.incidents) for (const path of i.photos ?? []) wanted.push({ path, at: i.at, caption: i.reported_by || "Incident", status: "incident-report", rank: 0 });
  for (const p of d.patrols)
    for (const path of p.photos ?? [])
      wanted.push({ path, at: p.at, caption: p.officer || "Officer", status: p.status, rank: p.status === "clear" ? 2 : 1 });
  wanted.sort((a, b) => a.rank - b.rank || Date.parse(a.at) - Date.parse(b.at));
  const photos: ReportPhoto[] = [];
  let bytesTotal = 0;
  if (opts.includePhotos) {
    for (const w of wanted) {
      if (photos.length >= MAX_PHOTOS) break;
      if (!w.path.startsWith(`${opts.orgId}/`)) continue; // never embed another org's file
      const { data: blob, error: dlErr } = await admin.storage.from(PHOTO_BUCKET).download(w.path);
      if (dlErr || !blob) continue;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (bytesTotal + bytes.length > MAX_PHOTO_BYTES_TOTAL) break;
      bytesTotal += bytes.length;
      photos.push({ bytes, at: w.at, caption: w.caption, status: w.status });
    }
    photos.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  }

  const input: DailyReportInput = {
    company,
    property: d.property,
    tz: opts.tz,
    windowStart: opts.start,
    windowEnd: opts.end,
    patrols: d.patrols,
    incidents: d.incidents,
    time: d.time,
    handoffs: d.handoffs,
    photos,
    photosOmitted: opts.includePhotos ? Math.max(0, wanted.length - photos.length) : 0,
    includePhotos: opts.includePhotos,
  };
  const pdf = await buildDailyReportPdf(input);
  const filename = `Daily-Patrol-Report-${safeName(d.property.name)}-${localYmd(new Date(opts.end), opts.tz)}.pdf`;
  return { pdf, input, empty: !d.patrols.length && !d.incidents.length && !d.time.length, filename };
}

/* ---------------------------------------------------------------- email */

function routeEmail(settings: DispatchSettings | null, intended: string[]): { to: string[]; test: boolean; reason: string } {
  if (!settings || settings.test_mode) {
    const t = (settings?.test_email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(t)) return { to: [], test: true, reason: "Emails are in test mode and no test email is set (Dispatch → Settings)." };
    return { to: [t], test: true, reason: "" };
  }
  const to = [...new Set(intended.map((e) => e.trim().toLowerCase()).filter((e) => EMAIL_RE.test(e)))];
  return { to, test: false, reason: to.length ? "" : "No valid recipient email." };
}

function emailBody(b: Built, test: { on: boolean; intended: string[] }) {
  const { input } = b;
  const s = summarize(input);
  const tz = input.tz;
  const period = `${day(input.windowStart, tz)} ${clock(input.windowStart, tz)} to ${day(input.windowEnd, tz)} ${clock(input.windowEnd, tz)} ${tzAbbr(input.windowEnd, tz)}`;
  const incidents = input.incidents.length + s.counts.incident;
  const rows: [string, string][] = [
    ["Patrols logged", String(input.patrols.length)],
    ["Follow-ups", String(s.counts["follow-up"])],
    ["Incidents", String(incidents)],
    ["Officers on duty", String(s.officers)],
    ["Time on site", s.onSiteMs ? fmtDuration(s.onSiteMs) : "None recorded"],
  ];
  const testNote = test.on
    ? `<p style="margin:0 0 14px;padding:10px 12px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;font-size:13px;color:#9a3412;">
         TEST MODE: this report was sent only to you. When test mode is off it goes to: ${escapeHtml(test.intended.join(", ") || "(no recipients set)")}.</p>`
    : "";
  const table = `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:6px 0 14px;">${rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:7px 0;border-bottom:1px solid #e0e1e5;color:#5c5f66;font-size:14px;">${escapeHtml(k)}</td><td style="padding:7px 0;border-bottom:1px solid #e0e1e5;text-align:right;font-weight:bold;font-size:14px;color:${k === "Incidents" && incidents ? "#dc2626" : "#16171a"};">${escapeHtml(v)}</td></tr>`,
    )
    .join("")}</table>`;
  const html = emailShell(
    input.company,
    `Daily patrol report: ${input.property.name}`,
    `${testNote}<p style="margin:0 0 10px;">Here is the patrol report for ${escapeHtml(period)}. The full report${input.photos.length ? " with photos" : ""} is attached as a PDF.</p>${table}${
      b.empty ? `<p style="margin:0 0 12px;">No patrols, incidents or time on site were recorded in this period.</p>` : ""
    }<p style="margin:0;color:#8a8d94;font-size:13px;">Questions? Just reply to this email.</p>`,
  );
  const text = [
    test.on ? `TEST MODE - normally sent to: ${test.intended.join(", ") || "(no recipients set)"}\n` : "",
    `Daily patrol report: ${input.property.name}`,
    `Period: ${period}`,
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    "The full report is attached as a PDF.",
  ].join("\n");
  const subject = `${test.on ? "[TEST] " : ""}Daily patrol report - ${input.property.name} - ${longDay(input.windowEnd, tz)}`;
  return { html, text, subject };
}

/* ---------------------------------------------------------------- process one run */

async function processRun(admin: Admin, run: Run): Promise<Record<string, unknown>> {
  const settings = await loadSettings(admin, run.property_id);
  const intended = settings?.recipients ?? [];
  const fail = async (msg: string) => {
    const retryable = run.trigger === "schedule" && run.attempts < 3;
    await admin
      .from("daily_report_runs")
      .update({
        status: "failed",
        error: msg.slice(0, 500),
        intended_to: intended,
        next_retry_at: retryable ? new Date(Date.now() + 30 * 60000 * run.attempts).toISOString() : null,
      })
      .eq("id", run.id);
    return { id: run.id, status: "failed", error: msg };
  };

  try {
    if (run.trigger === "schedule" && (!settings || !settings.enabled)) {
      await admin.from("daily_report_runs").update({ status: "skipped", note: "Daily reports were turned off before sending." }).eq("id", run.id);
      return { id: run.id, status: "skipped" };
    }
    if (!emailConfigured()) return await fail("Email sending isn't set up yet.");

    const built = await buildReport(admin, {
      orgId: run.org_id,
      propertyId: run.property_id,
      tz: run.tz,
      start: run.window_start,
      end: run.window_end,
      includePhotos: settings?.include_photos ?? true,
    });
    const counts = {
      patrol_count: built.input.patrols.length,
      incident_count: built.input.incidents.length,
      photo_count: built.input.photos.length,
    };

    const path = `${run.org_id}/${run.property_id}/${run.report_date}-${run.id}.pdf`;
    const { error: upErr } = await admin.storage.from(REPORT_BUCKET).upload(path, built.pdf, { contentType: "application/pdf", upsert: true });
    if (upErr) console.error("daily-report upload", upErr.message);

    // Never email a blank report — not on schedule, not manually, regardless of older settings.
    if (built.empty) {
      const note = "Nothing was recorded in this period, so no email was sent.";
      await admin
        .from("daily_report_runs")
        .update({ status: "skipped", note, pdf_path: upErr ? "" : path, intended_to: intended, ...counts, error: "", next_retry_at: null })
        .eq("id", run.id);
      return { id: run.id, status: "skipped", note };
    }
    if (!validPdf(built.pdf)) return await fail("The report PDF came out empty, so it wasn't sent.");

    const dispatch = await loadDispatchSettings(admin, run.org_id);
    const route = routeEmail(dispatch, intended);
    if (!route.to.length) return await fail(route.reason);
    if (!route.test && !intended.length) return await fail("Add at least one recipient for this property.");

    const { replyTo, name } = await orgIdentity(admin, run.org_id);
    const body = emailBody(built, { on: route.test, intended });
    const err = await sendEmail({
      to: route.to,
      subject: body.subject,
      html: body.html,
      text: body.text,
      replyTo: replyTo || undefined,
      fromName: name,
      attachments: [{ filename: built.filename, content: toBase64(built.pdf) }],
    });
    if (err) {
      await admin.from("daily_report_runs").update({ pdf_path: upErr ? "" : path, ...counts, test_mode: route.test }).eq("id", run.id);
      return await fail(err);
    }
    await admin
      .from("daily_report_runs")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        sent_to: route.to,
        intended_to: intended,
        test_mode: route.test,
        pdf_path: upErr ? "" : path,
        error: "",
        note: route.test ? "Test mode: sent to the test email only." : "",
        next_retry_at: null,
        ...counts,
      })
      .eq("id", run.id);
    return { id: run.id, status: "sent", test_mode: route.test };
  } catch (e) {
    console.error("daily-report run failed", run.id, e instanceof Error ? e.message : String(e));
    return await fail(e instanceof Error && e.message.length < 200 ? e.message : "The report couldn't be generated.");
  }
}

/* ---------------------------------------------------------------- admin */

async function adminAction(req: Request, admin: Admin, action: string, body: Record<string, unknown>): Promise<Response> {
  const caller = await requireAuth(req);
  const { data: me } = await admin.from("profiles").select("id, org_id, role, active").eq("id", caller.id).single();
  if (!me || !me.active || me.role !== "admin") throw new HttpError(403, "Only admins can manage daily reports.");

  const ownProperty = async (v: unknown) => {
    const id = uuid(v);
    const { data } = await admin.from("properties").select("id, org_id").eq("id", id).maybeSingle();
    if (!data || data.org_id !== me.org_id) throw new HttpError(404, "Property not found.");
    return id;
  };
  const ownRun = async (v: unknown) => {
    const id = uuid(v);
    const { data } = await admin.from("daily_report_runs").select("*").eq("id", id).maybeSingle();
    if (!data || data.org_id !== me.org_id) throw new HttpError(404, "Report not found.");
    return data as Run & { pdf_path: string };
  };

  if (action === "status") {
    const d = await loadDispatchSettings(admin, me.org_id);
    const propertyId = body.property_id ? await ownProperty(body.property_id) : null;
    const tz = propertyId ? await propertyTz(admin, propertyId) : null;
    const at = parseSendTime(propertyId ? (await loadSettings(admin, propertyId))?.send_time : null);
    const w = tz ? latestWindow(tz, at) : null;
    let next: string | null = null;
    if (tz) {
      const today = localYmd(new Date(), tz);
      const due = zonedToUtc(today, at[0], tz, at[1]);
      next = (due.getTime() > Date.now() ? due : zonedToUtc(addDays(today, 1), at[0], tz, at[1])).toISOString();
    }
    return json({
      email_configured: emailConfigured(),
      test_mode: !d || d.test_mode,
      test_email: d?.test_email ?? "",
      tz,
      latest_window: w,
      next_send_at: next,
    });
  }

  if (action === "preview") {
    const propertyId = await ownProperty(body.property_id);
    const tz = await propertyTz(admin, propertyId);
    const s = await loadSettings(admin, propertyId);
    const w = rollingWindow(tz);
    const include = typeof body.include_photos === "boolean" ? body.include_photos : s?.include_photos ?? true;
    const built = await buildReport(admin, { orgId: me.org_id, propertyId, tz, start: w.start, end: w.end, includePhotos: include });
    return json({ filename: built.filename, pdf_base64: toBase64(built.pdf), empty: built.empty, window: w, tz });
  }

  if (action === "send_now") {
    const propertyId = await ownProperty(body.property_id);
    const tz = await propertyTz(admin, propertyId);
    const w = rollingWindow(tz);
    const { data: run, error } = await admin
      .from("daily_report_runs")
      .insert({
        org_id: me.org_id,
        property_id: propertyId,
        report_date: w.report_date,
        tz,
        window_start: w.start,
        window_end: w.end,
        trigger: "manual",
        status: "sending",
        attempts: 1,
        last_attempt_at: new Date().toISOString(),
        requested_by: me.id,
      })
      .select("*")
      .single();
    if (error || !run) throw new HttpError(500, "Couldn't start the report.");
    return json(await processRun(admin, run as Run));
  }

  if (action === "retry") {
    const run = await ownRun(body.run_id);
    if (run.status !== "failed") throw new HttpError(400, "Only failed reports can be retried.");
    const { data: claimed } = await admin
      .from("daily_report_runs")
      .update({ status: "sending", attempts: run.attempts + 1, last_attempt_at: new Date().toISOString(), next_retry_at: null, requested_by: me.id })
      .eq("id", run.id)
      .eq("status", "failed")
      .select("*")
      .maybeSingle();
    if (!claimed) throw new HttpError(409, "This report is already being sent.");
    // A manual retry is the admin's call: don't schedule further automatic retries if it fails again.
    return json(await processRun(admin, { ...(claimed as Run), attempts: Math.max(3, (claimed as Run).attempts) }));
  }

  if (action === "download") {
    const run = await ownRun(body.run_id);
    if (!run.pdf_path) throw new HttpError(404, "No PDF was saved for this report.");
    const { data, error } = await admin.storage.from(REPORT_BUCKET).createSignedUrl(run.pdf_path, 600);
    if (error || !data) throw new HttpError(404, "The PDF couldn't be found.");
    return json({ url: data.signedUrl });
  }

  throw new HttpError(400, "Unknown action.");
}

/* ---------------------------------------------------------------- entry */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const admin = createAdminClient();
    const body = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "";

    if (action === "cron") {
      const secret = req.headers.get("x-cron-secret") ?? "";
      const { data: valid } = await admin.rpc("verify_cron_secret", { p_secret: secret });
      if (!secret || valid !== true) throw new HttpError(401, "Unauthorized");
      const { data, error } = await admin.rpc("daily_report__claim", { p_limit: 5 });
      if (error) throw new Error(error.message);
      const runs = (data ?? []) as Run[];
      const results = [];
      for (const r of runs) results.push(await processRun(admin, r));
      if (runs.length) console.log(`daily-report: ${runs.length} runs`, results.map((r) => r.status).join(","));
      return json({ ok: true, runs: results.length });
    }

    return await adminAction(req, admin, action, body);
  } catch (err) {
    return handleError(err);
  }
});
