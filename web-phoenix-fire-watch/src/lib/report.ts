import { differenceInMinutes, format } from "date-fns";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

import { signPhotoUrls } from "@/hooks/use-photo-urls";
import { BRAND, drawBrandLogo, drawPageFooter, drawRunningHeader, loadBrandLogo, loadBrandMark, type RGB } from "./pdf-brand";

import { STATUS_META, type Patrol, type PatrolStatus, type Property } from "./types";

export interface ShiftReportOptions {
  orgName: string;
  preparedBy: string;
  property: Property;
  patrols: Patrol[];
  /** e.g. "Fire Watch #2" or "All Patrols" */
  periodLabel: string;
  includePhotos?: boolean;
}

const INK: RGB = BRAND.ink;
const INK_2: RGB = BRAND.ink2;
const INK_3: RGB = BRAND.ink3;
const LINE: RGB = BRAND.line;
const PAPER_2: RGB = BRAND.paper2;
const CANVAS: RGB = [11, 11, 12];
const HEAD_FILL: RGB = [240, 241, 243];
const EMBER: RGB = BRAND.ember;

const STATUS_RGB: Record<PatrolStatus, RGB> = {
  clear: [22, 163, 74],
  "follow-up": [217, 138, 12],
  incident: [220, 38, 38],
};

const SIGNATURE_INK: RGB = [24, 38, 84];

const W = 612;
const H = 792;
const M = 40;
const MAX_PHOTOS = 48;
const MAX_SIGNATURES = 6;
const SCRIPT_FONT = "GreatVibes";

let scriptFontCache: string | null | undefined;

/** Loads the handwriting font used for electronic signatures (cached; null if unavailable). */
const loadScriptFont = async (): Promise<string | null> => {
  if (scriptFontCache !== undefined) return scriptFontCache;
  try {
    const res = await fetch("/fonts/GreatVibes-Regular.ttf");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    scriptFontCache = btoa(binary);
  } catch (err) {
    console.warn("[Report] signature font unavailable", err);
    scriptFontCache = null;
  }
  return scriptFontCache;
};

interface LoadedImage {
  data: string;
  w: number;
  h: number;
}

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load image`));
    img.src = src;
  });

const toJpeg = async (src: string, max: number, background = "#ffffff"): Promise<LoadedImage | null> => {
  try {
    const img = await loadImage(src);
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return { data: canvas.toDataURL("image/jpeg", 0.82), w, h };
  } catch (err) {
    console.warn("[Report] image skipped", err);
    return null;
  }
};

const durationLabel = (minutes: number): string => {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
};

const safeFilePart = (s: string): string =>
  s
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "Property";

/** Builds the branded Fire Watch Shift Report PDF. */
export async function buildShiftReport(opts: ShiftReportOptions): Promise<{ blob: Blob; fileName: string }> {
  const { orgName, preparedBy, property, periodLabel, includePhotos = true } = opts;
  const patrols = [...opts.patrols].sort((a, b) => Date.parse(a.dateTime) - Date.parse(b.dateTime));
  const now = new Date();
  const reportId = `PFW-${format(now, "yyMMdd-HHmm")}-${property.id.slice(0, 4).toUpperCase()}`;

  const doc = new jsPDF({ unit: "pt", format: "letter", compress: true });
  doc.setProperties({
    title: `Fire Watch Shift Report — ${property.name}`,
    subject: periodLabel,
    author: orgName,
    creator: "Phoenix Fire Watch",
  });

  const [logo, scriptFont] = await Promise.all([loadBrandLogo(), loadScriptFont()]);
  const mark = await loadBrandMark();
  let hasScript = false;
  if (scriptFont) {
    try {
      doc.addFileToVFS("GreatVibes-Regular.ttf", scriptFont);
      doc.addFont("GreatVibes-Regular.ttf", SCRIPT_FONT, "normal");
      hasScript = true;
    } catch (err) {
      console.warn("[Report] could not register signature font", err);
    }
  }

  const setText = (rgb: RGB) => doc.setTextColor(rgb[0], rgb[1], rgb[2]);
  const setFill = (rgb: RGB) => doc.setFillColor(rgb[0], rgb[1], rgb[2]);
  const setDraw = (rgb: RGB) => doc.setDrawColor(rgb[0], rgb[1], rgb[2]);

  const sectionTitle = (label: string, y: number) => {
    setFill(EMBER);
    doc.rect(M, y - 8, 3, 10, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    setText(INK);
    doc.text(label.toUpperCase(), M + 10, y, { charSpace: 1.2 });
  };

  // ---- Page 1 letterhead: official logo lockup beside the organization name
  const logoH = 56;
  if (logo) {
    const lw = drawBrandLogo(doc, logo, M, 24, logoH);
    const lx = M + lw + 14;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    setText(INK);
    doc.text(orgName, lx, 50, { maxWidth: 240 });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    setText(EMBER);
    doc.text("FIRE WATCH SERVICES", lx + 0.5, 64, { charSpace: 2.2 });
  } else {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(17);
    setText(INK);
    doc.text("PHOENIX", M, 44, { charSpace: 2.2 });
    doc.setFontSize(7.5);
    setText(EMBER);
    doc.text("FIRE WATCH", M + 0.5, 58, { charSpace: 3.4 });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    setText(INK_3);
    doc.text(orgName, M, 74, { maxWidth: 200 });
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12.5);
  setText(INK);
  doc.text("FIRE WATCH SHIFT REPORT", W - M, 40, { align: "right", charSpace: 0.8 });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  setText(INK_2);
  doc.text(periodLabel, W - M, 56, { align: "right" });
  setText(INK_3);
  doc.text(`Report ID  ${reportId}`, W - M, 70, { align: "right" });
  doc.text(`Generated  ${format(now, "MMM d, yyyy · h:mm a")}`, W - M, 83, { align: "right" });

  setFill(LINE);
  doc.rect(M + 52, 97.7, W - 2 * M - 52, 0.6, "F");
  setFill(EMBER);
  doc.rect(M, 97, 52, 1.8, "F");

  // ---- Property title
  let y = 136;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(19);
  setText(INK);
  const nameLines = doc.splitTextToSize(property.name, W - 2 * M) as string[];
  doc.text(nameLines, M, y);
  y += (nameLines.length - 1) * 22 + 17;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  setText(INK_2);
  if (property.address) {
    const addr = doc.splitTextToSize(property.address, W - 2 * M) as string[];
    doc.text(addr, M, y);
    y += addr.length * 12;
  }
  y += 14;

  // ---- Info boxes
  const first = patrols[0];
  const last = patrols[patrols.length - 1];
  const officers = Array.from(new Set(patrols.map((p) => p.officerName.trim()).filter(Boolean)));
  const boxW = (W - 2 * M - 12) / 2;
  const boxH = 96;

  const infoBox = (x: number, title: string, rows: [string, string][]) => {
    setFill(PAPER_2);
    setDraw(LINE);
    doc.setLineWidth(0.8);
    doc.roundedRect(x, y, boxW, boxH, 6, 6, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    setText(EMBER);
    doc.text(title.toUpperCase(), x + 14, y + 19, { charSpace: 1.3 });
    let ry = y + 38;
    for (const [label, value] of rows) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      setText(INK_3);
      doc.text(label, x + 14, ry);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      setText(INK);
      const v = (doc.splitTextToSize(value || "—", boxW - 100) as string[])[0] ?? "—";
      doc.text(v, x + 86, ry);
      ry += 17;
    }
  };

  infoBox(M, "Property Contact", [
    ["Contact", property.contactName],
    ["Phone", property.contactPhone],
    ["Email", property.contactEmail],
  ]);
  infoBox(M + boxW + 12, "Watch Period", [
    ["First patrol", first ? format(new Date(first.dateTime), "MMM d, yyyy · h:mm a") : "—"],
    ["Last patrol", last ? format(new Date(last.dateTime), "MMM d, yyyy · h:mm a") : "—"],
    ["Officers", officers.length ? officers.join(", ") : "—"],
  ]);
  y += boxH + 16;

  // ---- Stat tiles
  const counts = { clear: 0, "follow-up": 0, incident: 0 } as Record<PatrolStatus, number>;
  for (const p of patrols) counts[p.status] += 1;
  const tiles: { label: string; value: number; color: RGB }[] = [
    { label: "Total Patrols", value: patrols.length, color: EMBER },
    { label: "Clear", value: counts.clear, color: STATUS_RGB.clear },
    { label: "Follow-up", value: counts["follow-up"], color: STATUS_RGB["follow-up"] },
    { label: "Incidents", value: counts.incident, color: STATUS_RGB.incident },
  ];
  const tileW = (W - 2 * M - 30) / 4;
  const tileH = 60;
  tiles.forEach((t, i) => {
    const x = M + i * (tileW + 10);
    setFill([255, 255, 255]);
    setDraw(LINE);
    doc.roundedRect(x, y, tileW, tileH, 6, 6, "FD");
    setFill(t.color);
    doc.rect(x + 1, y + 1, 3, tileH - 2, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    setText(INK_3);
    doc.text(t.label.toUpperCase(), x + 16, y + 20, { charSpace: 1 });
    doc.setFontSize(22);
    setText(INK);
    doc.text(String(t.value), x + 16, y + 47);
  });
  y += tileH + 16;

  // ---- Coverage line
  if (patrols.length >= 2 && first && last) {
    let longest = 0;
    for (let i = 1; i < patrols.length; i += 1) {
      longest = Math.max(longest, differenceInMinutes(new Date(patrols[i].dateTime), new Date(patrols[i - 1].dateTime)));
    }
    const span = differenceInMinutes(new Date(last.dateTime), new Date(first.dateTime));
    const avg = Math.round(span / (patrols.length - 1));
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    setText(INK_2);
    doc.text(
      `Coverage span ${durationLabel(span)}   ·   Average interval ${durationLabel(avg)}   ·   Longest gap ${durationLabel(longest)}`,
      M,
      y,
    );
    y += 22;
  } else {
    y += 6;
  }

  // ---- Load patrol photos once (shared by the log thumbnails and the photo pages)
  const photoItems: { path: string; patrol: Patrol }[] = [];
  for (const p of patrols) for (const path of p.photos) photoItems.push({ path, patrol: p });
  const limited = includePhotos ? photoItems.slice(0, MAX_PHOTOS) : [];
  const loadedImgs = new Map<string, LoadedImage>();
  if (limited.length > 0) {
    let urls = new Map<string, string>();
    try {
      urls = await signPhotoUrls(limited.map((i) => i.path), 600);
    } catch (err) {
      console.warn("[Report] could not sign photo URLs", err);
    }
    await Promise.all(
      limited.map(async (item) => {
        const url = urls.get(item.path);
        const img = url ? await toJpeg(url, 900) : null;
        if (img) loadedImgs.set(item.path, img);
      }),
    );
  }
  const photoNumber = new Map<string, number>();
  for (const item of limited) if (loadedImgs.has(item.path)) photoNumber.set(item.path, photoNumber.size + 1);
  const photoAlias = (path: string) => `patrol-photo-${photoNumber.get(path) ?? 0}`;
  const loadedFor = (p: Patrol) => p.photos.filter((path) => loadedImgs.has(path));

  const THUMB = 34;
  const PHOTO_COL = 4 + THUMB * 2 + 4 + 12;

  // ---- Patrol log table
  sectionTitle("Patrol Log", y);
  autoTable(doc, {
    startY: y + 10,
    margin: { left: M, right: M, top: 64, bottom: 56 },
    rowPageBreak: "avoid",
    head: [["#", "Date / Time", "Officer", "Areas Patrolled", "Status", "Notes", "Photos"]],
    body: patrols.map((p, i) => {
      const shown = loadedFor(p).length;
      const photoText = p.photos.length === 0 ? "—" : shown === 0 ? `${p.photos.length} photo${p.photos.length > 1 ? "s" : ""}` : "";
      return [
        String(i + 1),
        `${format(new Date(p.dateTime), "MMM d, yyyy")}\n${format(new Date(p.dateTime), "h:mm a")}`,
        p.officerName,
        p.areas.join(", "),
        STATUS_META[p.status].label,
        p.notes || "—",
        photoText,
      ];
    }),
    theme: "plain",
    styles: {
      font: "helvetica",
      fontSize: 8.5,
      textColor: INK,
      cellPadding: { top: 6, bottom: 6, left: 6, right: 6 },
      lineColor: LINE,
      lineWidth: { bottom: 0.6 },
      valign: "middle",
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: HEAD_FILL,
      textColor: INK,
      fontStyle: "bold",
      fontSize: 7.5,
      cellPadding: { top: 7, bottom: 7, left: 6, right: 6 },
      lineWidth: 0,
    },
    alternateRowStyles: { fillColor: PAPER_2 },
    columnStyles: {
      0: { cellWidth: 22, halign: "center", textColor: INK_3 },
      1: { cellWidth: 68 },
      2: { cellWidth: 72 },
      3: { cellWidth: "auto" },
      4: { cellWidth: 64, fontStyle: "bold", cellPadding: { top: 6, bottom: 6, left: 16, right: 4 } },
      5: { cellWidth: 102, textColor: INK_2 },
      6: { cellWidth: PHOTO_COL, textColor: INK_3, fontSize: 7.5 },
    },
    didParseCell: (data) => {
      if (data.section !== "body") return;
      const p = patrols[data.row.index];
      if (!p) return;
      if (data.column.index === 4) data.cell.styles.textColor = STATUS_RGB[p.status];
      if (data.column.index === 6 && loadedFor(p).length > 0) data.cell.styles.minCellHeight = THUMB + 12 + 11;
    },
    didDrawCell: (data) => {
      if (data.section !== "body") return;
      const p = patrols[data.row.index];
      if (!p) return;
      if (data.column.index === 4) {
        setFill(STATUS_RGB[p.status]);
        doc.circle(data.cell.x + 9, data.cell.y + data.cell.height / 2, 2.4, "F");
      }
      if (data.column.index === 6) {
        const paths = loadedFor(p);
        if (paths.length === 0) return;
        const top = data.cell.y + 6;
        paths.slice(0, 2).forEach((path, k) => {
          const img = loadedImgs.get(path);
          if (!img) return;
          const x = data.cell.x + 6 + k * (THUMB + 4);
          // Center-crop into a square thumbnail.
          const s = Math.max(THUMB / img.w, THUMB / img.h);
          const dw = img.w * s;
          const dh = img.h * s;
          doc.saveGraphicsState();
          doc.roundedRect(x, top, THUMB, THUMB, 3, 3, null);
          doc.clip();
          doc.discardPath();
          doc.addImage(img.data, "JPEG", x + (THUMB - dw) / 2, top + (THUMB - dh) / 2, dw, dh, photoAlias(path), "FAST");
          doc.restoreGraphicsState();
          setDraw(LINE);
          doc.setLineWidth(0.6);
          doc.roundedRect(x, top, THUMB, THUMB, 3, 3, "S");
        });
        const extra = p.photos.length - 2;
        if (extra > 0) {
          const bx = data.cell.x + 6 + (THUMB + 4) + THUMB - 18;
          setFill(CANVAS);
          doc.roundedRect(bx, top + THUMB - 13, 16, 11, 3, 3, "F");
          doc.setFont("helvetica", "bold");
          doc.setFontSize(6.5);
          setText([255, 255, 255]);
          doc.text(`+${extra}`, bx + 8, top + THUMB - 5.5, { align: "center" });
        }
        const nums = paths.map((path) => photoNumber.get(path) ?? 0).filter(Boolean);
        const first = nums[0];
        const last = nums[nums.length - 1];
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6.5);
        setText(INK_3);
        doc.text(first === last ? `Photo ${first}` : `Photos ${first}–${last}`, data.cell.x + 6, top + THUMB + 9);
      }
    },
  });

  const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 40;
  y = finalY;

  if (patrols.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    setText(INK_3);
    doc.text("No patrols were recorded for this period.", M, y + 18);
    y += 24;
  }

  // ---- Certification + officer electronic signatures
  const patrolCountByOfficer = new Map<string, number>();
  for (const p of patrols) {
    const name = p.officerName.trim();
    if (name) patrolCountByOfficer.set(name, (patrolCountByOfficer.get(name) ?? 0) + 1);
  }
  const signers = Array.from(patrolCountByOfficer.entries()).sort((a, b) => b[1] - a[1]);
  if (signers.length === 0) signers.push([preparedBy, 0]);
  const shownSigners = signers.slice(0, MAX_SIGNATURES);
  const sigCols = 2;
  const sigGap = 20;
  const sigW = (W - 2 * M - sigGap) / sigCols;
  const sigH = 92;
  const sigRows = Math.ceil(shownSigners.length / sigCols);
  const certH = 66 + sigRows * (sigH + 12) + 30;

  y += 30;
  if (y + certH > H - 56) {
    doc.addPage();
    y = 84;
  }
  sectionTitle("Certification", y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  setText(INK_2);
  const officerPhrase = shownSigners.length > 1 ? "the undersigned fire watch officers certify" : "the undersigned fire watch officer certifies";
  const certLines = doc.splitTextToSize(
    `By electronic signature below, ${officerPhrase} that the fire watch patrols recorded in this report were conducted at ${property.name} as documented above, and that all observations are accurate and complete to the best of their knowledge.`,
    W - 2 * M,
  ) as string[];
  doc.text(certLines, M, y + 18);
  y += 18 + certLines.length * 11 + 12;

  const signedAt = format(now, "MMM d, yyyy · h:mm a");
  shownSigners.forEach(([name, count], idx) => {
    const col = idx % sigCols;
    const row = Math.floor(idx / sigCols);
    const x = M + col * (sigW + sigGap);
    const by = y + row * (sigH + 12);

    setFill(PAPER_2);
    setDraw(LINE);
    doc.setLineWidth(0.8);
    doc.roundedRect(x, by, sigW, sigH, 6, 6, "FD");

    // E-signed badge
    const badgeW = 74;
    setDraw(EMBER);
    doc.setLineWidth(0.8);
    doc.roundedRect(x + sigW - badgeW - 10, by + 9, badgeW, 15, 7.5, 7.5, "S");
    doc.setLineWidth(1.1);
    const cx = x + sigW - badgeW - 1;
    doc.line(cx, by + 16.5, cx + 2.4, by + 19);
    doc.line(cx + 2.4, by + 19, cx + 6.5, by + 13.5);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.3);
    setText(EMBER);
    doc.text("E-SIGNED", cx + 11, by + 19, { charSpace: 0.9 });

    // Handwritten signature
    const lineY = by + 52;
    if (hasScript) {
      doc.setFont(SCRIPT_FONT, "normal");
      let size = 26;
      doc.setFontSize(size);
      while (doc.getTextWidth(name) > sigW - 40 && size > 14) {
        size -= 1;
        doc.setFontSize(size);
      }
    } else {
      doc.setFont("times", "italic");
      doc.setFontSize(18);
    }
    setText(SIGNATURE_INK);
    doc.text(name, x + 16, lineY - 7);

    setDraw([160, 163, 170]);
    doc.setLineWidth(0.7);
    doc.line(x + 14, lineY, x + sigW - 14, lineY);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    setText(INK);
    const printed = (doc.splitTextToSize(name, sigW - 150) as string[])[0] ?? name;
    doc.text(printed, x + 14, lineY + 14);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    setText(INK_3);
    doc.text("FIRE WATCH OFFICER", x + sigW - 14, lineY + 14, { align: "right", charSpace: 0.7 });
    doc.text(
      `Signed electronically ${signedAt}${count ? `  ·  ${count} patrol${count === 1 ? "" : "s"}` : ""}`,
      x + 14,
      lineY + 28,
    );
  });
  y += sigRows * (sigH + 12);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  setText(INK_3);
  const extra = signers.length - shownSigners.length;
  const footNote = [
    extra > 0 ? `${extra} additional officer${extra === 1 ? " is" : "s are"} identified in the patrol log.` : "",
    `Electronic signatures applied by Phoenix Fire Watch from the officer names recorded on each patrol · Report ${reportId} · Prepared by ${preparedBy}, ${orgName}.`,
  ]
    .filter(Boolean)
    .join(" ");
  doc.text(doc.splitTextToSize(footNote, W - 2 * M) as string[], M, y + 6);

  // ---- Photo documentation
  if (includePhotos && photoItems.length > 0) {
    const items = photoItems;
    const usable = limited
      .filter((item) => loadedImgs.has(item.path))
      .map((item) => ({ ...item, img: loadedImgs.get(item.path) as LoadedImage }));

    if (usable.length > 0) {
      doc.addPage();
      y = 84;
      sectionTitle("Photo Documentation", y);
      y += 16;
      const cols = 3;
      const gap = 12;
      const cellW = (W - 2 * M - gap * (cols - 1)) / cols;
      const imgH = cellW * 0.75;
      const cellH = imgH + 36;
      usable.forEach((item, idx) => {
        const col = idx % cols;
        if (col === 0 && idx > 0) y += cellH + gap;
        if (col === 0 && y + cellH > H - 56) {
          doc.addPage();
          y = 72;
        }
        const x = M + col * (cellW + gap);
        setFill(PAPER_2);
        setDraw(LINE);
        doc.setLineWidth(0.6);
        doc.roundedRect(x, y, cellW, imgH, 4, 4, "FD");
        const img = item.img;
        const scale = Math.min((cellW - 8) / img.w, (imgH - 8) / img.h);
        const dw = img.w * scale;
        const dh = img.h * scale;
        doc.addImage(img.data, "JPEG", x + (cellW - dw) / 2, y + (imgH - dh) / 2, dw, dh, photoAlias(item.path), "FAST");
        const p = item.patrol;
        setFill(CANVAS);
        doc.roundedRect(x + 6, y + 6, 40, 13, 3, 3, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(6.5);
        setText([255, 255, 255]);
        doc.text(`PHOTO ${photoNumber.get(item.path) ?? idx + 1}`, x + 26, y + 15, { align: "center" });
        doc.setFontSize(7.5);
        setText(INK);
        doc.text(format(new Date(p.dateTime), "MMM d, yyyy · h:mm a"), x, y + imgH + 13);
        setText(STATUS_RGB[p.status]);
        doc.text(STATUS_META[p.status].label, x + cellW, y + imgH + 13, { align: "right" });
        doc.setFont("helvetica", "normal");
        setText(INK_3);
        const sub = (doc.splitTextToSize(`${p.officerName} · ${p.areas.join(", ")}`, cellW) as string[])[0] ?? "";
        doc.text(sub, x, y + imgH + 25);
      });
      if (items.length > MAX_PHOTOS) {
        y += cellH + 8;
        if (y > H - 70) {
          doc.addPage();
          y = 84;
        }
        doc.setFont("helvetica", "italic");
        doc.setFontSize(8);
        setText(INK_3);
        doc.text(`${items.length - MAX_PHOTOS} additional photos are available in the Phoenix Fire Watch app.`, M, y + 8);
      }
    }
  }

  // ---- Running header (pages 2+) and footer (all pages)
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    if (i > 1) drawRunningHeader(doc, mark, `${property.name}  ·  ${periodLabel}`);
    drawPageFooter(doc, {
      orgName,
      docLabel: "Fire Watch Shift Report",
      reportId,
      note: "Confidential",
    });
  }

  const datePart = first ? format(new Date(first.dateTime), "yyyy-MM-dd") : format(now, "yyyy-MM-dd");
  const fileName = `FireWatch_Report_${safeFilePart(property.name)}_${datePart}.pdf`;
  return { blob: doc.output("blob"), fileName };
}

/** Triggers a browser download for a generated blob. */
export const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
};
