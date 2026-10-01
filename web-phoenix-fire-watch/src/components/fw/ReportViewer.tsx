import { Download, FileText, Loader2, Mail, Minus, Plus, RefreshCw, X } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { friendlyError } from "@/lib/supabase";
import { cn } from "@/lib/utils";

export interface GeneratedReport {
  blob: Blob;
  fileName: string;
}

interface ReportViewerProps {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  /** Builds the PDF; called each time the viewer opens. */
  build: () => Promise<GeneratedReport>;
  onDownload: (report: GeneratedReport) => void;
  onSend: (report: GeneratedReport) => Promise<void> | void;
}

type PdfJs = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<PdfJs> | null = null;

/** Lazily loads the PDF renderer (kept out of the main bundle). */
const loadPdfJs = (): Promise<PdfJs> => {
  pdfjsPromise ??= Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs") as unknown as Promise<PdfJs>,
    import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
  ]).then(([lib, worker]) => {
    lib.GlobalWorkerOptions.workerSrc = (worker as { default: string }).default;
    return lib;
  });
  return pdfjsPromise;
};

const PdfPage = memo(({ doc, pageNumber, width }: { doc: PDFDocumentProxy; pageNumber: number; width: number }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rendered, setRendered] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    void (async () => {
      try {
        const page = await doc.getPage(pageNumber);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
        const viewport = page.getViewport({ scale: (width / base.width) * dpr });
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx) return;
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
        task = page.render({ canvas, canvasContext: ctx, viewport });
        await task.promise;
        if (!cancelled) setRendered(true);
      } catch (err) {
        if (!cancelled && !(err instanceof Error && err.name === "RenderingCancelledException")) {
          console.warn("[Report] page render failed", err);
        }
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, pageNumber, width]);

  return (
    <div className="relative mx-auto bg-white shadow-[0_12px_40px_rgba(0,0,0,0.55)]" style={{ width, minHeight: width * (792 / 612) }}>
      <canvas ref={canvasRef} className="block" aria-label={`Report page ${pageNumber}`} />
      {!rendered && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-[#B9BBC0]" />
        </div>
      )}
    </div>
  );
});
PdfPage.displayName = "PdfPage";

/** Full-screen in-app PDF viewer with download and send actions. */
export const ReportViewer = ({ open, title, subtitle, onClose, build, onDownload, onSend }: ReportViewerProps) => {
  const [report, setReport] = useState<GeneratedReport | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<number>(0);
  const [sending, setSending] = useState<boolean>(false);
  const [zoom, setZoom] = useState<number>(1);
  const [containerWidth, setContainerWidth] = useState<number>(800);
  const scrollRef = useRef<HTMLDivElement>(null);
  const buildRef = useRef(build);
  buildRef.current = build;

  useEffect(() => {
    if (!open) {
      setReport(null);
      setDoc(null);
      setError(null);
      setZoom(1);
      return;
    }
    let cancelled = false;
    let loaded: PDFDocumentProxy | null = null;
    setError(null);
    setDoc(null);
    void (async () => {
      try {
        const [generated, pdfjs] = await Promise.all([buildRef.current(), loadPdfJs()]);
        if (cancelled) return;
        setReport(generated);
        const data = new Uint8Array(await generated.blob.arrayBuffer());
        loaded = await pdfjs.getDocument({ data }).promise;
        if (cancelled) {
          void loaded.loadingTask.destroy();
          return;
        }
        setDoc(loaded);
      } catch (err) {
        console.error("[Report] viewer failed", err);
        if (!cancelled) setError(friendlyError(err, "Couldn't open the report."));
      }
    })();
    return () => {
      cancelled = true;
      if (loaded) void loaded.loadingTask.destroy();
    };
  }, [open, attempt]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!open || !el) return;
    const measure = () => setContainerWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  const send = useCallback(async () => {
    if (!report) return;
    setSending(true);
    try {
      await onSend(report);
    } finally {
      setSending(false);
    }
  }, [onSend, report]);

  if (!open) return null;

  const fitWidth = Math.min(containerWidth - 32, 860);
  const pageWidth = Math.max(280, Math.round(fitWidth * zoom));
  const pages = doc ? Array.from({ length: doc.numPages }, (_, i) => i + 1) : [];

  // Portaled to <body>: animated (transformed) page ancestors would otherwise trap this fixed overlay.
  return createPortal(
    <div className="fixed inset-0 z-50 flex h-[100dvh] animate-fade-up flex-col bg-[#060607]/95 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={title}>
      <header className="flex items-center gap-3 border-b border-line bg-canvas px-3 py-2.5 pt-[max(0.625rem,var(--safe-top))] sm:px-5">
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close report" className="shrink-0 text-ink-2 hover:text-ink">
          <X />
        </Button>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <FileText className="hidden h-5 w-5 shrink-0 text-ember sm:block" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-ink sm:text-[15px]">{title}</div>
            <div className="truncate text-xs text-ink-3">
              {subtitle}
              {doc ? `${subtitle ? " · " : ""}${doc.numPages} ${doc.numPages === 1 ? "page" : "pages"}` : ""}
            </div>
          </div>
        </div>
        <div className="hidden items-center gap-1 rounded-lg border border-line bg-surface p-0.5 md:flex">
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Zoom out" disabled={zoom <= 0.6} onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.2).toFixed(1)))}>
            <Minus />
          </Button>
          <span className="w-11 text-center font-mono text-xs text-ink-2">{Math.round(zoom * 100)}%</span>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Zoom in" disabled={zoom >= 2} onClick={() => setZoom((z) => Math.min(2, +(z + 0.2).toFixed(1)))}>
            <Plus />
          </Button>
        </div>
        <Button variant="outline" size="sm" disabled={!report} onClick={() => report && onDownload(report)} className="shrink-0">
          <Download />
          <span className="hidden sm:inline">Download</span>
        </Button>
        <Button size="sm" disabled={!report || sending} onClick={() => void send()} className="shrink-0">
          {sending ? <Loader2 className="animate-spin" /> : <Mail />}
          <span className="hidden sm:inline">Send</span>
        </Button>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto overscroll-contain [-webkit-overflow-scrolling:touch]">
        {error ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
            <p className="max-w-sm text-sm text-ink-2">{error}</p>
            <Button variant="outline" onClick={() => setAttempt((a) => a + 1)}>
              <RefreshCw />
              Try again
            </Button>
          </div>
        ) : !doc ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-ink-2">
            <Loader2 className="h-7 w-7 animate-spin text-ember" />
            <p className="text-sm">Preparing report with photos…</p>
          </div>
        ) : (
          <div className={cn("flex flex-col gap-5 px-4 py-6 sm:py-8", pageWidth > containerWidth - 32 ? "items-start" : "items-center")}>
            {pages.map((n) => (
              <PdfPage key={n} doc={doc} pageNumber={n} width={pageWidth} />
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};
