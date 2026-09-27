import {
  AlertTriangle,
  Camera,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CloudUpload,
  ImageOff,
  MapPin,
  Trash2,
  User,
  X,
} from "lucide-react";
import { memo, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";

import { usePhotoUrls } from "@/hooks/use-photo-urls";
import { fullDateTime, timeOfDay } from "@/lib/format";
import { STATUS_META, type Patrol } from "@/lib/types";
import { cn } from "@/lib/utils";

import { StatusBadge } from "./primitives";

interface PatrolRowProps {
  patrol: Patrol;
  propertyName?: string;
  propertyId?: string;
  showDate?: boolean;
  onDelete?: (patrol: Patrol) => void;
}

/** Expandable patrol log entry. */
export const PatrolRow = memo(({ patrol, propertyName, propertyId, showDate, onDelete }: PatrolRowProps) => {
  const [open, setOpen] = useState<boolean>(false);
  const [preview, setPreview] = useState<number | null>(null);
  const meta = STATUS_META[patrol.status];
  const photoCount = patrol.photos.length;
  const { urls } = usePhotoUrls(patrol.photos, photoCount > 0);
  const previewSrc = preview !== null ? urls[preview] : null;
  const step = (dir: 1 | -1) => setPreview((i) => (i === null ? i : (i + dir + photoCount) % photoCount));
  const hasDetail = patrol.notes.length > 0 || patrol.photos.length > 0 || !!onDelete;

  return (
    <li className="relative">
      <div className="flex items-stretch">
      <button
        type="button"
        onClick={() => hasDetail && setOpen((o) => !o)}
        aria-expanded={hasDetail ? open : undefined}
        className={cn(
          "focus-ring flex min-w-0 flex-1 items-start gap-4 px-6 py-4 text-left transition-colors sm:px-7",
          hasDetail && "hover:bg-white/[0.02]",
        )}
      >
        <span
          className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ring-4"
          style={{ backgroundColor: meta.color, ["--tw-ring-color" as string]: `${meta.color}22` }}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono text-sm text-ink">
              {showDate ? fullDateTime(patrol.dateTime) : timeOfDay(patrol.dateTime)}
            </span>
            <StatusBadge status={patrol.status} />
            {patrol.syncState && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
                  patrol.syncState === "failed"
                    ? "bg-status-incident/10 text-status-incident ring-status-incident/30"
                    : "bg-ember/10 text-ember ring-ember/30",
                )}
              >
                {patrol.syncState === "failed" ? (
                  <AlertTriangle className="h-3 w-3" />
                ) : (
                  <CloudUpload className="h-3 w-3" />
                )}
                {patrol.syncState === "failed" ? "Not uploaded" : "Waiting to upload"}
              </span>
            )}
            {patrol.photos.length > 0 && (
              <span className="inline-flex items-center gap-1 text-xs text-ink-3">
                <Camera className="h-3.5 w-3.5" />
                {patrol.photos.length}
              </span>
            )}
          </div>
          {propertyName && (
            <div className="mt-1.5 truncate text-[15px] font-medium text-ink">{propertyName}</div>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-2">
            <span className="inline-flex items-center gap-1.5">
              <User className="h-3.5 w-3.5 text-ink-3" />
              {patrol.officerName}
            </span>
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 shrink-0 text-ink-3" />
              <span className="truncate">{patrol.areas.join(", ")}</span>
            </span>
          </div>
        </div>
        {hasDetail && (
          <ChevronDown
            className={cn("mt-1 h-4 w-4 shrink-0 text-ink-3 transition-transform", open && "rotate-180")}
          />
        )}
      </button>
      {photoCount > 0 && !open && (
        <div className="flex shrink-0 items-center gap-1.5 py-4 pr-5 sm:pr-6">
          {patrol.photos.slice(0, 3).map((path, i) => {
            const src = urls[i];
            const showMore = i === 2 && photoCount > 3;
            return (
              <button
                key={path}
                type="button"
                onClick={() => setPreview(i)}
                aria-label={`View patrol photo ${i + 1}`}
                className={cn(
                  "focus-ring relative h-12 w-12 overflow-hidden rounded-md bg-raised ring-1 ring-line transition-transform hover:scale-105 sm:h-14 sm:w-14",
                  i > 0 && "hidden sm:block",
                )}
              >
                {src ? (
                  <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <span className="block h-full w-full animate-pulse" />
                )}
                {showMore && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/60 text-xs font-semibold text-white">
                    +{photoCount - 2}
                  </span>
                )}
                {i === 0 && photoCount > 1 && (
                  <span className="absolute bottom-0.5 right-0.5 rounded bg-black/70 px-1 text-[10px] font-semibold text-white sm:hidden">
                    {photoCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      </div>

      {open && (
        <div className="animate-fade-up space-y-4 px-6 pb-5 pl-[3.25rem] sm:px-7 sm:pl-[3.5rem]">
          {patrol.notes && <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-2">{patrol.notes}</p>}
          {patrol.photos.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {patrol.photos.map((path, i) => {
                const src = urls[i];
                return src ? (
                  <button
                    key={path}
                    type="button"
                    onClick={() => setPreview(i)}
                    className="focus-ring overflow-hidden rounded-lg ring-1 ring-line transition-transform hover:scale-[1.03]"
                  >
                    <img src={src} alt={`Patrol photo ${i + 1}`} className="h-28 w-28 object-cover sm:h-32 sm:w-32" />
                  </button>
                ) : (
                  <div
                    key={path}
                    className="flex h-28 w-28 animate-pulse items-center justify-center rounded-lg bg-raised ring-1 ring-line sm:h-32 sm:w-32"
                  >
                    <ImageOff className="h-5 w-5 text-ink-3" />
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex items-center gap-4">
            {propertyId && (
              <Link to={`/properties/${propertyId}`} className="focus-ring rounded text-sm text-ember hover:underline">
                Open property
              </Link>
            )}
            {onDelete && (
              <button
                type="button"
                onClick={() => onDelete(patrol)}
                className="focus-ring inline-flex items-center gap-1.5 rounded text-sm text-ink-3 transition-colors hover:text-status-incident"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete log
              </button>
            )}
          </div>
        </div>
      )}

      {preview !== null &&
        createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Patrol photo"
          className="fixed inset-0 z-50 flex animate-fade-up flex-col bg-black/95"
          onKeyDown={(e) => {
            if (e.key === "Escape") setPreview(null);
            if (e.key === "ArrowRight") step(1);
            if (e.key === "ArrowLeft") step(-1);
          }}
        >
          <div className="flex items-center justify-between gap-3 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <div className="min-w-0 text-sm text-white">
              <div className="truncate font-medium">
                {fullDateTime(patrol.dateTime)} · {meta.label}
              </div>
              <div className="truncate text-xs text-ink-2">
                {patrol.officerName} · Photo {preview + 1} of {photoCount}
              </div>
            </div>
            <button
              type="button"
              autoFocus
              onClick={() => setPreview(null)}
              aria-label="Close photo"
              className="focus-ring flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div
            className="relative flex flex-1 items-center justify-center overflow-hidden p-4"
            onClick={() => setPreview(null)}
          >
            {previewSrc ? (
              <img
                src={previewSrc}
                alt={`Patrol photo ${preview + 1}`}
                className="max-h-full max-w-full rounded-lg object-contain"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <ImageOff className="h-8 w-8 text-ink-3" />
            )}
            {photoCount > 1 && (
              <>
                <button
                  type="button"
                  aria-label="Previous photo"
                  onClick={(e) => {
                    e.stopPropagation();
                    step(-1);
                  }}
                  className="focus-ring absolute left-3 flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white ring-1 ring-white/15 hover:bg-black/80"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  aria-label="Next photo"
                  onClick={(e) => {
                    e.stopPropagation();
                    step(1);
                  }}
                  className="focus-ring absolute right-3 flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white ring-1 ring-white/15 hover:bg-black/80"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </>
            )}
          </div>
        </div>,
          document.body,
        )}
    </li>
  );
});
PatrolRow.displayName = "PatrolRow";
