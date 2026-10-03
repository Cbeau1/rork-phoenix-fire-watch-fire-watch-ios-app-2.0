import { Check, Database, ExternalLink, KeyRound, Loader2, ShieldAlert, Trash2, UserCog } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { Card, CardHeader, FieldError, FieldHint, FieldLabel, PageHeader } from "@/components/fw/primitives";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { LEGAL, RETENTION_OPTIONS, retentionLabel } from "@/lib/legal";
import { friendlyError } from "@/lib/supabase";
import { ROLE_LABEL } from "@/lib/types";
import { useAuth } from "@/state/AuthProvider";
import { useFireWatch } from "@/state/FireWatchProvider";

type DeleteScope = "self" | "organization";

const Account = () => {
  useDocumentTitle("Account");
  const { user, isAdmin, online, updateName, changePassword, setRetention, deleteAccount } = useAuth();
  const { sync } = useFireWatch();

  const [name, setName] = useState<string>(user?.name ?? "");
  const [savingName, setSavingName] = useState<boolean>(false);

  const [password, setPassword] = useState<string>("");
  const [confirm, setConfirm] = useState<string>("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [savingPw, setSavingPw] = useState<boolean>(false);

  const [savingRetention, setSavingRetention] = useState<boolean>(false);

  const [deleteScope, setDeleteScope] = useState<DeleteScope | null>(null);
  const [confirmText, setConfirmText] = useState<string>("");
  const [deleting, setDeleting] = useState<boolean>(false);

  if (!user) return null;

  const offlineGuard = (): boolean => {
    if (online) return false;
    toast.error("You're offline", { description: "Account changes need a connection." });
    return true;
  };

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || offlineGuard()) return;
    setSavingName(true);
    try {
      await updateName(name);
      toast.success("Name updated");
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setSavingName(false);
    }
  };

  const savePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return setPwError("Use at least 8 characters");
    if (password !== confirm) return setPwError("Passwords don't match");
    if (offlineGuard()) return;
    setPwError(null);
    setSavingPw(true);
    try {
      await changePassword(password);
      setPassword("");
      setConfirm("");
      toast.success("Password changed");
    } catch (err) {
      setPwError(friendlyError(err));
    } finally {
      setSavingPw(false);
    }
  };

  const changeRetention = async (value: string) => {
    if (offlineGuard()) return;
    const days = value === "none" ? null : Number(value);
    setSavingRetention(true);
    try {
      await setRetention(days);
      toast.success("Data retention updated", { description: retentionLabel(days) });
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setSavingRetention(false);
    }
  };

  const openDelete = (scope: DeleteScope) => {
    setConfirmText("");
    setDeleteScope(scope);
  };

  const requiredText = deleteScope === "organization" ? user.orgName : "DELETE";
  const canConfirm = confirmText.trim().toLowerCase() === requiredText.trim().toLowerCase();

  const runDelete = async () => {
    if (!deleteScope || !canConfirm || offlineGuard()) return;
    setDeleting(true);
    try {
      const deleted = await deleteAccount(deleteScope, deleteScope === "organization" ? confirmText.trim() : undefined);
      toast.success(deleted === "organization" ? "Organization and all data deleted" : "Your account was deleted");
    } catch (err) {
      toast.error(friendlyError(err, "Couldn't delete the account"));
      setDeleting(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Account" subtitle={`${ROLE_LABEL[user.role]} · ${user.orgName}`} />

      <Card>
        <CardHeader icon={UserCog} title="Profile" subtitle="Your name appears on patrol logs, notes and signed reports" />
        <form onSubmit={(e) => void saveName(e)} className="grid gap-5 px-6 py-6 sm:grid-cols-2 sm:px-7">
          <div>
            <FieldLabel htmlFor="acc-name">Full name</FieldLabel>
            <Input id="acc-name" value={name} autoComplete="name" onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <FieldLabel htmlFor="acc-email">Email</FieldLabel>
            <Input id="acc-email" value={user.email} disabled readOnly />
            <FieldHint>Ask your organization admin to change your login email.</FieldHint>
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={savingName || !name.trim() || name.trim() === user.name}>
              {savingName ? <Loader2 className="animate-spin" /> : <Check />}
              Save name
            </Button>
          </div>
        </form>
      </Card>

      <Card className="mt-5">
        <CardHeader icon={KeyRound} title="Password" subtitle="Change the password you use to sign in" />
        <form onSubmit={(e) => void savePassword(e)} className="grid gap-5 px-6 py-6 sm:grid-cols-2 sm:px-7" noValidate>
          <div>
            <FieldLabel htmlFor="acc-pw">New password</FieldLabel>
            <Input
              id="acc-pw"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div>
            <FieldLabel htmlFor="acc-pw2">Confirm password</FieldLabel>
            <Input
              id="acc-pw2"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <FieldError message={pwError ?? undefined} />
            <Button type="submit" variant="outline" disabled={savingPw || !password} className="mt-1">
              {savingPw ? <Loader2 className="animate-spin" /> : <KeyRound />}
              Change password
            </Button>
          </div>
        </form>
      </Card>

      <Card className="mt-5">
        <CardHeader icon={Database} title="Data & Privacy" subtitle="How long your organization's records are kept" />
        <div className="space-y-5 px-6 py-6 sm:px-7">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-medium text-ink">Automatic data retention</div>
              <p className="mt-1 max-w-md text-sm text-ink-2">
                Patrol logs, their photos and resolved notes older than this are permanently deleted every day.
              </p>
            </div>
            {isAdmin ? (
              <Select
                value={user.retentionDays === null ? "none" : String(user.retentionDays)}
                onValueChange={(v) => void changeRetention(v)}
                disabled={savingRetention}
              >
                <SelectTrigger aria-label="Retention period" className="h-10 w-full border-[#454954] bg-raised text-ink sm:w-52">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-line bg-surface text-ink">
                  {RETENTION_OPTIONS.map((o) => (
                    <SelectItem
                      key={o.label}
                      value={o.value === null ? "none" : String(o.value)}
                      className="focus:bg-ember focus:text-white"
                    >
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <span className="rounded-lg border border-line bg-raised px-3 py-2 text-sm text-ink">
                {retentionLabel(user.retentionDays)}
              </span>
            )}
          </div>
          <div className="rounded-lg border border-line bg-raised/50 p-4 text-sm leading-relaxed text-ink-2">
            Records are stored securely and are only visible to members of {user.orgName}. Offline changes are kept on
            this device only until they upload
            {sync.pendingCount > 0 ? ` (${sync.pendingCount} waiting now)` : ""}. Signing out clears the device copy.
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            <Link to="/privacy" className="focus-ring inline-flex items-center gap-1.5 rounded text-ember hover:underline">
              Privacy Policy <ExternalLink className="h-3.5 w-3.5" />
            </Link>
            <Link to="/terms" className="focus-ring inline-flex items-center gap-1.5 rounded text-ember hover:underline">
              Terms of Service <ExternalLink className="h-3.5 w-3.5" />
            </Link>
            <Link to="/support" className="focus-ring inline-flex items-center gap-1.5 rounded text-ember hover:underline">
              Help &amp; Support <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </Card>

      <Card className="mt-5 border-status-incident/30">
        <CardHeader icon={ShieldAlert} title="Delete Account" subtitle="Permanent — this can't be undone" />
        <div className="space-y-4 px-6 py-6 sm:px-7">
          <div className="flex flex-col gap-3 rounded-lg border border-line p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="max-w-md">
              <div className="text-sm font-medium text-ink">Delete my account</div>
              <p className="mt-1 text-sm text-ink-2">
                Removes your login and profile. Patrol logs you recorded stay with {user.orgName} as business records,
                without a link to your account.
              </p>
            </div>
            <Button variant="destructive-outline" onClick={() => openDelete("self")}>
              <Trash2 />
              Delete my account
            </Button>
          </div>
          {isAdmin && (
            <div className="flex flex-col gap-3 rounded-lg border border-status-incident/30 bg-status-incident/[0.04] p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="max-w-md">
                <div className="text-sm font-medium text-ink">Delete organization</div>
                <p className="mt-1 text-sm text-ink-2">
                  Permanently deletes {user.orgName}, every employee login, all properties, patrol logs, photos and
                  notes.
                </p>
              </div>
              <Button
                className="bg-status-incident text-white hover:bg-status-incident/90"
                onClick={() => openDelete("organization")}
              >
                <Trash2 />
                Delete organization
              </Button>
            </div>
          )}
          <p className="text-xs text-ink-3">
            Deletion happens right away. Questions? Contact{" "}
            <a href={`mailto:${LEGAL.privacyEmail}`} className="text-ember hover:underline">
              {LEGAL.privacyEmail}
            </a>
            .
          </p>
        </div>
      </Card>

      <AlertDialog open={!!deleteScope} onOpenChange={(o) => !o && !deleting && setDeleteScope(null)}>
        <AlertDialogContent className="border-line bg-surface text-ink sm:rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-xl">
              {deleteScope === "organization" ? `Delete ${user.orgName}?` : "Delete your account?"}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-ink-2">
              {deleteScope === "organization"
                ? "Every login, property, patrol log, photo and note in this organization will be permanently erased."
                : "Your login is removed immediately and you'll be signed out. If you're the only member, the organization and all its data are deleted too."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div>
            <FieldLabel htmlFor="confirm-delete">
              Type <span className="font-mono text-status-incident">{requiredText}</span> to confirm
            </FieldLabel>
            <Input
              id="confirm-delete"
              autoFocus
              autoComplete="off"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={deleting}
              className="border-[#454954] bg-transparent text-ink hover:bg-raised hover:text-ink"
            >
              Cancel
            </AlertDialogCancel>
            <Button
              className="bg-status-incident text-white hover:bg-status-incident/90"
              disabled={!canConfirm || deleting}
              onClick={() => void runDelete()}
            >
              {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
              Delete permanently
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Account;
