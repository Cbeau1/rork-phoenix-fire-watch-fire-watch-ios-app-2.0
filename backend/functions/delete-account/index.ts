import { type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

import { corsHeaders, createAdminClient, handleError, HttpError, json, readString, requireAuth } from "../_shared/auth.ts";

const BUCKET = "patrol-photos";

/** Removes every stored patrol photo that belongs to an organization. */
async function removeOrgPhotos(admin: SupabaseClient, orgId: string): Promise<void> {
  const paths = new Set<string>();
  const { data: rows } = await admin.from("patrols").select("photos").eq("org_id", orgId);
  for (const r of rows ?? []) for (const p of (r.photos as string[] | null) ?? []) paths.add(p);

  const { data: entries } = await admin.storage.from(BUCKET).list(orgId, { limit: 1000 });
  for (const entry of entries ?? []) {
    if (entry.id) {
      paths.add(`${orgId}/${entry.name}`);
      continue;
    }
    const { data: files } = await admin.storage.from(BUCKET).list(`${orgId}/${entry.name}`, { limit: 100 });
    for (const f of files ?? []) if (f.id) paths.add(`${orgId}/${entry.name}/${f.name}`);
  }

  const list = Array.from(paths).filter((p) => p.startsWith(`${orgId}/`));
  for (let i = 0; i < list.length; i += 100) {
    const { error } = await admin.storage.from(BUCKET).remove(list.slice(i, i + 100));
    if (error) console.error("photo removal failed", error.message);
  }
}

/** Removes every private workforce file (documents, versions, profile photos) for an organization. */
async function removeWorkforceFiles(admin: SupabaseClient, orgId: string): Promise<void> {
  const paths = new Set<string>();
  const { data: versions } = await admin.from("wf_document_versions").select("storage_path").eq("org_id", orgId);
  for (const v of versions ?? []) paths.add(String(v.storage_path));
  const { data: workers } = await admin.from("wf_workers").select("photo_path").eq("org_id", orgId).not("photo_path", "is", null);
  for (const w of workers ?? []) paths.add(String(w.photo_path));
  const { data: receipts } = await admin.from("ex_attachments").select("storage_path").eq("org_id", orgId);
  for (const r of receipts ?? []) paths.add(String(r.storage_path));
  const list = Array.from(paths).filter((p) => p.startsWith(`${orgId}/`));
  for (let i = 0; i < list.length; i += 100) {
    const { error } = await admin.storage.from("workforce-files").remove(list.slice(i, i + 100));
    if (error) console.error("workforce file removal failed", error.message);
  }
}

/** Permanently deletes an organization, all of its records, photos and member logins. */
async function deleteOrganization(admin: SupabaseClient, orgId: string, memberIds: string[]): Promise<void> {
  await removeOrgPhotos(admin, orgId);
  await removeWorkforceFiles(admin, orgId);
  for (const table of ["patrols", "watch_notes", "properties"]) {
    const { error } = await admin.from(table).delete().eq("org_id", orgId);
    if (error) throw new Error(`delete ${table}: ${error.message}`);
  }
  const { error: pErr } = await admin.from("profiles").delete().eq("org_id", orgId);
  if (pErr) throw new Error(`delete profiles: ${pErr.message}`);
  for (const id of memberIds) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.error("deleteUser failed", id, error.message);
  }
  const { error: oErr } = await admin.from("organizations").delete().eq("id", orgId);
  if (oErr) throw new Error(`delete organization: ${oErr.message}`);
}

/**
 * In-app account deletion (App Store Guideline 5.1.1(v)).
 * - scope "self": deletes the caller's login + profile. Records they logged stay with the
 *   organization (business records) with the author link removed. Sole members delete the org.
 * - scope "organization": admin-only; deletes the whole organization, every login and all data.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const caller = await requireAuth(req);
    const admin = createAdminClient();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const scope = body.scope === "organization" ? "organization" : "self";

    const { data: me } = await admin
      .from("profiles")
      .select("id, org_id, role")
      .eq("id", caller.id)
      .maybeSingle();

    if (!me) {
      await admin.auth.admin.deleteUser(caller.id);
      return json({ ok: true, deleted: "account" });
    }

    const { data: members, error: mErr } = await admin
      .from("profiles")
      .select("id, role, active")
      .eq("org_id", me.org_id);
    if (mErr) throw new HttpError(500, "Couldn't load your organization.");
    const others = (members ?? []).filter((m) => m.id !== me.id);

    if (scope === "self") {
      if (others.length === 0) {
        await deleteOrganization(admin, me.org_id, [me.id]);
        return json({ ok: true, deleted: "organization" });
      }
      if (me.role === "admin" && !others.some((m) => m.role === "admin" && m.active)) {
        throw new HttpError(
          400,
          "You're the only admin. Make another team member an admin first, or delete the whole organization.",
        );
      }
      const { error: pErr } = await admin.from("profiles").delete().eq("id", me.id);
      if (pErr) throw new HttpError(500, "Couldn't delete your account. Please try again.");
      const { error: uErr } = await admin.auth.admin.deleteUser(me.id);
      if (uErr) console.error("deleteUser failed", uErr.message);
      return json({ ok: true, deleted: "account" });
    }

    if (me.role !== "admin") throw new HttpError(403, "Only organization admins can delete the organization.");
    const { data: org } = await admin.from("organizations").select("name").eq("id", me.org_id).single();
    const confirmName = readString(body.confirmName, 160).toLowerCase();
    if (!org || confirmName !== String(org.name).trim().toLowerCase()) {
      throw new HttpError(400, "Type your organization's name exactly to confirm.");
    }
    await deleteOrganization(
      admin,
      me.org_id,
      (members ?? []).map((m) => m.id),
    );
    return json({ ok: true, deleted: "organization" });
  } catch (err) {
    return handleError(err);
  }
});
