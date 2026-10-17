type PdfJs = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<PdfJs> | null = null;

/** Lazily loads the PDF renderer (kept out of the main bundle). */
export const loadPdfJs = (): Promise<PdfJs> => {
  pdfjsPromise ??= Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs") as unknown as Promise<PdfJs>,
    import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
  ]).then(([lib, worker]) => {
    lib.GlobalWorkerOptions.workerSrc = (worker as { default: string }).default;
    return lib;
  });
  return pdfjsPromise;
};
