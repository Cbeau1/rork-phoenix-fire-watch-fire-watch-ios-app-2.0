import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Download, Search, UserPlus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { PageHeader } from "@/components/fw/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Empty, fmtDate, MetaPill, Pill, SelectField } from "@/components/workforce/kit";
import { useWorkerPhotos, WorkerAvatar } from "@/components/workforce/WorkerAvatar";
import { WorkerFormDialog } from "@/components/workforce/WorkerFormDialog";
import * as api from "@/lib/workforce/api";
import { fullName, SOURCE_SHORT, WORKER_STATUS, type Worker, type WorkerSource } from "@/lib/workforce/constants";
import { awaitingReturn, missingItems } from "@/lib/workforce/derive";
import { downloadCsv, stamp } from "@/lib/workforce/exports";
import { cn } from "@/lib/utils";
import { useWorkforce } from "@/state/WorkforceProvider";

const PAGE = 25;
type SortKey = "name" | "code" | "source" | "status" | "start" | "position";

const Directory = () => {
  const wf = useWorkforce();
  const [params, setParams] = useSearchParams();
  const [addOpen, setAddOpen] = useState<boolean>(false);
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: "name", asc: true });
  const [page, setPage] = useState<number>(0);

  const q = params.get("q") ?? "";
  const source = params.get("source") ?? "";
  const status = params.get("status") ?? "";
  const agency = params.get("agency") ?? "";
  const area = params.get("area") ?? "";
  const property = params.get("property") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const flag = params.get("flag") ?? "";
  const archived = params.get("archived") === "1";

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
    setPage(0);
  };

  const areas = useMemo(() => Array.from(new Set(wf.workers.flatMap((w) => w.service_areas))).sort(), [wf.workers]);

  const paperworkSet = useMemo(
    () => new Set(wf.workers.filter((w) => missingItems(w.id, wf.checklist, wf.placements).length > 0).map((w) => w.id)),
    [wf.workers, wf.checklist, wf.placements],
  );
  const equipmentSet = useMemo(
    () => new Set(awaitingReturn(wf.equipment, wf.workers, wf.placements).map((e) => e.worker_id)),
    [wf.equipment, wf.workers, wf.placements],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = wf.workers.filter((w) => {
      if (archived ? !w.archived_at : !!w.archived_at) return false;
      if (source && w.source !== source) return false;
      if (status === "intake") {
        if (w.status !== "onboarding" && w.status !== "pending_placement") return false;
      } else if (status && w.status !== status) return false;
      if (agency && w.agency_id !== agency) return false;
      if (area && !w.service_areas.includes(area)) return false;
      if (flag === "paperwork" && !paperworkSet.has(w.id)) return false;
      if (flag === "equipment" && !equipmentSet.has(w.id)) return false;
      if (property || from || to) {
        const pl = wf.placements.filter((p) => p.worker_id === w.id && (!property || p.property_id === property));
        const sh = w.staff_id ? wf.shifts.filter((s) => s.staff_id === w.staff_id && (!property || s.property_id === property)) : [];
        const okPl = pl.some((p) => (!from || (p.end_date ?? "9999") >= from) && (!to || p.start_date <= to));
        const okSh = sh.some((s) => (!from || s.shift_date >= from) && (!to || s.shift_date <= to));
        if (!okPl && !okSh) return false;
      }
      if (needle) {
        const hay = [fullName(w), w.worker_code, w.email, w.phone, w.position, wf.agencyById.get(w.agency_id ?? "")?.name ?? "", w.agency_worker_ref]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    const val = (w: Worker): string => {
      switch (sort.key) {
        case "code":
          return w.worker_code;
        case "source":
          return w.source;
        case "status":
          return WORKER_STATUS[w.status]?.label ?? w.status;
        case "start":
          return w.start_date ?? "";
        case "position":
          return w.position.toLowerCase();
        default:
          return `${w.last_name} ${w.first_name}`.toLowerCase();
      }
    };
    return list.sort((a, b) => (sort.asc ? 1 : -1) * val(a).localeCompare(val(b)));
  }, [wf.workers, wf.placements, wf.shifts, wf.agencyById, q, source, status, agency, area, property, from, to, flag, archived, sort, paperworkSet, equipmentSet]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const current = Math.min(page, pages - 1);
  const rows = filtered.slice(current * PAGE, current * PAGE + PAGE);
  const photos = useWorkerPhotos(rows);

  const activeFilters = [source, status, agency, area, property, from, to, flag, archived ? "1" : ""].filter(Boolean).length;

  const exportCsv = async () => {
    try {
      await api.logEvent("export", "directory", `Exported workforce directory CSV (${filtered.length} rows)`);
      downloadCsv(
        `workforce-directory_${stamp()}.csv`,
        ["Worker ID", "Name", "Source", "Agency", "Phone", "Email", "Position", "Hire / first assignment", "Status", "Service areas"],
        filtered.map((w) => [
          w.worker_code,
          fullName(w),
          SOURCE_SHORT[w.source as WorkerSource],
          wf.agencyById.get(w.agency_id ?? "")?.name ?? "",
          w.phone,
          w.email,
          w.position,
          w.start_date ?? "",
          WORKER_STATUS[w.status]?.label ?? w.status,
          w.service_areas.join("; "),
        ]),
      );
      toast.success("Directory exported");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed.");
    }
  };

  const SortHead = ({ k, children, className }: { k: SortKey; children: string; className?: string }) => (
    <th scope="col" className={cn("px-3 py-2.5 text-left font-medium", className)} aria-sort={sort.key === k ? (sort.asc ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        className="focus-ring inline-flex items-center gap-1 rounded hover:text-ink"
        onClick={() => setSort((s) => ({ key: k, asc: s.key === k ? !s.asc : true }))}
      >
        {children}
        {sort.key === k && (sort.asc ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />)}
      </button>
    </th>
  );

  const statusOptions = Object.entries(WORKER_STATUS)
    .filter(([k]) => !source || (source === "agency" ? ["pending_placement", "active", "unavailable", "assignment_ended", "do_not_assign"] : ["onboarding", "active", "on_leave", "suspended", "terminated"]).includes(k))
    .map(([value, m]) => ({ value, label: m.label }));

  return (
    <div>
      <PageHeader
        title="Workforce directory"
        subtitle={`${filtered.length} ${filtered.length === 1 ? "profile" : "profiles"}${archived ? " (archived)" : ""}`}
        actions={
          <>
            <Button variant="outline" onClick={() => void exportCsv()} disabled={filtered.length === 0}>
              <Download />
              Export CSV
            </Button>
            <Button onClick={() => setAddOpen(true)}>
              <UserPlus />
              Add worker
            </Button>
          </>
        }
      />

      <div className="rounded-xl border border-line bg-surface shadow-card p-3 sm:p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
          <Input
            aria-label="Search workers"
            placeholder="Search name, worker ID, email, phone, agency…"
            value={q}
            onChange={(e) => setParam("q", e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SelectField label="Worker source" value={source} onChange={(v) => setParam("source", v)} allowNone noneLabel="All sources" options={[{ value: "direct", label: "Direct employees" }, { value: "agency", label: "Agency workers" }]} />
          <SelectField
            label="Status"
            value={status}
            onChange={(v) => setParam("status", v)}
            allowNone
            noneLabel="All statuses"
            options={[{ value: "intake", label: "Onboarding / pending placement" }, ...statusOptions]}
          />
          <SelectField label="Agency" value={agency} onChange={(v) => setParam("agency", v)} allowNone noneLabel="All agencies" options={wf.agencies.map((a) => ({ value: a.id, label: a.name }))} />
          <SelectField label="Service area" value={area} onChange={(v) => setParam("area", v)} allowNone noneLabel="All areas" options={areas.map((a) => ({ value: a, label: a }))} />
          <SelectField label="Property" value={property} onChange={(v) => setParam("property", v)} allowNone noneLabel="Any property" options={wf.properties.map((p) => ({ value: p.id, label: p.name }))} />
          <div>
            <label htmlFor="dir-from" className="mb-2 block text-sm font-medium text-ink">Assigned from</label>
            <Input id="dir-from" type="date" value={from} onChange={(e) => setParam("from", e.target.value)} />
          </div>
          <div>
            <label htmlFor="dir-to" className="mb-2 block text-sm font-medium text-ink">Assigned to</label>
            <Input id="dir-to" type="date" value={to} onChange={(e) => setParam("to", e.target.value)} />
          </div>
          <SelectField
            label="Needs attention"
            value={flag}
            onChange={(v) => setParam("flag", v)}
            allowNone
            noneLabel="Any"
            options={[{ value: "paperwork", label: "Missing required paperwork" }, { value: "equipment", label: "Equipment awaiting return" }]}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant={archived ? "secondary" : "ghost"} size="sm" onClick={() => setParam("archived", archived ? "" : "1")}>
            {archived ? "Showing archived" : "Show archived"}
          </Button>
          {activeFilters > 0 && (
            <Button variant="ghost" size="sm" onClick={() => { setParams(q ? { q } : {}, { replace: true }); setPage(0); }}>
              <X />
              Clear filters ({activeFilters})
            </Button>
          )}
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-line bg-surface shadow-card">
        {rows.length === 0 ? (
          <div className="p-4">
            <Empty
              title={wf.workers.length === 0 ? "No workers yet" : "No matching profiles"}
              description={wf.workers.length === 0 ? "Add your first direct employee or agency worker." : "Try clearing a filter or search term."}
              action={wf.workers.length === 0 ? <Button onClick={() => setAddOpen(true)}><UserPlus />Add worker</Button> : undefined}
            />
          </div>
        ) : (
          <>
            {/* Mobile: stacked cards */}
            <ul className="space-y-2.5 p-3 md:hidden">
              {rows.map((w) => (
                <li key={w.id}>
                  <Link to={`/workforce/workers/${w.id}`} className="focus-ring flex items-start gap-3 rounded-lg border border-line bg-raised p-3.5">
                    <WorkerAvatar name={fullName(w)} url={photos[w.id]} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium text-ink">{fullName(w)}</span>
                        <MetaPill meta={WORKER_STATUS} value={w.status} />
                      </div>
                      <div className="mt-0.5 truncate text-xs text-ink-3">
                        <span className="font-mono">{w.worker_code}</span> · {SOURCE_SHORT[w.source as WorkerSource]}
                        {w.agency_id && <> · {wf.agencyById.get(w.agency_id)?.name}</>}
                      </div>
                      <div className="mt-1 truncate text-xs text-ink-2">{[w.position, w.phone, w.email].filter(Boolean).join(" · ") || "No contact details"}</div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            {/* Desktop: table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <caption className="sr-only">Workforce directory</caption>
                <thead className="border-b border-line text-xs uppercase tracking-wide text-ink-3">
                  <tr>
                    <SortHead k="name" className="pl-5">Name</SortHead>
                    <SortHead k="code">Worker ID</SortHead>
                    <SortHead k="source">Source</SortHead>
                    <th scope="col" className="px-3 py-2.5 text-left font-medium">Contact</th>
                    <SortHead k="position">Position</SortHead>
                    <SortHead k="start">Hire / first assignment</SortHead>
                    <SortHead k="status">Status</SortHead>
                    <th scope="col" className="px-3 py-2.5 pr-5 text-left font-medium">Service area</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((w) => (
                    <tr key={w.id} className="border-b border-line/60 last:border-0 hover:bg-raised/60">
                      <td className="py-2.5 pl-5 pr-3">
                        <Link to={`/workforce/workers/${w.id}`} className="focus-ring flex items-center gap-3 rounded">
                          <WorkerAvatar name={fullName(w)} url={photos[w.id]} size="sm" />
                          <span className="font-medium text-ink hover:text-link">{fullName(w)}</span>
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs text-ink-2">{w.worker_code}</td>
                      <td className="px-3 py-2.5">
                        <Pill tone={w.source === "agency" ? "blue" : "slate"}>{SOURCE_SHORT[w.source as WorkerSource]}</Pill>
                        {w.agency_id && <div className="mt-1 text-xs text-ink-3">{wf.agencyById.get(w.agency_id)?.name}</div>}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-ink-2">
                        <div>{w.phone || "—"}</div>
                        <div className="max-w-[200px] truncate">{w.email}</div>
                      </td>
                      <td className="px-3 py-2.5 text-ink-2">{w.position || "—"}</td>
                      <td className="px-3 py-2.5 text-ink-2">{fmtDate(w.start_date)}</td>
                      <td className="px-3 py-2.5"><MetaPill meta={WORKER_STATUS} value={w.status} /></td>
                      <td className="px-3 py-2.5 pr-5 text-xs text-ink-2">{w.service_areas.join(", ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm text-ink-2">
              <span>
                {current * PAGE + 1}–{Math.min(filtered.length, current * PAGE + PAGE)} of {filtered.length}
              </span>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" aria-label="Previous page" disabled={current === 0} onClick={() => setPage(current - 1)}>
                  <ChevronLeft />
                </Button>
                <Button variant="ghost" size="icon" aria-label="Next page" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
                  <ChevronRight />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      <WorkerFormDialog open={addOpen} onOpenChange={setAddOpen} worker={null} defaultSource={source === "agency" ? "agency" : "direct"} />
    </div>
  );
};

export default Directory;
