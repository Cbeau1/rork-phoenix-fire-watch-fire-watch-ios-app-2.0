import { format } from "date-fns";

import {
  entryMinutes,
  fmtCents,
  fmtHours,
  periodEnd,
  periodLabel,
  ENTRY_STATUS,
  type PayEstimate,
  type PayPeriod,
  type PersonSummary,
} from "@/lib/timeclock";
import { buildPdf, downloadBlob, downloadCsv, type PdfSection } from "@/lib/workforce/exports";

const fileStem = (period: PayPeriod) =>
  `payroll_${format(period.start, "yyyy-MM-dd")}_to_${format(periodEnd(period), "yyyy-MM-dd")}`;

const t = (iso: string | null) => (iso ? format(new Date(iso), "h:mm a") : "—");

/** Payroll PDF: summary + per-person daily detail. Only approved hours count toward totals. */
export const downloadPayrollPdf = (opts: {
  period: PayPeriod;
  people: PersonSummary[];
  orgName: string;
  preparedBy: string;
  siteName: (id: string | null) => string;
  /** Gross-pay estimates per person key; omitted when the admin can't see wages. */
  pay?: Map<string, PayEstimate>;
}) => {
  const { period, people, pay } = opts;
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

  const sections: PdfSection[] = [
    {
      title: "Summary",
      fields: [
        ["Pay period", `${periodLabel(period)} (${twoWeeks ? "2 weeks" : "1 week"})`],
        ["Employees", String(people.length)],
        ["Approved hours", fmtHours(totalApproved)],
        ["Regular / overtime", `${fmtHours(totalReg)} / ${fmtHours(totalOt)}`],
        ...(pay ? ([["Estimated gross pay", `${fmtCents(grossTotal)} (before taxes and deductions)`]] as [string, string][]) : []),
        ["Unapproved entries", unapproved === 0 ? "None — all hours reviewed" : `${unapproved} not included in totals`],
      ],
    },
    {
      title: "Hours by employee",
      table: {
        head: [
          "Employee",
          ...(twoWeeks ? ["Week 1", "Week 2"] : []),
          "Regular",
          "Overtime",
          "Approved total",
          "Not approved",
          ...(pay ? ["Rate", "Gross pay"] : []),
        ],
        body: [
          ...people.map((p) => [
            p.name,
            ...(twoWeeks ? p.weeks.map((w) => fmtHours(w.approvedMin)) : []),
            fmtHours(p.regularMin),
            fmtHours(p.overMin),
            fmtHours(p.approvedMin),
            p.pendingMin > 0 || p.openCount > 0 ? `${fmtHours(p.pendingMin)}${p.openCount ? ` + ${p.openCount} open` : ""}` : "—",
            ...(pay ? [rateCell(p), grossCell(p)] : []),
          ]),
          [
            "TOTAL",
            ...(twoWeeks ? [0, 1].map((i) => fmtHours(people.reduce((s, p) => s + (p.weeks[i]?.approvedMin ?? 0), 0))) : []),
            fmtHours(totalReg),
            fmtHours(totalOt),
            fmtHours(totalApproved),
            "",
            ...(pay ? ["", fmtCents(grossTotal)] : []),
          ],
        ],
      },
      emptyText: "No hours recorded in this period.",
    },
    ...people.map<PdfSection>((p) => ({
      title: `${p.name} — ${fmtHours(p.approvedMin)} approved hrs`,
      table: {
        head: ["Date", "Clock in", "Clock out", "Hours", "Site", "Status"],
        body: p.entries.map((e) => [
          format(new Date(e.clockIn), "EEE MMM d"),
          t(e.clockIn),
          t(e.clockOut),
          e.clockOut ? fmtHours(entryMinutes(e)) : "open",
          opts.siteName(e.propertyId),
          `${ENTRY_STATUS[e.status].label}${e.edited ? " (edited)" : ""}`,
        ]),
      },
    })),
    {
      title: "Approval",
      text: [
        "Overtime is calculated on approved hours over 40 per Monday–Sunday workweek. Times are recorded by the server when each employee clocks in and out; admin corrections are logged with a reason.",
        ...(pay
          ? [
              "Gross pay is an estimate: approved hours × the hourly rate in effect each day, plus a half-time premium on overtime hours. It is before taxes and deductions and is not a paycheck.",
            ]
          : []),
        "Approved by: ______________________________          Date: ________________",
      ],
    },
  ];

  const blob = buildPdf({
    title: "Payroll Hours Report",
    subtitle: periodLabel(period),
    orgName: opts.orgName,
    preparedBy: opts.preparedBy,
    heading: "PHOENIX FIRE WATCH · PAYROLL",
    footer: pay ? "Contains employee time and wage records. Confidential." : "Hours only — contains employee time records. Confidential.",
    sections,
  });
  downloadBlob(blob, `${fileStem(period)}.pdf`);
};

export const downloadPayrollCsv = (
  period: PayPeriod,
  people: PersonSummary[],
  siteName: (id: string | null) => string,
  pay?: Map<string, PayEstimate>,
) => {
  const rows: unknown[][] = [];
  for (const p of people) {
    const est = pay?.get(p.key);
    for (const e of p.entries) {
      rows.push([
        p.name,
        format(new Date(e.clockIn), "yyyy-MM-dd"),
        t(e.clockIn),
        t(e.clockOut),
        e.clockOut ? fmtHours(entryMinutes(e)) : "",
        siteName(e.propertyId),
        ENTRY_STATUS[e.status].label,
        e.edited ? "yes" : "no",
        e.adminNote,
        ...(pay ? [est?.rate ?? ""] : []),
      ]);
    }
    if (pay && est) {
      rows.push([`${p.name} — estimated gross pay`, "", "", "", fmtHours(p.approvedMin), "", "", "", "", (est.grossCents / 100).toFixed(2)]);
    }
  }
  downloadCsv(
    `${fileStem(period)}.csv`,
    ["Employee", "Date", "Clock in", "Clock out", "Hours", "Site", "Status", "Edited", "Admin note", ...(pay ? ["Hourly rate / gross"] : [])],
    rows,
  );
};
