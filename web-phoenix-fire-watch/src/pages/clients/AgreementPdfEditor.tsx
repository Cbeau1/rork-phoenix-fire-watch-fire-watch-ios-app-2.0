import { Download, Eye, RefreshCw, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { PdfPages } from "@/components/fw/PdfPages";
import { FormDialog, TextField } from "@/components/workforce/kit";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { crm } from "@/lib/crm/api";
import { editableFields, type FieldGroup, GROUP_LABEL, serializeAgreement, withEstimates } from "@/lib/crm/agreementFields";
import type { AgreementLayout } from "@/lib/crm/agreementLayout";
import { friendlyError } from "@/lib/supabase";

import { Spinner } from "./DealDialogs";

const GROUP_ORDER: FieldGroup[] = ["client", "proposal", "coverage", "rates", "start", "acceptance", "other"];

/** Shows a PDF built on demand (filled agreement preview), with download. */
export const PdfPreviewDialog = ({
  open,
  onOpenChange,
  title,
  description,
  fileName,
  load,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  fileName: string;
  load: () => Promise<Uint8Array>;
}) => {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open) {
      setBytes(null);
      setError("");
      return;
    }
    let cancelled = false;
    setBytes(null);
    setError("");
    load().then(
      (b) => !cancelled && setBytes(b),
      (err) => !cancelled && setError(friendlyError(err, "Couldn't build the preview.")),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuild only when opened or retried
  }, [open, attempt]);

  const download = () => {
    if (!bytes) return;
    const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: "application/pdf" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden border-line bg-surface p-0 text-ink sm:max-w-3xl sm:rounded-xl">
        <DialogHeader className="flex-row items-center justify-between gap-3 space-y-0 border-b border-line px-5 py-4 pr-14">
          <div className="min-w-0">
            <DialogTitle className="font-display text-lg">{title}</DialogTitle>
            {description && <DialogDescription className="mt-0.5 text-xs text-ink-3">{description}</DialogDescription>}
          </div>
          <Button size="sm" variant="outline" onClick={download} disabled={!bytes}>
            <Download />
            Download
          </Button>
        </DialogHeader>
        <div className="min-h-[50vh] overflow-y-auto bg-slate-500/25 p-4 sm:p-6">
          {error ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <p className="max-w-sm text-sm text-ink-2">{error}</p>
              <Button size="sm" variant="outline" onClick={() => setAttempt((n) => n + 1)}>
                <RefreshCw />
                Try again
              </Button>
            </div>
          ) : bytes ? (
            <PdfPages data={bytes} label={title} pageClassName="shadow-[0_10px_30px_rgba(0,0,0,0.35)]" />
          ) : (
            <div className="flex flex-col items-center gap-3 py-24 text-sm text-ink-3">
              <Spinner />
              Filling in your agreement…
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

/** Fills in the company's own agreement PDF, field by field, grouped like the document. */
export const AgreementPdfEditor = ({
  open,
  onOpenChange,
  layout,
  templatePath,
  initialValues,
  refill,
  warnSent,
  fileName,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  layout: AgreementLayout | null;
  templatePath: string | null;
  initialValues: Record<string, string>;
  refill: () => Record<string, string>;
  warnSent?: boolean;
  fileName: string;
  onSave: (body: string) => Promise<void>;
}) => {
  const fields = useMemo(() => (layout ? editableFields(layout) : []), [layout]);
  const initial = useMemo(() => {
    const out: Record<string, string> = {};
    for (const f of fields) out[f.name] = initialValues[f.name] ?? "";
    return layout ? withEstimates(layout, out) : out;
  }, [fields, initialValues, layout]);
  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    if (open) setValues(initial);
  }, [open, initial]);

  const set = (name: string, v: string) => setValues((prev) => (layout ? withEstimates(layout, { ...prev, [name]: v }) : { ...prev, [name]: v }));
  const dirty = serializeAgreement(values) !== serializeAgreement(initial);
  const loadPreview = useCallback(() => {
    if (!templatePath) return Promise.reject(new Error("Upload your agreement PDF in Templates & settings first."));
    return crm.previewAgreement(templatePath, serializeAgreement(values));
  }, [templatePath, values]);

  const grouped = GROUP_ORDER.map((g) => ({ g, items: fields.filter((f) => f.group === g) })).filter((x) => x.items.length > 0);

  return (
    <>
      <FormDialog
        open={open}
        onOpenChange={onOpenChange}
        title="Fill in agreement"
        description={
          warnSent
            ? "This agreement was already sent. Saving changes cancels the old signing link — you'll need to send it again."
            : "These go into the blanks on your agreement PDF. The client adds their name, title, date, initials and signature when they sign."
        }
        dirty={dirty}
        saving={saving}
        wide
        submitLabel="Save agreement"
        footerExtra={
          <div className="flex flex-wrap gap-1">
            <Button type="button" variant="ghost" size="sm" onClick={() => setPreview(true)} disabled={!templatePath}>
              <Eye />
              Preview PDF
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setValues(refill());
                toast.message("Refilled from the client, property and latest quote");
              }}
            >
              <RotateCcw />
              Refill
            </Button>
          </div>
        }
        onSubmit={() => {
          setSaving(true);
          onSave(serializeAgreement(values))
            .then(() => onOpenChange(false))
            .catch(() => undefined)
            .finally(() => setSaving(false));
        }}
      >
        {!layout ? (
          <p className="text-sm text-ink-2">This agreement's form fields couldn't be read. Upload the PDF again in Templates &amp; settings.</p>
        ) : (
          grouped.map(({ g, items }) => (
            <fieldset key={g} className="grid gap-3">
              <legend className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-ink-3">{GROUP_LABEL[g]}</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {items.map((f) => (
                  <TextField
                    key={f.name}
                    label={f.label}
                    value={values[f.name] ?? ""}
                    onChange={(v) => set(f.name, v)}
                    disabled={f.computed}
                    hint={f.computed ? "Calculated from the schedule and hourly rate" : f.hint}
                    placeholder={f.placeholder}
                    maxLength={f.multiline ? 2000 : 300}
                  />
                ))}
              </div>
            </fieldset>
          ))
        )}
      </FormDialog>
      <PdfPreviewDialog
        open={preview}
        onOpenChange={setPreview}
        title="Agreement preview"
        description="Exactly what the client will read before signing."
        fileName={fileName}
        load={loadPreview}
      />
    </>
  );
};
