import { ArrowLeft, Building2, Eye, EyeOff, KeyRound, Loader2, LogIn, MailCheck, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { Crest } from "@/components/fw/Crest";
import { FieldError, FieldHint, FieldLabel } from "@/components/fw/primitives";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { cn } from "@/lib/utils";
import { useAuth } from "@/state/AuthProvider";

type Mode = "signin" | "signup" | "forgot";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface SignUpErrors {
  orgName?: string;
  fullName?: string;
  email?: string;
  password?: string;
  confirm?: string;
  terms?: string;
}

const PasswordInput = ({
  id,
  value,
  onChange,
  invalid,
  autoComplete,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  autoComplete: string;
  placeholder?: string;
}) => {
  const [show, setShow] = useState<boolean>(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={show ? "text" : "password"}
        autoComplete={autoComplete}
        placeholder={placeholder}
        value={value}
        aria-invalid={invalid}
        onChange={(e) => onChange(e.target.value)}
        className="pr-11"
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Hide password" : "Show password"}
        className="focus-ring absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-ink-3 hover:text-ink"
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
};

const ErrorBox = ({ message }: { message: string | null }) =>
  message ? (
    <p
      role="alert"
      className="mt-5 rounded-lg border border-status-incident/30 bg-status-incident/10 px-3.5 py-2.5 text-sm text-status-incident"
    >
      {message}
    </p>
  ) : null;

/** Two-step reset: email a one-time code, then enter it with a new password. */
const ForgotPassword = ({ initialEmail, onDone }: { initialEmail: string; onDone: (email: string) => void }) => {
  const { requestPasswordReset, completePasswordReset, online } = useAuth();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState<string>(initialEmail);
  const [code, setCode] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [confirm, setConfirm] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState<boolean>(false);

  const sendCode = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!EMAIL_RE.test(email.trim())) {
      setError("Enter the email you sign in with.");
      return;
    }
    if (!online) {
      setError("You're offline. Connect to the internet to reset your password.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const sent = await requestPasswordReset(email);
      if (!sent) {
        setNotConfigured(true);
        return;
      }
      setStep("code");
      toast.success("Check your email", { description: `If ${email.trim()} has an account, a reset code is on its way.` });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send a reset code.");
    } finally {
      setBusy(false);
    }
  };

  const submitReset = async (e: FormEvent) => {
    e.preventDefault();
    const cleanCode = code.replace(/\s+/g, "");
    if (!/^\d{6,10}$/.test(cleanCode)) return setError("Enter the code from the email.");
    if (password.length < 8) return setError("Use at least 8 characters for your new password.");
    if (password !== confirm) return setError("Passwords don't match.");
    setBusy(true);
    setError(null);
    try {
      await completePasswordReset(email, cleanCode, password);
      toast.success("Password updated", { description: "You're signed in with your new password." });
      onDone(email);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't reset your password.");
      setBusy(false);
    }
  };

  if (notConfigured) {
    return (
      <div className="animate-fade-up p-7 sm:p-8">
        <KeyRound className="h-9 w-9 text-ember" strokeWidth={1.6} />
        <h1 className="mt-4 font-display text-2xl font-bold text-ink">Ask your admin</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-2">
          Email resets aren't available for this workspace yet. Your organization admin can set a new password for you
          from the Team page in seconds.
        </p>
        <Button type="button" variant="outline" size="lg" className="mt-7 w-full" onClick={() => onDone(email)}>
          <ArrowLeft />
          Back to sign in
        </Button>
      </div>
    );
  }

  return step === "email" ? (
    <form key="forgot-email" onSubmit={(e) => void sendCode(e)} className="animate-fade-up p-7 sm:p-8" noValidate>
      <h1 className="font-display text-2xl font-bold text-ink">Reset your password</h1>
      <p className="mt-1.5 text-sm text-ink-2">We'll email you a one-time code to set a new password.</p>
      <div className="mt-7">
        <FieldLabel htmlFor="fp-email">Email</FieldLabel>
        <Input
          id="fp-email"
          type="email"
          autoFocus
          autoComplete="email"
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <ErrorBox message={error} />
      <Button type="submit" size="lg" className="mt-7 w-full" disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : <MailCheck />}
        Email me a code
      </Button>
      <button
        type="button"
        onClick={() => onDone(email)}
        className="focus-ring mx-auto mt-5 flex items-center gap-1.5 rounded text-xs text-ink-3 hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to sign in
      </button>
    </form>
  ) : (
    <form key="forgot-code" onSubmit={(e) => void submitReset(e)} className="animate-fade-up p-7 sm:p-8" noValidate>
      <h1 className="font-display text-2xl font-bold text-ink">Enter your code</h1>
      <p className="mt-1.5 text-sm text-ink-2">
        Sent to <span className="text-ink">{email.trim()}</span>. It expires in 1 hour.
      </p>
      <div className="mt-7 space-y-5">
        <div>
          <FieldLabel htmlFor="fp-code" required>
            Reset code
          </FieldLabel>
          <Input
            id="fp-code"
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            maxLength={12}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^\d\s]/g, ""))}
            className="h-14 text-center font-mono text-2xl tracking-[0.5em]"
          />
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <FieldLabel htmlFor="fp-password" required>
              New password
            </FieldLabel>
            <PasswordInput id="fp-password" value={password} onChange={setPassword} autoComplete="new-password" />
            <FieldHint>8+ characters</FieldHint>
          </div>
          <div>
            <FieldLabel htmlFor="fp-confirm" required>
              Confirm
            </FieldLabel>
            <PasswordInput id="fp-confirm" value={confirm} onChange={setConfirm} autoComplete="new-password" />
          </div>
        </div>
      </div>
      <ErrorBox message={error} />
      <Button type="submit" size="lg" className="mt-7 w-full" disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : <KeyRound />}
        Set new password
      </Button>
      <div className="mt-5 flex items-center justify-between text-xs text-ink-3">
        <button type="button" onClick={() => onDone(email)} className="focus-ring flex items-center gap-1.5 rounded hover:text-ink">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to sign in
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void sendCode()}
          className="focus-ring rounded text-ember hover:underline disabled:opacity-40"
        >
          Resend code
        </button>
      </div>
    </form>
  );
};

const SignIn = () => {
  const { signIn, signUp, online } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  useDocumentTitle(mode === "signin" ? "Sign In" : mode === "forgot" ? "Reset Password" : "Create Organization");
  const [acceptedTerms, setAcceptedTerms] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");

  const [orgName, setOrgName] = useState<string>("");
  const [fullName, setFullName] = useState<string>("");
  const [confirm, setConfirm] = useState<string>("");
  const [errors, setErrors] = useState<SignUpErrors>({});

  const switchMode = (m: Mode) => {
    setMode(m);
    setFormError(null);
    setErrors({});
  };

  const submitSignIn = async (e: FormEvent) => {
    e.preventDefault();
    if (!EMAIL_RE.test(email.trim()) || !password) {
      setFormError("Enter your email and password.");
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await signIn(email, password);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Couldn't sign in.");
    } finally {
      setBusy(false);
    }
  };

  const submitSignUp = async (e: FormEvent) => {
    e.preventDefault();
    const next: SignUpErrors = {};
    if (!orgName.trim()) next.orgName = "Organization name is required";
    if (!fullName.trim()) next.fullName = "Your name is required";
    if (!EMAIL_RE.test(email.trim())) next.email = "Enter a valid email address";
    if (password.length < 8) next.password = "Use at least 8 characters";
    if (confirm !== password) next.confirm = "Passwords don't match";
    if (!acceptedTerms) next.terms = "Please agree to the Terms of Service and Privacy Policy";
    setErrors(next);
    if (Object.keys(next).length) return;

    setBusy(true);
    setFormError(null);
    try {
      await signUp({ orgName: orgName.trim(), fullName: fullName.trim(), email: email.trim(), password, acceptedTerms });
      toast.success(`Welcome to Phoenix Fire Watch`, { description: `${orgName.trim()} is ready. Add your team from the Team page.` });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Couldn't create your organization.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="canvas-glow relative flex min-h-screen items-center justify-center overflow-hidden px-4 pb-[max(2.5rem,var(--safe-bottom))] pt-[max(2.5rem,var(--safe-top))]">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/3 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-ember/[0.07] blur-3xl"
      />
      <div className="relative w-full max-w-md animate-fade-up">
        <Crest size="lg" className="mb-9" />

        <div className="rounded-2xl border border-line bg-surface">
          {mode !== "forgot" && (
          <div className="grid grid-cols-2 border-b border-line p-1.5" role="tablist">
            {(
              [
                ["signin", "Sign In"],
                ["signup", "Create Organization"],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => switchMode(m)}
                className={cn(
                  "focus-ring rounded-lg py-2.5 text-sm font-medium transition-colors",
                  mode === m ? "bg-raised text-ink" : "text-ink-3 hover:text-ink-2",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          )}

          {mode === "forgot" ? (
            <ForgotPassword
              initialEmail={email}
              onDone={(e) => {
                setEmail(e);
                switchMode("signin");
              }}
            />
          ) : mode === "signin" ? (
            <form key="signin" onSubmit={submitSignIn} className="animate-fade-up p-7 sm:p-8" noValidate>
              <h1 className="font-display text-2xl font-bold text-ink">Start your shift</h1>
              <p className="mt-1.5 text-sm text-ink-2">Sign in with the login your organization gave you.</p>

              <div className="mt-7 space-y-5">
                <div>
                  <FieldLabel htmlFor="email">Email</FieldLabel>
                  <Input
                    id="email"
                    type="email"
                    autoFocus
                    autoComplete="email"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div>
                  <div className="flex items-baseline justify-between">
                    <FieldLabel htmlFor="password">Password</FieldLabel>
                    <button
                      type="button"
                      onClick={() => switchMode("forgot")}
                      className="focus-ring rounded text-xs font-medium text-ember hover:underline"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="current-password" />
                </div>
              </div>

              {formError && (
                <p role="alert" className="mt-5 rounded-lg border border-status-incident/30 bg-status-incident/10 px-3.5 py-2.5 text-sm text-status-incident">
                  {formError}
                </p>
              )}

              <Button type="submit" size="lg" className="mt-7 w-full" disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <LogIn />}
                Sign In
              </Button>
            </form>
          ) : (
            <form key="signup" onSubmit={submitSignUp} className="animate-fade-up p-7 sm:p-8" noValidate>
              <h1 className="font-display text-2xl font-bold text-ink">Set up your company</h1>
              <p className="mt-1.5 text-sm text-ink-2">
                You'll be the organization admin and can create logins for your officers.
              </p>

              <div className="mt-7 space-y-5">
                <div>
                  <FieldLabel htmlFor="orgName" required>
                    Organization name
                  </FieldLabel>
                  <div className="relative">
                    <Building2 className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
                    <Input
                      id="orgName"
                      autoFocus
                      autoComplete="organization"
                      placeholder="e.g., Phoenix Fire Watch LLC"
                      value={orgName}
                      aria-invalid={!!errors.orgName}
                      onChange={(e) => setOrgName(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                  <FieldError message={errors.orgName} />
                </div>
                <div>
                  <FieldLabel htmlFor="fullName" required>
                    Your full name
                  </FieldLabel>
                  <Input
                    id="fullName"
                    autoComplete="name"
                    placeholder="e.g., Alex Carter"
                    value={fullName}
                    aria-invalid={!!errors.fullName}
                    onChange={(e) => setFullName(e.target.value)}
                  />
                  <FieldError message={errors.fullName} />
                </div>
                <div>
                  <FieldLabel htmlFor="su-email" required>
                    Work email
                  </FieldLabel>
                  <Input
                    id="su-email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@company.com"
                    value={email}
                    aria-invalid={!!errors.email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                  <FieldError message={errors.email} />
                </div>
                <div className="grid gap-5 sm:grid-cols-2">
                  <div>
                    <FieldLabel htmlFor="su-password" required>
                      Password
                    </FieldLabel>
                    <PasswordInput
                      id="su-password"
                      value={password}
                      onChange={setPassword}
                      invalid={!!errors.password}
                      autoComplete="new-password"
                    />
                    {errors.password ? <FieldError message={errors.password} /> : <FieldHint>8+ characters</FieldHint>}
                  </div>
                  <div>
                    <FieldLabel htmlFor="su-confirm" required>
                      Confirm
                    </FieldLabel>
                    <PasswordInput
                      id="su-confirm"
                      value={confirm}
                      onChange={setConfirm}
                      invalid={!!errors.confirm}
                      autoComplete="new-password"
                    />
                    <FieldError message={errors.confirm} />
                  </div>
                </div>
                <div>
                  <div className="flex items-start gap-3">
                    <Checkbox
                      id="su-terms"
                      checked={acceptedTerms}
                      onCheckedChange={(v) => setAcceptedTerms(v === true)}
                      aria-invalid={!!errors.terms}
                      className="mt-0.5 h-5 w-5 border-[#565b66] data-[state=checked]:border-ember data-[state=checked]:bg-ember data-[state=checked]:text-white"
                    />
                    <label htmlFor="su-terms" className="text-sm leading-relaxed text-ink-2">
                      I agree to the{" "}
                      <Link to="/terms" target="_blank" className="text-ember hover:underline">
                        Terms of Service
                      </Link>{" "}
                      and{" "}
                      <Link to="/privacy" target="_blank" className="text-ember hover:underline">
                        Privacy Policy
                      </Link>
                      .
                    </label>
                  </div>
                  <FieldError message={errors.terms} />
                </div>
              </div>

              {formError && (
                <p role="alert" className="mt-5 rounded-lg border border-status-incident/30 bg-status-incident/10 px-3.5 py-2.5 text-sm text-status-incident">
                  {formError}
                </p>
              )}

              <Button type="submit" size="lg" className="mt-7 w-full" disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
                Create Organization
              </Button>
            </form>
          )}
        </div>

        {!online && (
          <p className="mt-4 rounded-lg border border-status-follow/30 bg-status-follow/10 px-3.5 py-2.5 text-center text-xs text-status-follow">
            You're offline. Sign in once with a connection — after that the app works offline on this device.
          </p>
        )}

        {mode !== "forgot" && (
        <p className="mt-6 text-center text-xs text-ink-3">
          {mode === "signin" ? (
            <>
              New company?{" "}
              <button type="button" onClick={() => switchMode("signup")} className="focus-ring rounded text-ember hover:underline">
                Create an organization
              </button>
            </>
          ) : (
            <>
              Already have a login?{" "}
              <button type="button" onClick={() => switchMode("signin")} className="focus-ring rounded text-ember hover:underline">
                Sign in
              </button>
            </>
          )}
        </p>
        )}
        <nav aria-label="Legal" className="mt-4 flex justify-center gap-4 text-xs text-ink-3">
          <Link to="/privacy" className="focus-ring rounded hover:text-ink">
            Privacy
          </Link>
          <Link to="/terms" className="focus-ring rounded hover:text-ink">
            Terms
          </Link>
          <Link to="/support" className="focus-ring rounded hover:text-ink">
            Support
          </Link>
        </nav>
      </div>
    </div>
  );
};

export default SignIn;
