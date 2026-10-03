import {
  AlertTriangle,
  Download,
  Eye,
  FileText,
  Loader2,
  Mail,
  MapPin,
  Pencil,
  PersonStanding,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { PatrolRow } from "@/components/fw/PatrolRow";
import { PatrolTimerCard } from "@/components/fw/PatrolTimerCard";
import { ReportViewer, type GeneratedReport } from "@/components/fw/ReportViewer";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/fw/primitives";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { fullDateTime } from "@/lib/format";
import { buildShiftReport, downloadBlob } from "@/lib/report";
import { groupSessions, sessionLabel, sessionRange, type FireWatchSession } from "@/lib/sessions";
import { friendlyError } from "@/lib/supabase";
import { STATUS_META, type Patrol } from "@/lib/types";
import { useAuth } from "@/state/AuthProvider";
import { usePatrolStats, useFireWatch } from "@/state/FireWatchProvider";

import NotFound from "./NotFound";

const ALL = "all";

const DetailStat = ({
  label,
  value,
  icon: Icon,
  iconClass,
}: {
  label: string;
  value: number;
  icon: typeof ShieldCheck;
  iconClass: string;
}) => (
  <div className="flex items-start gap-4 rounded-xl border border-line bg-surface p-5 sm:p-6">
    <Icon className={`h-9 w-9 shrink-0 ${iconClass}`} strokeWidth={1.6} />
    <div>
      <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-ink-2 sm:text-xs">{label}</div>
      <div className="mt-2 font-display text-4xl font-extrabold leading-none tabular-nums text-ink sm:text-5xl">
        {value}
      </div>
    </div>
  </div>
);

const ContactField = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <dt className="text-xs font-medium uppercase tracking-[0.14em] text-ink-3">{label}</dt>
    <dd className="mt-1.5 break-words text-[15px] text-ink sm:text-base">{children}</dd>
  </div>
);

const emailBody = (propertyName: string, periodLabel: string, patrols: Patrol[], orgName: string): string => {
  const counts = { clear: 0, "follow-up": 0, incident: 0 };
  for (const p of patrols) counts[p.status] += 1;
  return [
    `Hello,`,
    ``,
    `Please find attached the Fire Watch Shift Report for ${propertyName} (${periodLabel}).`,
    ``,
    `Summary: ${patrols.length} patrols — ${counts.clear} Clear, ${counts["follow-up"]} Follow-up, ${counts.incident} Incident.`,
    ``,
    `Regards,`,
    orgName,
  ].join("\n");
};

const PropertyDetail = () => {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { propertyById, patrols, deleteProperty, deletePatrol } = useFireWatch();
  const { user, isAdmin } = useAuth();
  const property = propertyById.get(id);
  useDocumentTitle(property?.name ?? "Property");
  const [confirmDelete, setConfirmDelete] = useState<boolean>(false);
  const [pendingPatrol, setPendingPatrol] = useState<Patrol | null>(null);
  const [selected, setSelected] = useState<string>(ALL);
  const [busy, setBusy] = useState<"pdf" | "send" | null>(null);
  const [viewing, setViewing] = useState<{ patrols: Patrol[]; label: string } | null>(null);
  const [deleting, setDeleting] = useState<boolean>(false);

  const propertyPatrols = useMemo<Patrol[]>(() => patrols.filter((p) => p.propertyId === id), [patrols, id]);
  const stats = usePatrolStats(propertyPatrols);
  const sessions = useMemo<FireWatchSession[]>(() => groupSessions(propertyPatrols), [propertyPatrols]);
  const activeSession = selected === ALL ? null : (sessions.find((s) => s.id === selected) ?? null);
  const visibleSessions = activeSession ? [activeSession] : sessions;

  const onDeletePatrol = useCallback((p: Patrol) => setPendingPatrol(p), []);
  const closeViewer = useCallback(() => setViewing(null), []);

  if (!property) return <NotFound embedded />;

  const logPath = `/properties/${property.id}/log`;
  const reportPatrols = activeSession ? activeSession.patrols : propertyPatrols;
  const periodLabel = activeSession
    ? sessionLabel(activeSession)
    : sessions.length
      ? `All Patrols — ${sessionRange({ start: sessions[sessions.length - 1].start, end: sessions[0].end })}`
      : "All Patrols";
  const orgName = user?.orgName ?? "Phoenix Fire Watch";

  const makeReport = (patrolsForReport: Patrol[], label: string) =>
    buildShiftReport({
      orgName,
      preparedBy: user?.name ?? "Fire Watch Officer",
      property,
      patrols: patrolsForReport,
      periodLabel: label,
    });

  const downloadPdf = async (list = reportPatrols, label = periodLabel) => {
    if (list.length === 0) {
      toast.error("No patrols to include in this report");
      return;
    }
    setBusy("pdf");
    try {
      const { blob, fileName } = await makeReport(list, label);
      downloadBlob(blob, fileName);
      toast.success("Report downloaded", { description: fileName });
    } catch (err) {
      console.error("[Report] generation failed", err);
      toast.error("Couldn't generate the PDF", { description: friendlyError(err) });
    } finally {
      setBusy(null);
    }
  };

  const openViewer = (list = reportPatrols, label = periodLabel) => {
    if (list.length === 0) {
      toast.error("No patrols to include in this report");
      return;
    }
    setViewing({ patrols: list, label });
  };

  const shareReport = async (report: GeneratedReport, list: Patrol[], label: string) => {
    const { blob, fileName } = report;
    const file = new File([blob], fileName, { type: "application/pdf" });
    const subject = `Fire Watch Shift Report — ${property.name}`;
    const body = emailBody(property.name, label, list, orgName);

    if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: subject, text: body });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    }

    downloadBlob(blob, fileName);
    if (property.contactEmail) {
      window.location.href = `mailto:${property.contactEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      toast.success("PDF downloaded — attach it to the email", { description: fileName, duration: 7000 });
    } else {
      toast.success("PDF downloaded", { description: "Add a contact email to this property to email reports." });
    }
  };

  const sendReport = async () => {
    if (reportPatrols.length === 0) {
      toast.error("No patrols to include in this report");
      return;
    }
    setBusy("send");
    try {
      const report = await makeReport(reportPatrols, periodLabel);
      await shareReport(report, reportPatrols, periodLabel);
    } catch (err) {
      console.error("[Report] send failed", err);
      toast.error("Couldn't prepare the report", { description: friendlyError(err) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader
        backTo="/properties"
        backLabel="Back to Properties"
        title={property.name}
        subtitle={
          <span className="inline-flex items-start gap-2">
            <MapPin className="mt-1 h-4 w-4 shrink-0 text-ink-3" />
            {property.address}
          </span>
        }
        actions={
          <>
            <Button asChild variant="outline">
              <Link to={`/properties/${property.id}/edit`}>
                <Pencil />
                Edit
              </Link>
            </Button>
            {isAdmin && (
              <Button variant="destructive-outline" onClick={() => setConfirmDelete(true)}>
                <Trash2 />
                Delete
              </Button>
            )}
          </>
        }
      />

      <Button asChild size="lg" className="-mt-2 h-14 w-full text-base sm:w-auto sm:min-w-[260px]">
        <Link to={logPath}>
          <Plus className="!h-5 !w-5" />
          Log Patrol
        </Link>
      </Button>

      <PatrolTimerCard property={property} />

      <div className="mt-5 grid grid-cols-2 gap-4 lg:gap-5 xl:grid-cols-4">
        <DetailStat label="Total Patrols" value={stats.total} icon={PersonStanding} iconClass="text-ember" />
        <DetailStat label="Clear" value={stats.clear} icon={ShieldCheck} iconClass="text-status-clear" />
        <DetailStat label="Follow-up" value={stats.followUp} icon={FileText} iconClass="text-status-follow" />
        <DetailStat label="Incidents" value={stats.incidents} icon={AlertTriangle} iconClass="text-status-incident" />
      </div>

      <Card className="mt-5">
        <CardHeader title="Contact Information" />
        <dl className="grid gap-6 px-6 pb-7 pt-6 sm:grid-cols-2 sm:px-7 lg:grid-cols-[1fr_1fr_1.4fr]">
          <ContactField label="Contact Name">{property.contactName || <span className="text-ink-3">—</span>}</ContactField>
          <ContactField label="Phone">
            {property.contactPhone ? (
              <a href={`tel:${property.contactPhone}`} className="focus-ring rounded font-mono hover:text-ember">
                {property.contactPhone}
              </a>
            ) : (
              <span className="text-ink-3">—</span>
            )}
          </ContactField>
          <ContactField label="Email">
            {property.contactEmail ? (
              <a href={`mailto:${property.contactEmail}`} className="focus-ring rounded hover:text-ember">
                {property.contactEmail}
              </a>
            ) : (
              <span className="text-ink-3">—</span>
            )}
          </ContactField>
          <div className="sm:col-span-2 lg:col-span-3">
            <dt className="text-xs font-medium uppercase tracking-[0.14em] text-ink-3">Notes</dt>
            <dd className="mt-2 whitespace-pre-wrap rounded-lg border border-line bg-raised/60 p-4 text-[15px] leading-relaxed text-ink">
              {property.notes || <span className="text-ink-3">No special instructions</span>}
            </dd>
          </div>
        </dl>
      </Card>

      <Card className="mt-5 flex min-h-[420px] flex-col">
        <div className="flex flex-col gap-4 border-b border-line px-6 py-6 sm:px-7 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h2 className="font-display text-xl font-bold text-ink sm:text-[22px]">Fire Watch Sessions</h2>
            <p className="mt-1 text-sm text-ink-2">Patrol logs grouped by 24-hour activity periods</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={selected} onValueChange={setSelected} disabled={sessions.length === 0}>
              <SelectTrigger
                aria-label="Select session"
                className="h-10 w-full min-w-[220px] border-[#454954] bg-raised text-ink ring-offset-canvas focus:ring-ember/50 sm:w-auto"
              >
                <SelectValue placeholder="Select session" />
              </SelectTrigger>
              <SelectContent className="border-line bg-surface text-ink">
                <SelectItem value={ALL} className="focus:bg-ember focus:text-white">
                  All Patrols
                </SelectItem>
                {sessions.map((s) => (
                  <SelectItem key={s.id} value={s.id} className="focus:bg-ember focus:text-white">
                    {sessionLabel(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => openViewer()} disabled={!!busy || reportPatrols.length === 0}>
              <Eye />
              View Report
            </Button>
            <Button variant="outline" onClick={() => void downloadPdf()} disabled={!!busy || reportPatrols.length === 0}>
              {busy === "pdf" ? <Loader2 className="animate-spin" /> : <Download />}
              Download PDF
            </Button>
            <Button variant="outline" onClick={() => void sendReport()} disabled={!!busy || reportPatrols.length === 0}>
              {busy === "send" ? <Loader2 className="animate-spin" /> : <Mail />}
              Send Report
            </Button>
            <Button asChild>
              <Link to={logPath}>
                <Plus />
                Log Patrol
              </Link>
            </Button>
          </div>
        </div>

        {sessions.length === 0 ? (
          <EmptyState
            className="flex-1"
            title="No patrol logs yet"
            description="Start logging patrols for this property"
            action={
              <Button asChild size="lg">
                <Link to={logPath}>Log First Patrol</Link>
              </Button>
            }
          />
        ) : (
          <div className="space-y-5 px-4 py-5 sm:px-5">
            {visibleSessions.map((s) => {
              const incidents = s.patrols.filter((p) => p.status === "incident").length;
              const followUps = s.patrols.filter((p) => p.status === "follow-up").length;
              return (
                <div key={s.id} className="overflow-hidden rounded-lg border border-line bg-canvas/40">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-raised/50 px-5 py-3.5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-3">
                        <span className="h-2 w-2 shrink-0 animate-ember-pulse rounded-full bg-ember" aria-hidden />
                        <span className="text-[15px] font-semibold text-ink">{sessionLabel(s)}</span>
                      </div>
                      <div className="mt-0.5 pl-5 text-xs text-ink-3">
                        {s.patrols.length} {s.patrols.length === 1 ? "patrol" : "patrols"}
                        {followUps > 0 && <span className="text-status-follow"> · {followUps} follow-up</span>}
                        {incidents > 0 && (
                          <span className="text-status-incident">
                            {" "}
                            · {incidents} {incidents === 1 ? "incident" : "incidents"}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openViewer(s.patrols, sessionLabel(s))}
                        className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-lg border border-ember/40 bg-ember/10 px-3 text-xs font-semibold text-ember transition-colors hover:bg-ember hover:text-white"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        View Report
                      </button>
                      <button
                        type="button"
                        onClick={() => void downloadPdf(s.patrols, sessionLabel(s))}
                        disabled={!!busy}
                        aria-label="Download session PDF"
                        className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-ink-2 transition-colors hover:text-ember disabled:opacity-40"
                      >
                        <Download className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">PDF</span>
                      </button>
                    </div>
                  </div>
                  <ul className="divide-y divide-line">
                    {s.patrols.map((p) => (
                      <PatrolRow
                        key={p.id}
                        patrol={p}
                        showDate
                        onDelete={isAdmin || p.loggedBy === user?.id ? onDeletePatrol : undefined}
                      />
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <ReportViewer
        open={!!viewing}
        title={`Shift Report — ${property.name}`}
        subtitle={viewing?.label}
        onClose={closeViewer}
        build={() => makeReport(viewing?.patrols ?? [], viewing?.label ?? periodLabel)}
        onDownload={(r) => {
          downloadBlob(r.blob, r.fileName);
          toast.success("Report downloaded", { description: r.fileName });
        }}
        onSend={(r) => shareReport(r, viewing?.patrols ?? [], viewing?.label ?? periodLabel)}
      />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent className="border-line bg-surface text-ink sm:rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-xl">Delete this property?</AlertDialogTitle>
            <AlertDialogDescription className="text-ink-2">
              {property.name} and all {propertyPatrols.length} of its patrol logs will be permanently removed for
              your whole team.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-[#454954] bg-transparent text-ink hover:bg-raised hover:text-ink">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-status-incident text-white hover:bg-status-incident/90"
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                setDeleting(true);
                deleteProperty(property.id)
                  .then(() => {
                    toast.success("Property deleted");
                    navigate("/properties");
                  })
                  .catch((err: unknown) => {
                    toast.error(friendlyError(err, "Couldn't delete the property"));
                    setDeleting(false);
                    setConfirmDelete(false);
                  });
              }}
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete Property"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!pendingPatrol} onOpenChange={(o) => !o && setPendingPatrol(null)}>
        <AlertDialogContent className="border-line bg-surface text-ink sm:rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-xl">Delete this patrol log?</AlertDialogTitle>
            <AlertDialogDescription className="text-ink-2">
              {pendingPatrol
                ? `${fullDateTime(pendingPatrol.dateTime)} by ${pendingPatrol.officerName} (${STATUS_META[pendingPatrol.status].label}). `
                : ""}
              This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-[#454954] bg-transparent text-ink hover:bg-raised hover:text-ink">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-status-incident text-white hover:bg-status-incident/90"
              onClick={() => {
                const target = pendingPatrol;
                setPendingPatrol(null);
                if (!target) return;
                deletePatrol(target.id)
                  .then(() => toast.success("Patrol log deleted"))
                  .catch((err: unknown) => toast.error(friendlyError(err, "Couldn't delete the patrol")));
              }}
            >
              Delete Log
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default PropertyDetail;
