import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

export const sha256Hex = async (input: string | Uint8Array): Promise<string> => {
  const data = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
};

export const randomToken = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export const emailFrom = (): string => Deno.env.get("RESET_EMAIL_FROM") || "Phoenix Fire Watch <onboarding@resend.dev>";

export const emailConfigured = (): boolean => !!Deno.env.get("RESEND_API_KEY");

export interface Attachment {
  filename: string;
  content: string; // base64
}

/** Sends through Resend. Returns null on success, or a short reason the email didn't go out. */
export async function sendEmail(opts: {
  to: string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  fromName?: string;
  attachments?: Attachment[];
}): Promise<string | null> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return "Email sending isn't set up yet.";
  let from = emailFrom();
  if (opts.fromName) {
    const addr = from.match(/<([^>]+)>/)?.[1] ?? from;
    from = `${opts.fromName.replace(/[<>"]/g, "")} <${addr}>`;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
      ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
      ...(opts.attachments?.length ? { attachments: opts.attachments } : {}),
    }),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    console.error("resend failed", res.status, detail);
    try {
      const msg = (JSON.parse(detail) as { message?: string }).message;
      if (msg) return `The email service said: ${msg}`;
    } catch {
      /* not json */
    }
    return "The email service rejected the message.";
  }
  return null;
}

/** Branded email shell matching the app's other emails. */
export const emailShell = (company: string, heading: string, bodyHtml: string, cta?: { label: string; url: string }): string => `
<!doctype html>
<html>
  <body style="margin:0;background:#f3f4f6;font-family:Helvetica,Arial,sans-serif;color:#16171a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e0e1e5;border-radius:12px;">
          <tr><td style="padding:26px 28px 6px;border-bottom:3px solid #dc2626;">
            <div style="font-size:18px;letter-spacing:3px;color:#16171a;font-weight:bold;">${escapeHtml(company.toUpperCase())}</div>
          </td></tr>
          <tr><td style="padding:22px 28px 0;">
            <h1 style="margin:0;font-size:21px;color:#16171a;">${escapeHtml(heading)}</h1>
            <div style="margin:12px 0 0;font-size:15px;line-height:1.6;color:#45474d;">${bodyHtml}</div>
          </td></tr>
          ${cta ? `<tr><td style="padding:24px 28px 4px;">
            <a href="${escapeHtml(cta.url)}" style="display:inline-block;background:#dc2626;color:#ffffff;text-decoration:none;font-weight:bold;padding:13px 22px;border-radius:8px;font-size:15px;">${escapeHtml(cta.label)}</a>
            <p style="margin:14px 0 0;font-size:12px;color:#8a8d94;word-break:break-all;">Or open this link: ${escapeHtml(cta.url)}</p>
          </td></tr>` : ""}
          <tr><td style="padding:22px 28px 26px;">
            <p style="margin:0;font-size:12px;color:#8a8d94;border-top:1px solid #e0e1e5;padding-top:16px;">${escapeHtml(company)} · Fire watch services</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

export const paragraphs = (text: string): string =>
  text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 12px;">${escapeHtml(p).replace(/\n/g, "<br/>")}</p>`)
    .join("");

/** Company display name + reply-to for an organization. */
export async function orgIdentity(admin: SupabaseClient, orgId: string): Promise<{ name: string; replyTo: string }> {
  const [{ data: org }, { data: settings }] = await Promise.all([
    admin.from("organizations").select("name").eq("id", orgId).maybeSingle(),
    admin.from("crm_settings").select("company_email").eq("org_id", orgId).maybeSingle(),
  ]);
  return { name: org?.name || "Phoenix Fire Watch", replyTo: settings?.company_email || "" };
}

export const isSafeOrigin = (origin: string): boolean => {
  try {
    const u = new URL(origin);
    if (u.pathname !== "/" && u.pathname !== "") return false;
    return u.protocol === "https:" || (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1"));
  } catch {
    return false;
  }
};
