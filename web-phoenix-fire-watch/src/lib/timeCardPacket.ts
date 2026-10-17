import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import type { jsPDF } from "jspdf";

import { timeOfDay } from "@/lib/format";
import { BRAND, fitText } from "@/lib/pdf-brand";
import { loadPdfJs } from "@/lib/pdfjs";
import { supabase } from "@/lib/supabase";
import { toDateKey } from "@/lib/schedule";
import { entryMinutes, fmtHours, loadEntries, type TimeEntry } from "@/lib/timeclock";
import * as api from "@/lib/workforce/api";
import type { DocVersion, WfDocument } from "@/lib/workforce/constants";
import { buildPdf, downloadBlob, type PdfCell, type PdfSection } from "@/lib/workforce/exports";

/** A time card file in the packet, numbered TC-01, TC-02… in the order it appears. */
export interface PacketCard {
  ref: string;
  doc: WfDocument;
  version: DocVersion;
  /** True when matched to the shift by date rather than attached to it in Payroll. */
  byDate: boolean;
}

export interface PacketShift {
  entry: TimeEntry;
  day: string;
  minutes: number;
  site: string;
  cards: PacketCard[];
}

export interface PacketWorker {
  key: string;
  name: string;
  agency: string;
  shifts: PacketShift[];
  minutes: number;
  /** Tickets dated in the range that couldn't be tied to one of their shifts. */
  loose: PacketCard[];
}

export interface Packet {
  from: string;
  to: string;
  workers: PacketWorker[];
}

interface TempWorker {
  id: string;
  profileId: string | null;
  name: string;
  agencyId: string | null;
  agency: string;
}

const nameKey = (n: string) => n.trim().replace(/\s+/g, " ").toLowerCase();
const dayOf = (iso: string): string => toDateKey(new Date(iso));

const chunk = <T,>(xs: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

const loadTempWorkers = async (): Promise<TempWorker[]> => {
  const [w, a] = await Promise.all([
    supabase.from("wf_workers").select("id, profile_id, first_name, last_name, agency_id, source, archived_at").eq("source", "agency"),
    supabase.from("wf_agencies").select("id, name"),
  ]);
  if (w.error) throw api.wfError(w.error);
  const agencyName = new Map<string, string>((a.data ?? []).map((r) => [r.id, r.name]));
  return (w.data ?? []).map((r) => ({
    id: r.id,
    profileId: r.profile_id,
    name: `${r.first_name} ${r.last_name}`.trim(),
    agencyId: r.agency_id,
    agency: (r.agency_id && agencyName.get(r.agency_id)) || "",
  }));
};

/**
 * Gathers every temp-agency worker's shifts that started between `from` and `to` (inclusive, device
 * time), plus the time cards attached to each shift. Tickets on a worker's file that are dated on a shift
 * day but not attached yet are matched to that day's shift so nothing is left out.
 */
export const loadPacket = async (opts: { from: string; to: string; agencyId?: string; siteName: (id: string | null) => string }): Promise<Packet> => {
  const start = parseISO(opts.from);
  const days = differenceInCalendarDays(parseISO(opts.to), start) + 1;
  const [entries, temps] = await Promise.all([loadEntries({ start, days }), loadTempWorkers()]);
  const scoped = temps.filter((t) => !opts.agencyId || t.agencyId === opts.agencyId);
  const byProfile = new Map(scoped.filter((t) => t.profileId).map((t) => [t.profileId as string, t]));
  const byName = new Map(scoped.map((t) => [nameKey(t.name), t]));

  const workers = new Map<string, PacketWorker & { tempId: string }>();
  for (const e of entries) {
    if (e.status === "rejected") continue;
    const t = (e.profileId ? byProfile.get(e.profileId) : undefined) ?? byName.get(nameKey(e.workerName));
    if (!t) continue;
    let w = workers.get(t.id);
    if (!w) {
      w = { key: t.id, tempId: t.id, name: t.name || e.workerName, agency: t.agency, shifts: [], minutes: 0, loose: [] };
      workers.set(t.id, w);
    }
    const minutes = e.clockOut ? entryMinutes(e) : 0;
    w.shifts.push({ entry: e, day: dayOf(e.clockIn), minutes, site: opts.siteName(e.propertyId), cards: [] });
    w.minutes += minutes;
  }

  const entryIds = [...workers.values()].flatMap((w) => w.shifts.map((s) => s.entry.id));
  const workerIds = [...workers.keys()];
  const docs = new Map<string, WfDocument>();
  const results = await Promise.all([
    ...chunk(entryIds, 150).map((ids) => supabase.from("wf_documents").select("*").in("time_entry_id", ids).is("archived_at", null)),
    ...chunk(workerIds, 150).map((ids) =>
      supabase
        .from("wf_documents")
        .select("*")
        .in("worker_id", ids)
        .eq("category", "time_ticket")
        .is("time_entry_id", null)
        .is("archived_at", null)
        .gte("issue_date", opts.from)
        .lte("issue_date", opts.to),
    ),
  ]);
  for (const r of results) {
    if (r.error) throw api.wfError(r.error);
    for (const d of (r.data ?? []) as WfDocument[]) docs.set(d.id, d);
  }
  const versions = new Map<string, DocVersion>();
  const docList = [...docs.values()];
  for (const ids of chunk(docList.map((d) => d.id), 150)) {
    const { data, error } = await supabase.from("wf_document_versions").select("*").in("document_id", ids);
    if (error) throw api.wfError(error);
    for (const v of (data ?? []) as DocVersion[]) {
      const d = docs.get(v.document_id);
      if (d && v.version === d.current_version) versions.set(d.id, v);
    }
  }

  const shiftById = new Map<string, PacketShift>();
  for (const w of workers.values()) for (const s of w.shifts) shiftById.set(s.entry.id, s);
  const pending: { w: PacketWorker; s: PacketShift | null; doc: WfDocument; version: DocVersion; byDate: boolean }[] = [];
  for (const d of docList.sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const version = versions.get(d.id);
    if (!version) continue;
    if (d.time_entry_id) {
      const s = shiftById.get(d.time_entry_id);
      const w = s ? [...workers.values()].find((x) => x.shifts.includes(s)) : undefined;
      if (s && w) pending.push({ w, s, doc: d, version, byDate: false });
      continue;
    }
    const w = d.worker_id ? workers.get(d.worker_id) : undefined;
    if (!w) continue;
    const s = w.shifts.find((x) => x.day === d.issue_date) ?? null;
    pending.push({ w, s, doc: d, version, byDate: true });
  }

  const list = [...workers.values()].sort((a, b) => a.agency.localeCompare(b.agency) || a.name.localeCompare(b.name));
  for (const w of list) w.shifts.sort((a, b) => a.entry.clockIn.localeCompare(b.entry.clockIn));
  // Number the cards in reading order: worker by worker, shift by shift.
  let n = 0;
  const ref = () => `TC-${String(++n).padStart(2, "0")}`;
  for (const w of list) {
    for (const s of w.shifts) {
      for (const p of pending.filter((x) => x.s === s)) s.cards.push({ ref: ref(), doc: p.doc, version: p.version, byDate: p.byDate });
    }
    for (const p of pending.filter((x) => x.w === w && x.s === null)) w.loose.push({ ref: ref(), doc: p.doc, version: p.version, byDate: true });
  }
  return { from: opts.from, to: opts.to, workers: list.map(({ tempId: _t, ...w }) => w) };
};

// ─── Rendering attachments ───────────────────────────────────────────────────

interface PageImage {
  data: string;
  w: number;
  h: number;
}

const MAX_PX = 1700;
const MAX_PDF_PAGES = 4;

const toJpeg = (source: CanvasImageSource, w: number, h: number): PageImage => {
  const scale = Math.min(1, MAX_PX / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, cw, ch);
  ctx.drawImage(source, 0, 0, cw, ch);
  return { data: canvas.toDataURL("image/jpeg", 0.82), w: cw, h: ch };
};

const imagePages = async (blob: Blob): Promise<PageImage[]> => {
  const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
  try {
    return [toJpeg(bmp, bmp.width, bmp.height)];
  } finally {
    bmp.close();
  }
};

const pdfPages = async (blob: Blob): Promise<{ pages: PageImage[]; total: number }> => {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) });
  const pdf = await task.promise;
  try {
    const pages: PageImage[] = [];
    for (let i = 1; i <= Math.min(pdf.numPages, MAX_PDF_PAGES); i++) {
      const page = await pdf.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(2.5, MAX_PX / Math.max(base.width, base.height)) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas unavailable");
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      pages.push(toJpeg(canvas, canvas.width, canvas.height));
    }
    return { pages, total: pdf.numPages };
  } finally {
    void task.destroy();
  }
};

type Rendered = { ok: true; pages: PageImage[]; truncated: number } | { ok: false; reason: string };

const renderCard = async (card: PacketCard): Promise<Rendered> => {
  try {
    const url = await api.documentUrl(card.version.id, "preview");
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const isPdf = card.version.mime_type === "application/pdf" || /\.pdf$/i.test(card.version.file_name);
    if (isPdf) {
      const { pages, total } = await pdfPages(blob);
      return { ok: true, pages, truncated: Math.max(0, total - pages.length) };
    }
    return { ok: true, pages: await imagePages(blob), truncated: 0 };
  } catch (err) {
    console.warn("[TimeCardPacket] couldn't include", card.ref, err instanceof Error ? err.message : err);
    return { ok: false, reason: "The file couldn't be opened. Download it from the worker's file instead." };
  }
};

/** Renders cards a few at a time so a long week doesn't open dozens of downloads at once. */
const renderAll = async (cards: PacketCard[], onProgress: (done: number, total: number) => void): Promise<Map<string, Rendered>> => {
  const out = new Map<string, Rendered>();
  let next = 0;
  let done = 0;
  onProgress(0, cards.length);
  const worker = async () => {
    while (next < cards.length) {
      const c = cards[next++];
      if (!c) break;
      out.set(c.ref, await renderCard(c));
      onProgress(++done, cards.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, cards.length) }, worker));
  return out;
};

// ─── PDF ─────────────────────────────────────────────────────────────────────

const shiftDayLabel = (s: PacketShift) => format(new Date(s.entry.clockIn), "EEE MMM d");
const STATUS_LABEL: Record<string, string> = { approved: "Approved", pending: "Awaiting approval", open: "On the clock" };

export const rangeLabel = (from: string, to: string): string => {
  const a = parseISO(from);
  const b = parseISO(to);
  return `${format(a, a.getFullYear() === b.getFullYear() ? "MMM d" : "MMM d, yyyy")} – ${format(b, "MMM d, yyyy")}`;
};

export const packetCards = (p: Packet): PacketCard[] => p.workers.flatMap((w) => [...w.shifts.flatMap((s) => s.cards), ...w.loose]);

/** Builds and downloads the time card packet: summary, per-worker shift tables, then every time card. */
export const downloadPacket = async (
  p: Packet,
  opts: { orgName: string; preparedBy: string; agencyLabel: string; onProgress: (done: number, total: number) => void },
): Promise<void> => {
  const cards = packetCards(p);
  const rendered = await renderAll(cards, opts.onProgress);
  const shifts = p.workers.reduce((n, w) => n + w.shifts.length, 0);
  const totalMin = p.workers.reduce((n, w) => n + w.minutes, 0);
  const missing = p.workers.reduce((n, w) => n + w.shifts.filter((s) => s.cards.length === 0 && s.entry.clockOut).length, 0);
  const unapproved = p.workers.reduce((n, w) => n + w.shifts.filter((s) => s.entry.status !== "approved").length, 0);
  const label = rangeLabel(p.from, p.to);
  const days = differenceInCalendarDays(parseISO(p.to), parseISO(p.from)) + 1;
  const dayKeys = Array.from({ length: Math.min(days, 7) }, (_, i) => toDateKey(addDays(parseISO(p.from), i)));
  const weekGrid = days <= 7;

  const sections: PdfSection[] = [
    {
      title: "Summary",
      metrics: [
        { label: "Temp workers", value: String(p.workers.length) },
        { label: "Shifts", value: String(shifts) },
        { label: "Total hours", value: fmtHours(totalMin) },
        { label: "Time cards", value: `${cards.length}`, hint: missing > 0 ? `${missing} ${missing === 1 ? "shift" : "shifts"} without one` : "Every shift has one" },
      ],
    },
    weekGrid
      ? {
          title: "Hours by day",
          table: {
            head: ["Worker", ...dayKeys.map((d) => format(parseISO(d), "EEE M/d")), "Total"],
            body: p.workers.map((w) => [
              w.agency ? `${w.name}\n${w.agency}` : w.name,
              ...dayKeys.map((d) => {
                const m = w.shifts.filter((s) => s.day === d).reduce((n, s) => n + s.minutes, 0);
                return w.shifts.some((s) => s.day === d) ? fmtHours(m) : "—";
              }),
              fmtHours(w.minutes),
            ]),
            numeric: [...dayKeys.map((_, i) => i + 1), dayKeys.length + 1],
            foot: [["Total", ...dayKeys.map((d) => fmtHours(p.workers.reduce((n, w) => n + w.shifts.filter((s) => s.day === d).reduce((x, s) => x + s.minutes, 0), 0))), fmtHours(totalMin)]],
          },
          note: "Hours are counted on the day the shift started.",
        }
      : {
          title: "Workers",
          table: {
            head: ["Worker", "Agency", "Days worked", "Shifts", "Hours", "Time cards"],
            body: p.workers.map((w) => [
              w.name,
              w.agency || "—",
              String(new Set(w.shifts.map((s) => s.day)).size),
              String(w.shifts.length),
              fmtHours(w.minutes),
              String(w.shifts.reduce((n, s) => n + s.cards.length, 0) + w.loose.length),
            ]),
            numeric: [2, 3, 4, 5],
            foot: [["Total", "", "", String(shifts), fmtHours(totalMin), String(cards.length)]],
          },
        },
    ...p.workers.map<PdfSection>((w) => {
      const body: PdfCell[][] = [];
      const highlight: number[] = [];
      for (const s of w.shifts) {
        if (s.cards.length === 0 && s.entry.clockOut) highlight.push(body.length);
        body.push([
          shiftDayLabel(s),
          timeOfDay(s.entry.clockIn),
          s.entry.clockOut ? timeOfDay(s.entry.clockOut) : "—",
          s.site,
          s.entry.clockOut ? fmtHours(s.minutes) : "—",
          STATUS_LABEL[s.entry.status] ?? s.entry.status,
          s.cards.length > 0 ? s.cards.map((c) => c.ref).join(", ") : "Missing",
        ]);
      }
      return {
        title: `${w.name}${w.agency ? ` — ${w.agency}` : ""}`,
        table: {
          head: ["Date", "Clock in", "Clock out", "Site", "Hours", "Status", "Time card"],
          body,
          highlightRows: highlight,
          numeric: [4],
          foot: [[{ content: `${new Set(w.shifts.map((s) => s.day)).size} days · ${w.shifts.length} ${w.shifts.length === 1 ? "shift" : "shifts"}`, colSpan: 4 }, fmtHours(w.minutes), "", ""]],
        },
        note:
          w.loose.length > 0
            ? `Also on file for this period, not tied to a shift: ${w.loose.map((c) => `${c.ref} (${c.doc.issue_date ? format(parseISO(c.doc.issue_date), "EEE MMM d") : "undated"})`).join(", ")}.`
            : undefined,
      };
    }),
  ];

  const notes = [
    unapproved > 0 ? `${unapproved} ${unapproved === 1 ? "shift is" : "shifts are"} not approved yet — hours may still change.` : "",
    "Highlighted shifts have no time card attached.",
  ].filter(Boolean);
  const last = sections[sections.length - 1];
  if (last && notes.length) last.note = [last.note, ...notes].filter(Boolean).join(" ");

  const cardContext = new Map<string, { w: PacketWorker; s: PacketShift | null }>();
  for (const w of p.workers) {
    for (const s of w.shifts) for (const c of s.cards) cardContext.set(c.ref, { w, s });
    for (const c of w.loose) cardContext.set(c.ref, { w, s: null });
  }

  const blob = await buildPdf({
    title: "Temp Time Card Packet",
    subtitle: `${opts.agencyLabel} · ${label}`,
    heading: "Time cards",
    orgName: opts.orgName,
    preparedBy: opts.preparedBy,
    footer: "Clocked hours with the signed agency time card for each shift",
    sections,
    appendix: async (doc, f) => {
      for (const c of cards) {
        const ctx = cardContext.get(c.ref);
        const r = rendered.get(c.ref);
        const pages: (PageImage | null)[] = r && "pages" in r ? r.pages : [null];
        const truncated = r && "pages" in r ? r.truncated : 0;
        pages.forEach((img, i) => {
          doc.addPage();
          drawCardCaption(doc, f, c, ctx?.w, ctx?.s ?? null, pages.length > 1 ? `Page ${i + 1} of ${pages.length}${truncated > 0 ? ` (+${truncated} more in the original)` : ""}` : "");
          const top = f.top + 58;
          if (img) drawFitted(doc, img, f.M, top, f.W - 2 * f.M, f.bottom - top);
          else {
            doc.setFont("helvetica", "italic");
            doc.setFontSize(10);
            doc.setTextColor(...BRAND.ink2);
            doc.text(r && "reason" in r ? r.reason : "File unavailable.", f.M, top + 20);
          }
        });
      }
    },
  });
  const stem = `Time_cards_${p.from}_to_${p.to}${opts.agencyLabel && opts.agencyLabel !== "All agencies" ? `_${opts.agencyLabel.replace(/[^\w-]+/g, "_")}` : ""}`;
  downloadBlob(blob, `${stem}.pdf`);
};

const drawCardCaption = (
  doc: jsPDF,
  f: { W: number; M: number; top: number },
  c: PacketCard,
  w: PacketWorker | undefined,
  s: PacketShift | null,
  pageNote: string,
) => {
  const y = f.top;
  // Reference badge
  doc.setFillColor(...BRAND.ink);
  doc.roundedRect(f.M, y, 50, 20, 3, 3, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(255, 255, 255);
  doc.text(c.ref, f.M + 25, y + 13.5, { align: "center" });
  doc.setTextColor(...BRAND.ink);
  doc.setFontSize(13);
  doc.text(fitText(doc, `${w?.name ?? "Worker"}${w?.agency ? `  ·  ${w.agency}` : ""}`, f.W - 2 * f.M - 62), f.M + 60, y + 14);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...BRAND.ink2);
  const shiftLine = s
    ? `${format(new Date(s.entry.clockIn), "EEEE, MMM d")}  ·  ${timeOfDay(s.entry.clockIn)} – ${s.entry.clockOut ? timeOfDay(s.entry.clockOut) : "on the clock"}  ·  ${s.entry.clockOut ? `${fmtHours(s.minutes)} hrs` : ""}${s.site && s.site !== "—" ? `  ·  ${s.site}` : ""}`
    : `Not tied to a shift  ·  dated ${c.doc.issue_date ? format(parseISO(c.doc.issue_date), "EEEE, MMM d") : "—"}`;
  doc.text(fitText(doc, shiftLine, f.W - 2 * f.M - 62), f.M + 60, y + 28);
  doc.setFontSize(7.5);
  doc.setTextColor(...BRAND.ink3);
  const meta = [c.doc.title, c.byDate && s ? "matched by date" : "", pageNote].filter(Boolean).join("  ·  ");
  doc.text(fitText(doc, meta, f.W - 2 * f.M - 62), f.M + 60, y + 40);
};

const drawFitted = (doc: jsPDF, img: PageImage, x: number, y: number, maxW: number, maxH: number) => {
  const scale = Math.min(maxW / img.w, maxH / img.h);
  const w = img.w * scale;
  const h = img.h * scale;
  const ix = x + (maxW - w) / 2;
  doc.setDrawColor(...BRAND.line);
  doc.setLineWidth(0.6);
  doc.rect(ix - 0.5, y - 0.5, w + 1, h + 1);
  doc.addImage(img.data, "JPEG", ix, y, w, h, undefined, "FAST");
};
