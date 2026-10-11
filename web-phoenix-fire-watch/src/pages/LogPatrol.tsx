import { AlertCircle, ArrowUp, Camera, Clock, Loader2, LogIn, MapPinX, Save, Shield, X } from "lucide-react";
import { useCallback, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { CameraCapture } from "@/components/fw/CameraCapture";
import { GeofenceStatus, geofenceVerdict } from "@/components/fw/GeofenceStatus";
import { Card, CardHeader, FieldError, FieldHint, FieldLabel, PageHeader } from "@/components/fw/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useGeolocation } from "@/hooks/use-geolocation";
import { toLocalInputValue } from "@/lib/format";
import { isGeofenceActive } from "@/lib/geo";
import { friendlyError } from "@/lib/supabase";
import { STATUS_META, type PatrolStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useFireWatch } from "@/state/FireWatchProvider";
import { useMyClock } from "@/state/useTimeClock";

import NotFound from "./NotFound";

const MAX_PHOTOS = 5;
const STATUSES: PatrolStatus[] = ["clear", "follow-up", "incident"];

interface Errors {
  dateTime?: string;
  officerName?: string;
  areas?: string;
}

/** Required fields in on-screen order: error key → input id + label (used to scroll to the first missing one). */
const REQUIRED: { key: keyof Errors; id: string; label: string }[] = [
  { key: "dateTime", id: "dateTime", label: "Date & Time" },
  { key: "officerName", id: "officer", label: "Officer Name" },
  { key: "areas", id: "areas", label: "Areas Patrolled" },
];

const splitAreas = (value: string): string[] =>
  value
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);

const validate = (dateTime: string, officerName: string, areas: string): Errors => {
  const next: Errors = {};
  if (!dateTime || Number.isNaN(new Date(dateTime).getTime())) next.dateTime = "Choose the patrol date and time";
  if (!officerName.trim()) next.officerName = "Officer name is required";
  if (splitAreas(areas).length === 0) next.areas = "List at least one area patrolled";
  return next;
};

/** Smoothly brings a field to the middle of the screen and puts the cursor in it. */
const focusField = (id: string): void => {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  window.setTimeout(() => (el as HTMLInputElement).focus({ preventScroll: true }), 350);
};

const LogPatrol = () => {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  useDocumentTitle("Log Patrol");
  const { propertyById, addPatrol, user, patrols } = useFireWatch();
  const { open: openEntry, loading: clockLoading, clockIn } = useMyClock();
  const property = propertyById.get(id);
  const needsClockIn = !clockLoading && !openEntry;

  const lastOfficer = patrols.find((p) => p.propertyId === id)?.officerName;
  const [dateTime, setDateTime] = useState<string>(() => toLocalInputValue(new Date()));
  const [officerName, setOfficerName] = useState<string>(lastOfficer ?? user?.name ?? "");
  const [areas, setAreas] = useState<string>("");
  const [status, setStatus] = useState<PatrolStatus>("clear");
  const [notes, setNotes] = useState<string>("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [cameraOpen, setCameraOpen] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [attempted, setAttempted] = useState<boolean>(false);
  // After the first submit attempt, errors update live as fields are completed.
  const errors: Errors = attempted ? validate(dateTime, officerName, areas) : {};
  const missing = REQUIRED.filter((f) => errors[f.key]);

  const onCapture = useCallback((dataUrl: string) => {
    setPhotos((p) => (p.length >= MAX_PHOTOS ? p : [...p, dataUrl]));
  }, []);
  const closeCamera = useCallback(() => setCameraOpen(false), []);
  const fenced = !!property && isGeofenceActive(property.geofence);
  const { state: geo, retry: retryGeo } = useGeolocation(fenced);

  if (!property) return <NotFound embedded />;

  const backTo = `/properties/${property.id}`;
  const verdict = fenced ? geofenceVerdict(property, geo) : "inside";
  const blockedByFence = fenced && verdict !== "inside";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const areaList = splitAreas(areas);
    setAttempted(true);
    const found = validate(dateTime, officerName, areas);
    const incomplete = REQUIRED.filter((f) => found[f.key]);
    const firstMissing = incomplete[0];
    if (firstMissing) {
      const count = incomplete.length;
      toast.error(count === 1 ? "1 required field is incomplete" : `${count} required fields are incomplete`, {
        description: `Scroll up to complete ${firstMissing.label}${count > 1 ? " and the other highlighted fields" : ""}.`,
      });
      focusField(firstMissing.id);
      return;
    }
    if (!openEntry) {
      toast.error("Clock in first", { description: "Clock in before logging a patrol." });
      return;
    }
    if (blockedByFence) {
      toast.error(verdict === "checking" ? "Still checking your location" : "You're outside the geofence", {
        description: `Patrols for ${property.name} can only be logged on site.`,
      });
      return;
    }

    setSaving(true);
    try {
      const saved = await addPatrol({
        propertyId: property.id,
        dateTime: new Date(dateTime).toISOString(),
        officerName: officerName.trim(),
        areas: areaList,
        status,
        notes: notes.trim(),
        photos,
        location: fenced && geo.status === "ready" ? geo.location : null,
      });
      if (saved.syncState === "pending") {
        toast.success("Patrol saved on this device", {
          description: `You're offline — it${photos.length ? " and its photos" : ""} will upload automatically when you reconnect.`,
        });
      } else {
        toast.success("Patrol logged", { description: `${STATUS_META[status].label} · ${property.name}` });
      }
      navigate(backTo);
    } catch (err) {
      toast.error(friendlyError(err, "Couldn't log the patrol"));
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader backTo={backTo} backLabel="Back to Property" title="Log Fire Watch Patrol" subtitle={property.name} />

      {needsClockIn && (
        <Card className="mb-5 border-status-follow/40">
          <div className="flex flex-col gap-4 px-6 py-7 sm:flex-row sm:items-center sm:justify-between sm:px-7">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-raised ring-1 ring-line">
                <Clock className="h-6 w-6 text-ink-2" strokeWidth={1.8} />
              </div>
              <div>
                <div className="text-sm font-semibold text-ink">Clock in to log patrols</div>
                <p className="mt-0.5 text-sm text-ink-2">Start your shift on the time clock before logging a patrol.</p>
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
              <Button
                size="lg"
                disabled={clockIn.isPending}
                onClick={() =>
                  clockIn.mutate("", {
                    onSuccess: () => toast.success("Clocked in"),
                    onError: (err) => toast.error(err instanceof Error ? err.message : "Couldn't clock in."),
                  })
                }
                className="transition-transform active:scale-[0.97]"
              >
                {clockIn.isPending ? <Loader2 className="animate-spin" /> : <LogIn />}
                Clock In
              </Button>
              <Link to="/hours" className="focus-ring rounded text-center text-sm font-medium text-link hover:text-link-hover sm:text-right">
                Go to time clock
              </Link>
            </div>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader
          icon={Shield}
          title="Patrol Details"
          subtitle="Record patrol activity and observations"
          className="border-b border-line pb-6"
        />
        <form onSubmit={(e) => void submit(e)} noValidate className="space-y-6 px-6 py-7 sm:px-7">
          {fenced && <GeofenceStatus property={property} geo={geo} onRetry={retryGeo} />}
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <FieldLabel htmlFor="dateTime" required>
                Date &amp; Time
              </FieldLabel>
              <Input
                id="dateTime"
                type="datetime-local"
                value={dateTime}
                aria-invalid={!!errors.dateTime}
                onChange={(e) => setDateTime(e.target.value)}
                className="font-mono"
              />
              <FieldError message={errors.dateTime} />
            </div>
            <div>
              <FieldLabel htmlFor="officer" required>
                Officer Name
              </FieldLabel>
              <Input
                id="officer"
                placeholder="Full name"
                autoComplete="name"
                value={officerName}
                aria-invalid={!!errors.officerName}
                onChange={(e) => setOfficerName(e.target.value)}
              />
              <FieldError message={errors.officerName} />
            </div>
          </div>

          <div>
            <FieldLabel htmlFor="areas" required>
              Areas Patrolled
            </FieldLabel>
            <Input
              id="areas"
              placeholder="e.g., Main lobby, Basement, Parking garage"
              value={areas}
              aria-invalid={!!errors.areas}
              onChange={(e) => setAreas(e.target.value)}
            />
            {errors.areas ? <FieldError message={errors.areas} /> : <FieldHint>Separate multiple areas with commas</FieldHint>}
          </div>

          <fieldset>
            <legend className="mb-2 block text-sm font-medium text-ink">
              Status<span className="ml-0.5 text-link">*</span>
            </legend>
            <div className="grid grid-cols-3 gap-2 sm:max-w-md" role="radiogroup">
              {STATUSES.map((s) => {
                const meta = STATUS_META[s];
                const active = status === s;
                return (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setStatus(s)}
                    className={cn(
                      "focus-ring flex h-11 items-center justify-center gap-2 rounded-lg border text-sm font-medium transition-all",
                      active ? cn(meta.bg, meta.text, "border-current") : "border-line bg-raised text-ink-2 hover:text-ink",
                    )}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: meta.color }} />
                    {meta.label}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div>
            <FieldLabel htmlFor="notes">Additional Notes</FieldLabel>
            <Textarea
              id="notes"
              placeholder="Any additional observations or notes..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div className="border-t border-line pt-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-ink">Patrol Photos</div>
                <div className="mt-0.5 text-xs text-ink-3">
                  Live camera only · time-stamped · up to {MAX_PHOTOS} ({photos.length}/{MAX_PHOTOS})
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={photos.length >= MAX_PHOTOS}
                onClick={() => setCameraOpen(true)}
              >
                <Camera />
                Take Photo
              </Button>
            </div>
            {photos.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-3">
                {photos.map((src, i) => (
                  <div key={i} className="group relative animate-fade-up">
                    <img src={src} alt={`Attached photo ${i + 1}`} className="h-24 w-24 rounded-lg object-cover ring-1 ring-line" />
                    <button
                      type="button"
                      aria-label={`Remove photo ${i + 1}`}
                      onClick={() => setPhotos((p) => p.filter((_, idx) => idx !== i))}
                      className="focus-ring absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-canvas text-ink ring-1 ring-line hover:bg-status-incident"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {missing.length > 0 && (
            <div
              role="alert"
              className="flex animate-fade-up flex-col gap-3 rounded-lg border border-status-incident/40 bg-status-incident/[0.07] p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-status-incident-ink" />
                <div className="text-sm">
                  <div className="font-semibold text-ink">
                    {missing.length === 1 ? "Complete 1 required field" : `Complete ${missing.length} required fields`} to log this patrol
                  </div>
                  <p className="mt-0.5 text-ink-2">
                    Scroll up to fill in: <span className="font-medium text-ink">{missing.map((f) => f.label).join(", ")}</span>
                  </p>
                </div>
              </div>
              <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => focusField(missing[0].id)}>
                <ArrowUp />
                Go to {missing[0].label}
              </Button>
            </div>
          )}

          <div className="flex flex-col-reverse gap-3 border-t border-line pt-6 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => navigate(backTo)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || blockedByFence || needsClockIn}>
              {saving ? <Loader2 className="animate-spin" /> : blockedByFence ? <MapPinX /> : needsClockIn ? <Clock /> : <Save />}
              {saving
                ? photos.length
                  ? "Uploading…"
                  : "Saving…"
                : blockedByFence
                  ? verdict === "checking"
                    ? "Checking location…"
                    : "Must be on site"
                  : needsClockIn
                    ? "Clock In First"
                    : "Log Patrol"}
            </Button>
          </div>
        </form>
      </Card>

      <CameraCapture
        open={cameraOpen}
        onClose={closeCamera}
        onCapture={onCapture}
        remaining={MAX_PHOTOS - photos.length}
        stampLines={[property.name, officerName.trim() ? `Officer ${officerName.trim()}` : ""]}
      />
    </div>
  );
};

export default LogPatrol;
