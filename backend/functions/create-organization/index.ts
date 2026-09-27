import { corsHeaders, createAdminClient, EMAIL_RE, handleError, HttpError, json, readString } from "../_shared/auth.ts";

/**
 * Public sign-up: creates an organization and its first admin account.
 * The admin can then sign in with email + password and add employees.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const orgName = readString(body.orgName, 120);
    const fullName = readString(body.fullName, 120);
    const email = readString(body.email, 200).toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";

    if (!orgName) throw new HttpError(400, "Organization name is required.");
    if (!fullName) throw new HttpError(400, "Your name is required.");
    if (!EMAIL_RE.test(email)) throw new HttpError(400, "Enter a valid email address.");
    if (password.length < 8) throw new HttpError(400, "Password must be at least 8 characters.");
    if (body.acceptedTerms !== true) {
      throw new HttpError(400, "Please agree to the Terms of Service and Privacy Policy.");
    }

    const admin = createAdminClient();

    const { data: created, error: userErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (userErr || !created.user) {
      const msg = userErr?.message ?? "";
      if (/already|registered|exists/i.test(msg)) {
        throw new HttpError(409, "An account with this email already exists. Try signing in.");
      }
      console.error("createUser failed", msg);
      throw new HttpError(400, "Couldn't create the account. Check the details and try again.");
    }
    const userId = created.user.id;

    const { data: org, error: orgErr } = await admin
      .from("organizations")
      .insert({ name: orgName })
      .select("id, name")
      .single();
    if (orgErr || !org) {
      await admin.auth.admin.deleteUser(userId);
      console.error("org insert failed", orgErr?.message);
      throw new HttpError(500, "Couldn't create the organization. Please try again.");
    }

    const { error: profileErr } = await admin.from("profiles").insert({
      id: userId,
      org_id: org.id,
      full_name: fullName,
      email,
      role: "admin",
      terms_accepted_at: new Date().toISOString(),
    });
    if (profileErr) {
      await admin.auth.admin.deleteUser(userId);
      await admin.from("organizations").delete().eq("id", org.id);
      console.error("profile insert failed", profileErr.message);
      throw new HttpError(500, "Couldn't finish setting up your account. Please try again.");
    }

    return json({ ok: true, orgId: org.id, orgName: org.name });
  } catch (err) {
    return handleError(err);
  }
});
