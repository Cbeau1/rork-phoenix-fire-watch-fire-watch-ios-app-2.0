import {
  AlertOctagon,
  AlertTriangle,
  Camera,
  CheckCircle2,
  Clock3,
  CloudOff,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  MapPin,
  Phone,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";

import { CameraCapture } from "@/components/fw/CameraCapture";
import { Crest } from "@/components/fw/Crest";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { playAlertSound, primeAlertSound, vibrate } from "@/lib/alerts";
import {
  fmtMeters,
  fmtZoned,
  INCIDENT_CATEGORY,
  SEVERITY,
  type IncidentCategory,
  type PatrolStatus,
  type Severity,
} from "@/lib/dispatch/api";
import {
  cacheView,
  cachedView,
  dropOp,
  flushQueue,
  getFix,
  guardCall,
  GuardApiError,
  isNetworkError,
  putOp,
  queuedOps,
  sendOp,
  type CheckInResult,
  type Fix,
  type GuardOp,
  type GuardView,
} from "@/lib/dispatch/guard";
import { uid } from "@/lib/format";
import { shiftAnchor } from "@/lib/patrol-timer";
import { cn } from "@/lib/utils";

type LoadState = { kind: "loading" } | { kind: "ready" } | { kind: "dead"; message: string } | { kind: "error"; message: string };

const MAX_PHOTOS = 3;
const PING_EVERY_MS = 20000;

type Sharing = "off" | "starting" | "on" | "denied" | "stopped";

/**
 * While the guard is on shift, reports their position to dispatch (at most every ~20 s).
 * Stops when the server says so (checked out / shift over), at the shift's scheduled end, or when the page closes.
 */
const useLocationSharing = (token: string, active: boolean, endsAt: string | null, online: boolean): Sharing => {
  const [state, setState] = useState<Sharing>("off");
  const lastSent = useRef<number>(0);
  const stopped = useRef<boolean>(false);

  useEffect(() => {
    const endMs = endsAt ? new Date(endsAt).getTime() : null;
    if (!active || stopped.current || (endMs !== null && Date.now() >= endMs)) {
      setState((s) => (s === "on" || s === "starting" ? (stopped.current ? "stopped" : "off") : s));
      return;
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    setState("starting");
    let watch: number | null = null;
    let busy = false;
    const stop = (final: boolean) => {
      if (watch !== null) navigator.geolocation.clearWatch(watch);
      watch = null;
      if (final) {
        stopped.current = true;
        setState("stopped");
      }
    };
    watch = navigator.geolocation.watchPosition(
      (pos) => {
        setState("on");
        if (endMs !== null && Date.now() >= endMs) return stop(true);
        if (busy || !navigator.onLine || Date.now() - lastSent.current < PING_EVERY_MS) return;
        busy = true;
        lastSent.current = Date.now();
        const c = pos.coords;
        guardCall<{ ok?: boolean; stop?: boolean }>({
          action: "ping",
          token,
          lat: c.latitude,
          lng: c.longitude,
          accuracy: c.accuracy,
          heading: Number.isFinite(c.heading) ? c.heading : null,
          speed: Number.isFinite(c.speed) ? c.speed : null,
        })
          .then((r) => {
            if (r?.stop) stop(true);
          })
          .catch((e) => {
            if (e instanceof GuardApiError && (e.status === 404 || e.status === 410)) stop(true);
          })
          .finally(() => {
            busy = false;
          });
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setState("denied");
          stop(false);
        }
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 },
    );
    const endTimer = endMs !== null ? window.setTimeout(() => stop(true), Math.max(0, endMs - Date.now())) : null;
    return () => {
      stop(false);
      if (endTimer !== null) window.clearTimeout(endTimer);
    };
  }, [token, active, endsAt, online]);

  return state;
};

const useOnline = (): boolean => {
  const [online, setOnline] = useState<boolean>(typeof navigator === "undefined" ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
};

const useNow = (ms = 1000): number => {
  const [now, setNow] = useState<number>(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
};

const fmtCountdown = (ms: number): string => {
  const s = Math.max(0, Math.round(Math.abs(ms) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
};

/** Public, no-login page a guard opens from the texted shift link. */
const ShiftLink = () => {
  const { token = "" } = useParams();
  const online = useOnline();
  const [view, setView] = useState<GuardView | null>(null);
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [queue, setQueue] = useState<GuardOp[]>([]);
  const [checkingIn, setCheckingIn] = useState<boolean>(false);
  const [checkInMsg, setCheckInMsg] = useState<{ tone: "warn" | "error"; text: string } | null>(null);
  const [blocked, setBlocked] = useState<{ distance: number | null; radius: number } | null>(null);
  const [sheet, setSheet] = useState<"patrol" | "incident" | "checkout" | null>(null);
  const [toast, setToast] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);
  useDocumentTitle(view ? `Shift · ${view.property.name}` : "Shift");

  const refreshQueue = useCallback(async () => setQueue(await queuedOps(token)), [token]);

  const sharingActive =
    !!view?.entry && !view.entry.clock_out && !queue.some((o) => o.kind === "check_out" && !o.error);
  const sharing = useLocationSharing(token, sharingActive, view?.shift.ends_at ?? null, online);

  const fetchView = useCallback(async () => {
    try {
      const v = await guardCall<GuardView>({ action: "view", token });
      setView(v);
      setCachedAt(null);
      setLoad({ kind: "ready" });
      void cacheView(token, v);
      return v;
    } catch (e) {
      if (e instanceof GuardApiError && (e.status === 404 || e.status === 410)) {
        setLoad({ kind: "dead", message: e.message });
        return null;
      }
      const cached = await cachedView(token);
      if (cached) {
        setView((cur) => cur ?? cached.v);
        setCachedAt((cur) => cur ?? cached.at);
        setLoad({ kind: "ready" });
      } else {
        setLoad({ kind: "error", message: e instanceof Error ? e.message : "Couldn't load your shift." });
      }
      return null;
    }
  }, [token]);

  const sync = useCallback(async () => {
    const res = await flushQueue(token);
    await refreshQueue();
    if (res.sent > 0) {
      setToast({ tone: "ok", text: `${res.sent} saved ${res.sent === 1 ? "entry" : "entries"} sent.` });
      void fetchView();
    }
    if (res.failed > 0) setToast({ tone: "error", text: "An entry couldn't be saved. See Activity below." });
  }, [token, refreshQueue, fetchView]);

  useEffect(() => {
    void refreshQueue();
    void fetchView().then(() => void sync());
  }, [fetchView, refreshQueue, sync]);

  useEffect(() => {
    if (online) void sync();
  }, [online, sync]);

  // Keep the page fresh; poll faster while waiting on a dispatcher's approval.
  const waiting = !!blocked || view?.request?.status === "pending";
  useEffect(() => {
    const t = window.setInterval(() => {
      if (!navigator.onLine) return;
      void fetchView();
      void sync();
    }, waiting ? 8000 : 45000);
    return () => window.clearInterval(t);
  }, [waiting, fetchView, sync]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(t);
  }, [toast]);

  const checkIn = async () => {
    primeAlertSound();
    setCheckingIn(true);
    setCheckInMsg(null);
    let fix: Fix | null = null;
    try {
      fix = await getFix();
    } catch (e) {
      if (view?.property.geofence) {
        setCheckInMsg({ tone: "error", text: e instanceof Error ? e.message : "Couldn't get your location." });
        setCheckingIn(false);
        return;
      }
    }
    try {
      const res = await guardCall<CheckInResult>({
        action: "check_in",
        token,
        lat: fix?.lat ?? null,
        lng: fix?.lng ?? null,
        accuracy: fix?.accuracy ?? null,
      });
      if (res.blocked) {
        setBlocked({ distance: res.distance_m ?? null, radius: res.radius_m ?? 0 });
      } else {
        setBlocked(null);
        vibrate([40, 60, 40]);
        setToast({ tone: "ok", text: res.overridden ? "Checked in (approved by dispatch)." : "You're checked in. Have a safe shift." });
      }
      await fetchView();
    } catch (e) {
      setCheckInMsg({
        tone: "error",
        text: isNetworkError(e) ? "You need a connection to check in. Move to better signal and try again." : (e as Error).message,
      });
    } finally {
      setCheckingIn(false);
    }
  };

  /** Records a patrol/incident/check-out: sent now when online, otherwise saved on the phone and sent later. */
  const submit = async (op: GuardOp): Promise<"sent" | "queued"> => {
    if (navigator.onLine) {
      try {
        await sendOp(op, false);
        void fetchView();
        return "sent";
      } catch (e) {
        if (!isNetworkError(e)) throw e;
      }
    }
    await putOp(op);
    await refreshQueue();
    return "queued";
  };

  if (load.kind === "loading") {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-4 py-24 text-ink-2">
          <Loader2 className="h-7 w-7 animate-spin text-link" />
          Loading your shift…
        </div>
      </Shell>
    );
  }
  if (load.kind === "dead" || load.kind === "error" || !view) {
    return (
      <Shell>
        <div className="mx-auto max-w-sm py-20 text-center">
          <KeyRound className="mx-auto h-9 w-9 text-ink-3" strokeWidth={1.6} />
          <h1 className="mt-4 font-display text-2xl font-bold text-ink">
            {load.kind === "dead" ? "Link not active" : "Couldn't load your shift"}
          </h1>
          <p className="mt-2 text-ink-2">{load.kind === "dead" || load.kind === "error" ? load.message : ""}</p>
          {load.kind === "error" && (
            <Button className="mt-6" variant="outline" onClick={() => void fetchView()}>
              <RefreshCw />
              Try again
            </Button>
          )}
        </div>
      </Shell>
    );
  }

  const queuedCheckout = queue.some((o) => o.kind === "check_out" && !o.error);
  const onShift = !!view.entry && !view.entry.clock_out && !queuedCheckout;
  const done = !!view.entry?.clock_out || queuedCheckout;

  return (
    <Shell company={view.company}>
      {(!online || cachedAt) && (
        <Banner tone="warn" icon={CloudOff}>
          {online ? "Showing saved info — reconnecting…" : "You're offline. Patrols, incidents and check-out are saved on this phone and sent automatically."}
        </Banner>
      )}

      <ShiftHero view={view} onShift={onShift} done={done} />

      {!view.entry && !done && (
        <CheckInPanel
          view={view}
          busy={checkingIn}
          online={online}
          blocked={blocked}
          message={checkInMsg}
          onCheckIn={() => void checkIn()}
        />
      )}

      {onShift && (
        <>
          {sharing === "on" || sharing === "starting" ? (
            <div className="flex items-center gap-2.5 rounded-xl border border-status-clear/40 bg-status-clear/[0.07] px-3.5 py-2.5 text-sm text-ink">
              <span className="relative flex h-2.5 w-2.5 shrink-0">
                <span className="absolute inset-0 animate-ping rounded-full bg-status-clear/60 motion-reduce:hidden" />
                <span className="relative h-2.5 w-2.5 rounded-full bg-status-clear" />
              </span>
              <span>
                <span className="font-semibold">Sharing location with dispatch</span>
                <span className="text-ink-2"> · keep this page open. Stops when you check out or your shift ends.</span>
              </span>
            </div>
          ) : sharing === "denied" ? (
            <Banner tone="info" icon={MapPin}>
              Location is off for this page, so dispatch can't see you on the map. Turn on location for your browser to share it.
            </Banner>
          ) : null}
          <PatrolDue view={view} queue={queue} />
          <div className="grid grid-cols-1 gap-3">
            <Button size="lg" className="h-14 text-base" onClick={() => setSheet("patrol")}>
              <ShieldCheck className="!size-5" />
              Log patrol
            </Button>
            <div className="grid grid-cols-2 gap-3">
              <Button size="lg" variant="destructive-outline" className="h-12" onClick={() => setSheet("incident")}>
                <AlertOctagon />
                Report incident
              </Button>
              <Button size="lg" variant="outline" className="h-12" onClick={() => setSheet("checkout")}>
                <LogOut />
                Check out
              </Button>
            </div>
          </div>
        </>
      )}

      {done && (
        <div className="rounded-xl border border-status-clear/45 bg-status-clear/[0.08] p-5">
          <div className="flex items-center gap-2 font-semibold text-status-clear">
            <CheckCircle2 className="h-5 w-5" />
            {queuedCheckout ? "Check-out saved — sending when online" : "Checked out"}
          </div>
          {view.entry?.clock_out && (
            <p className="mt-1 font-mono text-sm text-ink-2">
              {fmtZoned(view.entry.clock_in, view.tz)} – {fmtZoned(view.entry.clock_out, view.tz)}
            </p>
          )}
          {view.handoff && <p className="mt-3 whitespace-pre-wrap rounded-lg border border-line bg-raised p-3 text-sm text-ink">{view.handoff}</p>}
          <p className="mt-3 text-sm text-ink-2">Thanks for your shift. You can close this page.</p>
        </div>
      )}

      <SiteInfo view={view} />

      <Activity view={view} queue={queue} onDiscard={async (id) => { await dropOp(id); await refreshQueue(); }} />

      {sheet === "patrol" && (
        <PatrolSheet view={view} token={token} onClose={() => setSheet(null)} submit={submit} onDone={(r) => {
          setSheet(null);
          setToast(r === "sent" ? { tone: "ok", text: "Patrol logged." } : { tone: "warn", text: "Saved on this phone — will send when you're back online." });
        }} />
      )}
      {sheet === "incident" && (
        <IncidentSheet view={view} token={token} onClose={() => setSheet(null)} submit={submit} onDone={(r) => {
          setSheet(null);
          setToast(r === "sent" ? { tone: "ok", text: "Incident reported to dispatch." } : { tone: "warn", text: "Incident saved — will send when you're back online." });
        }} />
      )}
      {sheet === "checkout" && (
        <CheckoutSheet view={view} token={token} queue={queue} onClose={() => setSheet(null)} submit={submit} onDone={(r) => {
          setSheet(null);
          setToast(r === "sent" ? { tone: "ok", text: "Checked out. Thanks!" } : { tone: "warn", text: "Check-out saved — will send when you're back online." });
        }} />
      )}

      {toast && (
        <div
          role="status"
          className={cn(
            "fixed inset-x-4 bottom-[max(1rem,var(--safe-bottom))] z-50 mx-auto max-w-md animate-fade-up rounded-xl border px-4 py-3 text-sm font-medium shadow-pop",
            toast.tone === "ok" && "border-status-clear/50 bg-surface text-ink",
            toast.tone === "warn" && "border-status-follow/50 bg-surface text-ink",
            toast.tone === "error" && "border-status-incident/50 bg-surface text-ink",
          )}
        >
          <span
            className={cn(
              "mr-2 inline-block h-2 w-2 rounded-full",
              toast.tone === "ok" ? "bg-status-clear" : toast.tone === "warn" ? "bg-status-follow" : "bg-status-incident",
            )}
          />
          {toast.text}
        </div>
      )}
    </Shell>
  );
};

export default ShiftLink;

/* ================================================================== pieces */

const Shell = ({ children, company }: { children: ReactNode; company?: string }) => (
  <div className="canvas-glow min-h-[100dvh] pb-[max(2rem,var(--safe-bottom))]">
    <header className="sticky top-0 z-30 border-b border-line bg-rail/90 pt-[var(--safe-top)] backdrop-blur">
      <div className="mx-auto flex h-14 max-w-xl items-center justify-between px-4">
        <Crest size="sm" />
        {company && <span className="truncate pl-3 text-xs font-medium text-ink-3">{company}</span>}
      </div>
    </header>
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 pt-5">{children}</main>
  </div>
);

const Banner = ({ tone, icon: Icon, children }: { tone: "warn" | "error" | "info"; icon: typeof CloudOff; children: ReactNode }) => (
  <div
    className={cn(
      "flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm",
      tone === "warn" && "border-status-follow/45 bg-status-follow/10 text-ink",
      tone === "error" && "border-status-incident/45 bg-status-incident/10 text-ink",
      tone === "info" && "border-primary/40 bg-primary/10 text-ink",
    )}
  >
    <Icon
      className={cn(
        "mt-0.5 h-4 w-4 shrink-0",
        tone === "warn" ? "text-status-follow" : tone === "error" ? "text-status-incident-ink" : "text-link",
      )}
    />
    <div className="min-w-0">{children}</div>
  </div>
);

const ShiftHero = ({ view, onShift, done }: { view: GuardView; onShift: boolean; done: boolean }) => (
  <section
    className={cn(
      "relative overflow-hidden rounded-2xl border bg-surface p-5 shadow-card",
      onShift ? "border-status-clear/55 shadow-[0_0_0_1px_rgb(var(--c-status-clear)/0.25),0_0_32px_-8px_rgb(var(--c-status-clear)/0.45)]" : "border-line",
    )}
  >
    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">Your shift</div>
    <h1 className="mt-1 font-display text-[26px] font-bold leading-tight text-ink">{view.property.name}</h1>
    {view.property.address && (
      <a
        href={`https://maps.google.com/?q=${encodeURIComponent(view.property.address)}`}
        target="_blank"
        rel="noreferrer"
        className="mt-1 flex items-start gap-1.5 text-sm text-link hover:text-link-hover"
      >
        <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
        {view.property.address}
      </a>
    )}
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-raised px-4 py-3">
      <div>
        <div className="text-sm font-medium text-ink">{view.guard}</div>
        <div className="font-mono text-[13px] text-ink-2">
          {fmtZoned(view.shift.starts_at, view.tz, true)} – {fmtZoned(view.shift.ends_at, view.tz)}
        </div>
      </div>
      {onShift ? (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-status-clear/15 px-3 py-1 text-xs font-semibold text-status-clear ring-1 ring-inset ring-status-clear/40">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-current" />
          </span>
          On shift · since {fmtZoned(view.entry?.clock_in, view.tz)}
        </span>
      ) : done ? (
        <span className="rounded-full bg-raised px-3 py-1 text-xs font-semibold text-ink-2 ring-1 ring-inset ring-line">Shift complete</span>
      ) : (
        <span className="rounded-full bg-status-follow/12 px-3 py-1 text-xs font-semibold text-status-follow ring-1 ring-inset ring-status-follow/40">
          Not checked in
        </span>
      )}
    </div>
    {view.shift.notes && <p className="mt-3 text-sm italic text-ink-2">{view.shift.notes}</p>}
  </section>
);

const CheckInPanel = ({
  view,
  busy,
  online,
  blocked,
  message,
  onCheckIn,
}: {
  view: GuardView;
  busy: boolean;
  online: boolean;
  blocked: { distance: number | null; radius: number } | null;
  message: { tone: "warn" | "error"; text: string } | null;
  onCheckIn: () => void;
}) => {
  const pending = view.request?.status === "pending";
  const approved = view.request?.status === "approved";
  const distance = blocked?.distance ?? view.request?.distance_m ?? null;
  const radius = blocked?.radius ?? view.property.radius ?? 0;
  return (
    <section className="flex flex-col gap-3">
      {(pending || (blocked && !approved)) && (
        <Banner tone="warn" icon={MapPin}>
          <div className="font-semibold">You're not at the site yet</div>
          <p className="mt-0.5 text-ink-2">
            You're about {fmtMeters(distance)} away (must be within {fmtMeters(radius)}). Head to the site and try again — or
            wait here: dispatch has been alerted and can approve your check-in.
          </p>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-3">
            <Loader2 className="h-3 w-3 animate-spin" /> Waiting for dispatch…
          </p>
        </Banner>
      )}
      {approved && (
        <Banner tone="info" icon={CheckCircle2}>
          <span className="font-semibold">Dispatch approved your check-in.</span> Tap Check in now.
        </Banner>
      )}
      {message && (
        <Banner tone={message.tone} icon={AlertTriangle}>
          {message.text}
        </Banner>
      )}
      <Button size="lg" className="h-16 text-lg" disabled={busy || !online} onClick={onCheckIn}>
        {busy ? <Loader2 className="!size-5 animate-spin" /> : <LogIn className="!size-5" />}
        {busy ? "Checking your location…" : "Check in"}
      </Button>
      <p className="text-center text-xs text-ink-3">
        {online
          ? view.property.geofence
            ? "Uses your phone's location to confirm you're on site."
            : "Records the time you start."
          : "Checking in needs a connection."}
      </p>
    </section>
  );
};

const PatrolDue = ({ view, queue }: { view: GuardView; queue: GuardOp[] }) => {
  const now = useNow();
  const lastQueued = queue.filter((o) => o.kind === "patrol" && !o.error).map((o) => Date.parse(o.at));
  const patrolTimes = [view.property_last_patrol_at, view.last_patrol_at]
    .map((t) => (t ? Date.parse(t) : null))
    .concat(lastQueued);
  // Continues from the previous officer's last patrol when it was still in its interval at clock-in.
  const base = view.entry
    ? shiftAnchor(Date.parse(view.entry.clock_in), view.property.interval, patrolTimes)
    : Math.max(0, ...patrolTimes.map((t) => t ?? 0));
  const due = base + view.property.interval * 60000;
  const left = due - now;
  const overdue = left <= 0;
  const soon = !overdue && left <= 5 * 60000;
  const alerted = useRef<string>("");
  useEffect(() => {
    const key = `${due}:${overdue ? "due" : soon ? "soon" : ""}`;
    if ((overdue || soon) && alerted.current !== key) {
      alerted.current = key;
      playAlertSound(overdue ? "due" : "warning");
      vibrate(overdue ? [200, 100, 200, 100, 200] : [120]);
    }
  }, [due, overdue, soon]);
  const pct = Math.min(1, Math.max(0, 1 - left / (view.property.interval * 60000)));

  return (
    <section
      className={cn(
        "flex items-center gap-4 rounded-2xl border bg-surface p-4",
        overdue ? "border-status-incident/60 bg-status-incident/[0.08]" : soon ? "border-status-follow/55" : "border-line",
      )}
    >
      <div className="relative h-16 w-16 shrink-0">
        <svg viewBox="0 0 36 36" className="h-16 w-16 -rotate-90">
          <circle cx="18" cy="18" r="15.5" fill="none" strokeWidth="3" className="stroke-raised" />
          <circle
            cx="18"
            cy="18"
            r="15.5"
            fill="none"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={`${pct * 97.4} 97.4`}
            className={cn("transition-all duration-1000", overdue ? "stroke-status-incident" : soon ? "stroke-status-follow" : "stroke-primary")}
          />
        </svg>
        <Clock3 className={cn("absolute inset-0 m-auto h-5 w-5", overdue ? "text-status-incident-ink" : soon ? "text-status-follow" : "text-link")} />
      </div>
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">
          {overdue ? "Patrol overdue" : "Next patrol due"}
        </div>
        <div className={cn("font-mono text-3xl font-semibold tabular-nums", overdue ? "text-status-incident-ink" : soon ? "text-status-follow" : "text-ink")}>
          {overdue ? "+" : ""}
          {fmtCountdown(left)}
        </div>
        <div className="text-xs text-ink-3">
          Every {view.property.interval} min · due {fmtZoned(new Date(due).toISOString(), view.tz)}
        </div>
      </div>
    </section>
  );
};

const SiteInfo = ({ view }: { view: GuardView }) => {
  const p = view.property;
  if (!p.access && !p.contact_phone && !view.previous_handoff) return null;
  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <h2 className="font-display text-lg font-bold text-ink">Site info</h2>
      <div className="mt-3 flex flex-col gap-2.5">
        {view.previous_handoff && (
          <div className="rounded-lg border border-primary/35 bg-primary/[0.07] p-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-link">
              Handoff from {view.previous_handoff.by} · {fmtZoned(view.previous_handoff.at, view.tz, true)}
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{view.previous_handoff.note}</p>
          </div>
        )}
        {p.access && (
          <div className="rounded-lg border border-line bg-raised p-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">Access</div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{p.access}</p>
          </div>
        )}
        {p.contact_phone && (
          <a href={`tel:${p.contact_phone}`} className="flex items-center gap-3 rounded-lg border border-line bg-raised p-3 hover:bg-raised-hover">
            <Phone className="h-4 w-4 text-link" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-ink">{p.contact || "Site contact"}</span>
              <span className="font-mono text-xs text-ink-2">{p.contact_phone}</span>
            </span>
          </a>
        )}
      </div>
    </section>
  );
};

const STATUS_LABEL: Record<PatrolStatus, string> = { clear: "Clear", "follow-up": "Follow-up", incident: "Incident" };
const STATUS_DOT: Record<PatrolStatus, string> = {
  clear: "bg-status-clear",
  "follow-up": "bg-status-follow",
  incident: "bg-status-incident",
};

const Activity = ({ view, queue, onDiscard }: { view: GuardView; queue: GuardOp[]; onDiscard: (id: string) => void }) => {
  const sentIds = new Set([...view.patrols, ...view.incidents].map((x) => x.client_op_id).filter(Boolean));
  const pending = queue.filter((o) => !sentIds.has(o.client_id));
  const rows = [
    ...pending.map((o) => ({ key: o.client_id, at: o.at, op: o })),
    ...view.patrols.map((p) => ({ key: p.id, at: p.at, patrol: p })),
    ...view.incidents.map((i) => ({ key: i.id, at: i.at, incident: i })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <h2 className="font-display text-lg font-bold text-ink">Activity this shift</h2>
      {rows.length === 0 ? (
        <p className="mt-2 rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-ink-3">
          Patrols and incidents you log will show here.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {rows.map((r) => {
            if ("op" in r && r.op) {
              const o = r.op;
              const label =
                o.kind === "patrol" ? `Patrol · ${STATUS_LABEL[o.status]}` : o.kind === "incident" ? `Incident · ${INCIDENT_CATEGORY[o.category]}` : "Check-out";
              return (
                <li key={r.key} className={cn("rounded-lg border p-3", o.error ? "border-status-incident/50 bg-status-incident/[0.07]" : "border-status-follow/45 bg-status-follow/[0.07]")}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-ink">{label}</div>
                      <div className="font-mono text-xs text-ink-2">{fmtZoned(o.at, view.tz)}</div>
                    </div>
                    {o.error ? (
                      <button type="button" onClick={() => onDiscard(o.client_id)} className="focus-ring flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-status-incident-ink hover:bg-status-incident/10">
                        <Trash2 className="h-3.5 w-3.5" /> Discard
                      </button>
                    ) : (
                      <span className="flex items-center gap-1 whitespace-nowrap rounded-full bg-status-follow/15 px-2 py-0.5 text-[11px] font-semibold text-status-follow">
                        <CloudOff className="h-3 w-3" /> Waiting to send
                      </span>
                    )}
                  </div>
                  {o.error && <p className="mt-1.5 text-xs text-status-incident-ink">Not saved: {o.error}</p>}
                </li>
              );
            }
            if ("patrol" in r && r.patrol) {
              const p = r.patrol;
              return (
                <li key={r.key} className="rounded-lg border border-line bg-raised p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm font-medium text-ink">
                        <span className={cn("h-2 w-2 rounded-full", STATUS_DOT[p.status])} />
                        Patrol · {STATUS_LABEL[p.status]}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-ink-2">{p.areas.join(", ")}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="font-mono text-xs text-ink-2">{fmtZoned(p.at, view.tz)}</div>
                      <div className="mt-0.5 flex justify-end gap-1.5 text-[11px] text-ink-3">
                        {p.photos > 0 && (
                          <span className="flex items-center gap-0.5">
                            <Camera className="h-3 w-3" />
                            {p.photos}
                          </span>
                        )}
                        {p.outside && <span className="text-status-follow">Off site</span>}
                      </div>
                    </div>
                  </div>
                </li>
              );
            }
            const i = (r as { incident: GuardView["incidents"][number] }).incident;
            return (
              <li key={r.key} className="rounded-lg border border-status-incident/40 bg-status-incident/[0.06] p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium text-ink">
                      <AlertOctagon className="h-3.5 w-3.5 text-status-incident-ink" />
                      {INCIDENT_CATEGORY[i.category]} · {SEVERITY[i.severity]}
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-xs text-ink-2">{i.description}</div>
                  </div>
                  <div className="shrink-0 font-mono text-xs text-ink-2">{fmtZoned(i.at, view.tz)}</div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

/* ================================================================== sheets */

type Submit = (op: GuardOp) => Promise<"sent" | "queued">;

/** Location for an entry: best effort, never blocks an offline save. */
const tryFix = async (): Promise<Fix | null> => {
  try {
    return await getFix(navigator.onLine ? 12000 : 6000);
  } catch {
    return null;
  }
};

const SheetShell = ({ title, description, onClose, children }: { title: string; description?: string; onClose: () => void; children: ReactNode }) => (
  <Dialog open onOpenChange={(o) => !o && onClose()}>
    <DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto border-line bg-surface text-ink sm:max-w-md sm:rounded-xl">
      <DialogHeader>
        <DialogTitle className="font-display text-xl">{title}</DialogTitle>
        {description && <DialogDescription className="text-ink-2">{description}</DialogDescription>}
      </DialogHeader>
      {children}
    </DialogContent>
  </Dialog>
);

const PhotoStrip = ({ photos, setPhotos, stamp }: { photos: string[]; setPhotos: (p: string[]) => void; stamp: string[] }) => {
  const [open, setOpen] = useState<boolean>(false);
  return (
    <div>
      <div className="mb-1.5 text-sm font-medium text-ink">Photos <span className="font-normal text-ink-3">(optional, up to {MAX_PHOTOS})</span></div>
      <div className="flex flex-wrap gap-2">
        {photos.map((p, i) => (
          <div key={i} className="relative h-20 w-20 overflow-hidden rounded-lg border border-line">
            <img src={p} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
            <button
              type="button"
              aria-label="Remove photo"
              onClick={() => setPhotos(photos.filter((_, j) => j !== i))}
              className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {photos.length < MAX_PHOTOS && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="focus-ring flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line-strong text-xs text-ink-2 hover:bg-raised"
          >
            <Camera className="h-5 w-5" />
            Add
          </button>
        )}
      </div>
      <CameraCapture
        open={open}
        onClose={() => setOpen(false)}
        onCapture={(d) => setPhotos([...photos, d].slice(0, MAX_PHOTOS))}
        remaining={MAX_PHOTOS - photos.length}
        stampLines={stamp}
      />
    </div>
  );
};

const Segmented = <T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; tone: string }[] }) => (
  <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
    {options.map((o) => (
      <button
        key={o.value}
        type="button"
        aria-pressed={value === o.value}
        onClick={() => onChange(o.value)}
        className={cn(
          "focus-ring h-11 rounded-lg border text-sm font-medium transition-colors",
          value === o.value ? o.tone : "border-line-strong text-ink-2 hover:bg-raised",
        )}
      >
        {o.label}
      </button>
    ))}
  </div>
);

const SubmitError = ({ text }: { text: string | null }) =>
  text ? (
    <div className="rounded-lg border border-status-incident/45 bg-status-incident/10 px-3 py-2.5 text-sm text-ink" role="alert">
      {text}
    </div>
  ) : null;

const PatrolSheet = ({ view, token, onClose, submit, onDone }: { view: GuardView; token: string; onClose: () => void; submit: Submit; onDone: (r: "sent" | "queued") => void }) => {
  const [areas, setAreas] = useState<string>("");
  const [status, setStatus] = useState<PatrolStatus>("clear");
  const [notes, setNotes] = useState<string>("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const areaList = useMemo(() => areas.split(",").map((a) => a.trim()).filter(Boolean), [areas]);

  const save = async () => {
    setError(null);
    if (areaList.length === 0) return setError("List at least one area you patrolled.");
    if (status !== "clear" && !notes.trim()) return setError("Add a note describing what needs attention.");
    const at = new Date().toISOString();
    setBusy("Getting your location…");
    const fix = await tryFix();
    setBusy("Saving…");
    try {
      const r = await submit({ kind: "patrol", client_id: uid(), token, at, fix, areas: areaList, status, notes: notes.trim(), photos });
      onDone(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the patrol.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <SheetShell title="Log patrol" description={view.property.name} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">Areas patrolled</span>
          <Input value={areas} onChange={(e) => setAreas(e.target.value)} placeholder="Lobby, Stairwell B, Roof" maxLength={600} className="h-11" />
          <span className="mt-1 block text-xs text-ink-3">Separate areas with commas.</span>
        </label>
        <div>
          <div className="mb-1.5 text-sm font-medium text-ink">Status</div>
          <Segmented<PatrolStatus>
            value={status}
            onChange={setStatus}
            options={[
              { value: "clear", label: "Clear", tone: "border-status-clear bg-status-clear/15 text-status-clear" },
              { value: "follow-up", label: "Follow-up", tone: "border-status-follow bg-status-follow/15 text-status-follow" },
              { value: "incident", label: "Incident", tone: "border-status-incident bg-status-incident/15 text-status-incident-ink" },
            ]}
          />
        </div>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">Notes {status === "clear" && <span className="font-normal text-ink-3">(optional)</span>}</span>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={2000} placeholder="Anything to report?" />
        </label>
        <PhotoStrip photos={photos} setPhotos={setPhotos} stamp={[view.property.name, view.guard]} />
        <SubmitError text={error} />
        <Button size="lg" className="h-12" disabled={!!busy} onClick={() => void save()}>
          {busy ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
          {busy ?? "Submit patrol"}
        </Button>
      </div>
    </SheetShell>
  );
};

const IncidentSheet = ({ view, token, onClose, submit, onDone }: { view: GuardView; token: string; onClose: () => void; submit: Submit; onDone: (r: "sent" | "queued") => void }) => {
  const [category, setCategory] = useState<IncidentCategory>("hazard");
  const [severity, setSeverity] = useState<Severity>("medium");
  const [description, setDescription] = useState<string>("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    if (description.trim().length < 3) return setError("Describe what happened.");
    const at = new Date().toISOString();
    setBusy("Getting your location…");
    const fix = await tryFix();
    setBusy("Sending…");
    try {
      onDone(await submit({ kind: "incident", client_id: uid(), token, at, fix, category, severity, description: description.trim(), photos }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't report the incident.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <SheetShell title="Report incident" description="Dispatch sees this on the board right away. In an emergency, call 911 first." onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div>
          <div className="mb-1.5 text-sm font-medium text-ink">What happened?</div>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(INCIDENT_CATEGORY) as IncidentCategory[]).map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={category === c}
                onClick={() => setCategory(c)}
                className={cn(
                  "focus-ring rounded-full border px-3 py-1.5 text-sm transition-colors",
                  category === c ? "border-primary bg-primary/15 text-link" : "border-line-strong text-ink-2 hover:bg-raised",
                )}
              >
                {INCIDENT_CATEGORY[c]}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-sm font-medium text-ink">Severity</div>
          <Segmented<Severity>
            value={severity}
            onChange={setSeverity}
            options={[
              { value: "low", label: "Low", tone: "border-line-strong bg-raised text-ink" },
              { value: "medium", label: "Medium", tone: "border-status-follow bg-status-follow/15 text-status-follow" },
              { value: "high", label: "High", tone: "border-status-incident bg-status-incident/15 text-status-incident-ink" },
            ]}
          />
        </div>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">Details</span>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} maxLength={4000} placeholder="Where, what you saw, what you did" />
        </label>
        <PhotoStrip photos={photos} setPhotos={setPhotos} stamp={[view.property.name, view.guard, "Incident"]} />
        <SubmitError text={error} />
        <Button size="lg" variant="destructive" className="h-12" disabled={!!busy} onClick={() => void save()}>
          {busy ? <Loader2 className="animate-spin" /> : <AlertOctagon />}
          {busy ?? "Send incident report"}
        </Button>
      </div>
    </SheetShell>
  );
};

const CheckoutSheet = ({ view, token, queue, onClose, submit, onDone }: { view: GuardView; token: string; queue: GuardOp[]; onClose: () => void; submit: Submit; onDone: (r: "sent" | "queued") => void }) => {
  const [handoff, setHandoff] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const waiting = queue.filter((o) => !o.error && o.kind !== "check_out").length;

  const save = async () => {
    setError(null);
    setBusy(true);
    const at = new Date().toISOString();
    const fix = await tryFix();
    try {
      onDone(await submit({ kind: "check_out", client_id: uid(), token, at, fix, handoff: handoff.trim() }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't check out.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SheetShell title="Check out" description={`Ends your time at ${view.property.name}.`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        {waiting > 0 && (
          <Banner tone="warn" icon={CloudOff}>
            {waiting} {waiting === 1 ? "entry is" : "entries are"} still waiting to send. They'll go before your check-out.
          </Banner>
        )}
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">Handoff note for the next guard <span className="font-normal text-ink-3">(optional)</span></span>
          <Textarea value={handoff} onChange={(e) => setHandoff(e.target.value)} rows={4} maxLength={2000} placeholder="Keys, open issues, anything the next shift should know" />
        </label>
        <SubmitError text={error} />
        <Button size="lg" className="h-12" disabled={busy} onClick={() => void save()}>
          {busy ? <Loader2 className="animate-spin" /> : <LogOut />}
          Check out now
        </Button>
      </div>
    </SheetShell>
  );
};
