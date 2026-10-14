/**
 * Job Report: one branded PDF per property covering the whole fire watch job — watch hours,
 * payroll (hours + labor cost), every patrol report, and associated expenses.
 */
import { format } from "date-fns";

import { fmtMoney, toCents, type Cents } from "@/lib/expenses/money";
import { loadWorkerTypes, personType, type PersonType, type WorkerTypeIndex } from "@/lib/payrollGroups";
import { supabase } from "@/lib/supabase";
import {
  ENTRY_STATUS,
  entryDay,
  entryMinutes,
  fmtCents,
  fmtHours,
  loadPayRates,
  loadPropertyEntries,
  loadTeam,
  rateKey,
  rateOn,
  type RateRow,
  type TeamMember,
  type TimeEntry,
} from "@/lib/timeclock";
import { STATUS_META, type Patrol, type Property } from "@/lib/types";
import { buildPdf, type PdfCell, type PdfSection } from "@/lib/workforce/exports";

/** One expense line on the report. */
export interface JobExpense {
  date: string;
  ref: string;
  vendor: string;
  category: string;
  description: string;
  paidBy: string;
  cents: Cents;
  currency: string;
}

export interface JobData {
  entries: TimeEntry[];
  shiftsScheduled: number;
  team: TeamMember[];
  /** Empty when the viewer can't see wages. */
  rates: Map<string, RateRow[]>;
  types: WorkerTypeIndex | undefined;
  /** Null when the viewer doesn't have the Expenditures permission. */
  expenses: JobExpense[] | null;
}

const settle = async <T,>(p: Promise<T>, fallback: T, label: string): Promise<T> => {
  try {
    return await p;
  } catch (err) {
    console.warn(`[JobReport] ${label} unavailable:`, err instanceof Error ? err.message : err);
    return fallback;
  }
};

/** Expenses tagged with the property or linked to one of its shifts. Null without permission. */
async function loadJobExpenses(propertyId: string, shiftIds: string[]): Promise<JobExpense[] | null> {
  const { data: allowed, error: permErr } = await supabase.rpc("wf_has", { p: "expenses" });
  if (permErr || allowed !== true) return null;

  const linkIds = new Set<string>();
  for (let i = 0; i < shiftIds.length; i += 150) {
    const { data, error } = await supabase.from("ex_shift_links").select("expenditure_id").in("shift_id", shiftIds.slice(i, i + 150));
    if (error) throw error;
    for (const r of data ?? []) linkIds.add(r.expenditure_id);
  }
  const [byProp, byLink, cats] = await Promise.all([
    supabase.from("ex_expenditures").select("*").eq("property_id", propertyId).is("archived_at", null).limit(5000),
    linkIds.size
      ? supabase.from("ex_expenditures").select("*").in("id", [...linkIds]).is("archived_at", null).limit(5000)
      : Promise.resolve({ data: [], error: null }),
    supabase.from("ex_categories").select("id, name"),
  ]);
  if (byProp.error) throw byProp.error;
  if (byLink.error) throw byLink.error;
  const catName = new Map<string, string>((cats.data ?? []).map((c) => [c.id, c.name]));
  const rows = new Map<string, (typeof byProp.data)[number]>();
  for (const r of [...(byProp.data ?? []), ...(byLink.data ?? [])]) rows.set(r.id, r);
  return [...rows.values()]
    .map((r) => ({
      date: r.spent_on,
      ref: r.code,
      vendor: r.vendor,
      category: catName.get(r.category_id) ?? "",
      description: r.description || r.purpose,
      paidBy: r.paid_by === "business" ? "Business" : r.payer_name || "—",
      cents: toCents(r.amount),
      currency: r.currency || "USD",
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Loads everything the Job Report needs for one property. Wage and expense data fail soft. */
export async function loadJobData(propertyId: string): Promise<JobData> {
  const { data: shifts, error } = await supabase.from("shifts").select("id").eq("property_id", propertyId).limit(5000);
  if (error) throw error;
  const shiftIds = (shifts ?? []).map((s) => s.id);
  const [entries, team, rates, types, expenses] = await Promise.all([
    loadPropertyEntries(propertyId, shiftIds),
    settle(loadTeam(), [] as TeamMember[], "team"),
    settle(loadPayRates(), new Map<string, RateRow[]>(), "pay rates"),
    settle(loadWorkerTypes(), undefined as WorkerTypeIndex | undefined, "worker types"),
    settle(loadJobExpenses(propertyId, shiftIds), null as JobExpense[] | null, "expenses"),
  ]);
  return { entries, shiftsScheduled: shiftIds.length, team, rates, types, expenses };
}

/** Minutes covered by at least one officer (overlapping punches count once). */
export const coverageMinutes = (entries: TimeEntry[], now: number = Date.now()): number => {
  const spans = entries
    .filter((e) => e.status !== "rejected")
    .map((e) => [Date.parse(e.clockIn), e.clockOut ? Date.parse(e.clockOut) : now] as const)
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let total = 0;
  let curStart = -1;
  let curEnd = -1;
  for (const [a, b] of spans) {
    if (a > curEnd) {
      if (curEnd > curStart) total += curEnd - curStart;
      curStart = a;
      curEnd = b;
    } else curEnd = Math.max(curEnd, b);
  }
  if (curEnd > curStart) total += curEnd - curStart;
  return Math.floor(total / 60000);
};

const typeText = (t: PersonType | undefined) => (!t ? "Direct" : t.group === "agency" ? `Agency${t.agency ? ` · ${t.agency}` : ""}` : "Direct");
const tm = (iso: string | null) => (iso ? format(new Date(iso), "h:mm a") : "—");
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

interface PersonRow {
  key: string;
  name: string;
  type: PersonType | undefined;
  shifts: number;
  approvedMin: number;
  pendingMin: number;
  laborCents: number;
  unpricedMin: number;
  rate: number | null;
}

/** Builds the branded Job Report PDF. Pure: all data comes in through `input`. */
export async function buildJobReport(input: {
  orgName: string;
  preparedBy: string;
  property: Property;
  patrols: Patrol[];
  data: JobData;
}): Promise<{ blob: Blob; fileName: string }> {
  const { property, patrols, data } = input;
  const teamName = new Map(data.team.map((m) => [m.id, m.name]));
  const nameFor = (e: TimeEntry) => (e.profileId ? (teamName.get(e.profileId) ?? e.workerName) : e.workerName || "Former member");
  const showPay = data.rates.size > 0;

  // ---- Payroll by employee (labor priced at the rate in effect each day)
  const people = new Map<string, PersonRow>();
  for (const e of data.entries) {
    const name = nameFor(e);
    const key = rateKey(e.profileId, name);
    let p = people.get(key);
    if (!p) {
      p = { key, name, type: data.types ? personType(data.types, { profileId: e.profileId, name }) : undefined, shifts: 0, approvedMin: 0, pendingMin: 0, laborCents: 0, unpricedMin: 0, rate: null };
      people.set(key, p);
    }
    if (e.status === "rejected") continue;
    p.shifts += 1;
    const min = entryMinutes(e);
    if (e.status === "approved") {
      p.approvedMin += min;
      const r = rateOn(data.rates.get(key), entryDay(e));
      if (r === null) p.unpricedMin += min;
      else {
        p.laborCents += Math.round((min / 60) * r * 100);
        p.rate = r;
      }
    } else if (e.status === "pending" || e.status === "open") p.pendingMin += min;
  }
  const rows = [...people.values()].filter((p) => p.shifts > 0).sort((a, b) => a.name.localeCompare(b.name));
  const approvedMin = rows.reduce((s, p) => s + p.approvedMin, 0);
  const pendingMin = rows.reduce((s, p) => s + p.pendingMin, 0);
  const laborCents = rows.reduce((s, p) => s + p.laborCents, 0);
  const unpriced = rows.filter((p) => p.unpricedMin > 0).map((p) => p.name);
  const coverMin = coverageMinutes(data.entries);
  const counted = data.entries.filter((e) => e.status !== "rejected");

  // ---- Expenses
  const expenses = data.expenses;
  const expByCur = new Map<string, Cents>();
  for (const x of expenses ?? []) expByCur.set(x.currency, (expByCur.get(x.currency) ?? 0) + x.cents);
  const expUsd = expByCur.get("USD") ?? 0;
  const otherCur = [...expByCur.entries()].filter(([c]) => c !== "USD");
  const totalCents = (showPay ? laborCents : 0) + expUsd;

  // ---- Patrols
  const sortedPatrols = [...patrols].sort((a, b) => Date.parse(a.dateTime) - Date.parse(b.dateTime));
  const pc = { clear: 0, "follow-up": 0, incident: 0 };
  for (const p of patrols) pc[p.status] += 1;

  // ---- Job period: first to last activity of any kind
  const stamps = [
    ...counted.flatMap((e) => [Date.parse(e.clockIn), e.clockOut ? Date.parse(e.clockOut) : Date.now()]),
    ...patrols.map((p) => Date.parse(p.dateTime)),
  ].filter((n) => Number.isFinite(n));
  const first = stamps.length ? new Date(Math.min(...stamps)) : null;
  const last = stamps.length ? new Date(Math.max(...stamps)) : null;
  const periodText = first && last ? `${format(first, "MMM d, yyyy h:mm a")} – ${format(last, "MMM d, yyyy h:mm a")}` : "No activity recorded yet";
  const spanMin = first && last ? Math.floor((last.getTime() - first.getTime()) / 60000) : 0;
  const officers = new Set(rows.map((r) => r.name));
  for (const p of patrols) if (p.officerName) officers.add(p.officerName);

  const contact = [property.contactName, property.contactPhone, property.contactEmail].filter(Boolean).join("  ·  ");

  const sections: PdfSection[] = [
    {
      title: "Job at a glance",
      metrics: [
        { label: "Watch duration", value: `${fmtHours(coverMin)} hrs`, hint: "Time with an officer on site" },
        { label: "Labor hours", value: fmtHours(approvedMin), hint: pendingMin > 0 ? `+ ${fmtHours(pendingMin)} awaiting approval` : `${plural(counted.length, "shift")} approved` },
        { label: "Patrol reports", value: String(patrols.length), hint: `${pc.incident} incident · ${pc["follow-up"]} follow-up` },
        showPay || expenses
          ? { label: "Total job cost", value: fmtCents(totalCents), hint: showPay && expenses ? "Labor + expenses" : showPay ? "Labor only" : "Expenses only" }
          : { label: "Officers on site", value: String(officers.size), hint: "Logged hours or patrols" },
      ],
    },
    {
      title: "Job details",
      fields: [
        ["Property", property.name],
        ["Address", property.address],
        ["Site contact", contact || "—"],
        ["Job period", periodText],
        [
          "Watch duration",
          `${fmtHours(coverMin)} hrs with an officer on site${spanMin - coverMin >= 60 ? ` (job spanned ${fmtHours(spanMin)} hrs, ${fmtHours(spanMin - coverMin)} hrs uncovered)` : " — continuous coverage"}`,
        ],
        ["Shifts", `${plural(counted.length, "shift")} worked${data.shiftsScheduled ? ` · ${data.shiftsScheduled} scheduled` : ""}`],
        ["Officers", officers.size ? [...officers].sort().join(", ") : "—"],
        ["Patrol interval", property.patrolIntervalMinutes ? `Every ${property.patrolIntervalMinutes} minutes` : "—"],
      ],
    },
    {
      title: "Job cost summary",
      table: {
        head: ["Item", "Detail", "Amount"],
        body: [
          [
            "Labor",
            showPay ? `${fmtHours(approvedMin)} approved hrs at each employee's rate` : "Requires the Employee pay permission",
            showPay ? fmtCents(laborCents) : "—",
          ],
          [
            "Expenses",
            expenses ? `${plural(expenses.length, "expense")} tagged to this job` : "Requires the Expenditures permission",
            expenses ? fmtMoney(expUsd) : "—",
          ],
          ...otherCur.map(([cur, c]) => ["Expenses (other currency)", `${cur} — not added to the total`, fmtMoney(c, cur)]),
        ],
        foot: [[{ content: "TOTAL JOB COST", colSpan: 2 }, fmtCents(totalCents)]],
        numeric: [2],
      },
      note: [
        "Labor counts approved hours only, each priced at the hourly rate in effect that day. Overtime premiums are calculated weekly across all sites and appear on the Payroll Hours Report.",
        pendingMin > 0 ? `${fmtHours(pendingMin)} hrs still awaiting approval are not included.` : "",
        unpriced.length ? `No pay rate on file for: ${unpriced.join(", ")} — those hours are not priced.` : "",
      ]
        .filter(Boolean)
        .join(" "),
    },
    {
      title: "Payroll by employee",
      table: {
        head: ["Employee", "Type", "Shifts", "Approved hrs", "Pending hrs", ...(showPay ? ["Rate", "Labor cost"] : [])],
        body: rows.map((p) => [
          p.name,
          typeText(p.type),
          String(p.shifts),
          fmtHours(p.approvedMin),
          p.pendingMin > 0 ? fmtHours(p.pendingMin) : "—",
          ...(showPay ? [p.rate !== null ? `$${p.rate.toFixed(2)}` : "—", p.unpricedMin > 0 && p.laborCents === 0 ? "No rate" : fmtCents(p.laborCents)] : []),
        ]),
        foot: [
          [
            { content: `TOTAL — ${plural(rows.length, "employee")}`, colSpan: 2 },
            String(rows.reduce((s, p) => s + p.shifts, 0)),
            fmtHours(approvedMin),
            pendingMin > 0 ? fmtHours(pendingMin) : "—",
            ...(showPay ? ["", fmtCents(laborCents)] : []),
          ],
        ],
        numeric: showPay ? [2, 3, 4, 5, 6] : [2, 3, 4],
      },
      emptyText: "No hours have been recorded for this job yet.",
    },
    {
      title: "Shift log",
      table: {
        head: ["Date", "Employee", "Clock in", "Clock out", "Hours", "Status"],
        body: data.entries.map((e) => [
          format(new Date(e.clockIn), "EEE MMM d, yyyy"),
          nameFor(e),
          tm(e.clockIn),
          tm(e.clockOut),
          e.clockOut ? fmtHours(entryMinutes(e)) : "open",
          `${ENTRY_STATUS[e.status].label}${e.edited ? " (edited)" : ""}`,
        ]),
        foot: [
          [{ content: `Total recorded — ${plural(counted.length, "shift")}`, colSpan: 4 }, fmtHours(approvedMin + pendingMin), ""],
          [{ content: "Approved (paid)", colSpan: 4 }, fmtHours(approvedMin), ""],
          ...(pendingMin > 0 ? [[{ content: "Awaiting approval", colSpan: 4 }, fmtHours(pendingMin), ""] as PdfCell[]] : []),
        ],
        numeric: [4],
      },
      note: data.entries.some((e) => e.status === "rejected") ? "Rejected entries are listed for the record but excluded from all totals." : undefined,
      emptyText: "No clock-ins recorded for this job.",
    },
    {
      title: "Expenses",
      ...(expenses
        ? {
            table: {
              head: ["Date", "Ref", "Vendor", "Category", "Description", "Paid by", "Amount"],
              body: expenses.map((x) => [
                format(new Date(`${x.date}T12:00:00`), "MMM d, yyyy"),
                x.ref,
                x.vendor || "—",
                x.category || "—",
                x.description || "—",
                x.paidBy,
                fmtMoney(x.cents, x.currency),
              ]),
              foot: [[{ content: `TOTAL — ${plural(expenses.length, "expense")}`, colSpan: 6 }, fmtMoney(expUsd)]],
              numeric: [6],
            },
            emptyText: "No expenses are tagged to this property or its shifts.",
          }
        : { text: ["Expense details require the Expenditures permission. An owner can grant access under Workforce → Settings."] }),
    },
    {
      title: "Patrol reports",
      table: {
        head: ["Date & time", "Officer", "Areas checked", "Status", "Notes"],
        body: sortedPatrols.map((p) => [
          format(new Date(p.dateTime), "MMM d, yyyy h:mm a"),
          p.officerName || "—",
          p.areas.join(", ") || "—",
          STATUS_META[p.status].label,
          p.notes || "—",
        ]),
        foot: [
          [
            { content: `TOTAL — ${plural(patrols.length, "report")}`, colSpan: 3 },
            { content: `${pc.clear} clear  ·  ${pc["follow-up"]} follow-up  ·  ${pc.incident} incident`, colSpan: 2 },
          ],
        ],
      },
      note: patrols.length ? "Photos and officer signatures are included in the Fire Watch Shift Report for this property." : undefined,
      emptyText: "No patrol reports submitted for this job.",
    },
    {
      title: "Sign-off",
      text: [
        "I certify that this report accurately reflects the fire watch services, hours, and costs recorded for this job.",
        "Prepared by: ______________________________          Date: ________________",
        "Approved by: ______________________________          Date: ________________",
      ],
    },
  ];

  const blob = await buildPdf({
    title: "Fire Watch Job Report",
    subtitle: `${property.name} · ${property.address}`,
    orgName: input.orgName,
    preparedBy: input.preparedBy,
    heading: "JOB REPORT",
    footer: showPay ? "Contains wage and cost information. Confidential." : "Confidential — internal use only.",
    sections,
  });
  const slug = property.name.replace(/[^\w-]+/g, "_").replace(/_+/g, "_").slice(0, 60);
  return { blob, fileName: `Job_Report_${slug}_${format(new Date(), "yyyy-MM-dd")}.pdf` };
}
