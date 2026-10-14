import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

import { corsHeaders, createAdminClient, handleError, HttpError, json, readString, requireAuth } from "../_shared/auth.ts";

const BUCKET = "workforce-files";
const MAX_BYTES = 10 * 1024 * 1024;
const URL_TTL_SECONDS = 60;
const PHOTO_TTL_SECONDS = 300;

type Kind = "pdf" | "jpg" | "png";
const MIME: Record<Kind, string> = { pdf: "application/pdf", jpg: "image/jpeg", png: "image/png" };

/** Identifies the real file type from its first bytes — the browser-supplied type is never trusted. */
function sniff(bytes: Uint8Array): Kind | null {
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) {
    return "pdf";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return "png";
  }
  return null;
}

/** Client that acts as the signed-in user, so RLS and permission checks use the verified account. */
function userClient(req: Request): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

const dbMessage = (err: { message?: string; code?: string } | null, fallback: string): string => {
  if (!err) return fallback;
  if (err.code === "42501" || /permission/i.test(err.message ?? "")) return "You don't have permission to do that.";
  const m = err.message ?? "";
  // Messages raised by our own SQL functions are written for end users.
  return m && m.length < 200 && !/violates|syntax|relation|column/i.test(m) ? m : fallback;
};

/** Expenditures access is a separate permission from Workforce access. */
async function requireExpenses(db: SupabaseClient): Promise<{ orgId: string }> {
  const { data: ok, error } = await db.rpc("wf_has", { p: "expenses" });
  if (error || ok !== true) throw new HttpError(403, "Expenditures are limited to authorized administrators.");
  const { data: orgId } = await db.rpc("my_org_id");
  if (typeof orgId !== "string") throw new HttpError(403, "Your account is not active.");
  return { orgId };
}

const EXPENSE_ACTIONS = new Set(["upload-expense-file", "expense-file-url"]);

async function requireWorkforce(db: SupabaseClient): Promise<{ orgId: string }> {
  const { data: ok, error } = await db.rpc("wf_has", { p: "manage" });
  if (error || ok !== true) throw new HttpError(403, "Workforce Management is limited to authorized administrators.");
  const { data: orgId } = await db.rpc("my_org_id");
  if (typeof orgId !== "string") throw new HttpError(403, "Your account is not active.");
  return { orgId };
}

const optDate = (v: FormDataEntryValue | null): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

async function readFile(form: FormData): Promise<{ bytes: Uint8Array; kind: Kind; name: string }> {
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Choose a file to upload.");
  if (file.size <= 0) throw new HttpError(400, "That file is empty.");
  if (file.size > MAX_BYTES) throw new HttpError(413, "Files must be 10 MB or smaller.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new HttpError(413, "Files must be 10 MB or smaller.");
  const kind = sniff(bytes);
  if (!kind) throw new HttpError(415, "Only PDF, JPG and PNG files are allowed.");
  return { bytes, kind, name: file.name.replace(/[^\w.\- ()]/g, "_").slice(0, 160) || `file.${kind}` };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    await requireAuth(req);
    const db = userClient(req);
    const admin = createAdminClient();

    const isForm = (req.headers.get("content-type") ?? "").includes("multipart/form-data");

    if (isForm) {
      const form = await req.formData();
      const action = String(form.get("action") ?? "");

      if (action === "upload-expense-file") {
        const { orgId } = await requireExpenses(db);
        const expenditureId = readString(form.get("expenditureId"), 64) || null;
        const paymentId = readString(form.get("paymentId"), 64) || null;
        if (!expenditureId === !paymentId) throw new HttpError(400, "Attach the file to an expenditure or a payment.");
        const { bytes, kind, name } = await readFile(form);
        const path = `${orgId}/expenses/${crypto.randomUUID()}.${kind}`;
        const { error: upErr } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: MIME[kind], upsert: false });
        if (upErr) {
          console.error("expense upload failed", upErr.message);
          throw new HttpError(500, "Couldn't store the file. Please try again.");
        }
        const { data, error } = await db.rpc("ex_register_attachment", {
          p_exp: expenditureId,
          p_pay: paymentId,
          p_path: path,
          p_name: name,
          p_mime: MIME[kind],
          p_size: bytes.length,
        });
        if (error) {
          await admin.storage.from(BUCKET).remove([path]);
          throw new HttpError(400, dbMessage(error, "Couldn't save the file."));
        }
        return json({ ok: true, id: data });
      }

      const { orgId } = await requireWorkforce(db);

      if (action === "upload-document") {
        const { bytes, kind, name } = await readFile(form);
        const path = `${orgId}/docs/${crypto.randomUUID()}.${kind}`;
        const { error: upErr } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: MIME[kind], upsert: false });
        if (upErr) {
          console.error("workforce upload failed", upErr.message);
          throw new HttpError(500, "Couldn't store the file. Please try again.");
        }
        const documentId = readString(form.get("documentId"), 64) || null;
        const { data, error } = await db.rpc("wf_register_upload", {
          p_document: documentId,
          p_owner_type: readString(form.get("ownerType"), 20),
          p_owner_id: readString(form.get("ownerId"), 64) || null,
          p_category: readString(form.get("category"), 40),
          p_title: readString(form.get("title"), 200),
          p_issue: optDate(form.get("issueDate")),
          p_exp: optDate(form.get("expirationDate")),
          p_class: readString(form.get("classification"), 20) || "standard",
          p_signed: form.get("signed") === "true",
          p_path: path,
          p_file_name: name,
          p_mime: MIME[kind],
          p_size: bytes.length,
          p_time_entry: readString(form.get("timeEntryId"), 64) || null,
        });
        if (error) {
          await admin.storage.from(BUCKET).remove([path]);
          throw new HttpError(400, dbMessage(error, "Couldn't save the document."));
        }
        return json({ ok: true, ...(data as Record<string, unknown>) });
      }

      if (action === "upload-photo") {
        const workerId = readString(form.get("workerId"), 64);
        const { bytes, kind } = await readFile(form);
        if (kind === "pdf") throw new HttpError(415, "Profile photos must be JPG or PNG.");
        const { data: worker, error: wErr } = await db.from("wf_workers").select("id, photo_path").eq("id", workerId).maybeSingle();
        if (wErr || !worker) throw new HttpError(404, "Worker not found.");
        const path = `${orgId}/photos/${worker.id}/${crypto.randomUUID()}.${kind}`;
        const { error: upErr } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: MIME[kind], upsert: false });
        if (upErr) throw new HttpError(500, "Couldn't store the photo. Please try again.");
        const { error } = await db.from("wf_workers").update({ photo_path: path }).eq("id", worker.id);
        if (error) {
          await admin.storage.from(BUCKET).remove([path]);
          throw new HttpError(400, dbMessage(error, "Couldn't save the photo."));
        }
        if (worker.photo_path && String(worker.photo_path).startsWith(`${orgId}/photos/`)) {
          await admin.storage.from(BUCKET).remove([worker.photo_path]);
        }
        return json({ ok: true });
      }

      throw new HttpError(400, "Unknown action.");
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = readString(body.action, 40);

    if (action === "expense-file-url") {
      const { orgId } = await requireExpenses(db);
      const id = readString(body.id, 64);
      const mode = body.mode === "download" ? "download" : "preview";
      // RLS on ex_attachments enforces org + Expenditures permission.
      const { data: att, error } = await db
        .from("ex_attachments")
        .select("id, storage_path, file_name, expenditure_id")
        .eq("id", id)
        .maybeSingle();
      if (error || !att) throw new HttpError(404, "File not found.");
      if (!String(att.storage_path).startsWith(`${orgId}/expenses/`)) throw new HttpError(404, "File not found.");
      const { data: signed, error: sErr } = await admin.storage
        .from(BUCKET)
        .createSignedUrl(att.storage_path, URL_TTL_SECONDS, mode === "download" ? { download: att.file_name } : undefined);
      if (sErr || !signed) throw new HttpError(500, "Couldn't open the file.");
      await db.rpc("ex_log_event", {
        p_action: mode,
        p_exp: att.expenditure_id,
        p_summary: `${mode === "download" ? "Downloaded" : "Previewed"} ${att.file_name}`,
      });
      return json({ ok: true, url: signed.signedUrl, expiresIn: URL_TTL_SECONDS });
    }

    if (EXPENSE_ACTIONS.has(action)) throw new HttpError(400, "Unknown action.");
    const { orgId } = await requireWorkforce(db);

    if (action === "document-url") {
      const versionId = readString(body.versionId, 64);
      const mode = body.mode === "download" ? "download" : "preview";
      // RLS decides visibility: restricted/financial/personnel files need their own permission.
      const { data: version, error } = await db
        .from("wf_document_versions")
        .select("id, storage_path, file_name, document_id, wf_documents(worker_id, classification, owner_type, title)")
        .eq("id", versionId)
        .maybeSingle();
      if (error || !version) throw new HttpError(404, "Document not found.");
      if (!String(version.storage_path).startsWith(`${orgId}/`)) throw new HttpError(404, "Document not found.");
      const doc = (Array.isArray(version.wf_documents) ? version.wf_documents[0] : version.wf_documents) as
        | { worker_id: string | null; classification: string; owner_type: string; title: string }
        | null;
      const { data: signed, error: sErr } = await admin.storage
        .from(BUCKET)
        .createSignedUrl(version.storage_path, URL_TTL_SECONDS, mode === "download" ? { download: version.file_name } : undefined);
      if (sErr || !signed) throw new HttpError(500, "Couldn't open the file.");
      const perm = doc?.owner_type === "personnel"
        ? "personnel"
        : doc?.classification === "restricted"
          ? "documents"
          : doc?.classification === "financial"
            ? "finance"
            : "manage";
      await db.rpc("wf_log_event", {
        p_action: mode,
        p_entity: "wf_documents",
        p_entity_id: version.document_id,
        p_worker: doc?.worker_id ?? null,
        p_summary: mode === "download" ? "Downloaded a document" : "Previewed a document",
        p_perm: perm,
      });
      return json({ ok: true, url: signed.signedUrl, expiresIn: URL_TTL_SECONDS });
    }

    if (action === "photo-urls") {
      const ids = Array.isArray(body.workerIds) ? body.workerIds.filter((x): x is string => typeof x === "string").slice(0, 200) : [];
      if (ids.length === 0) return json({ ok: true, urls: {} });
      const { data: rows } = await db.from("wf_workers").select("id, photo_path").in("id", ids).not("photo_path", "is", null);
      const valid = (rows ?? []).filter((r) => String(r.photo_path).startsWith(`${orgId}/photos/`));
      const urls: Record<string, string> = {};
      if (valid.length > 0) {
        const { data: signed } = await admin.storage
          .from(BUCKET)
          .createSignedUrls(valid.map((r) => r.photo_path as string), PHOTO_TTL_SECONDS);
        valid.forEach((r, i) => {
          const u = signed?.[i]?.signedUrl;
          if (u) urls[r.id] = u;
        });
      }
      return json({ ok: true, urls });
    }

    if (action === "purge-worker" || action === "purge-document") {
      const { data: paths, error } =
        action === "purge-worker"
          ? await db.rpc("wf_purge_worker", { p_worker: readString(body.id, 64), p_confirm: readString(body.confirm, 40) })
          : await db.rpc("wf_purge_document", { p_document: readString(body.id, 64), p_confirm: body.confirm === true });
      if (error) throw new HttpError(400, dbMessage(error, "Couldn't permanently delete this record."));
      const list = ((paths as string[] | null) ?? []).filter((p) => p.startsWith(`${orgId}/`));
      for (let i = 0; i < list.length; i += 100) {
        const { error: rmErr } = await admin.storage.from(BUCKET).remove(list.slice(i, i + 100));
        if (rmErr) console.error("workforce file removal failed", rmErr.message);
      }
      return json({ ok: true, removedFiles: list.length });
    }

    throw new HttpError(400, "Unknown action.");
  } catch (err) {
    return handleError(err);
  }
});
