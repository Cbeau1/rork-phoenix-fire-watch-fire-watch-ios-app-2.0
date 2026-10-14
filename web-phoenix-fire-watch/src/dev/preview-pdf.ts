/** Dev-only: builds sample branded PDFs with the real generators and renders page previews. */
import { buildShiftReport } from "@/lib/report";
import { buildPdf } from "@/lib/workforce/exports";
import type { Patrol, Property } from "@/lib/types";
import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

const property: Property = {
  id: "prop-1234",
  name: "Harborview Condominium Towers",
  address: "400 Harborview Dr, Tampa, FL 33602",
  contactName: "Dana Whitfield",
  contactPhone: "(813) 555-0142",
  contactEmail: "dana@harborviewhoa.org",
  notes: "",
  patrolIntervalMinutes: 60,
  geofence: { enabled: false, lat: null, lng: null, radiusM: 0 },
  imagePath: null,
  createdAt: new Date().toISOString(),
};

const areas = ["Parking garage P1–P2", "Pool deck & spa", "Stairwell A–D", "Loading dock", "Roof access"];
const statuses: Patrol["status"][] = ["clear", "clear", "follow-up", "clear", "incident", "clear"];
const officers = ["R. Bradley", "C. Engdahl", "J. D'SO"];

const patrols: Patrol[] = statuses.map((status, i) => ({
  id: `p-${i}`,
  propertyId: property.id,
  dateTime: new Date(2026, 9, 12, 19 + (i % 12), (i * 37) % 60).toISOString(),
  officerName: officers[i % officers.length],
  areas: [areas[i % areas.length], areas[(i + 2) % areas.length]],
  status,
  notes:
    status === "follow-up"
      ? "Gate latch on the north stairwell found unsecured — reported to property contact."
      : status === "incident"
        ? "Small smoldering debris in loading dock; extinguished and fire department notified."
        : "All clear. No smoke, fire, or hazards observed.",
  photos: [],
  loggedBy: null,
  createdAt: new Date().toISOString(),
}));

const shift = await buildShiftReport({
  orgName: "Phoenix Fire Watch",
  preparedBy: "Corey Beau",
  property,
  patrols,
  periodLabel: "Fire Watch #2 · Oct 12–14, 2026",
  includePhotos: false,
});

const rows = Array.from({ length: 48 }, (_, i) => {
  const ot = i % 7 === 0 ? "2.5" : "0.0";
  const gross = i % 7 === 0 ? "$245.75" : "$191.60";
  return [String(i + 1), "Bradley, Robert", i % 3 === 0 ? "Direct" : "Temp agency · HireQuest", "Mon Oct 12 · 12:00 PM – 8:00 PM", "8.0", ot, gross];
});

const payroll = await buildPdf({
  title: "Payroll Hours Report",
  subtitle: "Week of Oct 5 – Oct 11, 2026",
  orgName: "Phoenix Fire Watch",
  preparedBy: "Corey Beau",
  heading: "PHOENIX FIRE WATCH · PAYROLL",
  footer: "Contains employee time and wage records. Confidential.",
  sections: [
    {
      title: "Approved Hours",
      table: { head: ["#", "Employee", "Type", "Shift", "Reg hrs", "OT hrs", "Gross est."], body: rows },
    },
    {
      title: "Certification",
      text: [
        "Overtime is calculated on approved hours over 40 per Monday–Sunday workweek. Times are recorded by the server when each employee clocks in and out; admin corrections are logged with a reason.",
        "Approved by: ______________________________          Date: ________________",
      ],
    },
  ],
});

const render = async (blob: Blob): Promise<string[]> => {
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
  const out: string[] = [];
  for (let i = 1; i <= Math.min(pdf.numPages, 2); i += 1) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    await page.render({ canvasContext: ctx, canvas, viewport }).promise;
    out.push(canvas.toDataURL("image/png"));
  }
  return out;
};

(window as unknown as { __pdfPreviews: Promise<Record<string, string[]>> }).__pdfPreviews = Promise.all([
  render(shift.blob).then((pages) => ["shift", pages] as const),
  render(payroll).then((pages) => ["payroll", pages] as const),
]).then((entries) => Object.fromEntries(entries));
document.title = "pdf-ready";
