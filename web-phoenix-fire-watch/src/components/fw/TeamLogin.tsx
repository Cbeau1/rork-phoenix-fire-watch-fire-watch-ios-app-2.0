import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { copyText } from "@/lib/clipboard";
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

/** Domain used for generated logins when a worker has no personal email. */
export const LOGIN_DOMAIN = "phoenixfirewatch.com";

const slug = (s: string): string =>
  s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

/**
 * Generic login email from a name, e.g. "christopher.engdahl@phoenixfirewatch.com".
 * `n` > 1 adds a number for people who share a name ("christopher.engdahl2@…").
 */
export const genericLoginEmail = (first: string, last: string, n: number = 1): string => {
  const local = [slug(first), slug(last)].filter(Boolean).join(".") || "officer";
  return `${local.slice(0, 60)}${n > 1 ? n : ""}@${LOGIN_DOMAIN}`;
};

/** First generic email not already used by someone on the Team. */
export const nextGenericLoginEmail = (first: string, last: string, taken: Iterable<string>, start: number = 1): { email: string; n: number } => {
  const used = new Set(Array.from(taken, (e) => e.toLowerCase()));
  let n = start;
  while (used.has(genericLoginEmail(first, last, n))) n += 1;
  return { email: genericLoginEmail(first, last, n), n };
};

const isEmailTaken = (err: unknown): boolean => err instanceof Error && /already in use/i.test(err.message);

/**
 * Creates a login with a generated name-based email, trying the next number if that address is
 * already taken by an account outside this Team. `beforeAttempt` runs before each try so the
 * caller can save the candidate on the Workforce profile (the login is matched to it by email).
 */
export const createGenericTeamLogin = async (opts: {
  first: string;
  last: string;
  taken: Iterable<string>;
  password: string;
  role: Role;
  beforeAttempt: (email: string) => Promise<void>;
}): Promise<LoginCredentials> => {
  const fullName = `${opts.first} ${opts.last}`.trim();
  const taken = Array.from(opts.taken);
  let n = 1;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const next = nextGenericLoginEmail(opts.first, opts.last, taken, n);
    await opts.beforeAttempt(next.email);
    try {
      await createTeamLogin({ fullName, email: next.email, password: opts.password, role: opts.role });
      return { name: fullName, email: next.email, password: opts.password };
    } catch (err) {
      if (!isEmailTaken(err)) throw err;
      n = next.n + 1;
    }
  }
  throw new Error("Couldn't find a free login email for this name. Enter their email instead.");
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
    if (await copyText(text)) toast.success("Login details copied");
    else toast.error("Couldn't copy — select the text manually");
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
