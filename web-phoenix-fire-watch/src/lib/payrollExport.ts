import { format } from "date-fns";

import {
  entryMinutes,
  fmtCents,
  fmtHours,
  periodEnd,
  periodLabel,
  shiftOvertime,
  ENTRY_STATUS,
  type PayEstimate,
  type PayPeriod,
  type PersonSummary,
} from "@/lib/timeclock";
import { GROUP_LABEL, groupPeople, type PersonType } from "@/lib/payrollGroups";
import { buildPdf, downloadBlob, downloadCsv, type PdfCell, type PdfSection } from "@/lib/workforce/exports";

const fileStem = (period: PayPeriod) =>
  `payroll_${format(period.start, "yyyy-MM-dd")}_to_${format(periodEnd(period), "yyyy-MM-dd")}`;

const t = (iso: string | null) => (iso ? format(new Date(iso), "h:mm a") : "—");

type PayrollPdfOpts = {
  period: PayPeriod;
  people: PersonSummary[];
  orgName: string;
  preparedBy: string;
  siteName: (id: string | null) => string;
  /** Gross-pay estimates per person key; omitted when the admin can't see wages. */
  pay?: Map<string, PayEstimate>;
  /** Direct vs. agency classification; when given, rows and gross pay are split by group. */
  typeOf?: (p: PersonSummary) => PersonType;
};

/** Payroll PDF: summary + per-person daily detail. Only approved hours count toward totals. */
export const downloadPayrollPdf = async (opts: PayrollPdfOpts): Promise<void> => {
  downloadBlob(await buildPayrollPdf(opts), `${fileStem(opts.period)}.pdf`);
};

/** Builds the Payroll Hours Report PDF with period, group, and per-employee totals. */
export const buildPayrollPdf = async (opts: PayrollPdfOpts): Promise<Blob> => {
  const { period, pay, typeOf } = opts;
  const groups = typeOf ? groupPeople(opts.people, typeOf, pay ?? new Map()) : [];
  const people = typeOf ? groups.flatMap((g) => g.people) : opts.people;
  const typeLabel = (p: PersonSummary) => {
    const t = typeOf?.(p);
    return !t ? "" : t.group === "agency" ? `Agency${t.agency ? ` · ${t.agency}` : ""}` : "Direct";
  };
  const grossTotal = pay ? [...pay.values()].reduce((s, e) => s + e.grossCents, 0) : 0;
  const rateCell = (p: PersonSummary) => {
    const r = pay?.get(p.key)?.rate;
    return r === null || r === undefined ? "—" : `$${r.toFixed(2)}`;
  };
  const grossCell = (p: PersonSummary) => {
    const e = pay?.get(p.key);
    return e ? fmtCents(e.grossCents) : "—";
  };
  const twoWeeks = period.days > 7;
  const unapproved = people.reduce((n, p) => n + p.entries.filter((e) => e.status === "pending" || e.status === "open").length, 0);
  const totalApproved = people.reduce((s, p) => s + p.approvedMin, 0);
  const totalReg = people.reduce((s, p) => s + p.regularMin, 0);
  const totalOt = people.reduce((s, p) => s + p.overMin, 0);
  const totalPending = people.reduce((s, p) => s + p.pendingMin, 0);
  const totalOpen = people.reduce((s, p) => s + p.openCount, 0);
  const totalShifts = people.reduce((s, p) => s + p.entries.length, 0);

  // Hours-by-employee table: rows, bold subtotal rows, and a grand-total footer.
  const lead = typeOf ? 2 : 1;
  const empHead = [
    "Employee",
    ...(typeOf ? ["Type"] : []),
    "Shifts",
    ...(twoWeeks ? ["Week 1", "Week 2"] : []),
    "Regular",
    "Overtime",
    "Approved total",
    "Not approved",
    ...(pay ? ["Rate", "Gross pay"] : []),
  ];
  const numericCols = empHead.map((_, i) => i).filter((i) => i >= lead);
  const empBody: PdfCell[][] = [];
  const boldRows: number[] = [];
  const notApproved = (pendingMin: number, open: number) =>
    pendingMin > 0 || open > 0 ? `${fmtHours(pendingMin)}${open ? ` + ${open} open` : ""}` : "—";
  const weekCells = (list: PersonSummary[]) =>
    twoWeeks ? [0, 1].map((i) => fmtHours(list.reduce((s, p) => s + (p.weeks[i]?.approvedMin ?? 0), 0))) : [];
  for (const g of typeOf ? groups : [{ group: null, people }]) {
    for (const p of g.people) {
      empBody.push([
        p.name,
        ...(typeOf ? [typeLabel(p)] : []),
        String(p.entries.length),
        ...(twoWeeks ? p.weeks.map((w) => fmtHours(w.approvedMin)) : []),
        fmtHours(p.regularMin),
        fmtHours(p.overMin),
        fmtHours(p.approvedMin),
        notApproved(p.pendingMin, p.openCount),
        ...(pay ? [rateCell(p), grossCell(p)] : []),
      ]);
    }
    if ("grossCents" in g && groups.length > 1) {
      boldRows.push(empBody.length);
      empBody.push([
        { content: `${GROUP_LABEL[g.group]} subtotal`, colSpan: lead },
        String(g.people.reduce((s, p) => s + p.entries.length, 0)),
        ...weekCells(g.people),
        fmtHours(g.regularMin),
        fmtHours(g.overMin),
        fmtHours(g.approvedMin),
        notApproved(
          g.people.reduce((s, p) => s + p.pendingMin, 0),
          g.people.reduce((s, p) => s + p.openCount, 0),
        ),
        ...(pay ? ["", fmtCents(g.grossCents)] : []),
      ]);
    }
  }
  const empFoot: PdfCell[][] = [
    [
      { content: `TOTAL — ${people.length} ${people.length === 1 ? "employee" : "employees"}`, colSpan: lead },
      String(totalShifts),
      ...weekCells(people),
      fmtHours(totalReg),
      fmtHours(totalOt),
      fmtHours(totalApproved),
      notApproved(totalPending, totalOpen),
      ...(pay ? ["", fmtCents(grossTotal)] : []),
    ],
  ];

  const sections: PdfSection[] = [
    {
      title: "Period totals",
      metrics: [
        { label: "Approved hours", value: fmtHours(totalApproved), hint: `${totalShifts} shifts · ${people.length} employees` },
        { label: "Regular hours", value: fmtHours(totalReg), hint: "Up to 40 hrs / week" },
        { label: "Overtime hours", value: fmtHours(totalOt), hint: "Over 40 hrs / week" },
        pay
          ? { label: "Est. gross pay", value: fmtCents(grossTotal), hint: "Before taxes & deductions" }
          : { label: "Not approved", value: fmtHours(totalPending), hint: "Excluded from totals" },
      ],
    },
    {
      title: "Summary",
      fields: [
        ["Pay period", `${periodLabel(period)} (${twoWeeks ? "2 weeks" : "1 week"})`],
        ["Employees", String(people.length)],
        ["Approved hours", fmtHours(totalApproved)],
        ["Regular / overtime", `${fmtHours(totalReg)} / ${fmtHours(totalOt)}`],
        ...(pay
          ? ([
              ...groups.map((g) => [`${GROUP_LABEL[g.group]} gross pay`, `${fmtCents(g.grossCents)} · ${g.people.length} people · ${fmtHours(g.approvedMin)} hrs`]),
              ["Estimated gross pay (combined)", `${fmtCents(grossTotal)} (before taxes and deductions)`],
            ] as [string, string][])
          : []),
        ["Unapproved entries", unapproved === 0 ? "None — all hours reviewed" : `${unapproved} not included in totals`],
      ],
    },
    {
      title: "Hours by employee",
      table: { head: empHead, body: empBody, foot: empFoot, boldRows, numeric: numericCols },
      emptyText: "No hours recorded in this period.",
    },
    ...people.map<PdfSection>((p) => {
      const est = pay?.get(p.key);
      const ot = shiftOvertime(p.entries);
      const otCell = (id: string) => {
        const s = ot.get(id);
        if (!s || s.overMin === 0) return "";
        return `${s.crosses ? "Hits OT · " : "OT · "}${fmtHours(s.overMin)}${s.confirmed ? "" : "*"}`;
      };
      const highlightRows = p.entries.map((e, i) => ((ot.get(e.id)?.overMin ?? 0) > 0 ? i : -1)).filter((i) => i >= 0);
      const projected = p.entries.some((e) => {
        const s = ot.get(e.id);
        return !!s && s.overMin > 0 && !s.confirmed;
      });
      const recordedMin = p.entries.reduce((s, e) => s + (e.clockOut ? entryMinutes(e) : 0), 0);
      const foot: PdfCell[][] = [
        [
          { content: `Total recorded — ${p.entries.length} ${p.entries.length === 1 ? "shift" : "shifts"}`, colSpan: 3 },
          fmtHours(recordedMin),
          { content: projected ? "* Overtime once pending hours are approved" : "", colSpan: 3 },
        ],
        [
          { content: "Approved hours (paid)", colSpan: 3 },
          fmtHours(p.approvedMin),
          { content: `Regular ${fmtHours(p.regularMin)}  ·  Overtime ${fmtHours(p.overMin)}`, colSpan: 3 },
        ],
        ...(p.pendingMin > 0 || p.openCount > 0
          ? [
              [
                { content: "Not yet approved (excluded)", colSpan: 3 },
                fmtHours(p.pendingMin),
                { content: p.openCount ? `${p.openCount} still clocked in` : "", colSpan: 3 },
              ] as PdfCell[],
            ]
          : []),
        ...(est
          ? [
              [
                { content: "Estimated gross pay", colSpan: 3 },
                fmtCents(est.grossCents),
                {
                  content: `${est.rate !== null ? `$${est.rate.toFixed(2)}/hr` : "No rate on file"}${est.overtimePremiumCents > 0 ? `  ·  incl. ${fmtCents(est.overtimePremiumCents)} OT premium` : ""}`,
                  colSpan: 3,
                },
              ] as PdfCell[],
            ]
          : []),
      ];
      return {
        title: `${p.name}${typeOf ? ` (${typeLabel(p)})` : ""} — ${fmtHours(p.approvedMin)} approved hrs`,
        table: {
          head: ["Date", "Clock in", "Clock out", "Hours", "Week total", "Overtime", "Site", "Status"],
          body: p.entries.map((e) => [
            format(new Date(e.clockIn), "EEE MMM d"),
            t(e.clockIn),
            t(e.clockOut),
            e.clockOut ? fmtHours(entryMinutes(e)) : "open",
            e.status === "rejected" ? "—" : fmtHours(ot.get(e.id)?.afterMin ?? 0),
            otCell(e.id),
            opts.siteName(e.propertyId),
            `${ENTRY_STATUS[e.status].label}${e.edited ? " (edited)" : ""}`,
          ]),
          foot,
          highlightRows,
          numeric: [3, 4],
        },
      };
    }),
    {
      title: "Approval",
      text: [
        "Overtime is calculated on approved hours over 40 per Monday–Sunday workweek. Shifts that reach overtime are highlighted; \"Hits OT\" marks the shift that crosses 40 hours. Times are recorded by the server when each employee clocks in and out; admin corrections are logged with a reason.",
        ...(pay
          ? [
              "Gross pay is an estimate: approved hours × the hourly rate in effect each day, plus a half-time premium on overtime hours. It is before taxes and deductions and is not a paycheck.",
            ]
          : []),
        "Approved by: ______________________________          Date: ________________",
      ],
    },
  ];

  return buildPdf({
    title: "Payroll Hours Report",
    subtitle: periodLabel(period),
    orgName: opts.orgName,
    preparedBy: opts.preparedBy,
    heading: "PHOENIX FIRE WATCH · PAYROLL",
    footer: pay ? "Contains employee time and wage records. Confidential." : "Hours only — contains employee time records. Confidential.",
    sections,
  });
};

export const downloadPayrollCsv = (
  period: PayPeriod,
  people: PersonSummary[],
  siteName: (id: string | null) => string,
  pay?: Map<string, PayEstimate>,
  typeOf?: (p: PersonSummary) => PersonType,
) => {
  const rows: unknown[][] = [];
  const typeCell = (p: PersonSummary) => {
    const t = typeOf?.(p);
    return !t ? "Direct" : t.group === "agency" ? `Agency${t.agency ? ` - ${t.agency}` : ""}` : "Direct";
  };
  const groups = typeOf ? groupPeople(people, typeOf, pay ?? new Map()) : [];
  const ordered = typeOf ? groups.flatMap((g) => g.people) : people;
  for (const p of ordered) {
    const est = pay?.get(p.key);
    const ot = shiftOvertime(p.entries);
    for (const e of p.entries) {
      const s = ot.get(e.id);
      rows.push([
        p.name,
        typeCell(p),
        format(new Date(e.clockIn), "yyyy-MM-dd"),
        t(e.clockIn),
        t(e.clockOut),
        e.clockOut ? fmtHours(entryMinutes(e)) : "",
        s ? fmtHours(s.afterMin) : "",
        s && s.overMin > 0 ? fmtHours(s.overMin) : "",
        siteName(e.propertyId),
        ENTRY_STATUS[e.status].label,
        e.edited ? "yes" : "no",
        e.adminNote,
        ...(pay ? [est?.rate ?? ""] : []),
      ]);
    }
    if (pay && est) {
      rows.push([`${p.name} — estimated gross pay`, typeCell(p), "", "", "", fmtHours(p.approvedMin), "", fmtHours(p.overMin), "", "", "", "", (est.grossCents / 100).toFixed(2)]);
    }
  }
  if (pay) {
    for (const g of groups) rows.push([`${GROUP_LABEL[g.group]} — total gross pay`, "", "", "", "", fmtHours(g.approvedMin), "", fmtHours(g.overMin), "", "", "", "", (g.grossCents / 100).toFixed(2)]);
  }
  downloadCsv(
    `${fileStem(period)}.csv`,
    ["Employee", "Type", "Date", "Clock in", "Clock out", "Hours", "Week running total", "Overtime hours", "Site", "Status", "Edited", "Admin note", ...(pay ? ["Hourly rate / gross"] : [])],
    rows,
  );
};
