import { FileCheck2, Loader2, LogOut } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { Crest } from "@/components/fw/Crest";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { friendlyError } from "@/lib/supabase";
import { useAuth } from "@/state/AuthProvider";

/** Shown once to employees (created by an admin) before they first use the app. */
const AcceptTerms = () => {
  useDocumentTitle("Review Terms");
  const { user, acceptTerms, signOut, online } = useAuth();
  const [checked, setChecked] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);

  const accept = async () => {
    if (!online) {
      toast.error("You're offline", { description: "Connect once to accept the terms." });
      return;
    }
    setBusy(true);
    try {
      await acceptTerms();
    } catch (err) {
      toast.error(friendlyError(err));
      setBusy(false);
    }
  };

  return (
    <div className="canvas-glow flex min-h-screen items-center justify-center px-4 pb-[max(2.5rem,var(--safe-bottom))] pt-[max(2.5rem,var(--safe-top))]">
      <div className="w-full max-w-md animate-fade-up">
        <Crest size="lg" className="mb-8" />
        <div className="rounded-2xl border border-line bg-surface p-7 sm:p-8">
          <FileCheck2 className="h-9 w-9 text-link" strokeWidth={1.6} />
          <h1 className="mt-4 font-display text-2xl font-bold text-ink">Welcome{user ? `, ${user.name.split(" ")[0]}` : ""}</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-2">
            {user?.orgName ?? "Your organization"} set up your login. Before your first shift, please review how Phoenix
            Fire Watch handles your information and how officer names are used as electronic signatures on shift
            reports.
          </p>
          <div className="mt-6 flex items-start gap-3">
            <Checkbox
              id="accept"
              checked={checked}
              onCheckedChange={(v) => setChecked(v === true)}
              className="mt-0.5 h-5 w-5 border-line-hover data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-white"
            />
            <label htmlFor="accept" className="text-sm leading-relaxed text-ink-2">
              I agree to the{" "}
              <Link to="/terms" target="_blank" className="text-link hover:underline">
                Terms of Service
              </Link>{" "}
              and{" "}
              <Link to="/privacy" target="_blank" className="text-link hover:underline">
                Privacy Policy
              </Link>
              .
            </label>
          </div>
          <Button size="lg" className="mt-7 w-full" disabled={!checked || busy} onClick={() => void accept()}>
            {busy ? <Loader2 className="animate-spin" /> : <FileCheck2 />}
            Continue
          </Button>
          <button
            type="button"
            onClick={() => void signOut()}
            className="focus-ring mx-auto mt-4 flex items-center gap-2 rounded text-sm text-ink-3 hover:text-ink"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
};

export default AcceptTerms;
