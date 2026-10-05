import { useMutation } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  CheckCircle2,
  Download,
  Eye,
  FileText,
  History,
  Loader2,
  Lock,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import * as api from "@/lib/workforce/api";
import {
  AGENCY_DOC_CATEGORIES,
  AGENCY_ONLY_CATEGORIES,
  CLASSIFICATION,
  DIRECT_ONLY_CATEGORIES,
  DOC_CATEGORY_LABEL,
  FINANCIAL_CATEGORIES,
  RESTRICTED_CATEGORIES,
  REVIEW_STATUS,
  WORKER_DOC_CATEGORIES,
  type DocVersion,
  type WfDocument,
} from "@/lib/workforce/constants";
import { cn } from "@/lib/utils";
import { useWorkforce } from "@/state/WorkforceProvider";

import {
  AreaField,
  CheckField,
  ConfirmDialog,
  Empty,
  fmtDate,
  fmtDateTime,
  FormDialog,
  MetaPill,
  Pill,
  SelectField,
  TextField,
} from "./kit";

type OwnerType = "worker" | "agency" | "placement" | "invoice" | "personnel";

const categoriesFor = (owner: OwnerType, source?: string): Record<string, string> => {
  if (owner === "agency") return AGENCY_DOC_CATEGORIES;
  if (owner === "invoice") return { invoice: "Invoice" };
  if (owner === "placement") return { placement_confirmation: "Agency placement confirmation", other: "Other" };
  if (owner === "personnel") return { other: "Personnel attachment" };
  return Object.fromEntries(
    Object.entries(WORKER_DOC_CATEGORIES).filter(([k]) =>
      source === "agency" ? !DIRECT_ONLY_CATEGORIES.has(k) : !AGENCY_ONLY_CATEGORIES.has(k),
    ),
  );
};

/** Upload a new document, or a new version of an existing one (previous versions are always kept). */
export const UploadDialog = ({
  open,
  onOpenChange,
  ownerType,
  ownerId,
  source,
  replace,
  defaultCategory,
  onUploaded,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ownerType: OwnerType;
  ownerId: string;
  source?: string;
  replace?: WfDocument | null;
  defaultCategory?: string;
  onUploaded?: (documentId: string) => void;
}) => {
  const wf = useWorkforce();
  const cats = categoriesFor(ownerType, source);
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState<string>("");
  const [category, setCategory] = useState<string>("");
  const [issue, setIssue] = useState<string>("");
  const [exp, setExp] = useState<string>("");
  const [restricted, setRestricted] = useState<boolean>(false);
  const [signed, setSigned] = useState<boolean>(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setTitle("");
    setCategory(defaultCategory ?? (Object.keys(cats).length === 1 ? (Object.keys(cats)[0] ?? "") : ""));
    setIssue("");
    setExp(replace?.expiration_date ?? "");
    setRestricted(false);
    setSigned(false);
    setErrors({});
    if (fileRef.current) fileRef.current.value = "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, replace, defaultCategory]);

  const forcedRestricted = RESTRICTED_CATEGORIES.has(category) || ownerType === "personnel";
  const forcedFinancial = FINANCIAL_CATEGORIES.has(category) || ownerType === "invoice";
  const needsPerm = forcedRestricted
    ? ownerType === "personnel"
      ? wf.perms.personnel
      : wf.perms.documents
    : forcedFinancial
      ? wf.perms.finance
      : restricted
        ? wf.perms.documents
        : true;

  const upload = useMutation({
    mutationFn: () =>
      api.uploadDocument({
        file: file as File,
        documentId: replace?.id,
        ownerType,
        ownerId,
        category,
        title: title.trim(),
        issueDate: issue,
        expirationDate: exp,
        classification: restricted ? "restricted" : "standard",
        signed,
      }),
    onSuccess: (res) => {
      wf.invalidate("documents", "versions", "placements");
      toast.success(replace ? `Version ${res.version} uploaded — previous version kept` : "Document uploaded");
      onUploaded?.(res.documentId);
      onOpenChange(false);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Upload failed."),
  });

  const submit = () => {
    const e: Record<string, string> = {};
    if (!file) e.file = "Choose a PDF, JPG or PNG file.";
    else {
      const bad = api.checkFile(file);
      if (bad) e.file = bad;
    }
    if (!replace) {
      if (!title.trim()) e.title = "Title is required.";
      if (!category) e.category = "Choose a category.";
    }
    if (exp && issue && exp < issue) e.exp = "Expiration must be after the issue date.";
    setErrors(e);
    if (Object.keys(e).length === 0) upload.mutate();
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={replace ? `New version — ${replace.title}` : "Upload document"}
      description="PDF, JPG or PNG up to 10 MB. Files are stored privately and opened with short-lived links."
      dirty={!!file || !!title}
      saving={upload.isPending}
      onSubmit={submit}
      submitLabel={replace ? "Upload new version" : "Upload"}
    >
      <div>
        <label htmlFor="wf-file" className="mb-2 block text-sm font-medium text-ink">
          File<span className="ml-0.5 text-ember">*</span>
        </label>
        <input
          ref={fileRef}
          id="wf-file"
          type="file"
          accept={api.ACCEPT_FILES}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full rounded-lg border border-line bg-raised px-3 py-2.5 text-sm text-ink file:mr-3 file:rounded-md file:border-0 file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-ink"
        />
        {errors.file && <p className="mt-1.5 text-xs text-status-incident">{errors.file}</p>}
      </div>
      {replace?.signed && (
        <p className="rounded-lg border border-line bg-raised px-3.5 py-2.5 text-sm text-ink-2">
          This is a signed document. The signed original is preserved as a prior version and is never overwritten.
        </p>
      )}
      {!replace && (
        <>
          <TextField label="Title" required value={title} onChange={setTitle} error={errors.title} maxLength={200} />
          <SelectField
            label="Category"
            required
            value={category}
            onChange={setCategory}
            error={errors.category}
            options={Object.entries(cats).map(([value, label]) => ({ value, label }))}
          />
        </>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField label="Issue date" type="date" value={issue} onChange={setIssue} />
        <TextField label="Expiration date" type="date" value={exp} onChange={setExp} error={errors.exp} />
      </div>
      {!replace && (
        <>
          {forcedRestricted || forcedFinancial ? (
            <p className="flex items-center gap-2 rounded-lg border border-line bg-raised px-3.5 py-2.5 text-sm text-ink-2">
              <Lock className="h-4 w-4 text-ember" />
              {forcedRestricted ? "Stored as Restricted — only admins with restricted-document access can open it." : "Stored as Financial — only admins with agency-financials access can open it."}
            </p>
          ) : (
            <CheckField
              label="Restricted access"
              hint="Only admins with restricted-document permission can see or open it."
              checked={restricted}
              onChange={setRestricted}
            />
          )}
          <CheckField label="Signed document" hint="Signed documents are never overwritten — new uploads become new versions." checked={signed} onChange={setSigned} />
          {!needsPerm && (
            <p className="text-sm text-status-incident">You don't have permission to upload documents with this classification.</p>
          )}
        </>
      )}
    </FormDialog>
  );
};

/** Opens a document version through a 60-second signed link (logged). */
export const useOpenVersion = () => {
  const [preview, setPreview] = useState<{ url: string; mime: string; name: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const open = async (v: DocVersion, mode: "preview" | "download") => {
    setBusy(v.id + mode);
    try {
      const url = await api.documentUrl(v.id, mode);
      if (mode === "download") {
        const a = document.createElement("a");
        a.href = url;
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else setPreview({ url, mime: v.mime_type, name: v.file_name });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't open the file.");
    } finally {
      setBusy(null);
    }
  };
  const viewer = (
    <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
      <DialogContent className="flex h-[calc(100dvh-2rem)] max-w-5xl flex-col border-line bg-surface p-4 text-ink sm:rounded-xl">
        <DialogHeader>
          <DialogTitle className="truncate pr-8 text-base">{preview?.name}</DialogTitle>
          <DialogDescription className="text-ink-3">Secure preview · link expires in 60 seconds</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-line bg-raised">
          {preview?.mime === "application/pdf" ? (
            <iframe title={preview.name} src={preview.url} className="h-full w-full" />
          ) : preview ? (
            <img src={preview.url} alt={preview.name} className="mx-auto max-h-full max-w-full object-contain" />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
  return { open, busy, viewer };
};

const ReviewDialog = ({
  open,
  onOpenChange,
  version,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  version: DocVersion | null;
}) => {
  const wf = useWorkforce();
  const [status, setStatus] = useState<string>("approved");
  const [notes, setNotes] = useState<string>("");
  const [err, setErr] = useState<string>("");
  useEffect(() => {
    if (open) {
      setStatus(version?.review_status === "approved" ? "approved" : "approved");
      setNotes(version?.review_notes ?? "");
      setErr("");
    }
  }, [open, version]);
  const m = useMutation({
    mutationFn: () => api.reviewDocument(version?.id ?? "", status, notes),
    onSuccess: () => {
      wf.invalidate("versions");
      toast.success("Review saved");
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save the review."),
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Review document"
      dirty={notes !== (version?.review_notes ?? "")}
      saving={m.isPending}
      onSubmit={() => {
        if (status === "rejected" && notes.trim().length < 3) {
          setErr("Explain why it was rejected.");
          return;
        }
        m.mutate();
      }}
    >
      <SelectField
        label="Review status"
        required
        value={status}
        onChange={setStatus}
        options={[
          { value: "approved", label: "Approved" },
          { value: "rejected", label: "Rejected" },
          { value: "pending", label: "Pending review" },
        ]}
      />
      <AreaField label="Review notes" value={notes} onChange={setNotes} error={err} rows={3} />
    </FormDialog>
  );
};

/** Documents list for any owner (worker, agency, placement, invoice, personnel record). */
export const DocumentsPanel = ({
  ownerType,
  ownerId,
  filter,
  source,
  title = "Documents",
  compact,
}: {
  ownerType: OwnerType;
  ownerId: string;
  filter: (d: WfDocument) => boolean;
  source?: string;
  title?: string;
  compact?: boolean;
}) => {
  const wf = useWorkforce();
  const [uploadOpen, setUploadOpen] = useState<boolean>(false);
  const [replace, setReplace] = useState<WfDocument | null>(null);
  const [historyFor, setHistoryFor] = useState<WfDocument | null>(null);
  const [reviewFor, setReviewFor] = useState<DocVersion | null>(null);
  const [purgeFor, setPurgeFor] = useState<WfDocument | null>(null);
  const [showArchived, setShowArchived] = useState<boolean>(false);
  const { open, busy, viewer } = useOpenVersion();

  const docs = useMemo(() => wf.documents.filter(filter), [wf.documents, filter]);
  const visible = docs.filter((d) => showArchived || !d.archived_at);
  const versionsByDoc = useMemo(() => {
    const m = new Map<string, DocVersion[]>();
    for (const v of wf.versions) {
      const list = m.get(v.document_id) ?? [];
      list.push(v);
      m.set(v.document_id, list);
    }
    for (const list of m.values()) list.sort((a, b) => b.version - a.version);
    return m;
  }, [wf.versions]);

  const archive = useMutation({
    mutationFn: (d: WfDocument) =>
      api.updateDocument(d.id, d.archived_at ? { archived_at: null, archived_by: null } : { archived_at: new Date().toISOString(), archived_by: wf.user?.id ?? null }),
    onSuccess: (d) => {
      wf.invalidate("documents");
      toast.success(d.archived_at ? "Document archived" : "Document restored");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't update the document."),
  });

  const purge = useMutation({
    mutationFn: (d: WfDocument) => api.purgeDocument(d.id),
    onSuccess: () => {
      wf.invalidate("documents", "versions");
      setPurgeFor(null);
      toast.success("Document permanently deleted");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't delete the document."),
  });

  const hiddenNote =
    !wf.perms.documents || !wf.perms.finance
      ? "Restricted or financial documents you don't have permission for are hidden."
      : null;

  return (
    <div className={cn(!compact && "rounded-xl border border-line bg-surface")}>
      <div className={cn("flex flex-wrap items-center justify-between gap-3", compact ? "mb-3" : "px-5 pt-5 sm:px-6")}>
        <div>
          <h3 className={cn("font-display font-bold text-ink", compact ? "text-base" : "text-lg sm:text-xl")}>{title}</h3>
          {hiddenNote && !compact && <p className="mt-0.5 text-xs text-ink-3">{hiddenNote}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {docs.some((d) => d.archived_at) && (
            <Button variant="ghost" size="sm" onClick={() => setShowArchived((v) => !v)}>
              {showArchived ? "Hide archived" : "Show archived"}
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => {
              setReplace(null);
              setUploadOpen(true);
            }}
          >
            <Upload />
            Upload
          </Button>
        </div>
      </div>
      <div className={cn(!compact && "p-3 sm:p-4")}>
        {visible.length === 0 ? (
          <Empty title="No documents yet" description="Upload PDFs or photos of paperwork. Files stay private to authorized admins." />
        ) : (
          <ul className="space-y-2.5">
            {visible.map((d) => {
              const vs = versionsByDoc.get(d.id) ?? [];
              const cur = vs.find((v) => v.version === d.current_version) ?? vs[0];
              const expSoon = d.expiration_date && d.expiration_date <= new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
              return (
                <li key={d.id} className={cn("rounded-lg border border-line bg-raised px-4 py-3.5", d.archived_at && "opacity-60")}>
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <FileText className="mt-0.5 h-5 w-5 shrink-0 text-ember" />
                      <div className="min-w-0">
                        <div className="truncate font-medium text-ink">{d.title}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
                          <span>{DOC_CATEGORY_LABEL[d.category] ?? d.category}</span>
                          <span>·</span>
                          <span>v{d.current_version}</span>
                          {cur && <MetaPill meta={REVIEW_STATUS} value={cur.review_status} />}
                          {d.classification !== "standard" && <MetaPill meta={CLASSIFICATION} value={d.classification} />}
                          {d.signed && <Pill tone="blue">Signed</Pill>}
                          {d.archived_at && <Pill tone="slate">Archived</Pill>}
                        </div>
                        <div className="mt-1.5 text-xs text-ink-2">
                          Uploaded {fmtDate(cur?.uploaded_at)} by {wf.memberName(cur?.uploaded_by)}
                          {d.issue_date && <> · Issued {fmtDate(d.issue_date)}</>}
                          {d.expiration_date && (
                            <span className={cn(expSoon && "font-medium text-status-follow")}> · Expires {fmtDate(d.expiration_date)}</span>
                          )}
                        </div>
                        {cur?.reviewed_at && (
                          <div className="mt-1 text-xs text-ink-3">
                            Reviewed {fmtDate(cur.reviewed_at)} by {wf.memberName(cur.reviewed_by)}
                            {cur.review_notes && <> — “{cur.review_notes}”</>}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-1.5">
                      {cur && (
                        <>
                          <Button variant="outline" size="sm" onClick={() => void open(cur, "preview")} disabled={busy === cur.id + "preview"}>
                            {busy === cur.id + "preview" ? <Loader2 className="animate-spin" /> : <Eye />}
                            Preview
                          </Button>
                          <Button variant="ghost" size="icon" aria-label="Download" onClick={() => void open(cur, "download")} disabled={busy === cur.id + "download"}>
                            {busy === cur.id + "download" ? <Loader2 className="animate-spin" /> : <Download />}
                          </Button>
                        </>
                      )}
                      {!d.archived_at && cur && (
                        <Button variant="ghost" size="icon" aria-label="Review" onClick={() => setReviewFor(cur)}>
                          {cur.review_status === "rejected" ? <XCircle /> : <CheckCircle2 />}
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" aria-label="Version history" onClick={() => setHistoryFor(d)}>
                        <History />
                      </Button>
                      {!d.archived_at && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setReplace(d);
                            setUploadOpen(true);
                          }}
                        >
                          New version
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" aria-label={d.archived_at ? "Restore" : "Archive"} onClick={() => archive.mutate(d)}>
                        {d.archived_at ? <ArchiveRestore /> : <Archive />}
                      </Button>
                      {d.archived_at && wf.perms.purge && (
                        <Button variant="ghost" size="icon" aria-label="Delete permanently" onClick={() => setPurgeFor(d)}>
                          <Trash2 className="text-status-incident" />
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} ownerType={ownerType} ownerId={ownerId} source={source} replace={replace} />
      <ReviewDialog open={!!reviewFor} onOpenChange={(o) => !o && setReviewFor(null)} version={reviewFor} />

      <Dialog open={!!historyFor} onOpenChange={(o) => !o && setHistoryFor(null)}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto border-line bg-surface text-ink sm:max-w-xl sm:rounded-xl">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">Version history</DialogTitle>
            <DialogDescription className="text-ink-2">{historyFor?.title} — previous versions are never overwritten.</DialogDescription>
          </DialogHeader>
          <ul className="space-y-2">
            {(historyFor ? (versionsByDoc.get(historyFor.id) ?? []) : []).map((v) => (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-raised px-3.5 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium text-ink">
                    Version {v.version} <MetaPill meta={REVIEW_STATUS} value={v.review_status} />
                  </div>
                  <div className="mt-0.5 truncate text-xs text-ink-3">
                    {v.file_name} · {(v.size_bytes / 1024).toFixed(0)} KB · {fmtDateTime(v.uploaded_at)} · {wf.memberName(v.uploaded_by)}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" aria-label="Preview" onClick={() => void open(v, "preview")}>
                    <Eye />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label="Download" onClick={() => void open(v, "download")}>
                    <Download />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!purgeFor}
        onOpenChange={(o) => !o && setPurgeFor(null)}
        title="Permanently delete document?"
        description="This deletes every version and its files. It cannot be undone. Archiving is the normal way to remove a document."
        confirmLabel="Delete permanently"
        destructive
        busy={purge.isPending}
        onConfirm={() => purgeFor && purge.mutate(purgeFor)}
      />
      {viewer}
    </div>
  );
};
