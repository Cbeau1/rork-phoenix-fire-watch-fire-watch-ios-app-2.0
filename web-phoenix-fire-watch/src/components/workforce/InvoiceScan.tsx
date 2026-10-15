import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, FileText, Loader2, PenLine, ScanText, Sparkles, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import * as api from "@/lib/workforce/api";
import { cn } from "@/lib/utils";

/** What the invoice form is pre-filled from: the agency's file plus whatever the reader extracted. */
export interface InvoicePrefill {
  file: File;
  scan: api.ScannedInvoice | null;
  agencyId: string | null;
}

/** Re-encodes phone photos until they fit under the reader's size cap. PDFs are returned as-is. */
const shrinkForScan = async (file: File): Promise<File> => {
  const first = await api.prepareUpload(file);
  if (first.size <= api.MAX_SCAN_BYTES || !first.type.startsWith("image/")) return first;
  try {
    const bitmap = await createImageBitmap(first);
    for (const [edge, q] of [[1800, 0.8], [1400, 0.75]] as const) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) break;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", q));
      if (blob && blob.size <= api.MAX_SCAN_BYTES) {
        bitmap.close();
        return new File([blob], first.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" });
      }
    }
    bitmap.close();
  } catch {
    // fall through with the original
  }
  return first;
};

const STEPS = ["Uploading securely", "Reading the invoice", "Matching agency & workers", "Filling in the details"];

/**
 * Step 1 of recording an agency invoice: drop the PDF or photo, the server reads it, and the caller
 * opens the invoice form pre-filled. Nothing is saved until the user reviews and saves that form.
 */
export const ScanInvoiceDialog = ({
  open,
  onOpenChange,
  onReady,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onReady: (p: InvoicePrefill) => void;
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string>("");
  const [dragging, setDragging] = useState<boolean>(false);
  const [step, setStep] = useState<number>(0);

  const scan = useMutation({
    mutationFn: async (f: File) => {
      const ready = await shrinkForScan(f);
      setFile(ready);
      if (ready.size > api.MAX_SCAN_BYTES) throw new Error("This file is larger than 3 MB, so it can't be read automatically. You can still save it and enter the details yourself.");
      return { ready, res: await api.scanInvoice(ready) };
    },
    onSuccess: ({ ready, res }) => {
      if (!res.invoice.is_invoice) {
        setError("This doesn't look like an invoice. Check the file, or enter the details yourself.");
        return;
      }
      onReady({ file: ready, scan: res.invoice, agencyId: res.agencyId });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Couldn't read that invoice."),
  });

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setError("");
    setStep(0);
    scan.reset();
    if (inputRef.current) inputRef.current.value = "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!scan.isPending) return;
    setStep(0);
    const t = window.setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 3500);
    return () => window.clearInterval(t);
  }, [scan.isPending]);

  const pick = useCallback(
    (f: File | undefined) => {
      if (!f) return;
      setError("");
      const bad = api.checkFile(f);
      setFile(f);
      if (bad) {
        setError(bad);
        return;
      }
      scan.mutate(f);
    },
    [scan],
  );

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (!scan.isPending) pick(e.dataTransfer.files?.[0]);
  };

  const canSaveAnyway = !!file && !api.checkFile(file);

  return (
    <Dialog open={open} onOpenChange={(v) => !scan.isPending && onOpenChange(v)}>
      <DialogContent className="border-line bg-surface text-ink sm:max-w-lg sm:rounded-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanText className="h-5 w-5 text-primary" />
            Upload agency invoice
          </DialogTitle>
          <DialogDescription>
            Drop the PDF or a photo of the invoice. We'll read it, fill in the details for you to check, and save the file with the invoice.
          </DialogDescription>
        </DialogHeader>

        {scan.isPending ? (
          <div className="rounded-xl border border-line bg-raised p-5" role="status" aria-live="polite">
            <div className="flex items-center gap-3">
              <div className="relative grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-primary/10">
                <FileText className="h-5 w-5 text-primary" />
                <span className="absolute inset-x-1 top-1 h-0.5 animate-[scanline_1.6s_ease-in-out_infinite] rounded-full bg-primary shadow-[0_0_8px] shadow-primary" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-ink">{file?.name}</div>
                <div className="text-xs text-ink-3">Usually takes 10–20 seconds</div>
              </div>
            </div>
            <ol className="mt-4 space-y-2">
              {STEPS.map((s, i) => (
                <li key={s} className={cn("flex items-center gap-2 text-sm transition-colors", i < step ? "text-ink-2" : i === step ? "text-ink" : "text-ink-3/60")}>
                  {i < step ? (
                    <span className="grid h-4 w-4 place-items-center rounded-full bg-status-clear text-[10px] text-on-clear">✓</span>
                  ) : i === step ? (
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  ) : (
                    <span className="h-4 w-4 rounded-full border border-line-strong" />
                  )}
                  {s}
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn(
              "focus-ring group flex w-full flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-9 text-center transition-colors",
              dragging ? "border-primary bg-primary/10" : "border-line-strong bg-raised hover:border-primary/60 hover:bg-raised-hover",
            )}
          >
            <span className="grid h-12 w-12 place-items-center rounded-full bg-primary/10 transition-transform group-hover:scale-105">
              <Upload className="h-5 w-5 text-primary" />
            </span>
            <span className="text-sm font-medium text-ink">{dragging ? "Drop to read it" : "Drop the invoice here, or click to choose"}</span>
            <span className="text-xs text-ink-3">PDF, JPG or PNG · read automatically up to 3 MB</span>
          </button>
        )}
        <input ref={inputRef} type="file" accept={api.ACCEPT_FILES} className="sr-only" tabIndex={-1} onChange={(e) => pick(e.target.files?.[0])} />

        {error && !scan.isPending && (
          <div className="space-y-3 rounded-lg border border-status-follow/50 bg-status-follow/10 px-3.5 py-3 text-sm text-ink" role="alert">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-follow" />
              <span>{error}</span>
            </div>
            {canSaveAnyway && file && (
              <Button type="button" variant="outline" size="sm" onClick={() => onReady({ file, scan: null, agencyId: null })}>
                <PenLine />
                Enter details myself and save this file
              </Button>
            )}
          </div>
        )}

        {!scan.isPending && !error && (
          <p className="flex items-start gap-2 text-xs text-ink-3">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            Nothing is saved until you review the details and press Save.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
};
