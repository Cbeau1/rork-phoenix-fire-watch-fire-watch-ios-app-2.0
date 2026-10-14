import type { TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { supabase } from "@/lib/supabase";

import { NO_PERMS, type Perm, type WfPerms } from "./constants";

/** Turns a PostgREST/Postgres error into a readable message (our SQL raises user-facing text). */
export const wfError = (err: unknown): Error => {
  const e = err as { message?: string; code?: string } | null;
  const m = e?.message ?? "";
  if (e?.code === "42501" || /row-level security|permission denied/i.test(m)) {
    return new Error("You don't have permission to do that.");
  }
  if (e?.code === "23505") return new Error("That record already exists (duplicate).");
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return new Error("Network error — check your connection.");
  if (m && m.length < 220 && !/violates|syntax error|relation .* does not exist|column .* does not exist/i.test(m)) {
    return new Error(m);
  }
  return new Error("Something went wrong. Please try again.");
};

const unwrap = <T>(res: { data: T | null; error: unknown }): T => {
  if (res.error) throw wfError(res.error);
  return res.data as T;
};

const parsePerms = (raw: unknown): WfPerms => {
  const o = (raw ?? {}) as Partial<Record<Perm, unknown>>;
  return {
    manage: o.manage === true,
    personnel: o.personnel === true,
    pay: o.pay === true,
    documents: o.documents === true,
    finance: o.finance === true,
    purge: o.purge === true,
    admin: o.admin === true,
    expenses: o.expenses === true,
  };
};

/** First visit bootstraps settings + default checklists; returns the caller's verified permissions. */
export async function loadPermissions(): Promise<WfPerms> {
  const { data: ok, error } = await supabase.rpc("wf_has", { p: "manage" });
  if (error) throw wfError(error);
  if (ok !== true) return NO_PERMS;
  const res = await supabase.rpc("wf_ensure_setup");
  return parsePerms(unwrap(res));
}

export type TeamLink = { workerId: string; code: string; profileId: string };

/** Workforce profiles linked to Team logins. Returns null when the caller lacks Workforce access. */
export async function loadTeamLinks(): Promise<TeamLink[] | null> {
  const { data: ok, error } = await supabase.rpc("wf_has", { p: "manage" });
  if (error) throw wfError(error);
  if (ok !== true) return null;
  const rows = unwrap(
    await supabase.from("wf_workers").select("id, worker_code, profile_id").not("profile_id", "is", null),
  );
  return rows.map((r) => ({ workerId: r.id, code: r.worker_code, profileId: r.profile_id ?? "" }));
}

/** Creates (or re-links by email) the Workforce profile for a Team login. */
export async function linkTeamMember(profileId: string): Promise<string> {
  return unwrap(await supabase.rpc("wf_link_team_member", { p_profile: profileId }));
}

export const logEvent = async (
  action: "view" | "preview" | "download" | "export" | "print",
  entity: string,
  summary: string,
  opts: { entityId?: string | null; workerId?: string | null; perm?: Perm } = {},
): Promise<void> => {
  const { error } = await supabase.rpc("wf_log_event", {
    p_action: action,
    p_entity: entity,
    p_entity_id: opts.entityId ?? null,
    p_worker: opts.workerId ?? null,
    p_summary: summary,
    p_perm: opts.perm ?? "manage",
  });
  if (error) throw wfError(error);
};

/* ---------------- Workers ---------------- */

export const listWorkers = async () =>
  unwrap(await supabase.from("wf_workers").select("*").order("last_name").order("first_name"));

export const createWorker = async (row: TablesInsert<"wf_workers">) => {
  const w = unwrap(await supabase.from("wf_workers").insert(row).select("*").single());
  if (w.source === "direct") {
    unwrap(await supabase.rpc("wf_apply_checklist", { p_kind: "direct", p_worker: w.id }));
    unwrap(await supabase.from("wf_employment").insert({ worker_id: w.id, org_id: w.org_id, start_date: w.start_date }));
  }
  return w;
};

export const updateWorker = async (id: string, patch: TablesUpdate<"wf_workers">) =>
  unwrap(await supabase.from("wf_workers").update(patch).eq("id", id).select("*").single());

export const findDuplicates = async (first: string, last: string, email: string, phone: string, exclude?: string) =>
  unwrap(
    await supabase.rpc("wf_possible_duplicates", {
      p_first: first,
      p_last: last,
      p_email: email,
      p_phone: phone,
      p_exclude: exclude ?? null,
    }),
  ) ?? [];

/* ---------------- Agencies ---------------- */

export const listAgencies = async () => unwrap(await supabase.from("wf_agencies").select("*").order("name"));
export const saveAgency = async (id: string | null, row: TablesInsert<"wf_agencies">) =>
  id
    ? unwrap(await supabase.from("wf_agencies").update(row).eq("id", id).select("*").single())
    : unwrap(await supabase.from("wf_agencies").insert(row).select("*").single());

/* ---------------- Employment & pay ---------------- */

export const getEmployment = async (workerId: string) =>
  unwrap(await supabase.from("wf_employment").select("*").eq("worker_id", workerId).maybeSingle());

export const saveEmployment = async (workerId: string, orgId: string, patch: TablesUpdate<"wf_employment">) =>
  unwrap(
    await supabase
      .from("wf_employment")
      .upsert({ worker_id: workerId, org_id: orgId, ...patch }, { onConflict: "worker_id" })
      .select("*")
      .single(),
  );

export const listPay = async (workerId: string) => unwrap(await supabase.rpc("wf_pay_list", { p_worker: workerId })) ?? [];
export const addPay = async (workerId: string, rate: number, effective: string, note: string) =>
  unwrap(await supabase.rpc("wf_pay_add", { p_worker: workerId, p_rate: rate, p_effective: effective, p_note: note }));

/* ---------------- Placements ---------------- */

export const listPlacements = async () =>
  unwrap(await supabase.from("wf_placements").select("*").order("start_date", { ascending: false }));

export const createPlacement = async (row: TablesInsert<"wf_placements">) => {
  const p = unwrap(await supabase.from("wf_placements").insert(row).select("*").single());
  unwrap(await supabase.rpc("wf_apply_checklist", { p_kind: "placement", p_worker: p.worker_id, p_placement: p.id }));
  return p;
};

export const updatePlacement = async (id: string, patch: TablesUpdate<"wf_placements">) =>
  unwrap(await supabase.from("wf_placements").update(patch).eq("id", id).select("*").single());

export const listPlacementRates = async () =>
  unwrap(await supabase.from("wf_placement_rates").select("*").order("effective_date", { ascending: false }));
export const addPlacementRate = async (row: TablesInsert<"wf_placement_rates">) =>
  unwrap(await supabase.from("wf_placement_rates").insert(row).select("*").single());

export const listHours = async () =>
  unwrap(await supabase.from("wf_placement_hours").select("*").order("work_date", { ascending: false }));
export const addHours = async (rows: TablesInsert<"wf_placement_hours">[]) =>
  unwrap(await supabase.from("wf_placement_hours").insert(rows).select("*"));
export const deleteHours = async (id: string) => {
  unwrap(await supabase.from("wf_placement_hours").delete().eq("id", id).select("id"));
};

/* ---------------- Checklists & templates ---------------- */

export const listChecklist = async () =>
  unwrap(await supabase.from("wf_checklist_items").select("*").order("sort").order("created_at"));
export const updateChecklistItem = async (id: string, patch: TablesUpdate<"wf_checklist_items">) =>
  unwrap(await supabase.from("wf_checklist_items").update(patch).eq("id", id).select("*").single());
export const addChecklistItem = async (row: TablesInsert<"wf_checklist_items">) =>
  unwrap(await supabase.from("wf_checklist_items").insert(row).select("*").single());
export const applyChecklist = async (kind: string, workerId: string, placementId?: string) =>
  unwrap(await supabase.rpc("wf_apply_checklist", { p_kind: kind, p_worker: workerId, p_placement: placementId ?? null }));

export const listTemplates = async () =>
  unwrap(await supabase.from("wf_requirement_templates").select("*").order("applies_to").order("sort"));
export const saveTemplate = async (id: string | null, row: TablesInsert<"wf_requirement_templates">) =>
  id
    ? unwrap(await supabase.from("wf_requirement_templates").update(row).eq("id", id).select("*").single())
    : unwrap(await supabase.from("wf_requirement_templates").insert(row).select("*").single());
export const applyTemplateChanges = async (kind: string) =>
  unwrap(await supabase.rpc("wf_apply_template_changes", { p_kind: kind })) as { added: number; updated: number };

/* ---------------- Equipment ---------------- */

export const listEquipment = async () =>
  unwrap(await supabase.from("wf_equipment").select("*").order("issued_on", { ascending: false }));
export const saveEquipment = async (id: string | null, row: TablesInsert<"wf_equipment">) =>
  id
    ? unwrap(await supabase.from("wf_equipment").update(row).eq("id", id).select("*").single())
    : unwrap(await supabase.from("wf_equipment").insert(row).select("*").single());

/* ---------------- Personnel (restricted) ---------------- */

export const listPersonnel = async (workerId: string) =>
  unwrap(await supabase.rpc("wf_personnel_list", { p_worker: workerId })) ?? [];
export const savePersonnel = async (id: string | null, payload: Record<string, unknown>) =>
  unwrap(await supabase.rpc("wf_personnel_save", { p_id: id, p: payload as never }));
export const reopenPersonnel = async (id: string, reason: string) =>
  unwrap(await supabase.rpc("wf_personnel_reopen", { p_id: id, p_reason: reason }));
export const personnelHistory = async (id: string) =>
  unwrap(await supabase.rpc("wf_personnel_history", { p_id: id })) ?? [];
export const listFollowups = async () => unwrap(await supabase.rpc("wf_followups")) ?? [];

export interface RestrictionReview {
  id: string;
  decision: string;
  note: string;
  reviewedAt: string;
  reviewedBy: string | null;
}
export interface Restriction {
  id: string;
  reason: string;
  status: "active" | "lifted";
  createdAt: string;
  createdBy: string | null;
  liftedAt: string | null;
  liftedBy: string | null;
  reviews: RestrictionReview[];
}
export const listRestrictions = async (workerId: string): Promise<Restriction[]> =>
  (unwrap(await supabase.rpc("wf_restrictions_list", { p_worker: workerId })) as unknown as Restriction[]) ?? [];
export const addRestriction = async (workerId: string, reason: string) =>
  unwrap(await supabase.rpc("wf_restriction_add", { p_worker: workerId, p_reason: reason }));
export const reviewRestriction = async (id: string, decision: string, note: string, newStatus?: string) =>
  unwrap(
    await supabase.rpc("wf_restriction_review", {
      p_id: id,
      p_decision: decision,
      p_note: note,
      p_new_status: newStatus ?? null,
    }),
  );

/* ---------------- Documents ---------------- */

export const listDocuments = async () =>
  unwrap(await supabase.from("wf_documents").select("*").order("created_at", { ascending: false }));
export const listVersions = async () =>
  unwrap(await supabase.from("wf_document_versions").select("*").order("version", { ascending: false }));
export const updateDocument = async (id: string, patch: TablesUpdate<"wf_documents">) =>
  unwrap(await supabase.from("wf_documents").update(patch).eq("id", id).select("*").single());
export const reviewDocument = async (versionId: string, status: string, notes: string) =>
  unwrap(await supabase.rpc("wf_review_document", { p_version: versionId, p_status: status, p_notes: notes }));

/** Calls the private-files server function with a multipart body. */
async function invokeForm<T>(form: FormData): Promise<T> {
  const { data, error } = await supabase.functions.invoke("workforce-files", { body: form });
  if (error) {
    let message = "Upload failed. Please try again.";
    const ctx = (error as { context?: unknown }).context;
    if (ctx instanceof Response) {
      try {
        const payload = (await ctx.json()) as { error?: string };
        if (payload.error) message = payload.error;
      } catch {
        // not JSON
      }
    }
    throw new Error(message);
  }
  return data as T;
}

async function invokeJson<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("workforce-files", { body });
  if (error) {
    let message = "Something went wrong. Please try again.";
    const ctx = (error as { context?: unknown }).context;
    if (ctx instanceof Response) {
      try {
        const payload = (await ctx.json()) as { error?: string };
        if (payload.error) message = payload.error;
      } catch {
        // not JSON
      }
    }
    throw new Error(message);
  }
  return data as T;
}

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ACCEPT_FILES = "application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png";

export const checkFile = (file: File): string | null => {
  if (file.size > MAX_UPLOAD_BYTES) return "Files must be 10 MB or smaller.";
  if (!/\.(pdf|jpe?g|png)$/i.test(file.name) && !/^(application\/pdf|image\/(jpeg|png))$/.test(file.type)) {
    return "Only PDF, JPG and PNG files are allowed.";
  }
  return null;
};

/**
 * Prepares a phone photo for upload: re-encodes large or non-JPG/PNG images (e.g. HEIC where the
 * browser can decode it) as a JPEG of at most 2400 px, so daily paperwork photos stay well under
 * the 10 MB limit and remain sharp enough to read. Anything else is returned unchanged.
 */
export const prepareUpload = async (file: File): Promise<File> => {
  const isImage = file.type.startsWith("image/") || /\.(heic|heif|webp)$/i.test(file.name);
  const plain = /^image\/(jpeg|png)$/.test(file.type);
  if (!isImage || (plain && file.size <= 3 * 1024 * 1024)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
    if (!blob) return file;
    const base = file.name.replace(/\.[^.]+$/, "") || "photo";
    return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
  }
};

export interface UploadInput {
  file: File;
  documentId?: string;
  ownerType?: "worker" | "agency" | "placement" | "invoice" | "personnel";
  ownerId?: string;
  category?: string;
  title?: string;
  issueDate?: string;
  expirationDate?: string;
  classification?: string;
  signed?: boolean;
  /** Payroll shift (time entry) this paperwork belongs to, e.g. a daily agency time ticket. */
  timeEntryId?: string;
}

export const uploadDocument = (input: UploadInput) => {
  const form = new FormData();
  form.set("action", "upload-document");
  form.set("file", input.file);
  if (input.documentId) form.set("documentId", input.documentId);
  form.set("ownerType", input.ownerType ?? "");
  form.set("ownerId", input.ownerId ?? "");
  form.set("category", input.category ?? "");
  form.set("title", input.title ?? "");
  form.set("issueDate", input.issueDate ?? "");
  form.set("expirationDate", input.expirationDate ?? "");
  form.set("classification", input.classification ?? "standard");
  form.set("signed", input.signed ? "true" : "false");
  if (input.timeEntryId) form.set("timeEntryId", input.timeEntryId);
  return invokeForm<{ ok: boolean; documentId: string; versionId: string; version: number }>(form);
};

export const uploadWorkerPhoto = (workerId: string, file: File) => {
  const form = new FormData();
  form.set("action", "upload-photo");
  form.set("workerId", workerId);
  form.set("file", file);
  return invokeForm<{ ok: boolean }>(form);
};

/** Short-lived (60s) signed URL. Never stored or cached. */
export const documentUrl = async (versionId: string, mode: "preview" | "download") =>
  (await invokeJson<{ ok: boolean; url: string }>({ action: "document-url", versionId, mode })).url;

export const photoUrls = async (workerIds: string[]) =>
  (await invokeJson<{ ok: boolean; urls: Record<string, string> }>({ action: "photo-urls", workerIds })).urls;

export const purgeWorker = (id: string, confirm: string) => invokeJson<{ ok: boolean }>({ action: "purge-worker", id, confirm });
export const purgeDocument = (id: string) => invokeJson<{ ok: boolean }>({ action: "purge-document", id, confirm: true });

/* ---------------- Invoices ---------------- */

export const listInvoices = async () =>
  unwrap(await supabase.from("wf_invoices").select("*").order("invoice_date", { ascending: false, nullsFirst: false }));
export const saveInvoice = async (id: string | null, row: TablesInsert<"wf_invoices">) =>
  id
    ? unwrap(await supabase.from("wf_invoices").update(row).eq("id", id).select("*").single())
    : unwrap(await supabase.from("wf_invoices").insert(row).select("*").single());
export const listInvoiceLines = async () =>
  unwrap(await supabase.from("wf_invoice_lines").select("*").order("service_start").order("created_at"));
export const saveInvoiceLine = async (id: string | null, row: TablesInsert<"wf_invoice_lines">) =>
  id
    ? unwrap(await supabase.from("wf_invoice_lines").update(row).eq("id", id).select("*").single())
    : unwrap(await supabase.from("wf_invoice_lines").insert(row).select("*").single());
export const deleteInvoiceLine = async (id: string) => {
  unwrap(await supabase.from("wf_invoice_lines").delete().eq("id", id).select("id"));
};

/* ---------------- Reminders, settings, audit, permissions ---------------- */

export const refreshReminders = async () => {
  unwrap(await supabase.rpc("wf_refresh_reminders"));
  return unwrap(await supabase.from("wf_reminders").select("*").order("due_date", { ascending: true, nullsFirst: false }));
};
export const reminderAction = async (id: string, action: "assign" | "resolve" | "dismiss" | "reopen", note = "", assignee: string | null = null) =>
  unwrap(await supabase.rpc("wf_reminder_action", { p_id: id, p_action: action, p_note: note, p_assignee: assignee }));

export const getSettings = async () => unwrap(await supabase.from("wf_settings").select("*").maybeSingle());
export const saveSettings = async (orgId: string, patch: TablesUpdate<"wf_settings">) =>
  unwrap(await supabase.from("wf_settings").update(patch).eq("org_id", orgId).select("*").single());

export const listAudit = async (opts: { workerId?: string; limit?: number } = {}) => {
  let q = supabase.from("wf_audit_log").select("*").order("created_at", { ascending: false }).limit(opts.limit ?? 300);
  if (opts.workerId) q = q.eq("worker_id", opts.workerId);
  return unwrap(await q);
};

export interface RosterRow extends WfPerms {
  profileId: string;
  name: string;
  email: string;
}
export const permissionRoster = async (): Promise<RosterRow[]> =>
  (unwrap(await supabase.rpc("wf_permission_roster")) as unknown as RosterRow[]) ?? [];
export const setPermissions = async (profileId: string, perms: WfPerms) =>
  unwrap(await supabase.rpc("wf_set_permissions", { p_profile: profileId, p: perms as never }));

/* ---------------- Existing app records (read-only reuse) ---------------- */

export const listMembers = async () =>
  unwrap(await supabase.from("profiles").select("id, full_name, email, role, active").order("full_name"));
export const listStaff = async () => unwrap(await supabase.from("staff").select("*").order("name"));
export const listShifts = async () =>
  unwrap(
    await supabase
      .from("shifts")
      .select("id, staff_id, property_id, shift_date, start_time, end_time, notes")
      .order("shift_date", { ascending: false }),
  );
