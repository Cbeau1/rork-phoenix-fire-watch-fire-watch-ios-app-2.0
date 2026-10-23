import { callFunction, supabase } from "@/lib/supabase";

/* ---------------------------------------------------------------- types */

export type PatrolStatus = "clear" | "follow-up" | "incident";
export type IncidentCategory = "fire_smoke" | "alarm" | "hazard" | "injury" | "security" | "equipment" | "other";
export type Severity = "low" | "medium" | "high";

export const INCIDENT_CATEGORY: Record<IncidentCategory, string> = {
  fire_smoke: "Fire / smoke",
  alarm: "Alarm",
  hazard: "Hazard",
  injury: "Injury",
  security: "Security / trespass",
  equipment: "Equipment problem",
  other: "Other",
};

export const SEVERITY: Record<Severity, string> = { low: "Low", medium: "Medium", high: "High" };

export interface BoardShift {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  starts_at: string;
  ends_at: string;
  notes: string;
  property: { id: string; name: string; interval: number; geofence: boolean; lat?: number | null; lng?: number | null; radius?: number | null };
  /** auto_text / auto_email: this employee's shift-link auto-send switches (set on their profile). */
  staff: { id: string; name: string; profile_id: string | null; phone: string; auto_text?: boolean; auto_email?: boolean };
  entry: { id: string; clock_in: string; clock_out: string | null; source: string } | null;
  check_in: { distance_m: number | null; overridden: boolean; at: string } | null;
  handoff: string | null;
  last_patrol_at: string | null;
  /** Latest patrol at the property by anyone (incl. the previous officer). */
  property_last_patrol_at?: string | null;
  patrols: number;
  outside_patrols: number;
  incidents: number;
  request: { id: string; status: "pending" | "approved"; distance_m: number | null; accuracy_m: number | null; requested_at: string } | null;
  link: {
    created_at: string;
    sent_at: string | null;
    sent_to: string;
    opened_at: string | null;
    last_seen_at: string | null;
    send_error: string;
    expires_at: string;
    auto?: boolean;
  } | null;
  /** When the last link was revoked (only set while no link is active). */
  revoked_at?: string | null;
  /** The one automatic send attempt for this shift, if any. */
  auto_attempt?: { at: string; ok: boolean; note: string } | null;
  /** Latest live location from the guard's link page (only while checked in, until shift end). */
  location?: {
    lat: number;
    lng: number;
    accuracy_m: number | null;
    at: string;
    distance_m: number | null;
    heading: number | null;
    speed_mps: number | null;
  } | null;
  /** Recent breadcrumb trail, oldest first: [lat, lng]. */
  trail?: [number, number][];
}

export interface BoardAlert {
  id: string;
  shift_id: string;
  kind: "patrol_overdue" | "no_check_in";
  due_at: string;
  created_at: string;
  acknowledged_at: string | null;
  acknowledged_by: string;
  notified_at: string | null;
  notify_error: string;
}

export interface BoardIncident {
  id: string;
  shift_id: string | null;
  property: string;
  reported_by: string;
  category: IncidentCategory;
  severity: Severity;
  description: string;
  photos: string[];
  occurred_at: string;
  distance_m: number | null;
}

export interface Board {
  tz: string;
  now: string;
  shifts: BoardShift[];
  alerts: BoardAlert[];
  incidents: BoardIncident[];
}

export interface DispatchSettings {
  org_id: string;
  alert_phones: string[];
  grace_minutes: number;
  late_minutes: number;
  sms_alerts: boolean;
  test_mode: boolean;
  test_phone: string;
  test_email: string;
  /** Text each guard their shift link 1 hour before start. Default off. */
  auto_link_text?: boolean;
  /** Email each guard their shift link 1 hour before start. Default off. */
  auto_link_email?: boolean;
  /** Site address automatic links point to (saved from the admin's browser). */
  link_origin?: string;
}

export interface LinkStatus {
  sms_configured: boolean;
  email_configured?: boolean;
  test_mode: boolean;
  test_phone: string;
  test_email?: string;
}

export interface SendLinkResult {
  url: string;
  expires_at: string;
  sent: boolean;
  sent_to?: string;
  emailed?: boolean;
  emailed_to?: string;
  email_error?: string;
  test_mode?: boolean;
  error?: string;
}

/* ---------------------------------------------------------------- admin */

export async function fetchBoard(): Promise<Board> {
  const { data, error } = await supabase.rpc("dispatch_board");
  if (error) throw error;
  return data as unknown as Board;
}

export async function decideRequest(id: string, approve: boolean): Promise<void> {
  const { error } = await supabase.rpc("dispatch_decide_request", { p_id: id, p_approve: approve });
  if (error) throw error;
}

export async function ackAlert(id: string): Promise<void> {
  const { error } = await supabase.rpc("dispatch_ack_alert", { p_id: id });
  if (error) throw error;
}

export async function resolveIncident(id: string, note: string): Promise<void> {
  const { error } = await supabase.rpc("dispatch_resolve_incident", { p_id: id, p_note: note });
  if (error) throw error;
}

export async function fetchSettings(orgId: string): Promise<DispatchSettings | null> {
  const { data, error } = await supabase.from("dispatch_settings").select("*").eq("org_id", orgId).maybeSingle();
  if (error) throw error;
  return data as DispatchSettings | null;
}

export async function saveSettings(orgId: string, patch: Omit<DispatchSettings, "org_id">): Promise<void> {
  const { error } = await supabase
    .from("dispatch_settings")
    .upsert({ org_id: orgId, ...patch, updated_at: new Date().toISOString() }, { onConflict: "org_id" });
  if (error) throw error;
}

export const linkStatus = (): Promise<LinkStatus> => callFunction<LinkStatus>("shift-link", { action: "status", origin: window.location.origin });

export const sendShiftLink = (shiftId: string, opts: { text: boolean; email: boolean; emailTo?: string }): Promise<SendLinkResult> =>
  callFunction<SendLinkResult>("shift-link", {
    action: "send",
    shift_id: shiftId,
    text: opts.text,
    email: opts.email,
    email_to: opts.emailTo ?? "",
    origin: window.location.origin,
  });

/** The guard's best known email (worker record, then app login). */
export const shiftLinkContact = (shiftId: string): Promise<{ email: string }> => callFunction("shift-link", { action: "contact", shift_id: shiftId });

export const revokeShiftLink = (shiftId: string): Promise<{ ok: true }> =>
  callFunction("shift-link", { action: "revoke", shift_id: shiftId });

export const sendTestText = (): Promise<{ ok: true; sent_to: string[]; test_mode: boolean }> =>
  callFunction("shift-link", { action: "test_sms" });

export async function saveStaffPhone(staffId: string, phone: string): Promise<void> {
  const { error } = await supabase.from("staff").update({ phone: phone.trim() }).eq("id", staffId);
  if (error) throw error;
}

/* ---------------------------------------------------------------- time helpers */

/** "9:40 PM EDT" in the org/property timezone. */
export const fmtZoned = (iso: string | null | undefined, tz: string, withDay = false): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  const time = d.toLocaleString("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    ...(withDay ? { weekday: "short", month: "short", day: "numeric" } : {}),
  });
  const zone = d.toLocaleString("en-US", { timeZone: tz, timeZoneName: "short" }).split(" ").pop() ?? "";
  return `${time} ${zone}`;
};

export const minutesBetween = (a: string | number | Date, b: string | number | Date): number =>
  Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000);

export const fmtAgo = (mins: number): string => {
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m ago` : `${h}h ago`;
};

export const fmtMeters = (m: number | null | undefined): string => {
  if (m == null) return "—";
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
};
