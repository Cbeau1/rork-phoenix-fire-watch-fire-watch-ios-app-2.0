import {
  corsHeaders,
  createAdminClient,
  EMAIL_RE,
  handleError,
  HttpError,
  json,
  readString,
  requireAuth,
} from "../_shared/auth.ts";

type Action = "create" | "update" | "reset-password" | "remove";

/**
 * Org admin actions for employee accounts:
 * - create: new employee login inside the admin's organization
 * - update: change name / email / role / active flag
 * - reset-password: set a new password for an employee
 * - remove: delete the employee's login entirely
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const caller = await requireAuth(req);
    const admin = createAdminClient();

    const { data: me, error: meErr } = await admin
      .from("profiles")
      .select("id, org_id, role, active")
      .eq("id", caller.id)
      .single();
    if (meErr || !me || !me.active) throw new HttpError(403, "Your account is not active.");
    if (me.role !== "admin") throw new HttpError(403, "Only organization admins can manage team members.");

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = body.action as Action;

    const loadMember = async (memberId: string) => {
      if (!memberId) throw new HttpError(400, "Missing team member.");
      const { data, error } = await admin
        .from("profiles")
        .select("id, org_id, role")
        .eq("id", memberId)
        .single();
      if (error || !data || data.org_id !== me.org_id) throw new HttpError(404, "Team member not found.");
      return data;
    };

    const adminCount = async (): Promise<number> => {
      const { count } = await admin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("org_id", me.org_id)
        .eq("role", "admin")
        .eq("active", true);
      return count ?? 0;
    };

    if (action === "create") {
      const fullName = readString(body.fullName, 120);
      const email = readString(body.email, 200).toLowerCase();
      const password = typeof body.password === "string" ? body.password : "";
      const role = body.role === "admin" ? "admin" : "officer";
      if (!fullName) throw new HttpError(400, "Employee name is required.");
      if (!EMAIL_RE.test(email)) throw new HttpError(400, "Enter a valid email address.");
      if (password.length < 8) throw new HttpError(400, "Password must be at least 8 characters.");

      const { data: created, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });
      if (error || !created.user) {
        if (/already|registered|exists/i.test(error?.message ?? "")) {
          throw new HttpError(409, "That email is already in use by another account.");
        }
        console.error("createUser failed", error?.message);
        throw new HttpError(400, "Couldn't create the login. Check the details and try again.");
      }

      const { data: profile, error: pErr } = await admin
        .from("profiles")
        .insert({ id: created.user.id, org_id: me.org_id, full_name: fullName, email, role })
        .select("*")
        .single();
      if (pErr) {
        await admin.auth.admin.deleteUser(created.user.id);
        console.error("profile insert failed", pErr.message);
        throw new HttpError(500, "Couldn't finish creating the employee. Please try again.");
      }
      return json({ ok: true, member: profile });
    }

    if (action === "update") {
      const memberId = readString(body.memberId, 64);
      const member = await loadMember(memberId);
      const patch: Record<string, unknown> = {};
      if (typeof body.fullName === "string") {
        const n = readString(body.fullName, 120);
        if (!n) throw new HttpError(400, "Name can't be empty.");
        patch.full_name = n;
      }
      let newEmail = "";
      if (typeof body.email === "string") {
        const e = readString(body.email, 200).toLowerCase();
        if (!EMAIL_RE.test(e)) throw new HttpError(400, "Enter a valid email address.");
        const { data: cur } = await admin.from("profiles").select("email").eq("id", memberId).single();
        if (cur && cur.email.toLowerCase() !== e) newEmail = e;
      }
      if (body.role === "admin" || body.role === "officer") {
        if (memberId === me.id && body.role !== member.role) throw new HttpError(400, "You can't change your own role.");
        patch.role = body.role;
      }
      if (typeof body.active === "boolean") patch.active = body.active;

      const demoting = member.role === "admin" && (patch.role === "officer" || patch.active === false);
      if (demoting && (await adminCount()) <= 1) {
        throw new HttpError(400, "Your organization needs at least one active admin.");
      }

      if (newEmail) {
        const { error: authErr } = await admin.auth.admin.updateUserById(memberId, { email: newEmail, email_confirm: true });
        if (authErr) {
          if (/already|registered|exists/i.test(authErr.message ?? "")) {
            throw new HttpError(409, "That email is already in use by another account.");
          }
          console.error("email update failed", authErr.message);
          throw new HttpError(400, "Couldn't change the email address.");
        }
        patch.email = newEmail;
      }

      const { data, error } = Object.keys(patch).length
        ? await admin.from("profiles").update(patch).eq("id", memberId).select("*").single()
        : await admin.from("profiles").select("*").eq("id", memberId).single();
      if (error) throw new HttpError(500, "Couldn't update this team member.");

      if (typeof patch.active === "boolean") {
        await admin.auth.admin.updateUserById(memberId, { ban_duration: patch.active ? "none" : "876000h" });
      }
      return json({ ok: true, member: data });
    }

    if (action === "reset-password") {
      const memberId = readString(body.memberId, 64);
      await loadMember(memberId);
      const password = typeof body.password === "string" ? body.password : "";
      if (password.length < 8) throw new HttpError(400, "Password must be at least 8 characters.");
      const { error } = await admin.auth.admin.updateUserById(memberId, { password });
      if (error) throw new HttpError(500, "Couldn't reset the password.");
      return json({ ok: true });
    }

    if (action === "remove") {
      const memberId = readString(body.memberId, 64);
      if (memberId === me.id) throw new HttpError(400, "You can't remove your own account.");
      const member = await loadMember(memberId);
      if (member.role === "admin" && (await adminCount()) <= 1) {
        throw new HttpError(400, "Your organization needs at least one active admin.");
      }
      const { error } = await admin.auth.admin.deleteUser(memberId);
      if (error) throw new HttpError(500, "Couldn't remove this team member.");
      return json({ ok: true });
    }

    throw new HttpError(400, "Unknown action.");
  } catch (err) {
    return handleError(err);
  }
});
