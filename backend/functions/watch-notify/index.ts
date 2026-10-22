import { corsHeaders, createAdminClient, EMAIL_RE, handleError, HttpError, json, requireAuth } from "../_shared/auth.ts";
import { emailConfigured, escapeHtml, sendEmail } from "../_shared/crm.ts";
import { loadDispatchSettings, routeSms, sendSms, smsConfigured, toE164, type DispatchSettings } from "../_shared/sms.ts";

/**
 * Client emails when a fire watch starts and when it ends.
 * Cron (x-cron-secret, every 5 min): sends the start confirmation once the first shift is within 24 hours,
 * and the completion notice once the last shift of an ended watch is over.
 * Admin (signed-in admin JWT): status, save, preview, send (manual / resend), run (after ending a watch), skip.
 * Test mode (dispatch_settings.test_mode, or no settings) sends ONLY to the org's test email.
 * Optional client texts (per-property text_start / text_end, OFF by default) follow the same timing;
 * in test mode they go ONLY to the org's test phone.
 */

type Admin = ReturnType<typeof createAdminClient>;
type Kind = "start" | "end";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface OrgCfg {
  org_id: string;
  auto_enabled: boolean;
  your_phone: string;
  direct_line: string;
  office_line: string;
  invoice_days: number;
  review_url: string;
  signer_name: string;
  signer_title: string;
  company_legal: string;
  website: string;
  exists: boolean;
}
interface PropCfg {
  send_start: boolean;
  send_end: boolean;
  recipients: string[];
  client_first_name: string;
  onsite_contact: string;
  billing_email: string;
  coverage: string;
  officers: number | null;
  deposit_amount: number | null;
  text_start: boolean;
  text_end: boolean;
  text_phones: string[];
}
interface Watch {
  id: string;
  org_id: string;
  property_id: string;
  started_on: string;
  ended_on: string | null;
  ended_at: string | null;
  created_at: string;
}
interface Property {
  id: string;
  org_id: string;
  name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  patrol_interval_minutes: number | null;
  client_id: string | null;
}
interface Ctx {
  watch: Watch;
  property: Property;
  org: OrgCfg;
  prop: PropCfg;
  tz: string;
  clientBilling: string;
  firstStart: string | null;
  lastEnd: string | null;
  firstClockIn: string | null;
  lastClockOut: string | null;
  stillOnDuty: boolean;
  shifts: { s: number; e: number; st: string; et: string; date: string }[];
}

const uuid = (v: unknown): string => {
  if (typeof v !== "string" || !UUID_RE.test(v)) throw new HttpError(400, "Invalid request.");
  return v;
};
const kindOf = (v: unknown): Kind => {
  if (v !== "start" && v !== "end") throw new HttpError(400, "Invalid email type.");
  return v;
};
const str = (v: unknown, max = 200): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

const PROP_DEFAULTS: PropCfg = {
  send_start: true,
  send_end: true,
  recipients: [],
  client_first_name: "",
  onsite_contact: "",
  billing_email: "",
  coverage: "",
  officers: null,
  deposit_amount: null,
  text_start: false,
  text_end: false,
  text_phones: [],
};

/* ---------------------------------------------------------------- data */

async function loadOrgCfg(admin: Admin, orgId: string): Promise<OrgCfg> {
  const [{ data }, { data: crm }, { data: org }] = await Promise.all([
    admin.from("watch_email_settings").select("*").eq("org_id", orgId).maybeSingle(),
    admin.from("crm_settings").select("company_phone, countersign_name").eq("org_id", orgId).maybeSingle(),
    admin.from("organizations").select("name").eq("id", orgId).maybeSingle(),
  ]);
  if (data) return { ...(data as OrgCfg), invoice_days: Number(data.invoice_days) || 3, exists: true };
  return {
    org_id: orgId,
    auto_enabled: false,
    your_phone: crm?.company_phone ?? "",
    direct_line: "",
    office_line: crm?.company_phone ?? "",
    invoice_days: 3,
    review_url: "",
    signer_name: "",
    signer_title: "",
    company_legal: crm?.countersign_name || org?.name || "",
    website: "",
    exists: false,
  };
}

async function loadPropCfg(admin: Admin, propertyId: string): Promise<PropCfg> {
  const { data } = await admin.from("property_watch_email").select("*").eq("property_id", propertyId).maybeSingle();
  if (!data) return { ...PROP_DEFAULTS };
  return {
    send_start: !!data.send_start,
    send_end: !!data.send_end,
    recipients: (data.recipients ?? []) as string[],
    client_first_name: data.client_first_name ?? "",
    onsite_contact: data.onsite_contact ?? "",
    billing_email: data.billing_email ?? "",
    coverage: data.coverage ?? "",
    officers: data.officers == null ? null : Number(data.officers),
    deposit_amount: data.deposit_amount == null ? null : Number(data.deposit_amount),
    text_start: data.text_start === true,
    text_end: data.text_end === true,
    text_phones: (data.text_phones ?? []) as string[],
  };
}

const addDays = (ymd: string, n: number): string => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Converts a local wall time in `tz` to a UTC instant. */
function zoned(ymd: string, hms: string, tz: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  const [hh, mm] = hms.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(guess));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asLocal = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"));
  return guess - (asLocal - guess);
}

async function loadCtx(admin: Admin, watchId: string, orgId?: string): Promise<Ctx> {
  const { data: watch } = await admin.from("property_watches").select("id, org_id, property_id, started_on, ended_on, ended_at, created_at").eq("id", watchId).maybeSingle();
  if (!watch || (orgId && watch.org_id !== orgId)) throw new HttpError(404, "Watch not found.");
  const w = watch as Watch;
  const { data: property } = await admin
    .from("properties")
    .select("id, org_id, name, contact_name, contact_email, contact_phone, patrol_interval_minutes, client_id")
    .eq("id", w.property_id)
    .single();
  const p = property as Property;
  const [org, prop, tzRes, bounds] = await Promise.all([
    loadOrgCfg(admin, w.org_id),
    loadPropCfg(admin, w.property_id),
    admin.rpc("org__tz", { p_org: w.org_id }),
    admin.rpc("watch_email__bounds", { p_watch: w.id }),
  ]);
  const tz = (typeof tzRes.data === "string" && tzRes.data) || "America/New_York";
  const b = ((bounds.data ?? []) as { first_start: string | null; last_end: string | null }[])[0] ?? { first_start: null, last_end: null };

  let clientBilling = "";
  if (p.client_id) {
    const { data: c } = await admin.from("crm_clients").select("billing_email").eq("id", p.client_id).maybeSingle();
    clientBilling = c?.billing_email ?? "";
  }

  const fromIso = new Date(zoned(w.started_on, "00:00", tz)).toISOString();
  const untilIso = new Date(zoned(addDays(w.ended_on ?? addDays(w.started_on, 400), 1), "00:00", tz)).toISOString();
  const { data: entries } = await admin
    .from("time_entries")
    .select("clock_in, clock_out")
    .eq("property_id", p.id)
    .gte("clock_in", fromIso)
    .lt("clock_in", untilIso)
    .order("clock_in", { ascending: true })
    .limit(2000);
  const list = (entries ?? []) as { clock_in: string; clock_out: string | null }[];
  const outs = list.map((e) => e.clock_out).filter((x): x is string => !!x).sort();

  let q = admin.from("shifts").select("shift_date, start_time, end_time").eq("property_id", p.id).gte("shift_date", w.started_on);
  if (w.ended_on) q = q.lte("shift_date", w.ended_on);
  const { data: shiftRows } = await q.order("shift_date").order("start_time").limit(400);
  const shifts = ((shiftRows ?? []) as { shift_date: string; start_time: string; end_time: string }[]).map((r) => {
    const s = zoned(r.shift_date, r.start_time, tz);
    const endDay = r.end_time <= r.start_time ? addDays(r.shift_date, 1) : r.shift_date;
    return { s, e: zoned(endDay, r.end_time, tz), st: r.start_time.slice(0, 5), et: r.end_time.slice(0, 5), date: r.shift_date };
  });

  return {
    watch: w,
    property: p,
    org,
    prop,
    tz,
    clientBilling,
    firstStart: b.first_start,
    lastEnd: b.last_end,
    firstClockIn: list[0]?.clock_in ?? null,
    lastClockOut: outs[outs.length - 1] ?? null,
    stillOnDuty: list.some((e) => !e.clock_out),
    shifts,
  };
}

/* ---------------------------------------------------------------- fields */

const fmtDate = (ms: number, tz: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date(ms));
const fmtTime = (ms: number, tz: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(ms));
const clock12 = (hm: string) => {
  const [h, m] = hm.split(":").map(Number);
  const ap = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${ap}`;
};
const longYmd = (ymd: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date(`${ymd}T12:00:00Z`));

/** Coverage and officers worked out from the schedule's first week. */
function autoCoverage(ctx: Ctx): { coverage: string; officers: number | null } {
  if (!ctx.shifts.length) return { coverage: "", officers: null };
  const t0 = ctx.shifts[0].s;
  const week = ctx.shifts.filter((x) => x.s < t0 + 7 * 86400000);
  let officers = 1;
  for (const a of week) officers = Math.max(officers, week.filter((b) => b.s <= a.s && b.e > a.s).length);

  const sorted = [...week].sort((a, b) => a.s - b.s);
  let reach = sorted[0].s;
  let gap = false;
  for (const x of sorted) {
    if (x.s > reach + 60000) gap = true;
    reach = Math.max(reach, x.e);
  }
  if (!gap && reach - sorted[0].s >= 24 * 3600000) return { coverage: "24/7 continuous fire watch coverage", officers };

  const counts = new Map<string, number>();
  for (const x of week) counts.set(`${x.st}-${x.et}`, (counts.get(`${x.st}-${x.et}`) ?? 0) + 1);
  const [top] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [st, et] = top[0].split("-");
  const days = new Set(week.map((x) => x.date)).size;
  return { coverage: `${days > 1 ? "Daily" : "One shift"}, ${clock12(st)} – ${clock12(et)}`, officers };
}

interface Fields {
  first_name: string;
  property: string;
  start_date: string;
  start_time: string;
  end_date: string;
  end_time: string;
  coverage: string;
  officers: string;
  patrol: string;
  onsite: string;
  billing_email: string;
  your_phone: string;
  direct_line: string;
  office_line: string;
  invoice_days: number;
  review_url: string;
  signer_name: string;
  signer_title: string;
  company_legal: string;
  website: string;
  start_at: string | null;
  end_at: string | null;
  start_source: string;
  end_source: string;
  auto_coverage: string;
  auto_officers: number | null;
}

function resolve(ctx: Ctx, override?: Partial<PropCfg>, org?: Partial<OrgCfg>): Fields {
  const pc = { ...ctx.prop, ...(override ?? {}) };
  const oc = { ...ctx.org, ...(org ?? {}) };
  const tz = ctx.tz;
  const p = ctx.property;

  // Start: the first clock-in if the watch has begun, otherwise the first scheduled shift.
  const sched = ctx.firstStart ? Date.parse(ctx.firstStart) : null;
  const clockIn = ctx.firstClockIn ? Date.parse(ctx.firstClockIn) : null;
  let startMs: number | null = null;
  let startSource = "the watch start date";
  if (clockIn != null && (sched == null || clockIn <= sched + 6 * 3600000)) {
    startMs = clockIn;
    startSource = "the first guard clock-in";
  } else if (sched != null) {
    startMs = sched;
    startSource = "the first scheduled shift";
  }

  // End: the last clock-out, otherwise the last scheduled shift's end, otherwise when it was ended.
  let endMs: number | null = null;
  let endSource = "";
  if (ctx.watch.ended_on) {
    const lastOut = ctx.lastClockOut ? Date.parse(ctx.lastClockOut) : null;
    const lastEnd = ctx.lastEnd ? Date.parse(ctx.lastEnd) : null;
    if (lastOut != null && !(ctx.stillOnDuty && lastEnd != null && lastEnd > lastOut)) {
      endMs = lastOut;
      endSource = "the last guard clock-out";
    } else if (lastEnd != null) {
      endMs = lastEnd;
      endSource = "the last scheduled shift";
    } else if (ctx.watch.ended_at) {
      endMs = Date.parse(ctx.watch.ended_at);
      endSource = "when the watch was ended";
    }
  } else {
    // Preview of a running watch: as if it ended now.
    endMs = ctx.lastClockOut ? Date.parse(ctx.lastClockOut) : Date.now();
    endSource = "preview — the real end time fills in when the watch ends";
  }

  const auto = autoCoverage(ctx);
  const contactFirst = (p.contact_name ?? "").trim().split(/\s+/)[0] ?? "";
  const officersN = pc.officers ?? auto.officers;
  const interval = p.patrol_interval_minutes ?? 0;
  const patrol = interval > 0 ? (interval % 60 === 0 ? `Every ${interval === 60 ? "hour" : `${interval / 60} hours`}` : `Every ${interval} minutes`) : "";
  const onsite = pc.onsite_contact || [p.contact_name, p.contact_phone].filter((x) => x && x.trim()).join(" · ");

  return {
    first_name: pc.client_first_name || contactFirst || "there",
    property: p.name,
    start_date: startMs != null ? fmtDate(startMs, tz) : longYmd(ctx.watch.started_on),
    start_time: startMs != null ? fmtTime(startMs, tz) : "",
    end_date: endMs != null ? fmtDate(endMs, tz) : ctx.watch.ended_on ? longYmd(ctx.watch.ended_on) : "",
    end_time: endMs != null ? fmtTime(endMs, tz) : "",
    coverage: pc.coverage || auto.coverage,
    officers: officersN ? `${officersN} ${officersN === 1 ? "officer" : "officers"}` : "",
    patrol,
    onsite,
    billing_email: pc.billing_email || ctx.clientBilling || p.contact_email || "",
    your_phone: oc.your_phone,
    direct_line: oc.direct_line,
    office_line: oc.office_line,
    invoice_days: oc.invoice_days,
    review_url: oc.review_url,
    signer_name: oc.signer_name,
    signer_title: oc.signer_title,
    company_legal: oc.company_legal,
    website: oc.website,
    start_at: startMs != null ? new Date(startMs).toISOString() : null,
    end_at: endMs != null ? new Date(endMs).toISOString() : null,
    start_source: startSource,
    end_source: endSource,
    auto_coverage: auto.coverage,
    auto_officers: auto.officers,
  };
}

/* ---------------------------------------------------------------- compose */

interface Block {
  p?: string;
  rows?: [string, string][];
  link?: { label: string; url: string };
}

function signature(f: Fields): string[] {
  const lines = [f.signer_name, [f.signer_title, f.company_legal].filter(Boolean).join(", ")];
  const phones = [f.direct_line && `Direct: ${f.direct_line}`, f.office_line && `Office: ${f.office_line}`].filter(Boolean).join(" | ");
  if (phones) lines.push(phones);
  if (f.website) lines.push(f.website);
  return lines.filter((x) => x && x.trim());
}

function compose(kind: Kind, f: Fields, testFor?: string[]): { subject: string; text: string; html: string } {
  const phone = f.your_phone || f.office_line || f.direct_line;
  const at = (d: string, t: string) => (t ? `${d} at ${t}` : d);
  let subject: string;
  let heading: string;
  const blocks: Block[] = [{ p: `Hi ${f.first_name},` }];

  if (kind === "start") {
    subject = `Fire Watch Service Confirmed – ${f.property}`;
    heading = "Fire watch service confirmed";
    blocks.push({
      p: `Thank you for choosing ${f.company_legal || "us"}. This email confirms that fire watch service for ${f.property} is scheduled and our team is ready to begin on ${at(f.start_date, f.start_time)}.`,
    });
    const rows: [string, string][] = [
      ["Property", f.property],
      ["Start", at(f.start_date, f.start_time)],
    ];
    if (f.coverage) rows.push(["Coverage", f.coverage]);
    if (f.officers) rows.push(["Officers on duty", f.officers]);
    if (f.patrol) rows.push(["Patrol interval", f.patrol]);
    if (f.onsite) rows.push(["On-site contact", f.onsite]);
    blocks.push({ rows });
    blocks.push({
      p: `Our officers will conduct and log patrols at the interval above for the duration of the watch.${f.billing_email ? ` Invoices are sent weekly to ${f.billing_email}.` : " Invoices are sent weekly."}`,
    });
    blocks.push({ p: `If anything changes on site or you need to reach us at any time, please call ${phone || "us"}.` });
    blocks.push({ p: "Thank you for trusting us with your property." });
  } else {
    subject = `Fire Watch Service Completed – ${f.property}`;
    heading = "Fire watch service completed";
    blocks.push({
      p: `This email confirms that fire watch service at ${f.property} has been completed as of ${at(f.end_date, f.end_time)}. Thank you for choosing ${f.company_legal || "us"}.`,
    });
    blocks.push({
      p: `Your final invoice will be sent within ${f.invoice_days} business ${f.invoice_days === 1 ? "day" : "days"}${f.billing_email ? ` to ${f.billing_email}` : ""}.`,
    });
    blocks.push({ p: "If you need copies of the patrol logs for your records, your insurer, or the fire marshal, just reply to this email and we'll send them over." });
    if (f.review_url) {
      blocks.push({ p: "If you were happy with our service, we'd be grateful if you left us a quick Google review:" });
      blocks.push({ link: { label: "Leave a Google review", url: f.review_url } });
    }
    blocks.push({ p: `If you need fire watch coverage again, please call ${phone || "us"} — we're always here to help.` });
  }

  const sig = signature(f);
  const textParts = blocks.map((b) =>
    b.p ? b.p : b.rows ? b.rows.map(([k, v]) => `${k}: ${v}`).join("\n") : b.link ? b.link.url : "",
  );
  const testNote = testFor ? `[TEST MODE — would have gone to: ${testFor.length ? testFor.join(", ") : "no client email on file"}]\n\n` : "";
  const text = `${testNote}${textParts.join("\n\n")}\n\nBest regards,\n${sig.join("\n")}`;

  const P = (s: string) => `<p style="margin:0 0 14px;">${escapeHtml(s)}</p>`;
  const body = blocks
    .map((b) => {
      if (b.p) return P(b.p);
      if (b.rows)
        return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:4px 0 16px;border:1px solid #e0e1e5;border-radius:8px;">${b.rows
          .map(
            ([k, v], i) =>
              `<tr><td style="padding:9px 12px;font-size:13px;color:#8a8d94;white-space:nowrap;vertical-align:top;${i ? "border-top:1px solid #eef0f3;" : ""}">${escapeHtml(k)}</td><td style="padding:9px 12px;font-size:14px;color:#16171a;font-weight:bold;${i ? "border-top:1px solid #eef0f3;" : ""}">${escapeHtml(v)}</td></tr>`,
          )
          .join("")}</table>`;
      if (b.link)
        return `<p style="margin:0 0 16px;"><a href="${escapeHtml(b.link.url)}" style="display:inline-block;background:#dc2626;color:#ffffff;text-decoration:none;font-weight:bold;padding:11px 18px;border-radius:8px;font-size:14px;">${escapeHtml(b.link.label)}</a></p>`;
      return "";
    })
    .join("");
  const sigHtml = `<p style="margin:18px 0 0;">Best regards,<br/>${sig
    .map((l, i) => (i === 0 ? `<strong style="color:#16171a;">${escapeHtml(l)}</strong>` : escapeHtml(l)))
    .join("<br/>")}</p>`;
  const testHtml = testFor
    ? `<div style="margin:0 0 16px;padding:10px 12px;border:1px dashed #dc2626;border-radius:8px;font-size:12px;color:#991b1b;">Test mode — this would have gone to: ${escapeHtml(testFor.length ? testFor.join(", ") : "no client email on file")}</div>`
    : "";
  const company = f.company_legal || "Fire Watch";

  const html = `<!doctype html>
<html><body style="margin:0;background:#f3f4f6;font-family:Helvetica,Arial,sans-serif;color:#16171a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e0e1e5;border-radius:12px;">
<tr><td style="padding:26px 28px 6px;border-bottom:3px solid #dc2626;"><div style="font-size:18px;letter-spacing:3px;font-weight:bold;">${escapeHtml(company.toUpperCase())}</div></td></tr>
<tr><td style="padding:22px 28px 6px;"><h1 style="margin:0 0 14px;font-size:21px;">${escapeHtml(heading)}</h1>
<div style="font-size:15px;line-height:1.6;color:#45474d;">${testHtml}${body}${sigHtml}</div></td></tr>
<tr><td style="padding:18px 28px 24px;"><p style="margin:0;font-size:12px;color:#8a8d94;border-top:1px solid #e0e1e5;padding-top:14px;">${escapeHtml(company)}${f.website ? ` · ${escapeHtml(f.website)}` : ""}</p></td></tr>
</table></td></tr></table></body></html>`;
  return { subject: testFor ? `[TEST] ${subject}` : subject, text, html };
}

/* ---------------------------------------------------------------- send */

function intendedRecipients(ctx: Ctx, pc: PropCfg = ctx.prop): string[] {
  const list = pc.recipients.length ? pc.recipients : [ctx.property.contact_email ?? ""];
  return [...new Set(list.map((e) => e.trim().toLowerCase()).filter((e) => EMAIL_RE.test(e)))];
}

function routeEmail(settings: DispatchSettings | null, intended: string[]): { to: string[]; test: boolean; reason: string } {
  if (!settings || settings.test_mode) {
    const t = (settings?.test_email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(t)) return { to: [], test: true, reason: "Emails are in test mode and no test email is set (Dispatch → Settings)." };
    return { to: [t], test: true, reason: "" };
  }
  return { to: intended, test: false, reason: intended.length ? "" : "No client email on file for this property." };
}

interface Row {
  id: string;
  status: string;
  attempts: number;
  updated_at: string;
}

async function deliver(admin: Admin, watchId: string, kind: Kind, trigger: "auto" | "manual", by: string | null, force = false) {
  const ctx = await loadCtx(admin, watchId);
  const { data: existing } = await admin.from("watch_emails").select("id, status, attempts, updated_at").eq("watch_id", watchId).eq("kind", kind).maybeSingle();
  const ex = existing as Row | null;
  let row: Row | null = null;
  const now = new Date().toISOString();
  if (!ex) {
    const { data } = await admin
      .from("watch_emails")
      .upsert(
        { org_id: ctx.watch.org_id, property_id: ctx.property.id, watch_id: watchId, kind, status: "sending", trigger, attempts: 1, sent_by: by, updated_at: now },
        { onConflict: "watch_id,kind", ignoreDuplicates: true },
      )
      .select("id, status, attempts, updated_at")
      .maybeSingle();
    row = data as Row | null;
    if (!row) return { status: "busy" };
  } else {
    const stuck = ex.status === "sending" && Date.parse(ex.updated_at) < Date.now() - 15 * 60000;
    const retryable = ex.status === "failed" || stuck;
    if (!force && !retryable) return { status: ex.status, id: ex.id };
    if (ex.status === "sending" && !stuck) throw new HttpError(409, "This email is already being sent.");
    const { data } = await admin
      .from("watch_emails")
      .update({ status: "sending", trigger, attempts: ex.attempts + 1, sent_by: by, updated_at: now, error: "" })
      .eq("id", ex.id)
      .eq("status", ex.status)
      .select("id, status, attempts, updated_at")
      .maybeSingle();
    row = data as Row | null;
    if (!row) return { status: "busy" };
  }

  const f = resolve(ctx);
  const intended = intendedRecipients(ctx);
  const dispatch = await loadDispatchSettings(admin, ctx.watch.org_id);
  const route = routeEmail(dispatch, intended);
  const msg = compose(kind, f, route.test ? intended : undefined);
  const base = { intended_to: intended, test_mode: route.test, subject: msg.subject, event_at: kind === "start" ? f.start_at : f.end_at, updated_at: new Date().toISOString() };

  if (!route.to.length) {
    const status = route.test ? "failed" : "skipped";
    await admin.from("watch_emails").update({ ...base, status, error: route.reason, ...(route.test ? { attempts: 3 } : {}) }).eq("id", row.id);
    return { status, id: row.id, error: route.reason };
  }
  const err = await sendEmail({
    to: route.to,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
    replyTo: await replyTo(admin, ctx.watch.org_id),
    fromName: ctx.org.company_legal || undefined,
  });
  if (err) {
    await admin.from("watch_emails").update({ ...base, status: "failed", error: err }).eq("id", row.id);
    return { status: "failed", id: row.id, error: err };
  }
  await admin.from("watch_emails").update({ ...base, status: "sent", sent_to: route.to, sent_at: new Date().toISOString(), error: "" }).eq("id", row.id);
  return { status: "sent", id: row.id, sent_to: route.to, test_mode: route.test };
}

/* ---------------------------------------------------------------- texts */

function intendedPhones(ctx: Ctx, pc: PropCfg = ctx.prop): string[] {
  const list = pc.text_phones.length ? pc.text_phones : [ctx.property.contact_phone ?? ""];
  return [...new Set(list.map(toE164).filter(Boolean))];
}

const shortWhen = (iso: string | null, tz: string): string => {
  if (!iso) return "";
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(d);
  const t = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(d);
  return `${day} at ${t}`;
};

function composeSms(kind: Kind, f: Fields, tz: string): string {
  const company = f.company_legal || "Fire Watch";
  const phone = f.your_phone || f.office_line || f.direct_line;
  if (kind === "start") {
    const when = shortWhen(f.start_at, tz);
    return `${company}: Hi ${f.first_name}, fire watch service for ${f.property} is confirmed${when ? ` to begin ${when}` : ""}. Questions or changes? Call ${phone || "us"}. Reply STOP to opt out.`;
  }
  const when = shortWhen(f.end_at, tz);
  return `${company}: Hi ${f.first_name}, fire watch service at ${f.property} was completed${when ? ` ${when}` : ""}. Your final invoice follows within ${f.invoice_days} business ${f.invoice_days === 1 ? "day" : "days"}. Thank you!${f.review_url ? ` Review us: ${f.review_url}` : ""}`;
}

async function deliverText(admin: Admin, watchId: string, kind: Kind, trigger: "auto" | "manual", by: string | null, force = false) {
  const ctx = await loadCtx(admin, watchId);
  const { data: existing } = await admin.from("watch_texts").select("id, status, attempts, updated_at").eq("watch_id", watchId).eq("kind", kind).maybeSingle();
  const ex = existing as Row | null;
  let row: Row | null = null;
  const now = new Date().toISOString();
  if (!ex) {
    const { data } = await admin
      .from("watch_texts")
      .upsert(
        { org_id: ctx.watch.org_id, property_id: ctx.property.id, watch_id: watchId, kind, status: "sending", trigger, attempts: 1, sent_by: by, updated_at: now },
        { onConflict: "watch_id,kind", ignoreDuplicates: true },
      )
      .select("id, status, attempts, updated_at")
      .maybeSingle();
    row = data as Row | null;
    if (!row) return { status: "busy" };
  } else {
    const stuck = ex.status === "sending" && Date.parse(ex.updated_at) < Date.now() - 15 * 60000;
    const retryable = ex.status === "failed" || stuck;
    if (!force && !retryable) return { status: ex.status, id: ex.id };
    if (ex.status === "sending" && !stuck) throw new HttpError(409, "This text is already being sent.");
    const { data } = await admin
      .from("watch_texts")
      .update({ status: "sending", trigger, attempts: ex.attempts + 1, sent_by: by, updated_at: now, error: "" })
      .eq("id", ex.id)
      .eq("status", ex.status)
      .select("id, status, attempts, updated_at")
      .maybeSingle();
    row = data as Row | null;
    if (!row) return { status: "busy" };
  }

  const f = resolve(ctx);
  const intended = intendedPhones(ctx);
  const dispatch = await loadDispatchSettings(admin, ctx.watch.org_id);
  const route = routeSms(dispatch, intended, intended.join(", ") || "no client phone on file");
  const test = !dispatch || dispatch.test_mode;
  const body = route.prefix + composeSms(kind, f, ctx.tz);
  const base = { intended_to: intended, test_mode: test, body, updated_at: new Date().toISOString() };

  if (!route.to.length) {
    const status = test ? "failed" : "skipped";
    await admin.from("watch_texts").update({ ...base, status, error: route.reason, ...(test ? { attempts: 3 } : {}) }).eq("id", row.id);
    return { status, id: row.id, error: route.reason };
  }
  const sent: string[] = [];
  let err: string | null = null;
  for (const to of route.to) {
    const e = await sendSms(to, body);
    if (e) err = e;
    else sent.push(to);
  }
  if (!sent.length) {
    await admin.from("watch_texts").update({ ...base, status: "failed", error: err ?? "Text failed." }).eq("id", row.id);
    return { status: "failed", id: row.id, error: err ?? "Text failed." };
  }
  await admin.from("watch_texts").update({ ...base, status: "sent", sent_to: sent, sent_at: new Date().toISOString(), error: err ?? "" }).eq("id", row.id);
  return { status: "sent", id: row.id, sent_to: sent, test_mode: test };
}

async function replyTo(admin: Admin, orgId: string): Promise<string | undefined> {
  const { data } = await admin.from("crm_settings").select("company_email").eq("org_id", orgId).maybeSingle();
  return data?.company_email && EMAIL_RE.test(data.company_email) ? data.company_email : undefined;
}

/* ---------------------------------------------------------------- admin */

const ORG_FIELDS = ["your_phone", "direct_line", "office_line", "review_url", "signer_name", "signer_title", "company_legal", "website"] as const;

function cleanPropInput(v: unknown): Partial<PropCfg> {
  if (!v || typeof v !== "object") return {};
  const o = v as Record<string, unknown>;
  const out: Partial<PropCfg> = {};
  if (typeof o.send_start === "boolean") out.send_start = o.send_start;
  if (typeof o.send_end === "boolean") out.send_end = o.send_end;
  if (Array.isArray(o.recipients)) {
    const list = [...new Set(o.recipients.map((e) => str(e, 200).toLowerCase()).filter(Boolean))].slice(0, 10);
    const bad = list.find((e) => !EMAIL_RE.test(e));
    if (bad) throw new HttpError(400, `"${bad}" isn't a valid email address.`);
    out.recipients = list;
  }
  if ("client_first_name" in o) out.client_first_name = str(o.client_first_name, 60);
  if ("onsite_contact" in o) out.onsite_contact = str(o.onsite_contact, 160);
  if ("billing_email" in o) {
    const e = str(o.billing_email, 200).toLowerCase();
    if (e && !EMAIL_RE.test(e)) throw new HttpError(400, "The billing email isn't valid.");
    out.billing_email = e;
  }
  if ("coverage" in o) out.coverage = str(o.coverage, 160);
  if ("officers" in o) {
    const n = o.officers === null || o.officers === "" ? null : Math.round(Number(o.officers));
    if (n !== null && (!Number.isFinite(n) || n < 1 || n > 50)) throw new HttpError(400, "Officers on duty must be between 1 and 50.");
    out.officers = n;
  }
  if ("deposit_amount" in o) {
    const n = o.deposit_amount === null || o.deposit_amount === "" ? null : Number(o.deposit_amount);
    if (n !== null && (!Number.isFinite(n) || n < 0 || n > 10_000_000)) throw new HttpError(400, "The deposit amount isn't valid.");
    out.deposit_amount = n === null ? null : Math.round(n * 100) / 100;
  }
  if (typeof o.text_start === "boolean") out.text_start = o.text_start;
  if (typeof o.text_end === "boolean") out.text_end = o.text_end;
  if (Array.isArray(o.text_phones)) {
    const raw = o.text_phones.map((e) => str(e, 30)).filter(Boolean).slice(0, 5);
    const bad = raw.find((e) => !toE164(e));
    if (bad) throw new HttpError(400, `"${bad}" isn't a valid phone number.`);
    out.text_phones = [...new Set(raw.map(toE164))];
  }
  return out;
}

function cleanOrgInput(v: unknown): Partial<OrgCfg> {
  if (!v || typeof v !== "object") return {};
  const o = v as Record<string, unknown>;
  const out: Partial<OrgCfg> = {};
  for (const k of ORG_FIELDS) if (k in o) (out as Record<string, string>)[k] = str(o[k], k === "review_url" ? 400 : 120);
  if (out.review_url && !/^https:\/\/\S+$/i.test(out.review_url)) throw new HttpError(400, "The review link must start with https://");
  if ("invoice_days" in o) {
    const n = Math.round(Number(o.invoice_days));
    if (!Number.isFinite(n) || n < 1 || n > 60) throw new HttpError(400, "Invoice days must be between 1 and 60.");
    out.invoice_days = n;
  }
  if (typeof o.auto_enabled === "boolean") out.auto_enabled = o.auto_enabled;
  return out;
}

async function adminAction(req: Request, admin: Admin, action: string, body: Record<string, unknown>): Promise<Response> {
  const caller = await requireAuth(req);
  const { data: me } = await admin.from("profiles").select("id, org_id, role, active").eq("id", caller.id).single();
  if (!me || !me.active || me.role !== "admin") throw new HttpError(403, "Only admins can manage client watch emails.");

  const ownProperty = async (v: unknown) => {
    const id = uuid(v);
    const { data } = await admin.from("properties").select("id, org_id").eq("id", id).maybeSingle();
    if (!data || data.org_id !== me.org_id) throw new HttpError(404, "Property not found.");
    return id;
  };
  /** The watch an email is about: the running one, or (for the end email) the most recent ended one. */
  const watchFor = async (propertyId: string) => {
    const { data } = await admin
      .from("property_watches")
      .select("id, ended_on")
      .eq("property_id", propertyId)
      .order("started_on", { ascending: false })
      .limit(5);
    const list = (data ?? []) as { id: string; ended_on: string | null }[];
    return list.find((w) => !w.ended_on)?.id ?? list[0]?.id ?? null;
  };

  if (action === "status") {
    const propertyId = await ownProperty(body.property_id);
    const watchId = await watchFor(propertyId);
    const [org, prop, dispatch, { data: log }, { data: textLog }] = await Promise.all([
      loadOrgCfg(admin, me.org_id),
      loadPropCfg(admin, propertyId),
      loadDispatchSettings(admin, me.org_id),
      admin
        .from("watch_emails")
        .select("id, watch_id, kind, status, trigger, sent_to, intended_to, test_mode, subject, error, event_at, sent_at, created_at, updated_at")
        .eq("property_id", propertyId)
        .order("created_at", { ascending: false })
        .limit(10),
      admin
        .from("watch_texts")
        .select("id, watch_id, kind, status, trigger, sent_to, intended_to, test_mode, body, error, sent_at, created_at, updated_at")
        .eq("property_id", propertyId)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);
    let auto: Record<string, unknown> | null = null;
    let watch: Record<string, unknown> | null = null;
    if (watchId) {
      const ctx = await loadCtx(admin, watchId, me.org_id);
      const f = resolve(ctx);
      auto = {
        first_name: (ctx.property.contact_name ?? "").trim().split(/\s+/)[0] ?? "",
        onsite_contact: [ctx.property.contact_name, ctx.property.contact_phone].filter((x) => x && x.trim()).join(" · "),
        billing_email: ctx.clientBilling || ctx.property.contact_email || "",
        recipient: ctx.property.contact_email ?? "",
        phone: toE164(ctx.property.contact_phone ?? ""),
        coverage: f.auto_coverage,
        officers: f.auto_officers,
        patrol: f.patrol,
        start_at: f.start_at,
        start_source: f.start_source,
        end_at: ctx.watch.ended_on ? f.end_at : null,
        end_source: ctx.watch.ended_on ? f.end_source : "",
      };
      const sentStart = ((log ?? []) as { watch_id: string; kind: string }[]).some((l) => l.watch_id === watchId && l.kind === "start");
      const autoOn = org.exists && org.auto_enabled && Date.parse(ctx.watch.created_at) >= Date.parse((org as unknown as { live_since?: string }).live_since ?? "");
      watch = {
        id: ctx.watch.id,
        started_on: ctx.watch.started_on,
        ended_on: ctx.watch.ended_on,
        first_shift_at: ctx.firstStart,
        last_shift_end: ctx.lastEnd,
        // When the start confirmation will go out automatically (if it hasn't already).
        start_auto_at:
          !ctx.watch.ended_on && !sentStart && autoOn && prop.send_start && ctx.firstStart
            ? new Date(Math.max(Date.now(), Date.parse(ctx.firstStart) - 24 * 3600000)).toISOString()
            : null,
        text_start_auto_at:
          !ctx.watch.ended_on && autoOn && prop.text_start && ctx.firstStart &&
          !((textLog ?? []) as { watch_id: string; kind: string }[]).some((l) => l.watch_id === watchId && l.kind === "start")
            ? new Date(Math.max(Date.now(), Date.parse(ctx.firstStart) - 24 * 3600000)).toISOString()
            : null,
        auto_covers_this_watch: autoOn,
      };
    }
    return json({
      email_configured: emailConfigured(),
      sms_configured: smsConfigured(),
      test_mode: !dispatch || dispatch.test_mode,
      test_email: dispatch?.test_email ?? "",
      test_phone: dispatch?.test_phone ?? "",
      text_log: textLog ?? [],
      org: { ...org, live_since: undefined },
      property: prop,
      auto,
      watch,
      log: log ?? [],
    });
  }

  if (action === "save") {
    const now = new Date().toISOString();
    if (body.org) {
      const o = cleanOrgInput(body.org);
      const { error } = await admin.from("watch_email_settings").upsert({ org_id: me.org_id, ...o, updated_at: now, updated_by: me.id }, { onConflict: "org_id" });
      if (error) throw new HttpError(500, "Couldn't save the email details.");
    }
    if (body.property_id) {
      const propertyId = await ownProperty(body.property_id);
      const p = cleanPropInput(body.property);
      const { error } = await admin
        .from("property_watch_email")
        .upsert({ property_id: propertyId, org_id: me.org_id, ...p, updated_at: now, updated_by: me.id }, { onConflict: "property_id" });
      if (error) throw new HttpError(500, "Couldn't save the property's email settings.");
    }
    return json({ ok: true });
  }

  if (action === "preview") {
    const propertyId = await ownProperty(body.property_id);
    const kind = kindOf(body.kind);
    const watchId = await watchFor(propertyId);
    if (!watchId) throw new HttpError(404, "This property has no fire watch yet.");
    const ctx = await loadCtx(admin, watchId, me.org_id);
    const draft = cleanPropInput(body.property);
    const orgDraft = cleanOrgInput(body.org);
    const f = resolve(ctx, draft, orgDraft);
    const intended = intendedRecipients(ctx, { ...ctx.prop, ...draft });
    const dispatch = await loadDispatchSettings(admin, me.org_id);
    const route = routeEmail(dispatch, intended);
    const msg = compose(kind, f, route.test ? intended : undefined);
    const phones = intendedPhones(ctx, { ...ctx.prop, ...draft });
    const sr = routeSms(dispatch, phones, phones.join(", ") || "no client phone on file");
    const sms = { body: sr.prefix + composeSms(kind, f, ctx.tz), to: sr.to, intended: phones, reason: sr.reason };
    return json({ ...msg, sms, to: route.to, intended, test_mode: route.test, reason: route.reason, start_source: f.start_source, end_source: f.end_source, watch_ended: !!ctx.watch.ended_on });
  }

  if (action === "send") {
    const propertyId = await ownProperty(body.property_id);
    const kind = kindOf(body.kind);
    const watchId = await watchFor(propertyId);
    if (!watchId) throw new HttpError(404, "This property has no fire watch yet.");
    const { data: w } = await admin.from("property_watches").select("ended_on").eq("id", watchId).single();
    if (kind === "end" && !w?.ended_on) throw new HttpError(400, "End the watch first — the completion notice uses its real end time.");
    if (body.channel === "text") {
      if (!smsConfigured()) throw new HttpError(400, "Text messaging isn't set up yet.");
      return json(await deliverText(admin, watchId, kind, "manual", me.id, true));
    }
    if (!emailConfigured()) throw new HttpError(400, "Email sending isn't set up yet.");
    return json(await deliver(admin, watchId, kind, "manual", me.id, true));
  }

  if (action === "run") {
    const watchId = uuid(body.watch_id);
    const { data: w } = await admin.from("property_watches").select("org_id").eq("id", watchId).maybeSingle();
    if (!w || w.org_id !== me.org_id) throw new HttpError(404, "Watch not found.");
    const { data: due } = await admin.rpc("watch_email__due", { p_limit: 50 });
    const mine = ((due ?? []) as { watch_id: string; kind: Kind }[]).filter((d) => d.watch_id === watchId);
    const results = [];
    for (const d of mine) results.push({ kind: d.kind, ...(await deliver(admin, watchId, d.kind, "auto", me.id)) });
    const { data: dueT } = await admin.rpc("watch_text__due", { p_limit: 50 });
    const mineT = ((dueT ?? []) as { watch_id: string; kind: Kind }[]).filter((d) => d.watch_id === watchId);
    const texts = [];
    for (const d of mineT) texts.push({ kind: d.kind, ...(await deliverText(admin, watchId, d.kind, "auto", me.id)) });
    return json({ ok: true, results, texts });
  }

  if (action === "skip") {
    const watchId = uuid(body.watch_id);
    const kind = kindOf(body.kind);
    const { data: w } = await admin.from("property_watches").select("org_id, property_id").eq("id", watchId).maybeSingle();
    if (!w || w.org_id !== me.org_id) throw new HttpError(404, "Watch not found.");
    await admin
      .from(body.channel === "text" ? "watch_texts" : "watch_emails")
      .upsert(
        { org_id: w.org_id, property_id: w.property_id, watch_id: watchId, kind, status: "skipped", trigger: "manual", error: "Skipped when the watch was ended.", sent_by: me.id },
        { onConflict: "watch_id,kind", ignoreDuplicates: true },
      );
    return json({ ok: true });
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
      const { data: due } = await admin.rpc("watch_email__due", { p_limit: 10 });
      const { data: retry } = await admin
        .from("watch_emails")
        .select("watch_id, kind")
        .eq("status", "failed")
        .eq("trigger", "auto")
        .lt("attempts", 3)
        .lt("updated_at", new Date(Date.now() - 20 * 60000).toISOString())
        .limit(5);
      const jobs = [...((due ?? []) as { watch_id: string; kind: Kind }[]), ...((retry ?? []) as { watch_id: string; kind: Kind }[])];
      const results = [];
      for (const j of jobs) {
        try {
          results.push((await deliver(admin, j.watch_id, j.kind, "auto", null)).status);
        } catch (e) {
          console.error("watch-notify job failed", j.kind, e instanceof Error ? e.message : "unknown");
        }
      }
      const { data: dueT } = await admin.rpc("watch_text__due", { p_limit: 10 });
      const { data: retryT } = await admin
        .from("watch_texts")
        .select("watch_id, kind")
        .eq("status", "failed")
        .eq("trigger", "auto")
        .lt("attempts", 3)
        .lt("updated_at", new Date(Date.now() - 20 * 60000).toISOString())
        .limit(5);
      const textJobs = [...((dueT ?? []) as { watch_id: string; kind: Kind }[]), ...((retryT ?? []) as { watch_id: string; kind: Kind }[])];
      for (const j of textJobs) {
        try {
          results.push(`text:${(await deliverText(admin, j.watch_id, j.kind, "auto", null)).status}`);
        } catch (e) {
          console.error("watch-notify text job failed", j.kind, e instanceof Error ? e.message : "unknown");
        }
      }
      const total = jobs.length + textJobs.length;
      if (total) console.log(`watch-notify: ${total} jobs`, results.join(","));
      return json({ ok: true, jobs: total });
    }

    return await adminAction(req, admin, action, body);
  } catch (err) {
    return handleError(err);
  }
});
