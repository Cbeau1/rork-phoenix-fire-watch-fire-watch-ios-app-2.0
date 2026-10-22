import { PDFDocument, type PDFFont, type PDFImage, type PDFPage, rgb, StandardFonts } from "npm:pdf-lib@1.17.1";
import { corsHeaders, createAdminClient, EMAIL_RE, handleError, HttpError, json, readString } from "../_shared/auth.ts";
import { emailShell, escapeHtml, orgIdentity, sendEmail, sha256Hex } from "../_shared/crm.ts";

/**
 * Public signing endpoint (no login). The one-time token in the link is the only credential;
 * the database stores just its SHA-256 hash.
 * - view: returns the agreement for review and records the first view
 * - sign: records the signature with name, email, IP, device and a hash of the exact text,
 *         builds the signed PDF and stores it privately
 * - pdf:  lets the signer download their signed copy while the link is valid
 */

interface ContractRow {
  id: string;
  org_id: string;
  deal_id: string;
  number: number;
  title: string;
  body: string;
  status: string;
  sign_expires_at: string | null;
  sent_to: string;
  sent_to_name: string;
  viewed_at: string | null;
  signer_name: string | null;
  signer_email: string | null;
  signed_at: string | null;
  signed_pdf_path: string | null;
  app_origin: string;
  body_sha256: string | null;
}

const COLS =
  "id, org_id, deal_id, number, title, body, status, sign_expires_at, sent_to, sent_to_name, viewed_at, signer_name, signer_email, signed_at, signed_pdf_path, app_origin, body_sha256";

const ET = "America/New_York";

const fmtStamp = (iso: string): string => {
  const d = new Date(iso);
  const date = d.toLocaleString("en-US", { timeZone: ET, month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  const tz = d.toLocaleString("en-US", { timeZone: ET, timeZoneName: "short" }).split(" ").pop() ?? "ET";
  return `${date} ${tz}`;
};

// Standard PDF fonts only cover Windows-1252; replace anything else so signing never fails on odd characters.
const WIN_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");
const winAnsi = (s: string): string =>
  s
    .replace(/\t/g, "    ")
    .replace(/[\u2010\u2011\u2212]/g, "-")
    .replace(/[\u00A0\u2007\u202F]/g, " ")
    .split("")
    .map((ch) => {
      const c = ch.charCodeAt(0);
      if (c === 10) return ch;
      if (c < 32) return "";
      if (c <= 126 || (c >= 160 && c <= 255) || WIN_EXTRA.has(ch)) return ch;
      return "?";
    })
    .join("");

async function loadContract(token: string): Promise<{ admin: ReturnType<typeof createAdminClient>; c: ContractRow }> {
  if (token.length < 30 || token.length > 100 || !/^[A-Za-z0-9_-]+$/.test(token)) {
    throw new HttpError(404, "This signing link isn't valid. Ask the sender for a new one.");
  }
  const admin = createAdminClient();
  const { data } = await admin.from("crm_contracts").select(COLS).eq("sign_token_hash", await sha256Hex(token)).maybeSingle();
  if (!data) throw new HttpError(404, "This signing link isn't valid or has been replaced. Ask the sender for a new one.");
  return { admin, c: data as ContractRow };
}

const expired = (c: ContractRow): boolean => !!c.sign_expires_at && Date.parse(c.sign_expires_at) < Date.now();

async function context(admin: ReturnType<typeof createAdminClient>, c: ContractRow) {
  const { data: deal } = await admin
    .from("crm_deals")
    .select("client_id, crm_clients(name), properties(name, address)")
    .eq("id", c.deal_id)
    .single();
  const client = (deal?.crm_clients as { name: string } | null)?.name ?? "";
  const prop = deal?.properties as { name: string; address: string } | null;
  const company = await orgIdentity(admin, c.org_id);
  return { clientId: (deal?.client_id as string | null) ?? null, client, prop, company };
}

async function buildSignedPdf(opts: {
  c: ContractRow;
  company: string;
  client: string;
  property: string;
  signerName: string;
  signerEmail: string;
  signedAt: string;
  ip: string;
  ua: string;
  method: "draw" | "type";
  signaturePng: Uint8Array | null;
  bodyHash: string;
}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${opts.c.title} C-${opts.c.number} (signed)`);
  pdf.setAuthor(opts.company);
  pdf.setSubject(`Signed by ${opts.signerName}`);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.TimesRomanItalic);
  const ink = rgb(0.086, 0.09, 0.102);
  const ink2 = rgb(0.36, 0.37, 0.4);
  const ember = rgb(0.86, 0.15, 0.15);
  const line = rgb(0.878, 0.882, 0.898);

  let logo: PDFImage | null = null;
  if (opts.c.app_origin) {
    try {
      const res = await fetch(`${opts.c.app_origin}/phoenix-logo-brand.png`, { signal: AbortSignal.timeout(4000) });
      if (res.ok && (res.headers.get("content-type") ?? "").includes("png")) logo = await pdf.embedPng(new Uint8Array(await res.arrayBuffer()));
    } catch {
      logo = null;
    }
  }

  const W = 612, H = 792, M = 60, maxW = W - M * 2;
  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;
  const pages: PDFPage[] = [page];

  const header = () => {
    if (logo) {
      const h = 38, w = (h * logo.width) / logo.height;
      page.drawImage(logo, { x: M, y: y - h, width: w, height: h });
    } else {
      page.drawText(winAnsi(opts.company.toUpperCase()), { x: M, y: y - 20, size: 15, font: bold, color: ink });
    }
    page.drawText(winAnsi(`C-${opts.c.number}`), { x: W - M - bold.widthOfTextAtSize(`C-${opts.c.number}`, 10), y: y - 14, size: 10, font: bold, color: ink2 });
    y -= 50;
    page.drawRectangle({ x: M, y, width: maxW, height: 2, color: ember });
    y -= 22;
  };
  const newPage = () => {
    page = pdf.addPage([W, H]);
    pages.push(page);
    y = H - M;
    header();
  };
  const ensure = (h: number) => {
    if (y - h < M + 20) newPage();
  };
  const wrap = (text: string, f: PDFFont, size: number): string[] => {
    const out: string[] = [];
    for (const raw of text.split("\n")) {
      const words = raw.split(/ +/);
      let cur = "";
      for (const w of words) {
        const next = cur ? `${cur} ${w}` : w;
        if (f.widthOfTextAtSize(next, size) <= maxW) cur = next;
        else {
          if (cur) out.push(cur);
          // Break single words longer than the line
          let word = w;
          while (f.widthOfTextAtSize(word, size) > maxW) {
            let i = word.length;
            while (i > 1 && f.widthOfTextAtSize(word.slice(0, i), size) > maxW) i--;
            out.push(word.slice(0, i));
            word = word.slice(i);
          }
          cur = word;
        }
      }
      out.push(cur);
    }
    return out;
  };
  const write = (text: string, f: PDFFont, size: number, color = ink, gap = 4) => {
    for (const l of wrap(winAnsi(text), f, size)) {
      ensure(size + gap);
      page.drawText(l, { x: M, y: y - size, size, font: f, color });
      y -= size + gap;
    }
  };

  header();
  write(opts.c.title, bold, 18, ink, 6);
  y -= 4;
  write(`${opts.client}${opts.property ? `  ·  ${opts.property}` : ""}`.replace("·", "-"), font, 10, ink2);
  y -= 10;

  for (const block of opts.c.body.replace(/\r\n/g, "\n").split(/\n{2,}/)) {
    const t = block.trim();
    if (!t) continue;
    if (t.startsWith("## ")) {
      y -= 4;
      write(t.slice(3), bold, 11.5, ink, 5);
    } else if (t.startsWith("# ")) {
      y -= 6;
      write(t.slice(2), bold, 13.5, ink, 6);
    } else {
      write(t, font, 10.5, ink, 4.5);
    }
    y -= 7;
  }

  // Signature block
  ensure(190);
  y -= 10;
  page.drawRectangle({ x: M, y, width: maxW, height: 1, color: line });
  y -= 22;
  page.drawText("SIGNED ELECTRONICALLY", { x: M, y, size: 9, font: bold, color: ember });
  y -= 16;
  if (opts.signaturePng) {
    const img = await pdf.embedPng(opts.signaturePng);
    const h = 56, w = Math.min(260, (h * img.width) / img.height);
    page.drawImage(img, { x: M, y: y - h, width: w, height: (w * img.height) / img.width });
    y -= h + 4;
  } else {
    page.drawText(winAnsi(opts.signerName), { x: M, y: y - 30, size: 30, font: italic, color: ink });
    y -= 40;
  }
  page.drawRectangle({ x: M, y, width: 260, height: 0.8, color: ink2 });
  y -= 14;
  const details: [string, string][] = [
    ["Signed by", opts.signerName],
    ["Email", opts.signerEmail],
    ["Date & time", fmtStamp(opts.signedAt)],
    ["Method", opts.method === "draw" ? "Drawn signature" : "Typed signature"],
    ["IP address", opts.ip || "unknown"],
  ];
  for (const [k, v] of details) {
    page.drawText(k, { x: M, y: y - 9, size: 9, font: bold, color: ink2 });
    page.drawText(winAnsi(v).slice(0, 90), { x: M + 80, y: y - 9, size: 9, font, color: ink });
    y -= 14;
  }

  // Audit certificate page
  newPage();
  write("Signature certificate", bold, 16, ink, 8);
  y -= 6;
  const audit: [string, string][] = [
    ["Agreement", `${opts.c.title} (C-${opts.c.number})`],
    ["Client", opts.client],
    ["Property", opts.property || "—"],
    ["Sent to", `${opts.c.sent_to_name ? `${opts.c.sent_to_name} ` : ""}<${opts.c.sent_to}>`],
    ["First viewed", opts.c.viewed_at ? fmtStamp(opts.c.viewed_at) : fmtStamp(opts.signedAt)],
    ["Signed by", `${opts.signerName} <${opts.signerEmail}>`],
    ["Signed at", fmtStamp(opts.signedAt)],
    ["IP address", opts.ip || "unknown"],
    ["Device", opts.ua || "unknown"],
    ["Method", opts.method === "draw" ? "Drawn signature" : "Typed signature"],
    ["Consent", "Signer agreed to sign electronically and that the electronic signature is legally binding."],
    ["Document SHA-256", opts.bodyHash],
  ];
  for (const [k, v] of audit) {
    ensure(30);
    page.drawText(k.toUpperCase(), { x: M, y: y - 8, size: 7.5, font: bold, color: ink2 });
    y -= 12;
    write(v, font, 9.5, ink, 3.5);
    y -= 6;
  }
  y -= 6;
  write("The SHA-256 fingerprint identifies the exact agreement text that was signed. Any change to the text produces a different fingerprint.", font, 8.5, ink2, 3);

  pages.forEach((p, i) => {
    const label = `Page ${i + 1} of ${pages.length}`;
    p.drawText(label, { x: W - M - font.widthOfTextAtSize(label, 8), y: 30, size: 8, font, color: ink2 });
    p.drawText(winAnsi(`${opts.company} · Signed ${fmtStamp(opts.signedAt)}`).replace("·", "-"), { x: M, y: 30, size: 8, font, color: ink2 });
  });
  return await pdf.save();
}

const toBase64 = (bytes: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = readString(body.action, 10);
    const token = readString(body.token, 120);
    const { admin, c } = await loadContract(token);

    if (action === "view") {
      if (c.status === "void") throw new HttpError(410, "This agreement was withdrawn by the sender.");
      if (c.status === "draft") throw new HttpError(404, "This signing link has been replaced. Ask the sender for a new one.");
      if (c.status === "sent" && expired(c)) throw new HttpError(410, "This signing link has expired. Ask the sender to send it again.");
      const ctx = await context(admin, c);
      if (c.status === "sent" && !c.viewed_at) {
        await admin.from("crm_contracts").update({ viewed_at: new Date().toISOString() }).eq("id", c.id).is("viewed_at", null);
        await admin.from("crm_activity").insert({
          org_id: c.org_id,
          deal_id: c.deal_id,
          client_id: ctx.clientId,
          kind: "contract",
          summary: `Contract C-${c.number} opened by the client`,
          actor_name: c.sent_to_name || c.sent_to || "Client",
        });
      }
      return json({
        status: c.status,
        number: c.number,
        title: c.title,
        body: c.body,
        company: ctx.company.name,
        client: ctx.client,
        property: ctx.prop ? `${ctx.prop.name}${ctx.prop.address && ctx.prop.address !== ctx.prop.name ? `, ${ctx.prop.address}` : ""}` : "",
        recipient_name: c.sent_to_name,
        recipient_email: c.sent_to,
        expires_at: c.sign_expires_at,
        signer_name: c.signer_name,
        signed_at: c.signed_at,
      });
    }

    if (action === "pdf") {
      if (c.status !== "signed" || !c.signed_pdf_path) throw new HttpError(404, "The signed copy isn't available.");
      const { data, error } = await admin.storage.from("crm-documents").download(c.signed_pdf_path);
      if (error || !data) throw new HttpError(500, "Couldn't load the signed copy. Please try again.");
      return json({ filename: `${c.title.replace(/[^A-Za-z0-9]+/g, "-")}-C-${c.number}-signed.pdf`, pdf_base64: toBase64(new Uint8Array(await data.arrayBuffer())) });
    }

    if (action === "sign") {
      if (c.status === "signed") throw new HttpError(409, "This agreement is already signed.");
      if (c.status !== "sent") throw new HttpError(410, "This agreement can no longer be signed. Ask the sender for a new link.");
      if (expired(c)) throw new HttpError(410, "This signing link has expired. Ask the sender to send it again.");

      const name = readString(body.name, 120).replace(/\s+/g, " ");
      const email = readString(body.email, 200).toLowerCase();
      const method = body.method === "draw" ? "draw" : body.method === "type" ? "type" : "";
      const image = typeof body.signature_image === "string" ? body.signature_image : "";
      if (name.length < 2) throw new HttpError(400, "Enter your full legal name.");
      if (!EMAIL_RE.test(email)) throw new HttpError(400, "Enter a valid email address.");
      if (!method) throw new HttpError(400, "Add your signature.");
      if (body.consent !== true) throw new HttpError(400, "Please agree to sign electronically.");
      if (typeof body.body_sha256 === "string" && body.body_sha256 && body.body_sha256 !== (await sha256Hex(c.body))) {
        throw new HttpError(409, "The agreement was updated while you were reviewing it. Reload the page to see the latest version.");
      }

      let png: Uint8Array | null = null;
      if (method === "draw") {
        const m = image.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
        if (!m || image.length > 390_000) throw new HttpError(400, "Your drawn signature couldn't be read. Please draw it again.");
        png = Uint8Array.from(atob(m[1]), (ch) => ch.charCodeAt(0));
        if (png.length < 200) throw new HttpError(400, "Please draw your signature.");
      }

      const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("cf-connecting-ip") || "";
      const ua = (req.headers.get("user-agent") ?? "").slice(0, 400);
      const signedAt = new Date().toISOString();
      const bodyHash = await sha256Hex(c.body);
      const ctx = await context(admin, c);
      const propertyLabel = ctx.prop ? `${ctx.prop.name}${ctx.prop.address && ctx.prop.address !== ctx.prop.name ? `, ${ctx.prop.address}` : ""}` : "";

      const pdfBytes = await buildSignedPdf({
        c,
        company: ctx.company.name,
        client: ctx.client,
        property: propertyLabel,
        signerName: name,
        signerEmail: email,
        signedAt,
        ip,
        ua,
        method,
        signaturePng: png,
        bodyHash,
      });
      const path = `${c.org_id}/contracts/${c.id}/signed-agreement.pdf`;
      const { error: upErr } = await admin.storage.from("crm-documents").upload(path, pdfBytes, { contentType: "application/pdf", upsert: true });
      if (upErr) {
        console.error("signed pdf upload failed", upErr.message);
        throw new HttpError(500, "Couldn't save your signed copy. Nothing was signed — please try again.");
      }

      // Conditional on status so a double-tap or a parallel signer can't sign twice.
      const { data: updated, error: sErr } = await admin
        .from("crm_contracts")
        .update({
          status: "signed",
          signer_name: name,
          signer_email: email,
          signed_at: signedAt,
          signer_ip: ip || null,
          signer_user_agent: ua || null,
          signature_method: method,
          signature_image: method === "draw" ? image : null,
          body_sha256: bodyHash,
          signed_pdf_path: path,
        })
        .eq("id", c.id)
        .eq("status", "sent")
        .select("id");
      if (sErr || !updated?.length) {
        if (sErr) console.error("sign update failed", sErr.message);
        throw new HttpError(409, "This agreement could not be signed — it may have just been signed or changed. Reload the page.");
      }

      // Copies by email (best effort — the signature is already recorded).
      const pdfB64 = toBase64(pdfBytes);
      const filename = `${c.title.replace(/[^A-Za-z0-9]+/g, "-")}-C-${c.number}-signed.pdf`;
      const stamp = fmtStamp(signedAt);
      await sendEmail({
        to: [email],
        subject: `Signed: ${c.title} (C-${c.number})`,
        html: emailShell(ctx.company.name, "Thanks — your agreement is signed", `<p style="margin:0 0 12px;">Hi ${escapeHtml(name)}, your signed copy of the ${escapeHtml(c.title)} is attached for your records.</p><p style="margin:0;color:#8a8d94;font-size:13px;">Signed ${escapeHtml(stamp)}.</p>`),
        text: `Hi ${name}, your signed copy of the ${c.title} (C-${c.number}) is attached. Signed ${stamp}.`,
        replyTo: ctx.company.replyTo || undefined,
        fromName: ctx.company.name,
        attachments: [{ filename, content: pdfB64 }],
      }).catch(() => null);
      const { data: admins } = await admin.from("profiles").select("email").eq("org_id", c.org_id).eq("role", "admin").eq("active", true);
      const adminEmails = (admins ?? []).map((a) => a.email as string).filter((e) => e && EMAIL_RE.test(e));
      if (adminEmails.length) {
        await sendEmail({
          to: adminEmails.slice(0, 10),
          subject: `Contract signed: C-${c.number} — ${ctx.client}`,
          html: emailShell(ctx.company.name, "A contract was signed", `<p style="margin:0 0 12px;"><b>${escapeHtml(name)}</b> (${escapeHtml(email)}) signed ${escapeHtml(c.title)} C-${c.number} for ${escapeHtml(ctx.client)}${propertyLabel ? ` at ${escapeHtml(propertyLabel)}` : ""}.</p><p style="margin:0;color:#8a8d94;font-size:13px;">${escapeHtml(stamp)} · The signed PDF is attached and saved on the client's record.</p>`),
          text: `${name} (${email}) signed ${c.title} C-${c.number} for ${ctx.client} on ${stamp}.`,
          attachments: [{ filename, content: pdfB64 }],
        }).catch(() => null);
      }

      return json({ ok: true, signed_at: signedAt, signer_name: name });
    }

    throw new HttpError(400, "Unknown action.");
  } catch (err) {
    return handleError(err);
  }
});
