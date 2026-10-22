import { AlertTriangle, Loader2 } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { memo, useEffect, useRef, useState } from "react";

import { loadPdfJs } from "@/lib/pdfjs";
import { cn } from "@/lib/utils";

const Page = memo(({ doc, pageNumber, width, label }: { doc: PDFDocumentProxy; pageNumber: number; width: number; label: string }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ratio, setRatio] = useState(792 / 612);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    void (async () => {
      try {
        const page = await doc.getPage(pageNumber);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        setRatio(base.height / base.width);
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
        if (!cancelled && !(err instanceof Error && err.name === "RenderingCancelledException")) console.warn("[pdf] page render failed", err);
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, pageNumber, width]);

  return (
    <div className="relative mx-auto bg-white" style={{ width, minHeight: width * ratio }}>
      <canvas ref={canvasRef} className="block" aria-label={`${label} — page ${pageNumber}`} />
      {!rendered && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      )}
    </div>
  );
});
Page.displayName = "PdfPage";

/** Renders every page of a PDF, fitted to the container width. */
export const PdfPages = ({
  data,
  label = "Agreement",
  className,
  pageClassName,
  onReady,
}: {
  data: Uint8Array;
  label?: string;
  className?: string;
  pageClassName?: string;
  onReady?: (pages: number) => void;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState(false);
  const [width, setWidth] = useState(0);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    let cancelled = false;
    let loaded: PDFDocumentProxy | null = null;
    setDoc(null);
    setError(false);
    void (async () => {
      try {
        const pdfjs = await loadPdfJs();
        // pdf.js takes ownership of the buffer it's given, so hand it a copy.
        loaded = await pdfjs.getDocument({ data: data.slice() }).promise;
        if (cancelled) return void loaded.loadingTask.destroy();
        setDoc(loaded);
        onReadyRef.current?.(loaded.numPages);
      } catch (err) {
        console.error("[pdf] load failed", err);
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
      if (loaded) void loaded.loadingTask.destroy();
    };
  }, [data]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(Math.floor(el.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} className={cn("w-full", className)}>
      {error ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center text-sm text-slate-500">
          <AlertTriangle className="h-6 w-6 text-amber-500" />
          This document couldn't be displayed. Try reloading the page.
        </div>
      ) : !doc || width === 0 ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      ) : (
        <div className="grid gap-4">
          {Array.from({ length: doc.numPages }, (_, i) => (
            <div key={i} className={pageClassName}>
              <Page doc={doc} pageNumber={i + 1} width={width} label={label} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
