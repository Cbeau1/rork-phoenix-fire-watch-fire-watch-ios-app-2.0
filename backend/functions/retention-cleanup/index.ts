import { corsHeaders, createAdminClient, handleError, HttpError, json } from "../_shared/auth.ts";

const BUCKET = "patrol-photos";

/**
 * Daily data-retention job (triggered by pg_cron). For organizations that set a retention
 * period, permanently deletes patrols (and their photos) and resolved watch notes older
 * than that period. Protected by a private cron secret.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const admin = createAdminClient();
    const secret = req.headers.get("x-cron-secret") ?? "";
    const { data: valid } = await admin.rpc("verify_cron_secret", { p_secret: secret });
    if (!secret || valid !== true) throw new HttpError(401, "Unauthorized");

    const { data: orgs, error } = await admin
      .from("organizations")
      .select("id, retention_days")
      .not("retention_days", "is", null);
    if (error) throw new Error(error.message);

    let patrolsDeleted = 0;
    let photosDeleted = 0;
    let notesDeleted = 0;

    for (const org of orgs ?? []) {
      const days = Number(org.retention_days);
      if (!Number.isFinite(days) || days < 90) continue;
      const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();

      for (let round = 0; round < 20; round += 1) {
        const { data: old } = await admin
          .from("patrols")
          .select("id, photos")
          .eq("org_id", org.id)
          .lt("date_time", cutoff)
          .limit(500);
        if (!old || old.length === 0) break;
        const paths = old.flatMap((p) => ((p.photos as string[] | null) ?? []).filter((x) => x.startsWith(`${org.id}/`)));
        for (let i = 0; i < paths.length; i += 100) {
          const { error: rmErr } = await admin.storage.from(BUCKET).remove(paths.slice(i, i + 100));
          if (rmErr) console.error("photo removal failed", rmErr.message);
          else photosDeleted += Math.min(100, paths.length - i);
        }
        const { error: delErr } = await admin.from("patrols").delete().in("id", old.map((p) => p.id));
        if (delErr) {
          console.error("patrol delete failed", delErr.message);
          break;
        }
        patrolsDeleted += old.length;
        if (old.length < 500) break;
      }

      const { count } = await admin
        .from("watch_notes")
        .delete({ count: "exact" })
        .eq("org_id", org.id)
        .not("resolved_at", "is", null)
        .lt("resolved_at", cutoff);
      notesDeleted += count ?? 0;
    }

    console.log(`retention: ${patrolsDeleted} patrols, ${photosDeleted} photos, ${notesDeleted} notes`);
    return json({ ok: true, patrolsDeleted, photosDeleted, notesDeleted });
  } catch (err) {
    return handleError(err);
  }
});
