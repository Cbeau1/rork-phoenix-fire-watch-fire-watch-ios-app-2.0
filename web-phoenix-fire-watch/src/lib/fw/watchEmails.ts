import { callFunction } from "@/lib/supabase";

/** Client emails sent when a fire watch starts and ends (server-sent; see backend function "watch-notify"). */

export type WatchEmailKind = "start" | "end";
export type WatchEmailStatus = "sending" | "sent" | "failed" | "skipped";

export interface WatchEmailOrg {
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

export interface WatchEmailProperty {
  send_start: boolean;
  send_end: boolean;
  recipients: string[];
  client_first_name: string;
  onsite_contact: string;
  billing_email: string;
  coverage: string;
  officers: number | null;
  deposit_amount: number | null;
  /** Client text messages — OFF unless turned on per property. */
  text_start: boolean;
  text_end: boolean;
  text_phones: string[];
}

export type WatchChannel = "email" | "text";

export interface WatchTextLog {
  id: string;
  watch_id: string;
  kind: WatchEmailKind;
  status: WatchEmailStatus;
  trigger: "auto" | "manual";
  sent_to: string[];
  intended_to: string[];
  test_mode: boolean;
  body: string;
  error: string;
  sent_at: string | null;
  created_at: string;
}

export interface WatchEmailLog {
  id: string;
  watch_id: string;
  kind: WatchEmailKind;
  status: WatchEmailStatus;
  trigger: "auto" | "manual";
  sent_to: string[];
  intended_to: string[];
  test_mode: boolean;
  subject: string;
  error: string;
  event_at: string | null;
  sent_at: string | null;
  created_at: string;
}

export interface WatchEmailStatusResponse {
  email_configured: boolean;
  sms_configured: boolean;
  test_mode: boolean;
  test_email: string;
  test_phone: string;
  text_log: WatchTextLog[];
  org: WatchEmailOrg;
  property: WatchEmailProperty;
  auto: {
    first_name: string;
    onsite_contact: string;
    billing_email: string;
    recipient: string;
    phone: string;
    coverage: string;
    officers: number | null;
    patrol: string;
    start_at: string | null;
    start_source: string;
    end_at: string | null;
    end_source: string;
  } | null;
  watch: {
    id: string;
    started_on: string;
    ended_on: string | null;
    first_shift_at: string | null;
    last_shift_end: string | null;
    start_auto_at: string | null;
    text_start_auto_at: string | null;
    auto_covers_this_watch: boolean;
  } | null;
  log: WatchEmailLog[];
}

export interface WatchEmailPreview {
  subject: string;
  html: string;
  text: string;
  to: string[];
  intended: string[];
  test_mode: boolean;
  reason: string;
  start_source: string;
  end_source: string;
  watch_ended: boolean;
  sms: { body: string; to: string[]; intended: string[]; reason: string };
}

export interface WatchEmailSendResult {
  status: WatchEmailStatus | "busy";
  error?: string;
  sent_to?: string[];
  test_mode?: boolean;
}

type OrgInput = Partial<Omit<WatchEmailOrg, "exists">>;

export const fetchWatchEmailStatus = (propertyId: string) =>
  callFunction<WatchEmailStatusResponse>("watch-notify", { action: "status", property_id: propertyId });

export const saveWatchEmailSettings = (input: { property_id?: string; property?: Partial<WatchEmailProperty>; org?: OrgInput }) =>
  callFunction<{ ok: true }>("watch-notify", { action: "save", ...input });

export const previewWatchEmail = (propertyId: string, kind: WatchEmailKind, draft?: { property?: Partial<WatchEmailProperty>; org?: OrgInput }) =>
  callFunction<WatchEmailPreview>("watch-notify", { action: "preview", property_id: propertyId, kind, ...(draft ?? {}) });

export const sendWatchEmail = (propertyId: string, kind: WatchEmailKind, channel: WatchChannel = "email") =>
  callFunction<WatchEmailSendResult>("watch-notify", { action: "send", property_id: propertyId, kind, channel });

/** After a watch is ended: sends the completion email now if the last shift is already over. */
export const runWatchEmails = (watchId: string) =>
  callFunction<{ ok: true; results: ({ kind: WatchEmailKind } & WatchEmailSendResult)[]; texts?: ({ kind: WatchEmailKind } & WatchEmailSendResult)[] }>("watch-notify", {
    action: "run",
    watch_id: watchId,
  });

export const skipWatchEmail = (watchId: string, kind: WatchEmailKind, channel: WatchChannel = "email") =>
  callFunction<{ ok: true }>("watch-notify", { action: "skip", watch_id: watchId, kind, channel });
