import { Building2, ImagePlus, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { memo, useCallback, useMemo, useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";

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
import { usePhotoUrls } from "@/hooks/use-photo-urls";
import { friendlyError } from "@/lib/supabase";
import type { Property } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useFireWatch } from "@/state/FireWatchProvider";

const MAX_BYTES = 25 * 1024 * 1024;

/** Resolves a site's stored photo into a signed URL (null while loading or when there is none). */
const useSiteImageUrl = (path: string | null) => {
  const paths = useMemo<string[]>(() => (path ? [path] : []), [path]);
  const { urls, isLoading } = usePhotoUrls(paths, !!path);
  return { url: urls[0] ?? null, isLoading: !!path && isLoading };
};

/** Square site thumbnail for lists; falls back to a building glyph. */
export const SiteThumb = memo(({ property, className }: { property: Property; className?: string }) => {
  const { url } = useSiteImageUrl(property.imagePath);
  const [loaded, setLoaded] = useState<boolean>(false);
  return (
    <div
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-raised ring-1 ring-line transition-colors group-hover:ring-ember/30",
        className,
      )}
    >
      <Building2 className="h-8 w-8 text-silver md:h-10 md:w-10" strokeWidth={1.5} />
      {url && (
        <img
          src={url}
          alt=""
          loading="lazy"
          onLoad={() => setLoaded(true)}
          className={cn(
            "absolute inset-0 h-full w-full object-cover transition-opacity duration-300",
            loaded ? "opacity-100" : "opacity-0",
          )}
        />
      )}
    </div>
  );
});
SiteThumb.displayName = "SiteThumb";

/** Site photo banner on Property Detail, with add / change / remove. */
export const SiteImageCard = ({ property }: { property: Property }) => {
  const { setPropertyImage } = useFireWatch();
  const { url, isLoading } = useSiteImageUrl(property.imagePath);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const [dragging, setDragging] = useState<boolean>(false);
  const [confirmRemove, setConfirmRemove] = useState<boolean>(false);
  const [loaded, setLoaded] = useState<string | null>(null);
  const pending = property.syncState === "pending" || property.syncState === "failed";

  const upload = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        toast.error("Choose an image file", { description: "JPEG, PNG, HEIC or WebP photos work best." });
        return;
      }
      if (file.size > MAX_BYTES) {
        toast.error("That photo is too large", { description: "Pick an image under 25 MB." });
        return;
      }
      setBusy("upload");
      try {
        await setPropertyImage(property.id, file);
        toast.success(property.imagePath ? "Site photo updated" : "Site photo added");
      } catch (err) {
        console.error("[SiteImage] upload failed", err);
        toast.error("Couldn't save the site photo", { description: friendlyError(err) });
      } finally {
        setBusy(null);
        if (input.current) input.current.value = "";
      }
    },
    [property.id, property.imagePath, setPropertyImage],
  );

  const remove = useCallback(async () => {
    setBusy("remove");
    try {
      await setPropertyImage(property.id, null);
      toast.success("Site photo removed");
    } catch (err) {
      toast.error("Couldn't remove the site photo", { description: friendlyError(err) });
    } finally {
      setBusy(null);
    }
  }, [property.id, setPropertyImage]);

  const pick = () => {
    if (pending) {
      toast.error("This property hasn't uploaded yet", { description: "Add a photo once it has synced." });
      return;
    }
    input.current?.click();
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (busy || pending) return;
    void upload(e.dataTransfer.files?.[0]);
  };

  const dragProps = {
    onDragOver: (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      if (!busy) setDragging(true);
    },
    onDragLeave: () => setDragging(false),
    onDrop,
  };

  const fileInput = (
    <input
      ref={input}
      type="file"
      accept="image/*"
      className="hidden"
      onChange={(e) => void upload(e.target.files?.[0])}
    />
  );

  if (!property.imagePath) {
    return (
      <div
        {...dragProps}
        className={cn(
          "mt-5 flex flex-col items-start gap-4 rounded-xl border border-dashed p-5 transition-colors sm:flex-row sm:items-center sm:p-6",
          dragging ? "border-ember bg-ember/10" : "border-line bg-surface/60",
        )}
      >
        {fileInput}
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-raised ring-1 ring-line">
          <ImagePlus className="h-7 w-7 text-ember" strokeWidth={1.6} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg font-bold text-ink">Add a site photo</h2>
          <p className="mt-0.5 text-sm text-ink-2">
            A photo of the building or entrance helps officers recognize the site at a glance. Drop an image here or
            choose one.
          </p>
        </div>
        <button
          type="button"
          onClick={pick}
          disabled={!!busy}
          className="focus-ring inline-flex h-11 shrink-0 items-center gap-2 rounded-lg bg-ember px-5 text-sm font-semibold text-white transition-colors hover:bg-ember/90 disabled:opacity-60"
        >
          {busy === "upload" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
          {busy === "upload" ? "Uploading…" : "Choose Photo"}
        </button>
      </div>
    );
  }

  const ready = !!url && loaded === url;

  return (
    <div
      {...dragProps}
      className={cn(
        "relative mt-5 overflow-hidden rounded-xl border bg-raised",
        dragging ? "border-ember ring-2 ring-ember/40" : "border-line",
      )}
    >
      {fileInput}
      <div className="relative aspect-[16/9] max-h-[380px] w-full sm:aspect-[21/9]">
        {(!ready || isLoading) && (
          <div className="absolute inset-0 flex items-center justify-center bg-raised">
            <Building2 className="h-12 w-12 animate-pulse text-line" strokeWidth={1.4} />
          </div>
        )}
        {url && (
          <img
            src={url}
            alt={`Photo of ${property.name}`}
            onLoad={() => setLoaded(url)}
            className={cn(
              "absolute inset-0 h-full w-full object-cover transition-opacity duration-500",
              ready ? "opacity-100" : "opacity-0",
            )}
          />
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-canvas/85 to-transparent" />
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-canvas/60">
            <span className="flex items-center gap-2 rounded-full bg-canvas/90 px-4 py-2 text-sm font-medium text-ink ring-1 ring-line">
              <Loader2 className="h-4 w-4 animate-spin text-ember" />
              {busy === "upload" ? "Uploading photo…" : "Removing…"}
            </span>
          </div>
        )}
        <div className="absolute bottom-3 right-3 flex gap-2 sm:bottom-4 sm:right-4">
          <button
            type="button"
            onClick={pick}
            disabled={!!busy}
            className="focus-ring inline-flex h-10 items-center gap-2 rounded-lg bg-canvas/85 px-3.5 text-sm font-semibold text-ink ring-1 ring-line backdrop-blur transition-colors hover:bg-canvas hover:text-ember disabled:opacity-50"
          >
            <RefreshCw className="h-4 w-4" />
            Change
          </button>
          <button
            type="button"
            onClick={() => setConfirmRemove(true)}
            disabled={!!busy}
            aria-label="Remove site photo"
            className="focus-ring inline-flex h-10 w-10 items-center justify-center rounded-lg bg-canvas/85 text-ink-2 ring-1 ring-line backdrop-blur transition-colors hover:bg-canvas hover:text-status-incident disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent className="border-line bg-surface text-ink sm:rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-xl">Remove the site photo?</AlertDialogTitle>
            <AlertDialogDescription className="text-ink-2">
              The photo will be removed from {property.name} for your whole team.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-[#7A8394] bg-transparent text-ink hover:bg-raised hover:text-ink">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-status-incident text-white hover:bg-status-incident/90"
              onClick={() => void remove()}
            >
              Remove Photo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
