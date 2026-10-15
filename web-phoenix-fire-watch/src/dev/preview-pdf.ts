/** Dev-only: builds sample branded PDFs with the real generators and renders page previews. No network writes. */
import { addDays } from "date-fns";
import * as pdfjsLib from "pdfjs-dist";

import { buildJobReport, type JobData } from "@/lib/jobReport";
import { buildPayrollPdf } from "@/lib/payrollExport";
import type { PersonType } from "@/lib/payrollGroups";
import { estimatePay, rateKey, summarize, type PayEstimate, type PayPeriod, type RateRow, type TimeEntry } from "@/lib/timeclock";
import type { Patrol, Property } from "@/lib/types";

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
const statuses: Patrol["status"][] = ["clear", "clear", "follow-up", "clear", "incident", "clear", "clear", "clear"];
const officerNames = ["Robert Bradley", "Christopher Engdahl", "Justin D'SO"];

const patrols: Patrol[] = statuses.map((status, i) => ({
  id: `p-${i}`,
  propertyId: property.id,
  dateTime: new Date(2026, 9, 12, 19 + i, (i * 37) % 60).toISOString(),
  officerName: officerNames[i % officerNames.length],
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

const entry = (i: number, name: string, startH: number, day: number, hours: number, status: TimeEntry["status"]): TimeEntry => {
  const start = new Date(2026, 9, day, startH, 0);
  return {
    id: `e-${i}`,
    profileId: null,
    workerName: name,
    propertyId: property.id,
    clockIn: start.toISOString(),
    clockOut: new Date(start.getTime() + hours * 3600_000).toISOString(),
    status,
    employeeNote: "",
    adminNote: "",
    source: "clock",
    edited: i === 3,
    approvedBy: null,
    approvedAt: null,
    shiftId: null,
    scheduledLabel: null,
  };
};

const entries: TimeEntry[] = [
  entry(1, "Robert Bradley", 19, 12, 12, "approved"),
  entry(2, "Christopher Engdahl", 7, 13, 12, "approved"),
  entry(3, "Robert Bradley", 19, 13, 12, "approved"),
  entry(4, "Justin D'SO", 7, 14, 12, "approved"),
  entry(5, "Christopher Engdahl", 19, 14, 12, "pending"),
];

const rates = new Map<string, RateRow[]>([
  [rateKey(null, "Robert Bradley"), [{ rate: 23.95, effective: "2026-10-01" }]],
  [rateKey(null, "Christopher Engdahl"), [{ rate: 23.95, effective: "2026-10-01" }]],
  [rateKey(null, "Justin D'SO"), [{ rate: 20, effective: "2026-10-01" }]],
]);
const agency: PersonType = { group: "agency", agency: "HireQuest" };
const direct: PersonType = { group: "direct", agency: "" };
const typeFor = (name: string): PersonType => (name === "Justin D'SO" ? direct : agency);

const jobData: JobData = {
  entries,
  shiftsScheduled: 6,
  team: [],
  rates,
  types: {
    byProfile: new Map(),
    byName: new Map(officerNames.map((n) => [n.toLowerCase(), typeFor(n)])),
  },
  expenses: [
    { date: "2026-10-12", ref: "EX-0007", vendor: "Home Depot", category: "Equipment", description: "Fire extinguishers (2) for loading dock", paidBy: "Business", cents: 12998, currency: "USD" },
    { date: "2026-10-13", ref: "EX-0008", vendor: "Shell", category: "Fuel / mileage", description: "Patrol vehicle fuel", paidBy: "Robert Bradley", cents: 4612, currency: "USD" },
    { date: "2026-10-14", ref: "EX-0009", vendor: "Staples", category: "Supplies", description: "Patrol log binders & flashlights", paidBy: "Business", cents: 3875, currency: "USD" },
  ],
};

const job = await buildJobReport({ orgName: "Phoenix Fire Watch", preparedBy: "Corey Beau", property, patrols, data: jobData });

const period: PayPeriod = { start: new Date(2026, 9, 12), days: 7 };
const weekEntries = [
  ...entries,
  entry(6, "Robert Bradley", 19, 15, 12, "approved"),
  entry(7, "Robert Bradley", 19, 16, 12, "approved"),
  entry(8, "Justin D'SO", 7, 15, 8, "approved"),
  entry(9, "Robert Bradley", 19, 17, 8, "pending"),
].filter((e) => new Date(e.clockIn) < addDays(period.start, period.days));
const people = summarize(weekEntries, period, (_id, fb) => fb);
const pay = new Map<string, PayEstimate>(people.map((p) => [p.key, estimatePay(p, period, rates.get(rateKey(p.profileId, p.name)))]));
const payroll = await buildPayrollPdf({
  period,
  people,
  orgName: "Phoenix Fire Watch",
  preparedBy: "Corey Beau",
  siteName: () => property.name,
  pay,
  typeOf: (p) => typeFor(p.name),
});

const render = async (blob: Blob, maxPages: number): Promise<string[]> => {
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
  const out: string[] = [];
  for (let i = 1; i <= Math.min(pdf.numPages, maxPages); i += 1) {
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
  render(job.blob, 4).then((pages) => ["job", pages] as const),
  render(payroll, 3).then((pages) => ["payroll", pages] as const),
]).then((entries) => Object.fromEntries(entries));
document.title = "pdf-ready";
