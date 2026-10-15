import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

import { corsHeaders, handleError, HttpError, json, requireAuth } from "../_shared/auth.ts";
import { scanInvoice } from "./extract.ts";

/** Gateway request bodies are capped at ~4.5 MB; base64 adds a third. */
const MAX_BYTES = 3 * 1024 * 1024;

type Kind = "pdf" | "jpg" | "png";
const MIME: Record<Kind, string> = { pdf: "application/pdf", jpg: "image/jpeg", png: "image/png" };

function sniff(b: Uint8Array): Kind | null {
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return "pdf";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  return null;
}

function userClient(req: Request): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
/** "BRADLEY, ROBERT" and "Robert Bradley" both become "bradley robert". */
const nameKey = (s: string) => {
  const flipped = s.includes(",") ? s.split(",").reverse().join(" ") : s;
  return norm(flipped).split(" ").filter(Boolean).sort().join(" ");
};

const todayIn = (tz: string) => {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
    await requireAuth(req);
    const db = userClient(req);
    const { data: ok, error: permErr } = await db.rpc("wf_has", { p: "finance" });
    if (permErr || ok !== true) throw new HttpError(403, "Agency invoices are limited to authorized finance administrators.");

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size <= 0) throw new HttpError(400, "Choose an invoice file.");
    if (file.size > MAX_BYTES) throw new HttpError(413, "Invoices must be 3 MB or smaller to read automatically.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const kind = sniff(bytes);
    if (!kind) throw new HttpError(415, "Only PDF, JPG and PNG files can be read.");

    const secret = Deno.env.get("EXPO_PUBLIC_RORK_TOOLKIT_SECRET_KEY");
    const toolkitUrl = Deno.env.get("EXPO_PUBLIC_TOOLKIT_URL") || "https://toolkit.rork.com";
    if (!secret) throw new HttpError(503, "The invoice reader isn't set up yet. Enter the invoice manually.");

    const [{ data: agencies }, { data: workers }, { data: org }] = await Promise.all([
      db.from("wf_agencies").select("id, name"),
      db.from("wf_workers").select("id, first_name, last_name, agency_id, source"),
      db.from("organizations").select("timezone").limit(1).maybeSingle(),
    ]);
    const agencyList = (agencies ?? []) as { id: string; name: string }[];
    const tz = (org as { timezone?: string } | null)?.timezone || "America/New_York";

    let scanned;
    try {
      scanned = await scanInvoice({
        toolkitUrl,
        secret,
        bytes,
        mime: MIME[kind],
        fileName: file.name.replace(/[^\w.\- ()]/g, "_").slice(0, 120),
        agencies: agencyList.map((a) => a.name),
        today: todayIn(tz),
      });
    } catch (e) {
      throw new HttpError(502, e instanceof Error ? e.message : "Couldn't read that invoice.");
    }

    const vendor = scanned.vendor_name ? norm(scanned.vendor_name) : "";
    const agency =
      agencyList.find((a) => norm(a.name) === vendor) ??
      agencyList.find((a) => vendor && (vendor.includes(norm(a.name)) || norm(a.name).includes(vendor))) ??
      (agencyList.length === 1 ? agencyList[0] : undefined);

    const pool = ((workers ?? []) as { id: string; first_name: string; last_name: string; agency_id: string | null; source: string }[]).filter(
      (w) => !agency || w.agency_id === agency.id || w.source !== "agency",
    );
    const byKey = new Map(pool.map((w) => [nameKey(`${w.first_name} ${w.last_name}`), w.id]));
    const lines = scanned.lines.map((l) => ({ ...l, worker_id: l.worker_name ? (byKey.get(nameKey(l.worker_name)) ?? null) : null }));

    return json({ ok: true, invoice: { ...scanned, lines }, agencyId: agency?.id ?? null });
  } catch (err) {
    return handleError(err);
  }
});
