import { ArrowDown, BookOpenCheck, Loader2, LogOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Crest } from "@/components/fw/Crest";
import { FIELD_GUIDE_TITLE, FieldGuideActions, FieldGuidePage } from "@/components/fw/FieldGuide";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { friendlyError } from "@/lib/supabase";
import { useAuth } from "@/state/AuthProvider";

/** Required once for officers: read the field guide and acknowledge it before entering the app. */
const AcknowledgeGuide = () => {
  useDocumentTitle(FIELD_GUIDE_TITLE);
  const { user, acknowledgeGuide, signOut, online } = useAuth();
  const [reachedEnd, setReachedEnd] = useState<boolean>(false);
  const [checked, setChecked] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = endRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setReachedEnd(true);
      },
      { rootMargin: "0px 0px 40px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const acknowledge = async () => {
    if (!online) {
      toast.error("You're offline", { description: "Connect once to acknowledge the field guide." });
      return;
    }
    setBusy(true);
    try {
      await acknowledgeGuide();
      toast.success("Field guide acknowledged", { description: "You can re-read it any time from the dashboard." });
    } catch (err) {
      toast.error(friendlyError(err));
      setBusy(false);
    }
  };

  const firstName = user?.name.split(" ")[0] ?? "";

  return (
    <div className="canvas-glow min-h-screen pt-[max(1.5rem,var(--safe-top))]">
      <div className="mx-auto w-full max-w-3xl px-4 pb-48 sm:px-6">
        <div className="flex items-center justify-between gap-4">
          <Crest size="sm" />
          <button
            type="button"
            onClick={() => void signOut()}
            className="focus-ring flex items-center gap-2 rounded text-sm text-ink-3 hover:text-ink"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>

        <header className="mt-8 animate-fade-up">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ember">Required before your first shift</p>
          <h1 className="mt-2 font-display text-3xl font-bold text-ink sm:text-4xl">
            {firstName ? `${firstName}, read your field guide` : "Read your field guide"}
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-2 sm:text-base">
            This is how {user?.orgName || "Phoenix Fire Watch"} runs every fire watch. Read it all the way through, then
            acknowledge it to continue into the app.
          </p>
          <FieldGuideActions className="mt-4" />
        </header>

        <div className="mt-6 animate-fade-up [animation-delay:80ms]">
          <FieldGuidePage />
          <div ref={endRef} aria-hidden className="h-px" />
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-canvas/95 backdrop-blur pb-[max(1rem,var(--safe-bottom))] pt-4">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 sm:flex-row sm:items-center sm:gap-5 sm:px-6">
          <div className="flex flex-1 items-start gap-3">
            <Checkbox
              id="ack-guide"
              checked={checked}
              disabled={!reachedEnd}
              onCheckedChange={(v) => setChecked(v === true)}
              className="mt-0.5 h-5 w-5 border-[#8A93A3] data-[state=checked]:border-ember data-[state=checked]:bg-ember data-[state=checked]:text-white"
            />
            <label htmlFor="ack-guide" className={reachedEnd ? "text-sm leading-relaxed text-ink" : "text-sm leading-relaxed text-ink-3"}>
              I have read and understand the {FIELD_GUIDE_TITLE} and will follow it on every shift.
              {!reachedEnd && (
                <span className="mt-1 flex items-center gap-1.5 text-xs text-ink-3">
                  <ArrowDown className="h-3.5 w-3.5 animate-bounce" />
                  Scroll to the end of the guide to continue
                </span>
              )}
            </label>
          </div>
          <Button size="lg" className="w-full sm:w-auto" disabled={!checked || busy} onClick={() => void acknowledge()}>
            {busy ? <Loader2 className="animate-spin" /> : <BookOpenCheck />}
            Acknowledge &amp; Continue
          </Button>
        </div>
      </div>
    </div>
  );
};

export default AcknowledgeGuide;
