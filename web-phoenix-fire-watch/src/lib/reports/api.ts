import { callFunction, supabase } from "@/lib/supabase";

/** Daily patrol report emails at each property's chosen time (server-sent; see backend function "daily-report"). */

export type RunStatus = "queued" | "sending" | "sent" | "failed" | "skipped";

export interface DailyReportSettings {
  property_id: string;
  enabled: boolean;
  recipients: string[];
  include_photos: boolean;
  send_when_empty: boolean;
  timezone: string;
  /** Local send time, "HH:MM". The report covers the 24 hours before it. */
  send_time: string;
}

export interface DailyReportRun {
  id: string;
  property_id: string;
  report_date: string;
  tz: string;
  window_start: string;
  window_end: string;
  trigger: "schedule" | "manual";
  status: RunStatus;
  attempts: number;
  last_attempt_at: string | null;
  next_retry_at: string | null;
  intended_to: string[];
  sent_to: string[];
  test_mode: boolean;
  patrol_count: number;
  incident_count: number;
  photo_count: number;
  pdf_path: string;
  note: string;
  error: string;
  created_at: string;
  sent_at: string | null;
}

export interface DailyReportStatus {
  email_configured: boolean;
  test_mode: boolean;
  test_email: string;
  tz: string | null;
  latest_window: { report_date: string; start: string; end: string } | null;
  next_send_at: string | null;
}

export interface RecipientSuggestion {
  email: string;
  label: string;
}

const RUN_COLS =
  "id, property_id, report_date, tz, window_start, window_end, trigger, status, attempts, last_attempt_at, next_retry_at, intended_to, sent_to, test_mode, patrol_count, incident_count, photo_count, pdf_path, note, error, created_at, sent_at";

export const DEFAULT_SETTINGS = (propertyId: string): DailyReportSettings => ({
  property_id: propertyId,
  enabled: false,
  recipients: [],
  include_photos: true,
  send_when_empty: false,
  timezone: "",
  send_time: "09:00",
});

/** "07:30" or "07:30:00" → "7:30 AM". */
export const sendTimeLabel = (t: string): string => {
  const [h, m] = t.split(":").map(Number);
  const hh = Number.isFinite(h) ? h : 9;
  const mm = Number.isFinite(m) ? m : 0;
  return `${hh % 12 || 12}:${String(mm).padStart(2, "0")} ${hh < 12 ? "AM" : "PM"}`;
};

/** Every half hour of the day, as "HH:MM". */
export const SEND_TIMES: string[] = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);

const hhmm = (t: unknown): string => (typeof t === "string" && /^\d{2}:\d{2}/.test(t) ? t.slice(0, 5) : "09:00");

export async function fetchReportSettings(propertyId: string): Promise<DailyReportSettings> {
  const { data, error } = await supabase
    .from("daily_report_settings")
    .select("property_id, enabled, recipients, include_photos, send_when_empty, timezone, send_time")
    .eq("property_id", propertyId)
    .maybeSingle();
  if (error) throw error;
  return data ? { ...data, send_time: hhmm(data.send_time) } : DEFAULT_SETTINGS(propertyId);
}

export async function saveReportSettings(s: DailyReportSettings): Promise<DailyReportSettings> {
  const { data, error } = await supabase.rpc("daily_report_upsert_settings", {
    p_property: s.property_id,
    p_enabled: s.enabled,
    p_recipients: s.recipients,
    p_include_photos: s.include_photos,
    p_send_when_empty: s.send_when_empty,
    p_timezone: s.timezone,
    p_send_time: s.send_time,
  });
  if (error) throw error;
  const row = data as unknown as DailyReportSettings;
  return { ...row, send_time: hhmm(row.send_time) };
}

export async function fetchPropertyRuns(propertyId: string, limit = 14): Promise<DailyReportRun[]> {
  const { data, error } = await supabase
    .from("daily_report_runs")
    .select(RUN_COLS)
    .eq("property_id", propertyId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as DailyReportRun[];
}

/** Failed reports from the last 7 days across all properties (still waiting for a fix or retry). */
export async function fetchRecentFailures(): Promise<(DailyReportRun & { property_name: string })[]> {
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data, error } = await supabase
    .from("daily_report_runs")
    .select(`${RUN_COLS}, properties(name)`)
    .eq("status", "failed")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return ((data ?? []) as unknown as (DailyReportRun & { properties: { name: string } | null })[]).map(({ properties, ...r }) => ({
    ...r,
    property_name: properties?.name ?? "Property",
  }));
}

/** Emails already on file for this property: site contact, fire marshal, and client contacts. */
export async function fetchRecipientSuggestions(propertyId: string): Promise<RecipientSuggestion[]> {
  const { data: p, error } = await supabase
    .from("properties")
    .select("contact_name, contact_email, fire_marshal_name, fire_marshal_email, client_id")
    .eq("id", propertyId)
    .maybeSingle();
  if (error) throw error;
  if (!p) return [];
  const out: RecipientSuggestion[] = [];
  if (p.contact_email) out.push({ email: p.contact_email, label: p.contact_name ? `${p.contact_name} (site contact)` : "Site contact" });
  if (p.fire_marshal_email) out.push({ email: p.fire_marshal_email, label: p.fire_marshal_name ? `${p.fire_marshal_name} (fire marshal)` : "Fire marshal" });
  if (p.client_id) {
    const { data: contacts } = await supabase
      .from("crm_contacts")
      .select("name, email, role, receives_updates")
      .eq("client_id", p.client_id)
      .neq("email", "")
      .order("receives_updates", { ascending: false });
    for (const c of contacts ?? []) if (c.email) out.push({ email: c.email, label: `${c.name || c.email}${c.role ? ` (${c.role})` : " (client)"}` });
  }
  const seen = new Set<string>();
  return out.filter((s) => {
    const k = s.email.trim().toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export const fetchReportStatus = (propertyId: string) =>
  callFunction<DailyReportStatus>("daily-report", { action: "status", property_id: propertyId });

export const previewReport = (propertyId: string, includePhotos: boolean) =>
  callFunction<{ filename: string; pdf_base64: string; empty: boolean }>("daily-report", {
    action: "preview",
    property_id: propertyId,
    include_photos: includePhotos,
  });

export const sendReportNow = (propertyId: string) =>
  callFunction<{ id: string; status: RunStatus; error?: string; test_mode?: boolean }>("daily-report", { action: "send_now", property_id: propertyId });

export const retryReport = (runId: string) =>
  callFunction<{ id: string; status: RunStatus; error?: string; test_mode?: boolean }>("daily-report", { action: "retry", run_id: runId });

export const reportDownloadUrl = (runId: string) => callFunction<{ url: string }>("daily-report", { action: "download", run_id: runId });

export const base64ToBlob = (b64: string, type = "application/pdf"): Blob => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
};

/* ---------------------------------------------------------------- formatting (property timezone) */

export const tzAbbr = (iso: string, tz: string): string =>
  new Date(iso).toLocaleString("en-US", { timeZone: tz, timeZoneName: "short" }).split(" ").pop() ?? "";

export const fmtInTz = (iso: string, tz: string, withDay = true): string => {
  const d = new Date(iso);
  const t = d.toLocaleString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  const day = d.toLocaleString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" });
  return `${withDay ? `${day}, ` : ""}${t} ${tzAbbr(iso, tz)}`;
};

export const reportDayLabel = (run: Pick<DailyReportRun, "window_end" | "tz">): string =>
  new Date(run.window_end).toLocaleString("en-US", { timeZone: run.tz, weekday: "short", month: "short", day: "numeric" });
