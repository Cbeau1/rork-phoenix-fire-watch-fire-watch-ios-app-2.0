import { corsHeaders, createAdminClient, EMAIL_RE, handleError, HttpError, json, readString } from "../_shared/auth.ts";

const MIN_INTERVAL_MS = 60 * 1000;
const MAX_PER_HOUR = 5;

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

const emailHtml = (name: string, orgName: string, code: string): string => `
<!doctype html>
<html>
  <body style="margin:0;background:#0b0b0c;font-family:Helvetica,Arial,sans-serif;color:#e9eaec;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0b0c;padding:32px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#17181a;border:1px solid #232427;border-radius:12px;">
          <tr><td style="padding:28px 28px 8px;">
            <div style="font-size:20px;letter-spacing:4px;color:#c6c9ce;font-weight:bold;">PHOENIX</div>
            <div style="font-size:10px;letter-spacing:5px;color:#dc2626;margin-top:4px;">FIRE WATCH</div>
          </td></tr>
          <tr><td style="padding:16px 28px 0;">
            <h1 style="margin:0;font-size:22px;color:#e9eaec;">Reset your password</h1>
            <p style="margin:12px 0 0;font-size:15px;line-height:1.55;color:#9a9da3;">
              Hi ${escapeHtml(name || "there")}, use this code in Phoenix Fire Watch to set a new password${orgName ? ` for your ${escapeHtml(orgName)} login` : ""}.
            </p>
          </td></tr>
          <tr><td style="padding:24px 28px;">
            <div style="background:#0b0b0c;border:1px solid #2c2d31;border-radius:10px;padding:18px;text-align:center;font-family:'Courier New',monospace;font-size:34px;letter-spacing:10px;color:#ffffff;font-weight:bold;">${escapeHtml(code)}</div>
            <p style="margin:14px 0 0;font-size:13px;color:#6b6e74;">The code expires in 1 hour. If you didn't ask to reset your password, you can ignore this email — your password won't change.</p>
          </td></tr>
          <tr><td style="padding:0 28px 26px;border-top:1px solid #232427;">
            <p style="margin:18px 0 0;font-size:12px;color:#6b6e74;">Phoenix Fire Watch · Patrol logging &amp; shift reports</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

/**
 * Public endpoint: emails a one-time recovery code for an active account.
 * Always answers `{ ok: true }` for unknown emails so accounts can't be enumerated.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const email = readString(body.email, 200).toLowerCase();
    if (!EMAIL_RE.test(email)) throw new HttpError(400, "Enter a valid email address.");

    const apiKey = Deno.env.get("RESEND_API_KEY");
    if (!apiKey) return json({ ok: false, reason: "not-configured" });

    const admin = createAdminClient();

    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: recent } = await admin
      .from("password_reset_requests")
      .select("created_at")
      .eq("email", email)
      .gte("created_at", since)
      .order("created_at", { ascending: false });
    const list = recent ?? [];
    if (list.length >= MAX_PER_HOUR) {
      throw new HttpError(429, "Too many reset requests. Please wait an hour or ask your organization admin.");
    }
    if (list[0] && Date.now() - Date.parse(list[0].created_at) < MIN_INTERVAL_MS) {
      throw new HttpError(429, "A code was just sent. Please wait a minute before requesting another.");
    }
    await admin.from("password_reset_requests").insert({ email });

    const { data: profile } = await admin
      .from("profiles")
      .select("id, full_name, active, organizations(name)")
      .eq("email", email)
      .maybeSingle();
    if (!profile || !profile.active) return json({ ok: true });

    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "recovery", email });
    const code = link?.properties?.email_otp;
    if (linkErr || !code) {
      console.error("generateLink failed", linkErr?.message);
      throw new HttpError(500, "Couldn't create a reset code. Please try again.");
    }

    const org = profile.organizations as { name: string } | { name: string }[] | null;
    const orgName = (Array.isArray(org) ? org[0]?.name : org?.name) ?? "";
    const from = Deno.env.get("RESET_EMAIL_FROM") || "Phoenix Fire Watch <onboarding@resend.dev>";

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [email],
        subject: `${code} is your Phoenix Fire Watch reset code`,
        html: emailHtml(profile.full_name ?? "", orgName, code),
        text: `Your Phoenix Fire Watch password reset code is ${code}. It expires in 1 hour. If you didn't request this, ignore this email.`,
      }),
    });
    if (!res.ok) {
      console.error("resend failed", res.status, (await res.text()).slice(0, 300));
      throw new HttpError(502, "Couldn't send the reset email. Please try again or ask your organization admin.");
    }
    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
});
