import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { callFunction } from "@/lib/supabase";
import { ROLE_LABEL, type Role } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Login details to hand to a new employee (shown once). */
export type LoginCredentials = { name: string; email: string; password: string };

/** 10-char temporary password without look-alike characters. */
export const generatePassword = (): string => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint32Array(10);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
};

/**
 * Creates a Team login (app account) inside the caller's organization.
 * The database links it to the Workforce profile with the same email, or creates one.
 */
export const createTeamLogin = (payload: { fullName: string; email: string; password: string; role: Role }) =>
  callFunction<{ ok: boolean }>("manage-members", { action: "create", ...payload });

export const RolePicker = ({ value, onChange }: { value: Role; onChange: (r: Role) => void }) => (
  <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Role">
    {(["officer", "admin"] as const).map((r) => (
      <button
        key={r}
        type="button"
        role="radio"
        aria-checked={value === r}
        onClick={() => onChange(r)}
        className={cn(
          "focus-ring rounded-lg border px-3 py-2.5 text-left transition-colors",
          value === r ? "border-primary/60 bg-primary/10" : "border-line bg-raised hover:border-line-strong",
        )}
      >
        <div className={cn("text-sm font-medium", value === r ? "text-link" : "text-ink")}>{ROLE_LABEL[r]}</div>
        <div className="mt-0.5 text-xs text-ink-3">{r === "admin" ? "Manages team + everything" : "Logs patrols & notes"}</div>
      </button>
    ))}
  </div>
);

/** One-time display of a new or reset login, with copy-to-clipboard. */
export const LoginReadyDialog = ({ credentials, onClose }: { credentials: LoginCredentials | null; onClose: () => void }) => {
  const copy = async () => {
    if (!credentials) return;
    const text = `Phoenix Fire Watch login\n${window.location.origin}\nEmail: ${credentials.email}\nPassword: ${credentials.password}`;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Login details copied");
    } catch {
      toast.error("Couldn't copy — select the text manually");
    }
  };
  return (
    <Dialog open={!!credentials} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[calc(100%-2rem)] rounded-xl border-line bg-surface text-ink sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Login ready</DialogTitle>
          <DialogDescription className="text-ink-2">
            Share these details with {credentials?.name}. The password won't be shown again.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 rounded-lg border border-line bg-raised p-4 font-mono text-sm">
          <div>
            <div className="font-sans text-xs uppercase tracking-[0.14em] text-ink-3">Email</div>
            <div className="mt-1 select-all break-all text-ink">{credentials?.email}</div>
          </div>
          <div>
            <div className="font-sans text-xs uppercase tracking-[0.14em] text-ink-3">Password</div>
            <div className="mt-1 select-all text-link">{credentials?.password}</div>
          </div>
        </div>
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => void copy()}>
            Copy details
          </Button>
          <Button onClick={onClose}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
