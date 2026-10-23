import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Download, Eye, FileText, Image as ImageIcon, Loader2, Pencil, ScrollText, Trash2, Upload, X } from "lucide-react";
import { memo, useMemo, useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";

import { AreaField, ConfirmDialog, FormDialog, TextField } from "@/components/workforce/kit";
import { Button } from "@/components/ui/button";
import {
  deletePaperLog,
  extOf,
  fileProblem,
  fmtSize,
  isImage,
  isPdf,
  PAPER_LOG_ACCEPT,
  paperLogThumbs,
  paperLogUrl,
  updatePaperLog,
  uploadPaperLog,
  useInvalidatePaperLogs,
  usePaperLogs,
  type PaperLog,
} from "@/lib/paperLogs";
import { friendlyError } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useAuth } from "@/state/AuthProvider";

const today = (): string => format(new Date(), "yyyy-MM-dd");
const VISIBLE = 8;

const fmtLogDate = (d: string): string => {
  try {
    return format(parseISO(d), "EEE, MMM d, yyyy");
  } catch {
    return d;
  }
};

/** Opens a signed link in a new tab. The tab is opened first so pop-up blockers allow it. */
const openSigned = async (path: string, download?: string) => {
  const win = download ? null : window.open("", "_blank");
  try {
    const url = await paperLogUrl(path, download);
    if (win) win.location.href = url;
    else if (download) window.location.href = url;
    else window.open(url, "_blank", "noopener");
  } catch (e) {
    win?.close();
    toast.error("Couldn't open the file", { description: friendlyError(e) });
  }
};

// ─── Upload dialog ──────────────────────────────────────────────────────────

const UploadDialog = ({
  open,
  onOpenChange,
  propertyId,
  initial,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  propertyId: string;
  initial: File[];
}) => {
  const { user } = useAuth();
  const invalidate = useInvalidatePaperLogs(propertyId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>(initial);
  const [logDate, setLogDate] = useState<string>(today());
  const [note, setNote] = useState<string>("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [dateError, setDateError] = useState<string>("");

  const addFiles = (list: FileList | File[] | null) => {
    if (!list) return;
    const incoming = Array.from(list);
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}:${f.size}`));
      return [...prev, ...incoming.filter((f) => !seen.has(`${f.name}:${f.size}`))].slice(0, 30);
    });
  };

  const valid = files.filter((f) => !fileProblem(f));

  const submit = async () => {
    if (!user?.orgId) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(logDate)) {
      setDateError("Enter the date the log covers");
      return;
    }
    if (logDate > today()) {
      setDateError("The log date can't be in the future");
      return;
    }
    setDateError("");
    if (valid.length === 0) {
      toast.error(files.length ? "None of these files can be uploaded" : "Choose at least one file");
      return;
    }
    setProgress({ done: 0, total: valid.length });
    const failed: File[] = [];
    let lastError: unknown = null;
    for (const [i, f] of valid.entries()) {
      try {
        await uploadPaperLog(user.orgId, propertyId, f, logDate, note);
      } catch (e) {
        failed.push(f);
        lastError = e;
      }
      setProgress({ done: i + 1, total: valid.length });
    }
    void invalidate();
    setProgress(null);
    const ok = valid.length - failed.length;
    if (failed.length === 0) {
      toast.success(ok === 1 ? "Paper log saved" : `${ok} paper log files saved`, { description: fmtLogDate(logDate) });
      onOpenChange(false);
    } else {
      setFiles(failed);
      toast.error(`${failed.length} of ${valid.length} didn't upload`, {
        description: `${friendlyError(lastError).replace(/[.!]?\s*$/, ".")} The ones that failed are still listed. Try again.`,
      });
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={(v) => !progress && onOpenChange(v)}
      title="Upload paper logs"
      description="Scans or phone photos of the handwritten fire watch log. Originals are kept exactly as uploaded."
      dirty={files.length > 0 || note.trim() !== ""}
      saving={!!progress}
      onSubmit={() => void submit()}
      submitLabel={
        progress
          ? `Uploading ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
          : valid.length > 1
            ? `Upload ${valid.length} files`
            : "Upload"
      }
    >
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          addFiles(e.dataTransfer.files);
        }}
        className="rounded-lg border border-dashed border-line-strong bg-raised/50 p-4"
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={PAPER_LOG_ACCEPT}
          className="sr-only"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        {files.length === 0 ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="focus-ring flex w-full flex-col items-center gap-2 rounded-lg py-6 text-center"
          >
            <Upload className="h-7 w-7 text-link" strokeWidth={1.6} />
            <span className="text-[15px] font-semibold text-ink">Choose files or drop them here</span>
            <span className="text-xs text-ink-3">PDF, JPG, PNG or HEIC · up to 25 MB each · several pages at once is fine</span>
          </button>
        ) : (
          <>
            <ul className="space-y-1.5">
              {files.map((f) => {
                const problem = fileProblem(f);
                return (
                  <li key={`${f.name}:${f.size}`} className="flex items-center gap-3 rounded-md bg-surface px-3 py-2">
                    {extOf(f.name) === "pdf" ? (
                      <FileText className="h-4 w-4 shrink-0 text-ink-3" />
                    ) : (
                      <ImageIcon className="h-4 w-4 shrink-0 text-ink-3" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{f.name}</span>
                    {problem ? (
                      <span className="shrink-0 text-xs font-medium text-status-incident-ink">{problem}</span>
                    ) : (
                      <span className="shrink-0 font-mono text-xs text-ink-3">{fmtSize(f.size)}</span>
                    )}
                    <button
                      type="button"
                      aria-label={`Remove ${f.name}`}
                      disabled={!!progress}
                      onClick={() => setFiles((prev) => prev.filter((x) => x !== f))}
                      className="focus-ring rounded p-1 text-ink-3 hover:text-ink disabled:opacity-40"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                );
              })}
            </ul>
            <Button type="button" variant="ghost" size="sm" className="mt-2" disabled={!!progress} onClick={() => inputRef.current?.click()}>
              <Upload />
              Add more
            </Button>
          </>
        )}
      </div>
      <TextField
        label="Date the log covers"
        type="date"
        value={logDate}
        onChange={(v) => {
          setLogDate(v);
          setDateError("");
        }}
        required
        error={dateError}
        hint="For an overnight sheet, use the date the shift started."
        className="sm:max-w-[240px]"
        disabled={!!progress}
      />
      <AreaField
        label="Note (optional)"
        value={note}
        onChange={setNote}
        rows={2}
        placeholder="e.g. Night shift, pages 1–3, officer J. Smith"
        disabled={!!progress}
      />
    </FormDialog>
  );
};

// ─── Edit dialog ────────────────────────────────────────────────────────────

const EditDialog = ({ log, onClose }: { log: PaperLog; onClose: () => void }) => {
  const invalidate = useInvalidatePaperLogs(log.property_id);
  const [logDate, setLogDate] = useState<string>(log.log_date);
  const [note, setNote] = useState<string>(log.note);
  const [saving, setSaving] = useState<boolean>(false);
  const [dateError, setDateError] = useState<string>("");

  const save = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(logDate)) return setDateError("Enter the date the log covers");
    if (logDate > today()) return setDateError("The log date can't be in the future");
    setSaving(true);
    try {
      await updatePaperLog(log.id, logDate, note);
      void invalidate();
      toast.success("Paper log updated");
      onClose();
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormDialog
      open
      onOpenChange={(v) => !v && onClose()}
      title="Edit paper log"
      description={log.file_name}
      dirty={logDate !== log.log_date || note !== log.note}
      saving={saving}
      onSubmit={() => void save()}
    >
      <TextField
        label="Date the log covers"
        type="date"
        value={logDate}
        onChange={(v) => {
          setLogDate(v);
          setDateError("");
        }}
        required
        error={dateError}
        className="sm:max-w-[240px]"
      />
      <AreaField label="Note (optional)" value={note} onChange={setNote} rows={2} />
    </FormDialog>
  );
};

// ─── Card ───────────────────────────────────────────────────────────────────

const Thumb = ({ log, url }: { log: PaperLog; url?: string }) =>
  url && isImage(log) ? (
    <img src={url} alt="" loading="lazy" className="h-14 w-14 shrink-0 rounded-md border border-line object-cover" />
  ) : (
    <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center gap-0.5 rounded-md border border-line bg-raised">
      {isPdf(log) ? <FileText className="h-5 w-5 text-link" strokeWidth={1.6} /> : <ImageIcon className="h-5 w-5 text-link" strokeWidth={1.6} />}
      <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">{extOf(log.file_name) || "file"}</span>
    </div>
  );

/** Scans / photos of paper fire watch logs, stored with the property as a backup. Admin only. */
export const PaperLogsCard = memo(({ propertyId }: { propertyId: string }) => {
  const { data: logs = [], isLoading, error, refetch } = usePaperLogs(propertyId, true);
  const invalidate = useInvalidatePaperLogs(propertyId);
  const pickRef = useRef<HTMLInputElement>(null);
  const [uploadFiles, setUploadFiles] = useState<File[] | null>(null);
  const [editing, setEditing] = useState<PaperLog | null>(null);
  const [removing, setRemoving] = useState<PaperLog | null>(null);
  const [deleting, setDeleting] = useState<boolean>(false);
  const [dragging, setDragging] = useState<boolean>(false);
  const [showAll, setShowAll] = useState<boolean>(false);

  const imagePaths = useMemo(() => logs.filter(isImage).map((l) => l.file_path), [logs]);
  const { data: thumbs = {} } = useQuery({
    queryKey: ["paper-log-thumbs", propertyId, imagePaths],
    queryFn: () => paperLogThumbs(imagePaths),
    enabled: imagePaths.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const visible = showAll ? logs : logs.slice(0, VISIBLE);
  const days = new Set(logs.map((l) => l.log_date)).size;

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) setUploadFiles(Array.from(e.dataTransfer.files));
  };

  const confirmDelete = async () => {
    if (!removing) return;
    setDeleting(true);
    try {
      await deletePaperLog(removing.id);
      void invalidate();
      toast.success("Paper log deleted");
      setRemoving(null);
    } catch (e) {
      toast.error(friendlyError(e, "Couldn't delete the paper log"));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={onDrop}
      className={cn(
        "mt-5 rounded-xl border bg-surface shadow-card transition-colors",
        dragging ? "border-link ring-2 ring-link/30" : "border-line",
      )}
    >
      <input
        ref={pickRef}
        type="file"
        multiple
        accept={PAPER_LOG_ACCEPT}
        className="sr-only"
        onChange={(e) => {
          if (e.target.files?.length) setUploadFiles(Array.from(e.target.files));
          e.target.value = "";
        }}
      />
      <div className="flex flex-col gap-4 px-6 pt-6 sm:flex-row sm:items-start sm:justify-between sm:px-7">
        <div className="flex min-w-0 items-start gap-4">
          <ScrollText className="mt-0.5 h-8 w-8 shrink-0 text-link" strokeWidth={1.6} />
          <div className="min-w-0">
            <h2 className="font-display text-xl font-bold text-ink sm:text-[22px]">Paper Logs</h2>
            <p className="mt-1 text-sm text-ink-2">
              Scans or photos of handwritten fire watch logs, kept with this property as a backup.
              {logs.length > 0 && (
                <span className="text-ink-3">
                  {" "}
                  · {logs.length} {logs.length === 1 ? "file" : "files"} across {days} {days === 1 ? "day" : "days"}
                </span>
              )}
            </p>
          </div>
        </div>
        <Button onClick={() => pickRef.current?.click()} className="shrink-0">
          <Upload />
          Upload Paper Log
        </Button>
      </div>

      <div className="px-6 pb-6 pt-5 sm:px-7">
        {isLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-ink-3">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading paper logs…
          </div>
        ) : error ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-status-incident/40 bg-status-incident/10 px-4 py-3 text-sm text-status-incident-ink">
            {friendlyError(error, "Couldn't load paper logs")}
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              Retry
            </Button>
          </div>
        ) : logs.length === 0 ? (
          <button
            type="button"
            onClick={() => pickRef.current?.click()}
            className={cn(
              "focus-ring flex w-full flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center transition-colors",
              dragging ? "border-link bg-link/5" : "border-line-strong bg-raised/40 hover:border-link",
            )}
          >
            <Upload className="h-7 w-7 text-ink-3" strokeWidth={1.6} />
            <span className="text-[15px] font-semibold text-ink">No paper logs yet</span>
            <span className="text-sm text-ink-3">Drop scans or photos here, or click to choose files. PDF, JPG, PNG or HEIC, up to 25 MB each.</span>
          </button>
        ) : (
          <>
            <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
              {visible.map((l) => (
                <li key={l.id} className="flex flex-col gap-3 bg-surface px-4 py-3 sm:flex-row sm:items-center">
                  <button
                    type="button"
                    onClick={() => void openSigned(l.file_path)}
                    className="focus-ring flex min-w-0 flex-1 items-center gap-4 rounded-md text-left"
                    title="Open the original"
                  >
                    <Thumb log={l} url={thumbs[l.file_path]} />
                    <div className="min-w-0">
                      <div className="text-[15px] font-semibold text-ink">{fmtLogDate(l.log_date)}</div>
                      <div className="truncate text-sm text-ink-2">
                        {l.file_name} <span className="font-mono text-xs text-ink-3">· {fmtSize(l.size_bytes)}</span>
                      </div>
                      {l.note && <div className="mt-0.5 line-clamp-2 text-sm text-ink">{l.note}</div>}
                      <div className="mt-0.5 text-xs text-ink-3">
                        Uploaded by {l.uploaded_by_name} · {format(parseISO(l.created_at), "MMM d, yyyy · h:mm a")}
                      </div>
                    </div>
                  </button>
                  <div className="flex shrink-0 items-center gap-1 self-end sm:self-center">
                    <Button variant="ghost" size="sm" onClick={() => void openSigned(l.file_path)} aria-label={`View ${l.file_name}`}>
                      <Eye />
                      <span className="hidden md:inline">View</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => void openSigned(l.file_path, l.file_name)}
                      aria-label={`Download ${l.file_name}`}
                      title="Download"
                    >
                      <Download />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setEditing(l)} aria-label="Edit date or note" title="Edit date or note">
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setRemoving(l)}
                      aria-label={`Delete ${l.file_name}`}
                      title="Delete"
                      className="text-ink-3 hover:text-status-incident-ink"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            {logs.length > VISIBLE && (
              <Button variant="ghost" size="sm" className="mt-3" onClick={() => setShowAll((v) => !v)}>
                {showAll ? "Show fewer" : `Show all ${logs.length}`}
              </Button>
            )}
            <p className="mt-3 text-xs text-ink-3">Tip: drag files onto this card to upload them.</p>
          </>
        )}
      </div>

      {uploadFiles && (
        <UploadDialog
          key={uploadFiles.map((f) => f.name).join("|")}
          open
          onOpenChange={(v) => !v && setUploadFiles(null)}
          propertyId={propertyId}
          initial={uploadFiles}
        />
      )}
      {editing && <EditDialog log={editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(v) => !v && !deleting && setRemoving(null)}
        title="Delete this paper log?"
        description={removing ? `${removing.file_name} (${fmtLogDate(removing.log_date)}) will be permanently removed. This can't be undone.` : undefined}
        confirmLabel="Delete"
        destructive
        busy={deleting}
        onConfirm={() => void confirmDelete()}
      />
    </section>
  );
});
PaperLogsCard.displayName = "PaperLogsCard";
