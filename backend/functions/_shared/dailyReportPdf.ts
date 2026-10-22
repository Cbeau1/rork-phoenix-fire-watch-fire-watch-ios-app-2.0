import { PDFDocument, type PDFFont, type PDFImage, type PDFPage, rgb, StandardFonts } from "npm:pdf-lib@1.17.1";
import { winAnsi } from "./agreementPdf.ts";
import { BRAND_LOGO } from "./brandLogo.ts";

/** Server-side daily patrol report (pdf-lib, Letter). Mirrors the web app's report palette. */

export type PatrolStatus = "clear" | "follow-up" | "incident";

export interface ReportPatrol {
  id: string;
  at: string;
  officer: string;
  areas: string[] | null;
  status: PatrolStatus;
  notes: string | null;
  photos: string[] | null;
  outside_fence: boolean | null;
  source: string | null;
}
export interface ReportIncident {
  id: string;
  at: string;
  reported_by: string;
  category: string;
  severity: string;
  description: string;
  photos: string[] | null;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution: string | null;
}
export interface ReportTime {
  worker: string;
  clock_in: string;
  clock_out: string | null;
}
export interface ReportHandoff {
  at: string;
  by: string;
  note: string;
}
export interface ReportPhoto {
  bytes: Uint8Array;
  at: string;
  caption: string;
  status: PatrolStatus | "incident-report";
}
export interface DailyReportInput {
  company: string;
  property: { name: string; address: string; contact_name: string; patrol_interval_minutes: number | null };
  tz: string;
  windowStart: string;
  windowEnd: string;
  patrols: ReportPatrol[];
  incidents: ReportIncident[];
  time: ReportTime[];
  handoffs: ReportHandoff[];
  photos: ReportPhoto[];
  photosOmitted: number;
  includePhotos: boolean;
}

type RGB = [number, number, number];
const C = {
  ink: [22, 23, 26] as RGB,
  ink2: [92, 95, 102] as RGB,
  ink3: [138, 141, 148] as RGB,
  line: [224, 225, 229] as RGB,
  paper2: [247, 247, 248] as RGB,
  ember: [220, 38, 38] as RGB,
  white: [255, 255, 255] as RGB,
};
const STATUS: Record<PatrolStatus, { label: string; color: RGB }> = {
  clear: { label: "Clear", color: [22, 163, 74] },
  "follow-up": { label: "Follow-up", color: [217, 138, 12] },
  incident: { label: "Incident", color: [220, 38, 38] },
};
const CATEGORY: Record<string, string> = {
  fire_smoke: "Fire / smoke",
  alarm: "Alarm",
  hazard: "Hazard",
  injury: "Injury",
  security: "Security / trespass",
  equipment: "Equipment problem",
  other: "Other",
};
const col = (c: RGB) => rgb(c[0] / 255, c[1] / 255, c[2] / 255);

/* ---------------------------------------------------------------- time formatting */

export const tzAbbr = (iso: string, tz: string): string =>
  new Date(iso).toLocaleString("en-US", { timeZone: tz, timeZoneName: "short" }).split(" ").pop() ?? "";
export const clock = (iso: string, tz: string): string =>
  new Date(iso).toLocaleString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
export const day = (iso: string, tz: string): string =>
  new Date(iso).toLocaleString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" });
export const longDay = (iso: string, tz: string): string =>
  new Date(iso).toLocaleString("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric", year: "numeric" });
const dayClock = (iso: string, tz: string) => `${day(iso, tz)}, ${clock(iso, tz)}`;
export const fmtDuration = (ms: number): string => {
  const m = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(m / 60);
  return h ? `${h} h ${String(m % 60).padStart(2, "0")} m` : `${m} min`;
};

/** Summary numbers shared by the PDF and the email body. */
export function summarize(input: Pick<DailyReportInput, "patrols" | "incidents" | "time" | "windowStart" | "windowEnd">) {
  const counts = { clear: 0, "follow-up": 0, incident: 0 } as Record<PatrolStatus, number>;
  for (const p of input.patrols) counts[p.status] = (counts[p.status] ?? 0) + 1;
  const ws = Date.parse(input.windowStart), we = Date.parse(input.windowEnd);
  let onSiteMs = 0;
  for (const t of input.time) {
    const a = Math.max(ws, Date.parse(t.clock_in));
    const b = Math.min(we, t.clock_out ? Date.parse(t.clock_out) : Math.min(Date.now(), we));
    if (b > a) onSiteMs += b - a;
  }
  let longestGap = 0;
  const times = input.patrols.map((p) => Date.parse(p.at)).sort((a, b) => a - b);
  for (let i = 1; i < times.length; i++) longestGap = Math.max(longestGap, times[i] - times[i - 1]);
  const officers = new Set([...input.time.map((t) => t.worker), ...input.patrols.map((p) => p.officer)].filter(Boolean));
  const areas = new Set(input.patrols.flatMap((p) => p.areas ?? []).filter(Boolean));
  return { counts, onSiteMs, longestGap, officers: officers.size, areas: areas.size };
}

/* ---------------------------------------------------------------- layout engine */

const W = 612, H = 792, M = 40, CW = W - M * 2, BOTTOM = 54;

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of winAnsi(text || "").split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) {
      out.push("");
      continue;
    }
    let line = "";
    for (let w of words) {
      while (font.widthOfTextAtSize(w, size) > width && w.length > 1) {
        // hard-break very long tokens
        let cut = w.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > width) cut--;
        if (line) {
          out.push(line);
          line = "";
        }
        out.push(w.slice(0, cut));
        w = w.slice(cut);
      }
      const next = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) <= width) line = next;
      else {
        if (line) out.push(line);
        line = w;
      }
    }
    if (line) out.push(line);
  }
  return out.length ? out : [""];
}

class Doc {
  pdf!: PDFDocument;
  page!: PDFPage;
  reg!: PDFFont;
  bold!: PDFFont;
  logo!: PDFImage;
  y = 0;
  constructor(private input: DailyReportInput) {}

  async init() {
    this.pdf = await PDFDocument.create();
    this.pdf.setTitle(winAnsi(`Daily patrol report - ${this.input.property.name}`));
    this.pdf.setAuthor(winAnsi(this.input.company));
    this.pdf.setCreator("Phoenix Fire Watch");
    this.reg = await this.pdf.embedFont(StandardFonts.Helvetica);
    this.bold = await this.pdf.embedFont(StandardFonts.HelveticaBold);
    const bin = Uint8Array.from(atob(BRAND_LOGO.jpegBase64), (c) => c.charCodeAt(0));
    this.logo = await this.pdf.embedJpg(bin);
  }

  text(s: string, x: number, y: number, size: number, opts: { bold?: boolean; color?: RGB; align?: "left" | "right" | "center"; spacing?: number } = {}) {
    const font = opts.bold ? this.bold : this.reg;
    const t = winAnsi(s);
    const w = font.widthOfTextAtSize(t, size);
    const dx = opts.align === "right" ? -w : opts.align === "center" ? -w / 2 : 0;
    this.page.drawText(t, { x: x + dx, y, size, font, color: col(opts.color ?? C.ink) });
  }
  rect(x: number, y: number, w: number, h: number, fill: RGB, border?: RGB) {
    this.page.drawRectangle({ x, y, width: w, height: h, color: col(fill), ...(border ? { borderColor: col(border), borderWidth: 0.75 } : {}) });
  }
  hline(y: number, color: RGB = C.line, x1 = M, x2 = W - M, thickness = 0.75) {
    this.page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color: col(color) });
  }

  newPage(first = false) {
    this.page = this.pdf.addPage([W, H]);
    const { input } = this;
    if (first) {
      const lh = 62, lw = (BRAND_LOGO.width / BRAND_LOGO.height) * lh;
      this.page.drawImage(this.logo, { x: M, y: H - M - lh, width: lw, height: lh });
      this.text(input.company.toUpperCase(), W - M, H - M - 14, 9, { bold: true, color: C.ink2, align: "right" });
      this.text("DAILY PATROL REPORT", W - M, H - M - 34, 17, { bold: true, align: "right" });
      this.text(longDay(input.windowEnd, input.tz), W - M, H - M - 50, 9.5, { color: C.ink2, align: "right" });
      this.y = H - M - lh - 12;
      this.page.drawRectangle({ x: M, y: this.y, width: CW, height: 2.5, color: col(C.ember) });
      this.y -= 26;
    } else {
      this.text(input.company.toUpperCase(), M, H - 30, 8, { bold: true, color: C.ink2 });
      this.text(`${input.property.name}  ·  ${day(input.windowEnd, input.tz)}`, W - M, H - 30, 8, { color: C.ink3, align: "right" });
      this.hline(H - 38);
      this.y = H - 58;
    }
  }
  ensure(h: number) {
    if (this.y - h < BOTTOM) this.newPage();
  }
  section(title: string, right?: string) {
    this.ensure(48);
    this.y -= 8;
    this.page.drawRectangle({ x: M, y: this.y - 1, width: 3, height: 12, color: col(C.ember) });
    this.text(title.toUpperCase(), M + 9, this.y, 10, { bold: true });
    if (right) this.text(right, W - M, this.y, 8.5, { color: C.ink3, align: "right" });
    this.y -= 9;
    this.hline(this.y);
    this.y -= 14;
  }
  paragraph(s: string, size = 9.5, color: RGB = C.ink2, x = M, width = CW) {
    for (const line of wrap(s, this.reg, size, width)) {
      this.ensure(size + 4);
      this.text(line, x, this.y, size, { color });
      this.y -= size + 3.5;
    }
  }

  footers() {
    const pages = this.pdf.getPages();
    const gen = new Date().toISOString();
    pages.forEach((p, i) => {
      this.page = p;
      this.hline(38);
      this.text(`Times shown in ${tzAbbr(this.input.windowEnd, this.input.tz)} (${this.input.tz}).  Generated ${dayClock(gen, this.input.tz)} ${tzAbbr(gen, this.input.tz)}.`, M, 26, 7.5, { color: C.ink3 });
      this.text(`Page ${i + 1} of ${pages.length}`, W - M, 26, 7.5, { color: C.ink3, align: "right" });
    });
  }
}

/* ---------------------------------------------------------------- report */

export async function buildDailyReportPdf(input: DailyReportInput): Promise<Uint8Array> {
  const d = new Doc(input);
  await d.init();
  d.newPage(true);
  const { tz } = input;
  const stats = summarize(input);
  const abbrS = tzAbbr(input.windowStart, tz), abbrE = tzAbbr(input.windowEnd, tz);

  // Property block
  d.text(input.property.name, M, d.y, 19, { bold: true });
  d.y -= 16;
  if (input.property.address) {
    d.text(input.property.address, M, d.y, 9.5, { color: C.ink2 });
    d.y -= 13;
  }
  d.text(`Report period: ${dayClock(input.windowStart, tz)} ${abbrS}  to  ${dayClock(input.windowEnd, tz)} ${abbrE}`, M, d.y, 9.5, { color: C.ink2 });
  d.y -= 24;

  // Stat tiles
  const tiles: { label: string; value: string; color?: RGB }[] = [
    { label: "Patrols logged", value: String(input.patrols.length) },
    { label: "Follow-ups", value: String(stats.counts["follow-up"]), color: stats.counts["follow-up"] ? STATUS["follow-up"].color : undefined },
    { label: "Incidents", value: String(input.incidents.length + stats.counts.incident), color: input.incidents.length + stats.counts.incident ? C.ember : undefined },
    { label: "Hours on site", value: stats.onSiteMs ? (stats.onSiteMs / 3600000).toFixed(1) : "0" },
  ];
  const gap = 10, tw = (CW - gap * 3) / 4, th = 54;
  tiles.forEach((t, i) => {
    const x = M + i * (tw + gap);
    d.rect(x, d.y - th, tw, th, C.paper2, C.line);
    d.text(t.value, x + 12, d.y - 28, 20, { bold: true, color: t.color ?? C.ink });
    d.text(t.label.toUpperCase(), x + 12, d.y - 44, 7.5, { bold: true, color: C.ink3 });
  });
  d.y -= th + 14;
  const facts: string[] = [];
  facts.push(`${stats.officers} officer${stats.officers === 1 ? "" : "s"} on duty`);
  if (stats.areas) facts.push(`${stats.areas} area${stats.areas === 1 ? "" : "s"} checked`);
  if (stats.longestGap) facts.push(`longest gap between patrols ${fmtDuration(stats.longestGap)}`);
  if (input.property.patrol_interval_minutes) facts.push(`patrols scheduled every ${input.property.patrol_interval_minutes} min`);
  d.paragraph(facts.join("  ·  ").replace(/^./, (c) => c.toUpperCase()), 9, C.ink2);
  d.y -= 6;

  const empty = !input.patrols.length && !input.incidents.length && !input.time.length;
  if (empty) {
    d.ensure(60);
    d.rect(M, d.y - 46, CW, 46, C.paper2, C.line);
    d.text("No patrols, incidents or time on site were recorded in this period.", M + 14, d.y - 27, 10, { color: C.ink2 });
    d.y -= 60;
  }

  // Officers on duty
  if (input.time.length) {
    d.section("Officers on duty", `${input.time.length} shift${input.time.length === 1 ? "" : "s"}`);
    const cols = [M, M + 190, M + 330, M + 470];
    ["OFFICER", "CHECKED IN", "CHECKED OUT", "TIME IN PERIOD"].forEach((h, i) => d.text(h, cols[i], d.y, 7.5, { bold: true, color: C.ink3 }));
    d.y -= 14;
    const ws = Date.parse(input.windowStart), we = Date.parse(input.windowEnd);
    for (const t of input.time) {
      d.ensure(18);
      const a = Math.max(ws, Date.parse(t.clock_in));
      const b = Math.min(we, t.clock_out ? Date.parse(t.clock_out) : Math.min(Date.now(), we));
      d.text(t.worker || "Officer", cols[0], d.y, 9.5, { bold: true });
      d.text(dayClock(t.clock_in, tz), cols[1], d.y, 9.5, { color: C.ink2 });
      d.text(t.clock_out ? dayClock(t.clock_out, tz) : "Still on site", cols[2], d.y, 9.5, { color: t.clock_out ? C.ink2 : STATUS.clear.color });
      d.text(fmtDuration(Math.max(0, b - a)), cols[3], d.y, 9.5, { color: C.ink2 });
      d.y -= 6;
      d.hline(d.y);
      d.y -= 12;
    }
    d.y -= 4;
  }

  // Incidents
  if (input.incidents.length) {
    d.section("Incidents", `${input.incidents.length} reported`);
    for (const i of input.incidents) {
      const lines = wrap(i.description, d.reg, 9.5, CW - 28);
      const res = i.resolved_at
        ? wrap(`Resolved ${dayClock(i.resolved_at, tz)}${i.resolved_by ? ` by ${i.resolved_by}` : ""}${i.resolution ? ` - ${i.resolution}` : ""}`, d.reg, 8.5, CW - 28)
        : ["Open - not yet resolved"];
      const h = 34 + lines.length * 13 + res.length * 11 + 6;
      d.ensure(Math.min(h, 300));
      const top = d.y;
      d.rect(M, top - h, CW, h, [254, 242, 242], [252, 202, 202]);
      d.page.drawRectangle({ x: M, y: top - h, width: 3, height: h, color: col(C.ember) });
      d.text(`${CATEGORY[i.category] ?? i.category}  ·  ${(i.severity || "").toUpperCase()} SEVERITY`, M + 14, top - 16, 9.5, { bold: true, color: C.ember });
      d.text(`${dayClock(i.at, tz)} ${tzAbbr(i.at, tz)}  ·  ${i.reported_by || "Officer"}`, W - M - 12, top - 16, 8.5, { color: C.ink2, align: "right" });
      d.y = top - 32;
      for (const l of lines) {
        d.text(l, M + 14, d.y, 9.5);
        d.y -= 13;
      }
      for (const l of res) {
        d.text(l, M + 14, d.y, 8.5, { color: i.resolved_at ? STATUS.clear.color : C.ember });
        d.y -= 11;
      }
      d.y = top - h - 10;
    }
  }

  // Patrol log
  if (input.patrols.length) {
    d.section("Patrol log", `${stats.counts.clear} clear  ·  ${stats.counts["follow-up"]} follow-up  ·  ${stats.counts.incident} incident`);
    const cx = [M, M + 62, M + 160, M + 300, M + 366];
    const cw = [58, 94, 136, 62, W - M - (M + 366)];
    const header = () => {
      d.rect(M, d.y - 5, CW, 17, C.paper2);
      ["TIME", "OFFICER", "AREAS CHECKED", "STATUS", "NOTES"].forEach((h, i) => d.text(h, cx[i] + 4, d.y, 7.5, { bold: true, color: C.ink3 }));
      d.y -= 18;
    };
    header();
    for (const p of input.patrols) {
      const officer = wrap(p.officer || "Officer", d.reg, 9, cw[1] - 6);
      const areas = wrap((p.areas ?? []).join(", ") || "-", d.reg, 9, cw[2] - 6);
      let note = (p.notes ?? "").trim();
      const tags: string[] = [];
      if (p.outside_fence) tags.push("logged outside the site geofence");
      if (p.photos?.length) tags.push(`${p.photos.length} photo${p.photos.length === 1 ? "" : "s"}`);
      if (tags.length) note = note ? `${note} (${tags.join("; ")})` : `(${tags.join("; ")})`;
      const notes = wrap(note || "-", d.reg, 8.5, cw[4] - 6);
      const n = Math.max(officer.length, areas.length, notes.length, 1);
      const rh = n * 11.5 + 8;
      if (d.y - rh < BOTTOM) {
        d.newPage();
        header();
      }
      const top = d.y;
      d.text(clock(p.at, tz), cx[0] + 4, top, 9, { bold: true });
      d.text(day(p.at, tz), cx[0] + 4, top - 11, 7, { color: C.ink3 });
      officer.forEach((l, i) => d.text(l, cx[1] + 4, top - i * 11.5, 9));
      areas.forEach((l, i) => d.text(l, cx[2] + 4, top - i * 11.5, 9, { color: C.ink2 }));
      const st = STATUS[p.status] ?? STATUS.clear;
      d.page.drawCircle({ x: cx[3] + 7, y: top + 3, size: 3, color: col(st.color) });
      d.text(st.label, cx[3] + 14, top, 9, { bold: true, color: st.color });
      notes.forEach((l, i) => d.text(l, cx[4] + 4, top - i * 11.5, 8.5, { color: C.ink2 }));
      d.y = top - Math.max(rh - 8, 18) - 2;
      d.hline(d.y + 4);
      d.y -= 8;
    }
    d.y -= 4;
  }

  // Handoff notes
  if (input.handoffs.length) {
    d.section("Shift handoff notes");
    for (const h of input.handoffs) {
      d.ensure(30);
      d.text(`${h.by || "Officer"}  ·  checked out ${dayClock(h.at, tz)} ${tzAbbr(h.at, tz)}`, M, d.y, 9, { bold: true });
      d.y -= 13;
      d.paragraph(h.note, 9.5, C.ink2);
      d.y -= 8;
    }
  }

  // Photos
  if (input.includePhotos && (input.photos.length || input.photosOmitted)) {
    d.section("Photos", `${input.photos.length} included${input.photosOmitted ? `, ${input.photosOmitted} more in the app` : ""}`);
    const per = 3, g = 10, cellW = (CW - g * (per - 1)) / per, imgH = cellW * 0.75, cellH = imgH + 26;
    let i = 0;
    for (const ph of input.photos) {
      let img: PDFImage | null = null;
      try {
        img = await d.pdf.embedJpg(ph.bytes);
      } catch {
        try {
          img = await d.pdf.embedPng(ph.bytes);
        } catch {
          img = null;
        }
      }
      if (!img) continue;
      if (i % per === 0) {
        d.ensure(cellH + 4);
      }
      const x = M + (i % per) * (cellW + g);
      const top = d.y;
      d.rect(x, top - imgH, cellW, imgH, C.paper2, C.line);
      const scale = Math.min(cellW / img.width, imgH / img.height);
      const iw = img.width * scale, ih = img.height * scale;
      d.page.drawImage(img, { x: x + (cellW - iw) / 2, y: top - imgH + (imgH - ih) / 2, width: iw, height: ih });
      const cap = wrap(ph.caption, d.reg, 7.5, cellW - 60)[0] ?? "";
      d.text(`${clock(ph.at, tz)}  ${cap}`, x, top - imgH - 11, 7.5, { color: C.ink2 });
      if (ph.status !== "incident-report") {
        const st = STATUS[ph.status] ?? STATUS.clear;
        d.text(st.label, x + cellW, top - imgH - 11, 7.5, { bold: true, color: st.color, align: "right" });
      } else d.text("Incident", x + cellW, top - imgH - 11, 7.5, { bold: true, color: C.ember, align: "right" });
      i++;
      if (i % per === 0) d.y -= cellH;
    }
    if (i % per !== 0) d.y -= cellH;
  }

  d.footers();
  return await d.pdf.save();
}
