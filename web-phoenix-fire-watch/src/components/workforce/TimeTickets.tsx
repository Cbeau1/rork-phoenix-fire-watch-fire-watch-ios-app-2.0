import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Archive, Camera, Download, Eye, FileText, Link2, Link2Off, Loader2, Paperclip, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { timeOfDay } from "@/lib/format";
import { entryMinutes, fmtHours, loadEntriesByIds, loadPersonEntries, type TimeEntry } from "@/lib/timeclock";
import { supabase } from "@/lib/supabase";
import * as api from "@/lib/workforce/api";
import type { DocVersion, WfDocument, Worker } from "@/lib/workforce/constants";
import { cn } from "@/lib/utils";
import { useAuth } from "@/state/AuthProvider";
import { useWorkforce } from "@/state/WorkforceProvider";

import { useOpenVersion } from "./DocumentsPanel";
import { Empty, fmtDate, FormDialog, Pill, SelectField, TextField } from "./kit";

/** A time ticket document with its current file version. */
export interface Ticket {
  doc: WfDocument;
  version: DocVersion | null;
}

const errMsg = (e: unknown, fallback: string): string => (e instanceof Error ? e.message : fallback);

/** "Wed Oct 14 · 7:00 AM → 7:00 PM · 12.00 hrs" */
export const shiftLabel = (e: TimeEntry): string =>
  `${format(new Date(e.clockIn), "EEE MMM d")} · ${timeOfDay(e.clockIn)} → ${e.clockOut ? timeOfDay(e.clockOut) : "now"} · ${fmtHours(entryMinutes(e))} hrs`;

const dateKey = (iso: string): string => format(new Date(iso), "yyyy-MM-dd");

const useInvalidateDocs = () => {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["wf", "documents"] });
    void qc.invalidateQueries({ queryKey: ["wf", "versions"] });
    void qc.invalidateQueries({ queryKey: ["wf", "tickets"] });
  };
};

const attachVersions = async (docs: WfDocument[]): Promise<Ticket[]> => {
  if (docs.length === 0) return [];
  const { data, error } = await supabase
    .from("wf_document_versions")
    .select("*")
    .in(
      "document_id",
      docs.map((d) => d.id),
    );
  if (error) throw api.wfError(error);
  const versions = (data ?? []) as DocVersion[];
  return docs.map((doc) => ({
    doc,
    version: versions.find((v) => v.document_id === doc.id && v.version === doc.current_version) ?? null,
  }));
};

/**
 * Documents attached to the given payroll shifts, grouped by shift. Fails soft (empty map) for admins
 * without Workforce access so Payroll keeps working.
 */
export const useEntryTickets = (entryIds: string[], enabled: boolean): Map<string, Ticket[]> => {
  const { user } = useAuth();
  const ids = useMemo(() => [...new Set(entryIds)].sort(), [entryIds]);
  const q = useQuery({
    queryKey: ["wf", "tickets", "by-entry", user?.orgId ?? "", ids.join(",")],
    enabled: enabled && ids.length > 0,
    staleTime: 20_000,
    retry: 1,
    queryFn: async () => {
      const docs: WfDocument[] = [];
      for (let i = 0; i < ids.length; i += 150) {
        const { data, error } = await supabase
          .from("wf_documents")
          .select("*")
          .in("time_entry_id", ids.slice(i, i + 150))
          .is("archived_at", null)
          .order("created_at");
        if (error) throw api.wfError(error);
        docs.push(...((data ?? []) as WfDocument[]));
      }
      return attachVersions(docs);
    },
  });
  return useMemo(() => {
    const m = new Map<string, Ticket[]>();
    for (const t of q.data ?? []) {
      const k = t.doc.time_entry_id ?? "";
      m.set(k, [...(m.get(k) ?? []), t]);
    }
    return m;
  }, [q.data]);
};

/** Shift picker options for one person, newest first. */
const useShiftOptions = (profileId: string | null, enabled: boolean) =>
  useQuery({
    queryKey: ["tc", "person-entries", profileId ?? ""],
    enabled: enabled && !!profileId,
    staleTime: 30_000,
    queryFn: () => loadPersonEntries(profileId ?? ""),
  });

/** Upload a photo or PDF of a daily time ticket into a worker's file, optionally attached to a payroll shift. */
export const TicketUploadDialog = ({
  open,
  onOpenChange,
  personName,
  workerId,
  profileId,
  entry,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  personName: string;
  /** Worker file to store it in. When omitted, the server finds the file from the shift's person. */
  workerId?: string;
  /** Lets the dialog offer this person's recent shifts to attach to. */
  profileId: string | null;
  /** Fixed shift (e.g. opened from a Payroll row). */
  entry?: TimeEntry;
}) => {
  const invalidate = useInvalidateDocs();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [preparing, setPreparing] = useState<boolean>(false);
  const [ticketDate, setTicketDate] = useState<string>("");
  const [shiftId, setShiftId] = useState<string>("");
  const [title, setTitle] = useState<string>("");
  const [titleTouched, setTitleTouched] = useState<boolean>(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const shifts = useShiftOptions(profileId, open && !entry);

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setTicketDate(entry ? dateKey(entry.clockIn) : format(new Date(), "yyyy-MM-dd"));
    setShiftId(entry?.id ?? "");
    setTitleTouched(false);
    setErrors({});
    if (fileRef.current) fileRef.current.value = "";
  }, [open, entry]);

  useEffect(() => {
    if (!file || !file.type.startsWith("image/")) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Suggest the shift that started on the ticket's date.
  useEffect(() => {
    if (entry || !open || !ticketDate || !shifts.data) return;
    const match = shifts.data.find((e) => dateKey(e.clockIn) === ticketDate);
    setShiftId(match?.id ?? "");
  }, [ticketDate, shifts.data, entry, open]);

  useEffect(() => {
    if (titleTouched || !ticketDate) return;
    const d = new Date(`${ticketDate}T12:00:00`);
    setTitle(`Time ticket · ${Number.isNaN(d.getTime()) ? ticketDate : format(d, "EEE MMM d, yyyy")}`);
  }, [ticketDate, titleTouched]);

  const pick = async (f: File | null) => {
    if (!f) return;
    setPreparing(true);
    try {
      const ready = await api.prepareUpload(f);
      const bad = api.checkFile(ready);
      setErrors((e) => ({ ...e, file: bad ?? "" }));
      setFile(bad ? null : ready);
    } finally {
      setPreparing(false);
    }
  };

  const upload = useMutation({
    mutationFn: () =>
      api.uploadDocument({
        file: file as File,
        ownerType: "worker",
        ownerId: workerId,
        category: "time_ticket",
        title: title.trim(),
        issueDate: ticketDate,
        timeEntryId: shiftId || undefined,
      }),
    onSuccess: () => {
      invalidate();
      toast.success(shiftId ? "Time ticket saved and attached to the shift" : `Time ticket saved to ${personName}'s file`);
      onOpenChange(false);
    },
    onError: (e) => toast.error(errMsg(e, "Upload failed.")),
  });

  const submit = () => {
    const e: Record<string, string> = {};
    if (!file) e.file = "Take a photo of the ticket or choose a file.";
    if (!title.trim()) e.title = "Add a title.";
    if (!ticketDate) e.date = "Enter the date on the ticket.";
    setErrors(e);
    if (Object.values(e).every((v) => !v)) upload.mutate();
  };

  const shiftOptions = (shifts.data ?? []).map((e) => ({ value: e.id, label: shiftLabel(e) }));

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add time ticket"
      description={`Saved privately to ${personName}'s file. Photos and PDFs up to 10 MB.`}
      dirty={!!file}
      saving={upload.isPending || preparing}
      onSubmit={submit}
      submitLabel="Save ticket"
    >
      <div>
        <label
          htmlFor="ticket-file"
          className={cn(
            "focus-within:ring-2 focus-within:ring-primary/60 flex cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border-2 border-dashed bg-raised text-center transition-colors hover:border-primary/60",
            errors.file ? "border-status-incident/70" : "border-line",
            previewUrl ? "p-2" : "px-4 py-8",
          )}
        >
          {preparing ? (
            <Loader2 className="h-6 w-6 animate-spin text-link" />
          ) : previewUrl ? (
            <img src={previewUrl} alt="Time ticket preview" className="max-h-56 w-full rounded-lg object-contain" />
          ) : file ? (
            <>
              <FileText className="h-7 w-7 text-link" />
              <span className="text-sm font-medium text-ink">{file.name}</span>
            </>
          ) : (
            <>
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/15 text-link">
                <Camera className="h-5 w-5" />
              </span>
              <span className="text-sm font-medium text-ink">Take a photo or choose a file</span>
              <span className="text-xs text-ink-3">JPG, PNG or PDF — large phone photos are resized automatically</span>
            </>
          )}
          {file && !preparing && <span className="text-xs text-ink-3">Tap to choose a different file</span>}
          <input
            ref={fileRef}
            id="ticket-file"
            type="file"
            accept="image/*,application/pdf,.pdf,.heic,.heif"
            className="sr-only"
            onChange={(e) => void pick(e.target.files?.[0] ?? null)}
          />
        </label>
        {errors.file && <p className="mt-1.5 text-xs text-status-incident-ink">{errors.file}</p>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Date on ticket" type="date" required value={ticketDate} onChange={setTicketDate} error={errors.date} />
        <TextField
          label="Title"
          required
          value={title}
          onChange={(v) => {
            setTitle(v);
            setTitleTouched(true);
          }}
          error={errors.title}
          maxLength={200}
        />
      </div>

      {entry ? (
        <div className="flex items-start gap-3 rounded-lg border border-line bg-raised px-4 py-3">
          <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-link" />
          <div className="min-w-0 text-sm">
            <div className="font-medium text-ink">Attached to payroll shift</div>
            <div className="mt-0.5 font-mono text-xs text-ink-2">{shiftLabel(entry)}</div>
          </div>
        </div>
      ) : profileId ? (
        <SelectField
          label="Attach to payroll shift"
          value={shiftId}
          onChange={setShiftId}
          options={shiftOptions}
          allowNone
          noneLabel="Don't attach — just keep it on file"
          disabled={shifts.isLoading}
          hint={
            shifts.isLoading
              ? "Loading recent shifts…"
              : shiftOptions.length === 0
                ? "No clocked shifts yet — it will be kept on file."
                : "Matched to the shift that started on the ticket's date, if there is one."
          }
        />
      ) : (
        <p className="rounded-lg border border-line bg-raised px-4 py-3 text-sm text-ink-2">
          {personName} doesn't have an app login, so there are no payroll shifts to attach to. The ticket is kept on file.
        </p>
      )}
    </FormDialog>
  );
};

/** Pick (or change) the payroll shift an existing ticket belongs to. */
const AttachShiftDialog = ({ ticket, profileId, onClose }: { ticket: WfDocument | null; profileId: string | null; onClose: () => void }) => {
  const invalidate = useInvalidateDocs();
  const [shiftId, setShiftId] = useState<string>("");
  const shifts = useShiftOptions(profileId, !!ticket);
  useEffect(() => {
    if (!ticket) return;
    const issued = ticket.issue_date;
    setShiftId(ticket.time_entry_id ?? shifts.data?.find((e) => issued && dateKey(e.clockIn) === issued)?.id ?? "");
  }, [ticket, shifts.data]);
  const save = useMutation({
    mutationFn: () => api.updateDocument(ticket?.id ?? "", { time_entry_id: shiftId || null }),
    onSuccess: () => {
      invalidate();
      toast.success(shiftId ? "Attached to the shift" : "Detached from the shift");
      onClose();
    },
    onError: (e) => toast.error(errMsg(e, "Couldn't update the ticket.")),
  });
  return (
    <FormDialog
      open={!!ticket}
      onOpenChange={(o) => !o && onClose()}
      title="Attach to payroll shift"
      description={ticket?.title}
      dirty={shiftId !== (ticket?.time_entry_id ?? "")}
      saving={save.isPending}
      onSubmit={() => save.mutate()}
      submitLabel="Save"
    >
      <SelectField
        label="Payroll shift"
        value={shiftId}
        onChange={setShiftId}
        allowNone
        noneLabel="Not attached"
        disabled={shifts.isLoading}
        options={(shifts.data ?? []).map((e) => ({ value: e.id, label: shiftLabel(e) }))}
        hint={shifts.isLoading ? "Loading recent shifts…" : undefined}
      />
    </FormDialog>
  );
};

const TicketRow = ({
  ticket,
  shift,
  busyKey,
  onOpen,
  actions,
}: {
  ticket: Ticket;
  shift?: TimeEntry | null;
  busyKey: string | null;
  onOpen: (v: DocVersion, mode: "preview" | "download") => void;
  actions?: ReactNode;
}) => {
  const v = ticket.version;
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-line bg-raised px-4 py-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-link">
          <Paperclip className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className="truncate font-medium text-ink">{ticket.doc.title}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
            {ticket.doc.issue_date && <span>Dated {fmtDate(ticket.doc.issue_date)}</span>}
            {v && <span>· {v.file_name}</span>}
          </div>
          {shift !== undefined && (
            <div className="mt-1.5">
              {shift ? (
                <span className="inline-flex items-center gap-1.5 font-mono text-xs text-ink-2">
                  <Link2 className="h-3 w-3 text-link" />
                  {shiftLabel(shift)}
                </span>
              ) : ticket.doc.time_entry_id ? (
                <Pill tone="blue">Attached to a shift</Pill>
              ) : (
                <Pill tone="slate">On file · not attached</Pill>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-1">
        {v && (
          <>
            <Button variant="outline" size="sm" onClick={() => onOpen(v, "preview")} disabled={busyKey === v.id + "preview"}>
              {busyKey === v.id + "preview" ? <Loader2 className="animate-spin" /> : <Eye />}
              View
            </Button>
            <Button variant="ghost" size="icon" aria-label="Download" onClick={() => onOpen(v, "download")} disabled={busyKey === v.id + "download"}>
              {busyKey === v.id + "download" ? <Loader2 className="animate-spin" /> : <Download />}
            </Button>
          </>
        )}
        {actions}
      </div>
    </li>
  );
};

/** Payroll: tickets attached to one shift, plus upload and "attach one already on file". */
export const ShiftTicketsDialog = ({
  entry,
  personName,
  tickets,
  onClose,
}: {
  entry: TimeEntry | null;
  personName: string;
  tickets: Ticket[];
  onClose: () => void;
}) => {
  const invalidate = useInvalidateDocs();
  const { open, busy, viewer } = useOpenVersion();
  const [uploadOpen, setUploadOpen] = useState<boolean>(false);
  const { user } = useAuth();

  // Unattached tickets already in this person's file.
  const onFile = useQuery({
    queryKey: ["wf", "tickets", "unattached", user?.orgId ?? "", entry?.profileId ?? ""],
    enabled: !!entry?.profileId,
    staleTime: 20_000,
    queryFn: async () => {
      const { data: workers, error: wErr } = await supabase.from("wf_workers").select("id").eq("profile_id", entry?.profileId ?? "");
      if (wErr) throw api.wfError(wErr);
      const ids = (workers ?? []).map((w) => w.id);
      if (ids.length === 0) return { hasFile: false, tickets: [] as Ticket[] };
      const { data, error } = await supabase
        .from("wf_documents")
        .select("*")
        .in("worker_id", ids)
        .eq("category", "time_ticket")
        .is("time_entry_id", null)
        .is("archived_at", null)
        .order("issue_date", { ascending: false, nullsFirst: false })
        .limit(30);
      if (error) throw api.wfError(error);
      return { hasFile: true, tickets: await attachVersions((data ?? []) as WfDocument[]) };
    },
  });

  const link = useMutation({
    mutationFn: (v: { id: string; entryId: string | null }) => api.updateDocument(v.id, { time_entry_id: v.entryId }),
    onSuccess: (_d, v) => {
      invalidate();
      toast.success(v.entryId ? "Ticket attached to this shift" : "Ticket detached — still kept on file");
    },
    onError: (e) => toast.error(errMsg(e, "Couldn't update the ticket.")),
  });

  const sameDay = (t: Ticket) => !!entry && t.doc.issue_date === dateKey(entry.clockIn);
  const suggestions = [...(onFile.data?.tickets ?? [])].sort((a, b) => Number(sameDay(b)) - Number(sameDay(a)));

  return (
    <>
      <Dialog open={!!entry && !uploadOpen} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto border-line bg-surface text-ink sm:max-w-xl sm:rounded-xl">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">Time tickets</DialogTitle>
            <DialogDescription className="text-ink-2">
              {personName} · <span className="font-mono">{entry ? shiftLabel(entry) : ""}</span>
            </DialogDescription>
          </DialogHeader>

          {tickets.length === 0 ? (
            <Empty title="No ticket attached" description="Snap a photo of the signed agency ticket and attach it here for your records." />
          ) : (
            <ul className="space-y-2">
              {tickets.map((t) => (
                <TicketRow
                  key={t.doc.id}
                  ticket={t}
                  busyKey={busy}
                  onOpen={(v, m) => void open(v, m)}
                  actions={
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Detach from this shift"
                      title="Detach from this shift (stays on file)"
                      onClick={() => link.mutate({ id: t.doc.id, entryId: null })}
                      disabled={link.isPending}
                    >
                      <Link2Off />
                    </Button>
                  }
                />
              ))}
            </ul>
          )}

          {onFile.data?.hasFile === false ? (
            <p className="rounded-lg border border-status-follow/40 bg-status-follow/10 px-4 py-3 text-sm text-ink">
              {personName} doesn't have a worker file yet, so there's nowhere to keep the ticket.{" "}
              <a href="/team" className="font-medium text-link underline-offset-2 hover:underline">
                Add them on the Team page
              </a>{" "}
              first.
            </p>
          ) : (
            <Button onClick={() => setUploadOpen(true)} className="w-full sm:w-auto" disabled={onFile.isLoading}>
              <Upload />
              Upload time ticket
            </Button>
          )}

          {suggestions.length > 0 && (
            <div className="mt-2 border-t border-line pt-4">
              <h4 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-2">Already in {personName}'s file</h4>
              <ul className="mt-2 space-y-2">
                {suggestions.map((t) => (
                  <TicketRow
                    key={t.doc.id}
                    ticket={t}
                    busyKey={busy}
                    onOpen={(v, m) => void open(v, m)}
                    actions={
                      <Button size="sm" variant={sameDay(t) ? "default" : "outline"} onClick={() => link.mutate({ id: t.doc.id, entryId: entry?.id ?? null })} disabled={link.isPending}>
                        <Link2 />
                        Attach
                      </Button>
                    }
                  />
                ))}
              </ul>
            </div>
          )}
        </DialogContent>
      </Dialog>
      {entry && (
        <TicketUploadDialog open={uploadOpen} onOpenChange={setUploadOpen} personName={personName} profileId={entry.profileId} entry={entry} />
      )}
      {viewer}
    </>
  );
};

/** Worker profile: every daily time ticket on file, with the shift each one is attached to. */
export const WorkerTimeTicketsPanel = ({ worker, name }: { worker: Worker; name: string }) => {
  const wf = useWorkforce();
  const invalidate = useInvalidateDocs();
  const { open, busy, viewer } = useOpenVersion();
  const [uploadOpen, setUploadOpen] = useState<boolean>(false);
  const [attachFor, setAttachFor] = useState<WfDocument | null>(null);

  const tickets = useMemo<Ticket[]>(() => {
    const docs = wf.documents
      .filter((d) => d.worker_id === worker.id && d.category === "time_ticket" && !d.archived_at)
      .sort((a, b) => (b.issue_date ?? b.created_at).localeCompare(a.issue_date ?? a.created_at));
    return docs.map((doc) => ({
      doc,
      version: wf.versions.find((v) => v.document_id === doc.id && v.version === doc.current_version) ?? null,
    }));
  }, [wf.documents, wf.versions, worker.id]);

  const linkedIds = useMemo(() => tickets.map((t) => t.doc.time_entry_id).filter((x): x is string => !!x), [tickets]);
  const shiftsQ = useQuery({
    queryKey: ["tc", "entries-by-id", linkedIds.slice().sort().join(",")],
    enabled: linkedIds.length > 0,
    staleTime: 30_000,
    queryFn: () => loadEntriesByIds(linkedIds),
  });
  const shiftById = useMemo(() => new Map((shiftsQ.data ?? []).map((e) => [e.id, e])), [shiftsQ.data]);
  const unattached = tickets.filter((t) => !t.doc.time_entry_id).length;

  const archive = useMutation({
    mutationFn: (d: WfDocument) => api.updateDocument(d.id, { archived_at: new Date().toISOString(), archived_by: wf.user?.id ?? null }),
    onSuccess: () => {
      invalidate();
      toast.success("Ticket archived — find it under Documents › Show archived");
    },
    onError: (e) => toast.error(errMsg(e, "Couldn't archive the ticket.")),
  });

  return (
    <div className="rounded-xl border border-line bg-surface shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 sm:px-6">
        <div>
          <h3 className="font-display text-lg font-bold text-ink sm:text-xl">Time tickets</h3>
          <p className="mt-0.5 text-xs text-ink-3">
            {tickets.length === 0
              ? "Daily signed tickets from the agency, kept for future reference."
              : `${tickets.length} on file${unattached > 0 ? ` · ${unattached} not attached to a shift` : ""}`}
          </p>
        </div>
        <Button size="sm" onClick={() => setUploadOpen(true)}>
          <Camera />
          Add time ticket
        </Button>
      </div>
      <div className="p-3 sm:p-4">
        {tickets.length === 0 ? (
          <Empty
            title="No time tickets yet"
            description="Photograph the signed ticket each day. You can attach it to the matching payroll shift so it's there when you approve hours."
          />
        ) : (
          <ul className="space-y-2">
            {tickets.map((t) => (
              <TicketRow
                key={t.doc.id}
                ticket={t}
                shift={t.doc.time_entry_id ? (shiftById.get(t.doc.time_entry_id) ?? null) : null}
                busyKey={busy}
                onOpen={(v, m) => void open(v, m)}
                actions={
                  <>
                    {worker.profile_id && (
                      <Button variant="ghost" size="sm" onClick={() => setAttachFor(t.doc)}>
                        <Link2 />
                        {t.doc.time_entry_id ? "Change shift" : "Attach"}
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" aria-label="Archive" onClick={() => archive.mutate(t.doc)} disabled={archive.isPending}>
                      <Archive />
                    </Button>
                  </>
                }
              />
            ))}
          </ul>
        )}
      </div>
      <TicketUploadDialog open={uploadOpen} onOpenChange={setUploadOpen} personName={name} workerId={worker.id} profileId={worker.profile_id} />
      <AttachShiftDialog ticket={attachFor} profileId={worker.profile_id} onClose={() => setAttachFor(null)} />
      {viewer}
    </div>
  );
};
