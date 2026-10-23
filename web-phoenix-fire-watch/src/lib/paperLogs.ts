import { useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";

/** A scanned or photographed paper fire watch log kept with a property as a backup. */
export interface PaperLog {
  id: string;
  property_id: string;
  /** The day the paper log covers, yyyy-MM-dd. */
  log_date: string;
  note: string;
  file_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  uploaded_by_name: string;
}

const BUCKET = "crm-documents";
export const MAX_PAPER_LOG_BYTES = 25 * 1024 * 1024;
export const PAPER_LOG_ACCEPT = "application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.pdf,.jpg,.jpeg,.png,.webp,.heic,.heif";
const EXTENSIONS = ["pdf", "jpg", "jpeg", "png", "webp", "heic", "heif"];

export const paperLogsKey = (propertyId: string) => ["paper-logs", propertyId] as const;

export const extOf = (name: string): string => name.split(".").pop()?.toLowerCase() ?? "";
export const isImage = (l: Pick<PaperLog, "file_name" | "mime_type">): boolean =>
  ["jpg", "jpeg", "png", "webp"].includes(extOf(l.file_name)) || /^image\/(jpeg|png|webp)$/.test(l.mime_type);
export const isPdf = (l: Pick<PaperLog, "file_name" | "mime_type">): boolean => extOf(l.file_name) === "pdf" || l.mime_type === "application/pdf";

/** Returns a reason the file can't be uploaded, or null when it's fine. */
export const fileProblem = (f: File): string | null => {
  if (!EXTENSIONS.includes(extOf(f.name))) return "Only PDF, JPG, PNG, WEBP or HEIC files";
  if (f.size > MAX_PAPER_LOG_BYTES) return "Larger than 25 MB";
  if (f.size === 0) return "The file is empty";
  return null;
};

export const fmtSize = (b: number): string =>
  b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;

export const usePaperLogs = (propertyId: string, enabled: boolean) =>
  useQuery({
    queryKey: paperLogsKey(propertyId),
    enabled,
    queryFn: async (): Promise<PaperLog[]> => {
      const { data, error } = await supabase.rpc("paper_logs", { p_property: propertyId });
      if (error) throw error;
      return ((data ?? []) as unknown as PaperLog[]).map((l) => ({ ...l, size_bytes: Number(l.size_bytes) || 0 }));
    },
  });

export const useInvalidatePaperLogs = (propertyId: string) => {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: paperLogsKey(propertyId) });
};

const contentType = (f: File): string => {
  if (f.type) return f.type;
  const e = extOf(f.name);
  if (e === "pdf") return "application/pdf";
  if (e === "jpg" || e === "jpeg") return "image/jpeg";
  return `image/${e}`;
};

/** Uploads one file and records it. Removes the file again if the record can't be saved. */
export async function uploadPaperLog(orgId: string, propertyId: string, file: File, logDate: string, note: string): Promise<void> {
  const ext = extOf(file.name);
  const path = `${orgId}/paper-logs/${propertyId}/${crypto.randomUUID()}.${ext}`;
  const type = contentType(file);
  const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: type, upsert: false });
  if (up.error) throw up.error;
  const { error } = await supabase.rpc("paper_log_add", {
    p_property: propertyId,
    p_date: logDate,
    p_note: note,
    p_path: path,
    p_name: file.name.slice(0, 200),
    p_mime: type,
    p_size: file.size,
  });
  if (error) {
    void supabase.storage.from(BUCKET).remove([path]);
    throw error;
  }
}

export async function updatePaperLog(id: string, logDate: string, note: string): Promise<void> {
  const { error } = await supabase.rpc("paper_log_update", { p_id: id, p_date: logDate, p_note: note });
  if (error) throw error;
}

export async function deletePaperLog(id: string): Promise<void> {
  const { data, error } = await supabase.rpc("paper_log_delete", { p_id: id });
  if (error) throw error;
  const path = data as unknown as string | null;
  if (path) await supabase.storage.from(BUCKET).remove([path]);
}

/** Short-lived link to view (or download) the original file. */
export async function paperLogUrl(path: string, download?: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300, download ? { download } : undefined);
  if (error) throw error;
  return data.signedUrl;
}

export async function paperLogThumbs(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 600);
  if (error) throw error;
  const out: Record<string, string> = {};
  for (const r of data ?? []) if (r.path && r.signedUrl) out[r.path] = r.signedUrl;
  return out;
}
