import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  BellRing,
  Camera,
  Check,
  CheckCircle2,
  Clock,
  Flame,
  Link2,
  Loader2,
  MapPin,
  MapPinOff,
  MessageSquareText,
  RadioTower,
  RefreshCw,
  Settings2,
  ShieldAlert,
  UserX,
  X,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { DispatchMap } from "@/components/fw/DispatchMap";
import { DispatchSettingsDialog } from "@/components/fw/DispatchSettingsDialog";
import { ReportFailuresCard } from "@/components/fw/ReportFailuresCard";
import { Card, PageHeader } from "@/components/fw/primitives";
import { ShiftLinkDialog, type ShiftLinkTarget } from "@/components/fw/ShiftLinkDialog";
import { Button } from "@/components/ui/button";
import { AreaField, Empty, ErrorBlock, FormDialog, Loading, Pill } from "@/components/workforce/kit";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { usePhotoUrls } from "@/hooks/use-photo-urls";
import {
  ackAlert,
  decideRequest,
  fetchSettings,
  fmtAgo,
  fmtMeters,
  fmtZoned,
  INCIDENT_CATEGORY,
  resolveIncident,
  SEVERITY,
  type BoardAlert,
  type BoardIncident,
  type BoardShift,
  type DispatchSettings,
} from "@/lib/dispatch/api";
import { linkState } from "@/lib/dispatch/linkState";
import { BOARD_KEY, shiftState, useDispatchBoard, useNow, type ShiftPhase, type ShiftState } from "@/lib/dispatch/useBoard";
import { friendlyError } from "@/lib/supabase";
import type { Tone } from "@/lib/workforce/constants";
import { cn } from "@/lib/utils";
import { useAuth } from "@/state/AuthProvider";

const PHASE: Record<ShiftPhase, { label: string; tone: Tone }> = {
  on_duty: { label: "On duty", tone: "green" },
  starting: { label: "Starting soon", tone: "blue" },
  upcoming: { label: "Upcoming", tone: "slate" },
  late: { label: "Not checked in", tone: "red" },
  missed: { label: "Missed", tone: "red" },
  done: { label: "Checked out", tone: "slate" },
};

const PHASE_ORDER: ShiftPhase[] = ["late", "on_duty", "starting", "upcoming", "missed", "done"];

const zoneLabel = (tz: string): string =>
  new Date().toLocaleString("en-US", { timeZone: tz, timeZoneName: "short" }).split(" ").pop() ?? tz;

const Dispatch = () => {
  useDocumentTitle("Dispatch");
  const { user, isAdmin } = useAuth();
  const orgId = user?.orgId ?? "";
  const qc = useQueryClient();
  const board = useDispatchBoard();
  const now = useNow(20_000);
  const settings = useQuery({ queryKey: ["dispatch", "settings", orgId], enabled: isAdmin && !!orgId, queryFn: () => fetchSettings(orgId) });

  const [linkTarget, setLinkTarget] = useState<ShiftLinkTarget | null>(null);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [resolveFor, setResolveFor] = useState<BoardIncident | null>(null);
  const [resolveNote, setResolveNote] = useState<string>("");

  const invalidate = () => void qc.invalidateQueries({ queryKey: BOARD_KEY });

  const decide = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) => decideRequest(id, approve),
    onSuccess: (_d, v) => {
      toast.success(v.approve ? "Check-in allowed — the guard can check in now" : "Check-in denied");
      invalidate();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const ack = useMutation({
    mutationFn: (id: string) => ackAlert(id),
    onSuccess: () => {
      toast.success("Alert acknowledged");
      invalidate();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const resolve = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => resolveIncident(id, note),
    onSuccess: () => {
      toast.success("Incident resolved");
      setResolveFor(null);
      invalidate();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const data = board.data;
  const tz = data?.tz ?? "America/New_York";
  const late = settings.data?.late_minutes ?? 15;

  const shiftById = useMemo(() => new Map((data?.shifts ?? []).map((s) => [s.id, s])), [data]);
  const states = useMemo(() => new Map((data?.shifts ?? []).map((s) => [s.id, shiftState(s, now, late)])), [data, now, late]);
  const requests = useMemo(() => (data?.shifts ?? []).filter((s) => s.request?.status === "pending"), [data]);
  const grouped = useMemo(() => {
    const g = new Map<ShiftPhase, BoardShift[]>();
    for (const s of data?.shifts ?? []) {
      const p = states.get(s.id)?.phase ?? "upcoming";
      g.set(p, [...(g.get(p) ?? []), s]);
    }
    return g;
  }, [data, states]);

  const openLink = (s: BoardShift) =>
    setLinkTarget({
      shiftId: s.id,
      staffId: s.staff.id,
      staffName: s.staff.name,
      phone: s.staff.phone,
      propertyName: s.property.name,
      whenLabel: `${fmtZoned(s.starts_at, tz, true)} – ${fmtZoned(s.ends_at, tz)}`,
      hasLink: !!s.link,
    });

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-lg py-20 text-center">
        <ShieldAlert className="mx-auto h-12 w-12 text-link" strokeWidth={1.5} />
        <h1 className="mt-5 font-display text-3xl font-extrabold text-ink">Administrators only</h1>
        <p className="mt-2 text-ink-2">The dispatch board is limited to organization admins.</p>
        <Button asChild className="mt-7">
          <Link to="/">Return to Dashboard</Link>
        </Button>
      </div>
    );
  }

  const onDuty = grouped.get("on_duty")?.length ?? 0;
  const attention = requests.length + (data?.alerts.filter((a) => !a.acknowledged_at).length ?? 0);
  const updatedAgo = board.dataUpdatedAt ? Math.max(0, Math.round((now - board.dataUpdatedAt) / 1000)) : null;

  return (
    <div>
      <PageHeader
        title="Dispatch"
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="inline-flex items-center gap-1.5">
              <span className={cn("h-2 w-2 rounded-full", board.isError ? "bg-status-follow" : "animate-primary-pulse bg-status-clear")} />
              {board.isError ? "Connection problem — retrying" : "Live"}
            </span>
            <span className="text-ink-3">·</span>
            <span>Times in {zoneLabel(tz)}</span>
            {updatedAgo != null && !board.isError && (
              <>
                <span className="text-ink-3">·</span>
                <span className="text-ink-3">updated {updatedAgo < 20 ? "just now" : `${updatedAgo}s ago`}</span>
              </>
            )}
          </span>
        }
        actions={
          <>
            <Button variant="outline" onClick={() => void board.refetch()} disabled={board.isFetching} aria-label="Refresh">
              <RefreshCw className={cn(board.isFetching && "animate-spin")} />
              Refresh
            </Button>
            <Button variant="outline" onClick={() => setSettingsOpen(true)}>
              <Settings2 />
              Alert settings
            </Button>
          </>
        }
      />

      {settings.data?.test_mode && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-status-follow/40 bg-status-follow/10 px-4 py-3 text-sm text-ink">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-status-follow" />
          <span>
            <strong className="font-semibold">Test mode is on.</strong> Shift links and alert texts go only to{" "}
            <span className="font-mono">{settings.data.test_phone || "the test phone"}</span>, never to guards or other admins.{" "}
            <button type="button" className="focus-ring rounded text-link underline-offset-2 hover:underline" onClick={() => setSettingsOpen(true)}>
              Change
            </button>
          </span>
        </div>
      )}

      {board.isLoading ? (
        <Loading label="Loading the board…" />
      ) : board.isError && !data ? (
        <ErrorBlock message={friendlyError(board.error)} onRetry={() => void board.refetch()} />
      ) : data ? (
        <div className="grid gap-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="On duty" value={onDuty} dot="bg-status-clear" />
            <Stat label="Needs attention" value={attention} dot={attention ? "bg-status-incident" : "bg-ink-3"} urgent={attention > 0} />
            <Stat label="Open incidents" value={data.incidents.length} dot={data.incidents.length ? "bg-status-follow" : "bg-ink-3"} />
            <Stat
              label="Coming up"
              value={(grouped.get("starting")?.length ?? 0) + (grouped.get("upcoming")?.length ?? 0)}
              dot="bg-info"
            />
          </div>

          {(requests.length > 0 || data.alerts.length > 0) && (
            <Card className="overflow-hidden border-status-incident/40">
              <div className="flex items-center gap-2.5 border-b border-line px-5 py-4 sm:px-6">
                <BellRing className="h-5 w-5 text-status-incident-ink" />
                <h2 className="font-display text-lg font-bold text-ink">Needs attention</h2>
              </div>
              <ul className="divide-y divide-line">
                {requests.map((s) => (
                  <RequestRow
                    key={s.id}
                    shift={s}
                    tz={tz}
                    now={now}
                    busy={decide.isPending && decide.variables?.id === s.request?.id}
                    onDecide={(approve) => s.request && decide.mutate({ id: s.request.id, approve })}
                  />
                ))}
                {data.alerts.map((a) => (
                  <AlertRow
                    key={a.id}
                    alert={a}
                    shift={shiftById.get(a.shift_id)}
                    tz={tz}
                    now={now}
                    busy={ack.isPending && ack.variables === a.id}
                    onAck={() => ack.mutate(a.id)}
                  />
                ))}
              </ul>
            </Card>
          )}

          <DispatchMap shifts={data.shifts} now={now} />

          <ReportFailuresCard />

          {data.incidents.length > 0 && (
            <Card className="overflow-hidden">
              <div className="flex items-center gap-2.5 border-b border-line px-5 py-4 sm:px-6">
                <Flame className="h-5 w-5 text-status-follow" />
                <h2 className="font-display text-lg font-bold text-ink">Open incidents</h2>
              </div>
              <ul className="divide-y divide-line">
                {data.incidents.map((i) => (
                  <IncidentRow
                    key={i.id}
                    incident={i}
                    tz={tz}
                    onResolve={() => {
                      setResolveNote("");
                      setResolveFor(i);
                    }}
                  />
                ))}
              </ul>
            </Card>
          )}

          <Card className="overflow-hidden">
            <div className="flex flex-col gap-1 border-b border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div className="flex items-center gap-2.5">
                <RadioTower className="h-5 w-5 text-link" />
                <h2 className="font-display text-lg font-bold text-ink">Shifts</h2>
              </div>
              <p className="text-xs text-ink-3">Last 10 hours through the next 20 hours</p>
            </div>
            {data.shifts.length === 0 ? (
              <div className="p-4">
                <Empty
                  title="No shifts right now"
                  description="Shifts from the Schedule that are running, just ended, or start in the next 20 hours show up here."
                  action={
                    <Button asChild variant="outline">
                      <Link to="/schedule">Open Schedule</Link>
                    </Button>
                  }
                />
              </div>
            ) : (
              <div>
                {PHASE_ORDER.filter((p) => grouped.get(p)?.length).map((p) => (
                  <section key={p}>
                    <h3 className="bg-raised/60 px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3 sm:px-6">
                      {PHASE[p].label} · {grouped.get(p)?.length}
                    </h3>
                    <ul className="divide-y divide-line">
                      {grouped.get(p)?.map((s) => (
                        <ShiftRow
                          key={s.id}
                          shift={s}
                          state={states.get(s.id)!}
                          tz={tz}
                          now={now}
                          settings={settings.data ?? null}
                          onLink={() => openLink(s)}
                        />
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </Card>
        </div>
      ) : null}

      <ShiftLinkDialog target={linkTarget} onClose={() => setLinkTarget(null)} />
      <DispatchSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} orgId={orgId} settings={settings.data ?? null} />
      <FormDialog
        open={!!resolveFor}
        onOpenChange={(o) => !o && setResolveFor(null)}
        title="Resolve incident"
        description={resolveFor ? `${INCIDENT_CATEGORY[resolveFor.category]} at ${resolveFor.property}` : undefined}
        dirty={resolveNote.trim().length > 0}
        saving={resolve.isPending}
        submitLabel="Mark resolved"
        onSubmit={() => resolveFor && resolve.mutate({ id: resolveFor.id, note: resolveNote.trim() })}
      >
        <AreaField
          label="What was done? (optional)"
          value={resolveNote}
          onChange={setResolveNote}
          rows={3}
          placeholder="e.g. Fire department cleared the alarm at 11:40 PM."
        />
      </FormDialog>
    </div>
  );
};

/* ---------------------------------------------------------------- pieces */

const Stat = ({ label, value, dot, urgent }: { label: string; value: number; dot: string; urgent?: boolean }) => (
  <Card className={cn("px-5 py-4", urgent && "border-status-incident/50")}>
    <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-ink-2">
      <span className={cn("h-2 w-2 rounded-full", dot, urgent && "animate-pulse")} />
      {label}
    </div>
    <div className="mt-1.5 font-display text-3xl font-extrabold tabular-nums text-ink">{value}</div>
  </Card>
);

const Row = ({ icon, iconClass, children, actions }: { icon: ReactNode; iconClass: string; children: ReactNode; actions?: ReactNode }) => (
  <li className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:px-6">
    <div className="flex min-w-0 flex-1 items-start gap-3.5">
      <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", iconClass)}>{icon}</div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
    {actions && <div className="flex shrink-0 flex-wrap gap-2 pl-[54px] sm:pl-0">{actions}</div>}
  </li>
);

const RequestRow = ({
  shift,
  tz,
  now,
  busy,
  onDecide,
}: {
  shift: BoardShift;
  tz: string;
  now: number;
  busy: boolean;
  onDecide: (approve: boolean) => void;
}) => {
  const r = shift.request!;
  return (
    <Row icon={<MapPinOff className="h-5 w-5 text-status-incident-ink" />} iconClass="bg-status-incident/12">
      <div className="font-medium text-ink">
        {shift.staff.name} is trying to check in off-site
      </div>
      <div className="mt-0.5 text-sm text-ink-2">
        {shift.property.name} · <span className="font-mono">{fmtMeters(r.distance_m)}</span> from the site
        {r.accuracy_m != null && <span className="text-ink-3"> (GPS ±{fmtMeters(r.accuracy_m)})</span>} ·{" "}
        {fmtAgo(Math.max(0, Math.round((now - new Date(r.requested_at).getTime()) / 60000)))}
      </div>
      <div className="mt-0.5 text-xs text-ink-3">Asked at {fmtZoned(r.requested_at, tz)} · the guard's screen updates as soon as you decide</div>
      <ActionsInline>
        <Button size="sm" disabled={busy} onClick={() => onDecide(true)}>
          {busy ? <Loader2 className="animate-spin" /> : <Check />}
          Allow check-in
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => onDecide(false)}>
          <X />
          Deny
        </Button>
      </ActionsInline>
    </Row>
  );
};

/** Buttons that sit under the text on every width (keeps rows readable). */
const ActionsInline = ({ children }: { children: ReactNode }) => <div className="mt-3 flex flex-wrap gap-2">{children}</div>;

const AlertRow = ({
  alert,
  shift,
  tz,
  now,
  busy,
  onAck,
}: {
  alert: BoardAlert;
  shift: BoardShift | undefined;
  tz: string;
  now: number;
  busy: boolean;
  onAck: () => void;
}) => {
  const overdueMin = Math.max(0, Math.round((now - new Date(alert.due_at).getTime()) / 60000));
  const isPatrol = alert.kind === "patrol_overdue";
  const who = shift ? `${shift.staff.name} · ${shift.property.name}` : "Shift";
  return (
    <Row
      icon={isPatrol ? <Clock className="h-5 w-5 text-status-incident-ink" /> : <UserX className="h-5 w-5 text-status-incident-ink" />}
      iconClass={alert.acknowledged_at ? "bg-raised" : "bg-status-incident/12"}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-ink">{isPatrol ? "Patrol overdue" : "Guard hasn't checked in"}</span>
        <Pill tone={alert.acknowledged_at ? "slate" : "red"}>{overdueMin} min late</Pill>
      </div>
      <div className="mt-0.5 text-sm text-ink-2">
        {who} · {isPatrol ? "patrol was due" : "shift started"} <span className="font-mono">{fmtZoned(alert.due_at, tz)}</span>
      </div>
      <div className="mt-1 text-xs text-ink-3">
        {alert.notify_error ? (
          <span className="text-status-incident-ink">Text failed: {alert.notify_error}</span>
        ) : alert.notified_at ? (
          <>Admins texted at {fmtZoned(alert.notified_at, tz)}</>
        ) : (
          "On the board"
        )}
        {alert.acknowledged_at && <> · Acknowledged by {alert.acknowledged_by || "an admin"}</>}
      </div>
      {!alert.acknowledged_at && (
        <ActionsInline>
          <Button size="sm" variant="outline" disabled={busy} onClick={onAck}>
            {busy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
            Acknowledge
          </Button>
        </ActionsInline>
      )}
    </Row>
  );
};

const IncidentRow = ({ incident, tz, onResolve }: { incident: BoardIncident; tz: string; onResolve: () => void }) => {
  const { urls } = usePhotoUrls(incident.photos);
  const tone: Tone = incident.severity === "high" ? "red" : incident.severity === "medium" ? "amber" : "slate";
  return (
    <Row icon={<AlertTriangle className="h-5 w-5 text-status-follow" />} iconClass="bg-status-follow/12">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-ink">{INCIDENT_CATEGORY[incident.category]}</span>
        <Pill tone={tone}>{SEVERITY[incident.severity]}</Pill>
      </div>
      <div className="mt-0.5 text-sm text-ink-2">
        {incident.property} · {incident.reported_by} · <span className="font-mono">{fmtZoned(incident.occurred_at, tz, true)}</span>
      </div>
      {incident.description && <p className="mt-2 whitespace-pre-wrap text-sm text-ink">{incident.description}</p>}
      {incident.photos.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {urls.map((u, i) =>
            u ? (
              <a key={i} href={u} target="_blank" rel="noreferrer" className="focus-ring block overflow-hidden rounded-lg border border-line">
                <img src={u} alt={`Incident photo ${i + 1}`} className="h-16 w-16 object-cover" loading="lazy" />
              </a>
            ) : (
              <div key={i} className="flex h-16 w-16 items-center justify-center rounded-lg border border-line bg-raised">
                <Camera className="h-4 w-4 text-ink-3" />
              </div>
            ),
          )}
        </div>
      )}
      <ActionsInline>
        <Button size="sm" variant="outline" onClick={onResolve}>
          <CheckCircle2 />
          Resolve
        </Button>
      </ActionsInline>
    </Row>
  );
};

const ShiftRow = ({
  shift: s,
  state,
  tz,
  now,
  settings,
  onLink,
}: {
  shift: BoardShift;
  state: ShiftState;
  tz: string;
  now: number;
  settings: DispatchSettings | null;
  onLink: () => void;
}) => {
  const link = linkState(s, now, tz, settings);
  const phase = PHASE[state.phase];
  const due = state.dueIn;
  return (
    <li className="grid gap-3 px-5 py-4 sm:px-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1.4fr)_auto] lg:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium text-ink">{s.staff.name}</span>
          <Pill tone={phase.tone}>{phase.label}</Pill>
          {s.check_in?.overridden && <Pill tone="amber">Admin-approved check-in</Pill>}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-ink-2">
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5 text-ink-3" />
            {s.property.name}
          </span>
          <span className="font-mono text-[13px] text-ink-3">
            {fmtZoned(s.starts_at, tz, true)} – {fmtZoned(s.ends_at, tz)}
          </span>
        </div>
      </div>

      <div className="min-w-0 text-sm">
        {state.phase === "on_duty" && due != null ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className={cn("font-medium", due < 0 ? "text-status-incident-ink" : due <= 5 ? "text-status-follow" : "text-ink")}>
              {due < 0 ? `Patrol overdue ${-due} min` : `Next patrol in ${due} min`}
            </span>
            <span className="text-ink-3">
              {s.patrols} patrol{s.patrols === 1 ? "" : "s"}
              {s.last_patrol_at && ` · last ${fmtAgo(Math.max(0, Math.round((now - new Date(s.last_patrol_at).getTime()) / 60000)))}`}
            </span>
          </div>
        ) : state.phase === "upcoming" || state.phase === "starting" ? (
          <span className="text-ink-2">Starts in {fmtDuration(state.startDelta)}</span>
        ) : state.phase === "late" ? (
          <span className="font-medium text-status-incident-ink">{fmtDuration(-state.startDelta)} past start</span>
        ) : state.phase === "done" ? (
          <span className="text-ink-2">
            Out {fmtZoned(s.entry?.clock_out, tz)} · {s.patrols} patrol{s.patrols === 1 ? "" : "s"}
          </span>
        ) : (
          <span className="text-ink-3">No check-in recorded</span>
        )}
        <div className="mt-1 flex flex-wrap gap-1.5">
          {s.outside_patrols > 0 && <Pill tone="amber">{s.outside_patrols} logged off-site (offline)</Pill>}
          {s.incidents > 0 && <Pill tone="red">{s.incidents} open incident{s.incidents === 1 ? "" : "s"}</Pill>}
          {s.check_in?.distance_m != null && state.phase === "on_duty" && (
            <span className="text-xs text-ink-3">Checked in {fmtMeters(s.check_in.distance_m)} from site</span>
          )}
          {state.phase === "on_duty" && s.location && (
            <span className="inline-flex items-center gap-1 text-xs text-ink-3">
              <MapPin className="h-3 w-3" />
              {now - new Date(s.location.at).getTime() < 3 * 60_000 ? "Sharing location" : `Location ${fmtAgo(Math.round((now - new Date(s.location.at).getTime()) / 60000))}`}
              {s.location.distance_m != null && ` · ${fmtMeters(s.location.distance_m)} from site`}
            </span>
          )}
        </div>
        {s.handoff && state.phase === "done" && <p className="mt-1.5 line-clamp-2 text-xs text-ink-2">Handoff: {s.handoff}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-2 lg:justify-end">
        <span title={link.detail} className="inline-flex items-center gap-1.5">
          {link.phase === "live" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-status-clear" aria-hidden />}
          <Pill tone={link.tone}>{link.label}</Pill>
        </span>
        {state.phase !== "done" && state.phase !== "missed" && (
          <Button size="sm" variant={s.link ? "outline" : "default"} onClick={onLink}>
            {s.link ? <Link2 /> : <MessageSquareText />}
            {s.link ? "Manage link" : "Send link"}
          </Button>
        )}
      </div>
    </li>
  );
};

const fmtDuration = (mins: number): string => {
  const m = Math.max(0, mins);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
};

export default Dispatch;
