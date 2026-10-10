import { BookOpenCheck, CheckCircle2, Download, ExternalLink } from "lucide-react";
import { memo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** Versioned file names: when the guide changes, add a new file instead of overwriting. */
export const FIELD_GUIDE_PDF = "/docs/phoenix-field-guide-v2.pdf";
export const FIELD_GUIDE_IMAGE = "/docs/phoenix-field-guide-v2.png";
export const FIELD_GUIDE_TITLE = "New Employee Field Guide";

/** The guide page as a sharp image on white paper (reliable on every browser, incl. iOS Safari). */
export const FieldGuidePage = memo(({ className, onLoad }: { className?: string; onLoad?: () => void }) => {
  const [loaded, setLoaded] = useState<boolean>(false);
  return (
    <div className={cn("relative overflow-hidden rounded-lg bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.08)]", className)}>
      {!loaded && <div className="aspect-[612/792] w-full animate-pulse bg-[#ECEDEF]" />}
      <img
        src={FIELD_GUIDE_IMAGE}
        alt="Phoenix Fire Watch — Fire Watch Field Guide: how to perform a fire watch, what to do if you find fire or smoke, and what never to do."
        className={cn("block h-auto w-full transition-opacity duration-300", loaded ? "opacity-100" : "absolute inset-0 opacity-0")}
        onLoad={() => {
          setLoaded(true);
          onLoad?.();
        }}
        draggable={false}
      />
    </div>
  );
});
FieldGuidePage.displayName = "FieldGuidePage";

export const FieldGuideActions = ({ className }: { className?: string }) => (
  <div className={cn("flex flex-wrap gap-2", className)}>
    <Button asChild variant="outline" size="sm">
      <a href={FIELD_GUIDE_PDF} target="_blank" rel="noreferrer">
        <ExternalLink />
        Open PDF
      </a>
    </Button>
    <Button asChild variant="outline" size="sm">
      <a href={FIELD_GUIDE_PDF} download="Phoenix-Fire-Watch-Field-Guide.pdf">
        <Download />
        Download
      </a>
    </Button>
  </div>
);

const formatAck = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/** Dashboard card so officers can re-read the guide any time. */
export const FieldGuideCard = ({ acknowledgedAt }: { acknowledgedAt: string | null }) => {
  const [open, setOpen] = useState<boolean>(false);
  return (
    <>
      <section
        aria-labelledby="field-guide-heading"
        className="mt-5 overflow-hidden rounded-xl border border-line bg-surface"
      >
        <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:p-6">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={`Read the ${FIELD_GUIDE_TITLE}`}
            className="focus-ring group relative mx-auto w-28 shrink-0 rotate-[-2deg] rounded-md transition-transform duration-200 hover:rotate-0 hover:scale-[1.03] sm:mx-0 sm:w-24"
          >
            <img
              src={FIELD_GUIDE_IMAGE}
              alt=""
              loading="lazy"
              className="block w-full rounded-md bg-white shadow-[0_6px_18px_rgba(0,0,0,0.35)]"
            />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ember">Training</p>
            <h2 id="field-guide-heading" className="mt-1 font-display text-xl font-bold text-ink">
              {FIELD_GUIDE_TITLE}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-ink-2">
              How to perform a fire watch, what to do if you find fire or smoke, and the rules you never break. Keep it
              with you on every shift.
            </p>
            {acknowledgedAt && (
              <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-ink-3">
                <CheckCircle2 className="h-3.5 w-3.5 text-[#22C55E]" />
                You acknowledged this guide on {formatAck(acknowledgedAt)}
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col sm:items-stretch">
            <Button onClick={() => setOpen(true)}>
              <BookOpenCheck />
              Read Guide
            </Button>
            <Button asChild variant="outline">
              <a href={FIELD_GUIDE_PDF} download="Phoenix-Fire-Watch-Field-Guide.pdf">
                <Download />
                Download PDF
              </a>
            </Button>
          </div>
        </div>
      </section>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[92vh] max-w-3xl flex-col gap-4 overflow-hidden p-4 sm:p-6">
          <DialogHeader className="pr-8 text-left">
            <DialogTitle>{FIELD_GUIDE_TITLE}</DialogTitle>
            <DialogDescription>Phoenix Fire Watch · Florida quick reference</DialogDescription>
          </DialogHeader>
          <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-1">
            <FieldGuidePage />
          </div>
          <FieldGuideActions />
        </DialogContent>
      </Dialog>
    </>
  );
};
