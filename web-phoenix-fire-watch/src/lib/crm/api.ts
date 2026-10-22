import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { callFunction, supabase } from "@/lib/supabase";
import { useAuth } from "@/state/AuthProvider";

import type {
  BoardDeal,
  CrmActivity,
  CrmClient,
  CrmContact,
  CrmContract,
  CrmDeal,
  CrmPropertyLite,
  CrmQuote,
  CrmSettings,
} from "./types";

/**
 * The CRM tables are admin-only under RLS; these hooks are convenience wrappers and every write is
 * independently authorized (and validated by triggers) on the server.
 */
// The generated client types can't describe embedded selects precisely; results are cast to the
// interfaces in ./types, which mirror backend/sql/crm-pipeline.sql.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const raise = (error: { message?: string } | null) => {
  if (error) throw new Error(error.message || "Something went wrong.");
};

const PROPERTY_COLS =
  "id, name, address, contact_name, contact_phone, contact_email, access_instructions, fire_marshal_name, fire_marshal_phone, fire_marshal_email, patrol_interval_minutes, client_id";

export const crmKeys = {
  all: (org: string) => ["crm", org] as const,
  board: (org: string) => ["crm", org, "board"] as const,
  clients: (org: string) => ["crm", org, "clients"] as const,
  client: (org: string, id: string) => ["crm", org, "client", id] as const,
  deal: (org: string, id: string) => ["crm", org, "deal", id] as const,
  settings: (org: string) => ["crm", org, "settings"] as const,
  tz: (org: string) => ["crm", org, "tz"] as const,
};

export const useOrg = () => {
  const { user } = useAuth();
  return { orgId: user?.orgId ?? "", orgName: user?.orgName ?? "", userName: user?.name ?? "" };
};

export const useInvalidateCrm = () => {
  const qc = useQueryClient();
  const { orgId } = useOrg();
  return useCallback(() => qc.invalidateQueries({ queryKey: crmKeys.all(orgId) }), [qc, orgId]);
};

/** Organization timezone (falls back to Eastern, the company's home zone). */
export const useOrgTimezone = (): string => {
  const { orgId } = useOrg();
  const q = useQuery({
    queryKey: crmKeys.tz(orgId),
    enabled: !!orgId,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await db.from("organizations").select("timezone").eq("id", orgId).maybeSingle();
      raise(error);
      return (data?.timezone as string | null) || "America/New_York";
    },
  });
  return q.data ?? "America/New_York";
};

export const useBoard = () => {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: crmKeys.board(orgId),
    enabled: !!orgId,
    queryFn: async (): Promise<BoardDeal[]> => {
      const { data, error } = await db
        .from("crm_deals")
        .select(
          "*, client:crm_clients(id, name), property:properties(id, name, address), quotes:crm_quotes(id, number, hourly_rate, hours_per_week, coverage, status, created_at), contracts:crm_contracts(id, number, status, created_at, signed_at)",
        )
        .eq("org_id", orgId)
        .order("updated_at", { ascending: false })
        .limit(1000);
      raise(error);
      return (data ?? []) as BoardDeal[];
    },
  });
};

export interface ClientRow extends CrmClient {
  contacts: Pick<CrmContact, "id" | "name" | "email" | "phone" | "role">[];
  deals: Pick<CrmDeal, "id" | "stage">[];
}

export const useClients = () => {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: crmKeys.clients(orgId),
    enabled: !!orgId,
    queryFn: async (): Promise<ClientRow[]> => {
      const { data, error } = await db
        .from("crm_clients")
        .select("*, contacts:crm_contacts(id, name, email, phone, role), deals:crm_deals(id, stage)")
        .eq("org_id", orgId)
        .order("name")
        .limit(2000);
      raise(error);
      return (data ?? []) as ClientRow[];
    },
  });
};

export interface ClientDetail {
  client: CrmClient;
  contacts: CrmContact[];
  properties: CrmPropertyLite[];
  deals: BoardDeal[];
}

export const useClient = (id: string) => {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: crmKeys.client(orgId, id),
    enabled: !!orgId && !!id,
    queryFn: async (): Promise<ClientDetail | null> => {
      const [c, contacts, props, deals] = await Promise.all([
        db.from("crm_clients").select("*").eq("id", id).maybeSingle(),
        db.from("crm_contacts").select("*").eq("client_id", id).order("created_at"),
        db.from("properties").select(PROPERTY_COLS).eq("client_id", id).order("name"),
        db
          .from("crm_deals")
          .select(
            "*, client:crm_clients(id, name), property:properties(id, name, address), quotes:crm_quotes(id, number, hourly_rate, hours_per_week, coverage, status, created_at), contracts:crm_contracts(id, number, status, created_at, signed_at)",
          )
          .eq("client_id", id)
          .order("created_at", { ascending: false }),
      ]);
      raise(c.error);
      raise(contacts.error);
      raise(props.error);
      raise(deals.error);
      if (!c.data) return null;
      return {
        client: c.data as CrmClient,
        contacts: (contacts.data ?? []) as CrmContact[],
        properties: (props.data ?? []) as CrmPropertyLite[],
        deals: (deals.data ?? []) as BoardDeal[],
      };
    },
  });
};

export interface DealDetail {
  deal: CrmDeal;
  client: CrmClient;
  contacts: CrmContact[];
  property: CrmPropertyLite | null;
  quotes: CrmQuote[];
  contracts: CrmContract[];
  activity: CrmActivity[];
}

export const useDeal = (id: string) => {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: crmKeys.deal(orgId, id),
    enabled: !!orgId && !!id,
    queryFn: async (): Promise<DealDetail | null> => {
      const d = await db.from("crm_deals").select("*").eq("id", id).maybeSingle();
      raise(d.error);
      if (!d.data) return null;
      const deal = d.data as CrmDeal;
      const [c, contacts, prop, quotes, contracts, activity] = await Promise.all([
        db.from("crm_clients").select("*").eq("id", deal.client_id).maybeSingle(),
        db.from("crm_contacts").select("*").eq("client_id", deal.client_id).order("created_at"),
        deal.property_id
          ? db.from("properties").select(PROPERTY_COLS).eq("id", deal.property_id).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        db.from("crm_quotes").select("*").eq("deal_id", id).order("created_at", { ascending: false }),
        db
          .from("crm_contracts")
          .select(
            "id, deal_id, quote_id, number, title, body, coverage, hours_per_week, hourly_rate, start_date, end_date, payment_terms, status, sign_expires_at, sent_at, sent_to, sent_to_name, viewed_at, signer_name, signer_email, signed_at, signer_ip, signer_user_agent, signature_method, body_sha256, signed_pdf_path, void_reason, created_at, doc_kind, template_path, template_layout",
          )
          .eq("deal_id", id)
          .order("created_at", { ascending: false }),
        db.from("crm_activity").select("id, kind, summary, actor_name, created_at").eq("deal_id", id).order("created_at", { ascending: false }).limit(200),
      ]);
      for (const r of [c, contacts, prop, quotes, contracts, activity]) raise(r.error);
      if (!c.data) return null;
      return {
        deal,
        client: c.data as CrmClient,
        contacts: (contacts.data ?? []) as CrmContact[],
        property: (prop.data ?? null) as CrmPropertyLite | null,
        quotes: (quotes.data ?? []) as CrmQuote[],
        contracts: ((contracts.data ?? []) as CrmContract[]).map((x) => ({ ...x, signature_image: null })),
        activity: (activity.data ?? []) as CrmActivity[],
      };
    },
  });
};

export const SETTINGS_DEFAULTS = (orgId: string): CrmSettings => ({
  org_id: orgId,
  company_phone: "",
  company_email: "",
  company_address: "",
  default_rate: null,
  payment_terms: "Net 15",
  quote_valid_days: 14,
  sign_link_days: 14,
  quote_notes: "",
  contract_template: "",
  agreement_pdf_path: null,
  agreement_pdf_name: "",
  agreement_layout: null,
  agreement_uploaded_at: null,
  countersign_name: "",
});

export const useCrmSettings = () => {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: crmKeys.settings(orgId),
    enabled: !!orgId,
    queryFn: async (): Promise<CrmSettings & { saved: boolean }> => {
      const { data, error } = await db.from("crm_settings").select("*").eq("org_id", orgId).maybeSingle();
      raise(error);
      return data ? { ...(data as CrmSettings), saved: true } : { ...SETTINGS_DEFAULTS(orgId), saved: false };
    },
  });
};

/* ------------------------------ mutations ------------------------------ */

export const crm = {
  async intake(payload: Record<string, unknown>) {
    const { data, error } = await supabase.rpc("crm_intake", { p: payload as never });
    raise(error);
    return data as { deal_id: string; client_id: string; property_id: string; reused_client: boolean; reused_property: boolean };
  },
  async updateDeal(id: string, patch: Partial<CrmDeal>) {
    const { error } = await db.from("crm_deals").update(patch).eq("id", id);
    raise(error);
  },
  async updateClient(id: string, patch: Partial<CrmClient>) {
    const { error } = await db.from("crm_clients").update(patch).eq("id", id);
    raise(error);
  },
  async saveContact(orgId: string, clientId: string, c: Partial<CrmContact> & { id?: string }) {
    const row = {
      name: (c.name ?? "").trim(),
      email: (c.email ?? "").trim().toLowerCase(),
      phone: (c.phone ?? "").trim(),
      role: c.role ?? "other",
      receives_updates: !!c.receives_updates,
      notes: c.notes ?? "",
    };
    const { error } = c.id
      ? await db.from("crm_contacts").update(row).eq("id", c.id)
      : await db.from("crm_contacts").insert({ ...row, org_id: orgId, client_id: clientId });
    raise(error);
  },
  async deleteContact(id: string) {
    const { error } = await db.from("crm_contacts").delete().eq("id", id);
    raise(error);
  },
  async updateProperty(id: string, patch: Partial<CrmPropertyLite>) {
    const { error } = await db.from("properties").update(patch).eq("id", id);
    raise(error);
  },
  async saveQuote(orgId: string, dealId: string, q: Partial<CrmQuote> & { id?: string }) {
    const row = {
      coverage: q.coverage,
      hours_per_week: q.hours_per_week,
      hourly_rate: q.hourly_rate,
      minimum_hours: q.minimum_hours ?? null,
      start_date: q.start_date || null,
      end_date: q.end_date || null,
      schedule: q.schedule ?? "",
      payment_terms: q.payment_terms ?? "",
      notes: q.notes ?? "",
      valid_until: q.valid_until || null,
    };
    if (q.id) {
      const { error } = await db.from("crm_quotes").update(row).eq("id", q.id);
      raise(error);
      return q.id;
    }
    const { data, error } = await db.from("crm_quotes").insert({ ...row, org_id: orgId, deal_id: dealId }).select("id").single();
    raise(error);
    return (data as { id: string }).id;
  },
  async deleteQuote(id: string) {
    const { error } = await db.from("crm_quotes").delete().eq("id", id).eq("status", "draft");
    raise(error);
  },
  async setQuoteStatus(id: string, status: "sent" | "declined", extra: Record<string, unknown> = {}) {
    const { error } = await db.from("crm_quotes").update({ status, ...extra }).eq("id", id);
    raise(error);
  },
  async acceptQuote(id: string, by: string, note: string) {
    const { error } = await supabase.rpc("crm_quote_accept", { p_quote: id, p_by: by, p_note: note, p_source: "manual" });
    raise(error);
  },
  async createContract(orgId: string, dealId: string, c: Partial<CrmContract>) {
    const { data, error } = await db
      .from("crm_contracts")
      .insert({
        org_id: orgId,
        deal_id: dealId,
        quote_id: c.quote_id ?? null,
        title: c.title,
        body: c.body,
        coverage: c.coverage,
        hours_per_week: c.hours_per_week ?? null,
        hourly_rate: c.hourly_rate ?? null,
        start_date: c.start_date || null,
        end_date: c.end_date || null,
        payment_terms: c.payment_terms ?? "",
        doc_kind: c.doc_kind ?? "text",
        template_path: c.template_path ?? null,
        template_layout: c.template_layout ?? null,
      })
      .select("id, number")
      .single();
    raise(error);
    return data as { id: string; number: number };
  },
  async updateContract(id: string, patch: Partial<CrmContract>) {
    const { error } = await db.from("crm_contracts").update(patch).eq("id", id);
    raise(error);
  },
  async saveSettings(s: CrmSettings) {
    const { error } = await db.from("crm_settings").upsert(
      {
        org_id: s.org_id,
        company_phone: s.company_phone,
        company_email: s.company_email.trim().toLowerCase(),
        company_address: s.company_address,
        default_rate: s.default_rate,
        payment_terms: s.payment_terms,
        quote_valid_days: s.quote_valid_days,
        sign_link_days: s.sign_link_days,
        quote_notes: s.quote_notes,
        contract_template: s.contract_template,
        countersign_name: s.countersign_name.trim(),
      },
      { onConflict: "org_id" },
    );
    raise(error);
  },
  /** Stores a new version of the organization's agreement PDF (older versions stay for contracts that use them). */
  async uploadAgreement(orgId: string, file: File, layout: unknown) {
    const path = `${orgId}/templates/${crypto.randomUUID()}.pdf`;
    const up = await supabase.storage.from("crm-documents").upload(path, file, { contentType: "application/pdf", upsert: false });
    raise(up.error);
    const { error } = await db.from("crm_settings").upsert(
      {
        org_id: orgId,
        agreement_pdf_path: path,
        agreement_pdf_name: file.name.slice(0, 200),
        agreement_layout: layout,
        agreement_uploaded_at: new Date().toISOString(),
      },
      { onConflict: "org_id" },
    );
    raise(error);
  },
  async clearAgreement(orgId: string) {
    const { error } = await db
      .from("crm_settings")
      .update({ agreement_pdf_path: null, agreement_pdf_name: "", agreement_layout: null, agreement_uploaded_at: null })
      .eq("org_id", orgId);
    raise(error);
  },
  /** Filled, unsigned copy of the agreement PDF exactly as the client will see it. */
  async previewAgreement(templatePath: string, body: string): Promise<Uint8Array> {
    const res = await callFunction<{ pdf_base64?: string }>("crm-send", { action: "preview", template_path: templatePath, body });
    if (!res?.pdf_base64) throw new Error("Couldn't build the preview.");
    return Uint8Array.from(atob(res.pdf_base64), (ch) => ch.charCodeAt(0));
  },
  async signedPdfUrl(path: string) {
    const { data, error } = await supabase.storage.from("crm-documents").createSignedUrl(path, 120, { download: true });
    raise(error);
    return data?.signedUrl ?? "";
  },
};
