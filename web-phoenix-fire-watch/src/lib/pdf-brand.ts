/**
 * Shared brand kit for every generated PDF: the official logo and the palette.
 * Letterheads, running headers and footers all pull from here so reports stay consistent.
 */
import type { jsPDF } from "jspdf";

export type RGB = [number, number, number];

export const BRAND = {
  ink: [22, 23, 26] as RGB,
  ink2: [92, 95, 102] as RGB,
  ink3: [138, 141, 148] as RGB,
  line: [224, 225, 229] as RGB,
  paper2: [247, 247, 248] as RGB,
  ember: [220, 38, 38] as RGB,
};

export interface BrandLogo {
  data: string;
  w: number;
  h: number;
}

let logoCache: BrandLogo | null | undefined;
let markCache: BrandLogo | null | undefined;

const loadFlattened = async (src: string, max: number): Promise<BrandLogo | null> => {
  try {
    const img = await loadImage(src);
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas context");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return { data: canvas.toDataURL("image/jpeg", 0.9), w, h };
  } catch (err) {
    console.warn("[PdfBrand] logo unavailable", err);
    return null;
  }
};

/**
 * Loads the official Phoenix Fire Watch logo (public/phoenix-logo-brand.png), flattened onto
 * white as a JPEG for the PDF. Cached; null when unavailable so documents render unbranded.
 */
export const loadBrandLogo = async (): Promise<BrandLogo | null> => {
  if (logoCache === undefined) logoCache = await loadFlattened("/phoenix-logo-brand.png", 480);
  return logoCache;
};

/**
 * Mark-only variant (the phoenix seal without the wordmark) for small placements such as
 * running headers, where the full lockup would be illegible. Falls back to the full logo.
 */
export const loadBrandMark = async (): Promise<BrandLogo | null> => {
  if (markCache === undefined) {
    markCache = await loadFlattened("/phoenix-mark.png", 240);
    if (!markCache) markCache = await loadBrandLogo();
  }
  return markCache;
};

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image"));
    img.src = src;
  });

/** Aspect-correct size for drawing the logo at a given height. */
export const logoSize = (logo: BrandLogo, height: number): [number, number] => {
  const w = (height * logo.w) / logo.h;
  return [w, height];
};

/** Draws the logo with its top-left corner at (x, y). Returns the width drawn. */
export const drawBrandLogo = (doc: jsPDF, logo: BrandLogo, x: number, y: number, height: number): number => {
  const [w, h] = logoSize(logo, height);
  doc.addImage(logo.data, "JPEG", x, y, w, h, undefined, "FAST");
  return w;
};

/**
 * Draws the shared running header used on every page after the first: small logo, wordmark,
 * right-aligned context line, and the hairline rule with the ember accent.
 */
export const drawRunningHeader = (
  doc: jsPDF,
  logo: BrandLogo | null,
  context: string,
  opts?: { wordmark?: string; width?: number; margin?: number },
): void => {
  const W = doc.internal.pageSize.getWidth();
  const M = opts?.margin ?? 40;
  let x = M;
  if (logo) x += drawBrandLogo(doc, logo, M, 20, 26) + 12;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...BRAND.ink);
  doc.text(opts?.wordmark ?? "PHOENIX FIRE WATCH", x, 32, { charSpace: 1.2 });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...BRAND.ink3);
  doc.text(doc.splitTextToSize(context, W - M - x - 12)[0] ?? "", W - M, 30, { align: "right" });
  doc.setFillColor(...BRAND.line);
  doc.rect(M + (logo ? 40 : 0), 43.7, W - 2 * M - (logo ? 40 : 0), 0.5, "F");
  doc.setFillColor(...BRAND.ember);
  doc.rect(M, 43, logo ? 40 : 52, 1.6, "F");
};

/** Draws the shared footer: hairline rule, brand line, confidential note, and page numbers. */
export const drawPageFooter = (
  doc: jsPDF,
  opts: { orgName: string; docLabel: string; reportId?: string; note?: string },
): void => {
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 40;
  doc.setDrawColor(...BRAND.line);
  doc.setLineWidth(0.6);
  doc.line(M, H - 38, W - M, H - 38);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...BRAND.ink3);
  const left = [opts.orgName, opts.docLabel, opts.reportId].filter(Boolean).join("  ·  ");
  doc.text(left, M, H - 24);
  if (opts.note) doc.text(opts.note, W / 2 + 60, H - 24, { align: "center" });
  doc.text(`Page ${doc.getCurrentPageInfo().pageNumber} of ${doc.getNumberOfPages()}`, W - M, H - 24, {
    align: "right",
  });
};
