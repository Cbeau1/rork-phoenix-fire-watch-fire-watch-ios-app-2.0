import { corsHeaders, createAdminClient, EMAIL_RE, handleError, HttpError, json, readString, requireAuth } from "../_shared/auth.ts";
import { emailShell, escapeHtml, isSafeOrigin, orgIdentity, paragraphs, randomToken, sendEmail, sha256Hex } from "../_shared/crm.ts";

const money = (n: number | null | undefined): string =>
  n == null ? "—" : `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (d: string | null | undefined): string => {
  if (!d) return "";
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
};

/**
 * Admin-only sending for the sales pipeline:
 * - quote: emails the quote PDF (built in the browser) and marks the quote sent
 * - contract: issues a fresh one-time signing link (only its hash is stored) and emails it
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const caller = await requireAuth(req);
    const admin = createAdminClient();
    const { data: me } = await admin.from("profiles").select("id, org_id, role, active, full_name").eq("id", caller.id).single();
    if (!me || !me.active) throw new HttpError(403, "Your account is not active.");
    if (me.role !== "admin") throw new HttpError(403, "Only organization admins can send quotes and contracts.");

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = readString(body.action, 20);
    const to = readString(body.to, 200).toLowerCase();
    const toName = readString(body.to_name, 200);
    const message = readString(body.message, 4000);
    if (!EMAIL_RE.test(to)) throw new HttpError(400, "Enter a valid email address for the client.");
    const company = await orgIdentity(admin, me.org_id);

    if (action === "quote") {
      const quoteId = readString(body.quote_id, 64);
      const pdf = typeof body.pdf_base64 === "string" ? body.pdf_base64 : "";
      if (!pdf || pdf.length > 8_000_000) throw new HttpError(400, "The quote PDF is missing or too large.");
      const { data: quote } = await admin
        .from("crm_quotes")
        .select("id, org_id, number, status, hourly_rate, hours_per_week, valid_until, deal_id")
        .eq("id", quoteId)
        .maybeSingle();
      if (!quote || quote.org_id !== me.org_id) throw new HttpError(404, "Quote not found.");
      if (quote.status === "accepted" || quote.status === "declined") {
        throw new HttpError(400, "This quote is already closed. Create a new quote to send updated pricing.");
      }
      const { data: deal } = await admin
        .from("crm_deals")
        .select("id, crm_clients(name), properties(name, address)")
        .eq("id", quote.deal_id)
        .single();
      const client = (deal?.crm_clients as { name: string } | null)?.name ?? "";
      const prop = deal?.properties as { name: string; address: string } | null;
      const label = `Q-${quote.number}`;
      const weekly = Number(quote.hourly_rate) * Number(quote.hours_per_week);

      const intro = `Hi ${toName || "there"},\n\n${message || `Thank you for reaching out. Attached is our fire watch quote${prop ? ` for ${prop.name}` : ""}.`}`;
      const summary = `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 4px;font-size:14px;color:#16171a;">
        <tr><td style="padding:3px 16px 3px 0;color:#8a8d94;">Quote</td><td><b>${label}</b></td></tr>
        ${prop ? `<tr><td style="padding:3px 16px 3px 0;color:#8a8d94;">Property</td><td>${escapeHtml(prop.name)}</td></tr>` : ""}
        <tr><td style="padding:3px 16px 3px 0;color:#8a8d94;">Rate</td><td>${money(quote.hourly_rate)}/hour</td></tr>
        <tr><td style="padding:3px 16px 3px 0;color:#8a8d94;">Est. weekly</td><td>${money(weekly)}</td></tr>
        ${quote.valid_until ? `<tr><td style="padding:3px 16px 3px 0;color:#8a8d94;">Valid until</td><td>${fmtDate(quote.valid_until)}</td></tr>` : ""}
      </table>`;
      const failure = await sendEmail({
        to: [to],
        subject: `${company.name} fire watch quote ${label}${client ? ` — ${client}` : ""}`,
        html: emailShell(company.name, `Your fire watch quote`, paragraphs(intro) + summary + `<p style="margin:14px 0 0;">Reply to this email to accept or ask questions.</p>`),
        text: `${intro}\n\nQuote ${label}: ${money(quote.hourly_rate)}/hour, est. ${money(weekly)} per week.${quote.valid_until ? ` Valid until ${fmtDate(quote.valid_until)}.` : ""}\n\nThe quote PDF is attached. Reply to this email to accept or ask questions.`,
        replyTo: company.replyTo || undefined,
        fromName: company.name,
        attachments: [{ filename: `${company.name.replace(/[^A-Za-z0-9]+/g, "-")}-Quote-${label}.pdf`, content: pdf }],
      });
      if (failure) throw new HttpError(502, `${failure} The quote wasn't sent — you can download the PDF and send it yourself.`);

      await admin.from("crm_quotes").update({ status: "sent", sent_at: new Date().toISOString(), sent_to: to }).eq("id", quote.id);
      return json({ ok: true, emailed: true });
    }

    if (action === "contract") {
      const contractId = readString(body.contract_id, 64);
      const origin = readString(body.origin, 200).replace(/\/+$/, "");
      if (!isSafeOrigin(origin)) throw new HttpError(400, "Couldn't build the signing link for this site address.");
      const { data: contract } = await admin
        .from("crm_contracts")
        .select("id, org_id, number, status, title, deal_id")
        .eq("id", contractId)
        .maybeSingle();
      if (!contract || contract.org_id !== me.org_id) throw new HttpError(404, "Contract not found.");
      if (contract.status === "signed") throw new HttpError(400, "This contract is already signed.");
      if (contract.status === "void") throw new HttpError(400, "This contract was voided. Create a new one to send.");

      const { data: settings } = await admin.from("crm_settings").select("sign_link_days").eq("org_id", me.org_id).maybeSingle();
      const days = settings?.sign_link_days ?? 14;
      const token = randomToken();
      const expires = new Date(Date.now() + days * 86400_000);
      const { error: upErr } = await admin
        .from("crm_contracts")
        .update({
          status: "sent",
          sign_token_hash: await sha256Hex(token),
          sign_expires_at: expires.toISOString(),
          sent_at: new Date().toISOString(),
          sent_to: to,
          sent_to_name: toName,
          app_origin: origin,
        })
        .eq("id", contract.id)
        .in("status", ["draft", "sent"]);
      if (upErr) {
        console.error("contract send update failed", upErr.message);
        throw new HttpError(500, "Couldn't prepare the signing link. Please try again.");
      }
      const link = `${origin}/sign/${token}`;
      const expiresLabel = expires.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" });
      const intro = `Hi ${toName || "there"},\n\n${message || `${company.name} has sent you the ${contract.title} (C-${contract.number}) to review and sign online.`}`;
      const failure = await sendEmail({
        to: [to],
        subject: `Please sign: ${contract.title} (C-${contract.number})`,
        html: emailShell(
          company.name,
          "Your agreement is ready to sign",
          paragraphs(intro) + `<p style="margin:0;color:#8a8d94;font-size:13px;">This secure link works until ${expiresLabel}. No account is needed.</p>`,
          { label: "Review & sign", url: link },
        ),
        text: `${intro}\n\nReview and sign: ${link}\n\nThis secure link works until ${expiresLabel}. No account is needed.`,
        replyTo: company.replyTo || undefined,
        fromName: company.name,
      });
      return json({ ok: true, link, emailed: !failure, email_error: failure, expires_at: expires.toISOString() });
    }

    throw new HttpError(400, "Unknown action.");
  } catch (err) {
    return handleError(err);
  }
});
