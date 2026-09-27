import { Camera, Loader2, Save, Shield, X } from "lucide-react";
import { useCallback, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { CameraCapture } from "@/components/fw/CameraCapture";
import { Card, CardHeader, FieldError, FieldHint, FieldLabel, PageHeader } from "@/components/fw/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { toLocalInputValue } from "@/lib/format";
import { friendlyError } from "@/lib/supabase";
import { STATUS_META, type PatrolStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useFireWatch } from "@/state/FireWatchProvider";

import NotFound from "./NotFound";

const MAX_PHOTOS = 5;
const STATUSES: PatrolStatus[] = ["clear", "follow-up", "incident"];

interface Errors {
  dateTime?: string;
  officerName?: string;
  areas?: string;
}

const LogPatrol = () => {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  useDocumentTitle("Log Patrol");
  const { propertyById, addPatrol, user, patrols } = useFireWatch();
  const property = propertyById.get(id);

  const lastOfficer = patrols.find((p) => p.propertyId === id)?.officerName;
  const [dateTime, setDateTime] = useState<string>(() => toLocalInputValue(new Date()));
  const [officerName, setOfficerName] = useState<string>(lastOfficer ?? user?.name ?? "");
  const [areas, setAreas] = useState<string>("");
  const [status, setStatus] = useState<PatrolStatus>("clear");
  const [notes, setNotes] = useState<string>("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [cameraOpen, setCameraOpen] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [errors, setErrors] = useState<Errors>({});

  const onCapture = useCallback((dataUrl: string) => {
    setPhotos((p) => (p.length >= MAX_PHOTOS ? p : [...p, dataUrl]));
  }, []);
  const closeCamera = useCallback(() => setCameraOpen(false), []);

  if (!property) return <NotFound embedded />;

  const backTo = `/properties/${property.id}`;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const areaList = areas
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);
    const next: Errors = {};
    if (!dateTime || Number.isNaN(new Date(dateTime).getTime())) next.dateTime = "Choose the patrol date and time";
    if (!officerName.trim()) next.officerName = "Officer name is required";
    if (areaList.length === 0) next.areas = "List at least one area patrolled";
    setErrors(next);
    if (Object.keys(next).length > 0 || saving) return;

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

      <Card>
        <CardHeader
          icon={Shield}
          title="Patrol Details"
          subtitle="Record patrol activity and observations"
          className="border-b border-line pb-6"
        />
        <form onSubmit={(e) => void submit(e)} noValidate className="space-y-6 px-6 py-7 sm:px-7">
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
              Status<span className="ml-0.5 text-ember">*</span>
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

          <div className="flex flex-col-reverse gap-3 border-t border-line pt-6 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => navigate(backTo)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : <Save />}
              {saving ? (photos.length ? "Uploading…" : "Saving…") : "Log Patrol"}
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
