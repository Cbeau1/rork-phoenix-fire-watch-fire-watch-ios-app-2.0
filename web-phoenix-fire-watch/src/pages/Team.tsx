import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  KeyRound,
  Loader2,
  MoreHorizontal,
  Pencil,
  Shield,
  ShieldOff,
  Trash2,
  UserCheck,
  UserPlus,
  UserX,
  Users,
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { toast } from "sonner";

import { Card, CardHeader, EmptyState, FieldError, FieldHint, FieldLabel, PageHeader } from "@/components/fw/primitives";
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
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { initials, timeAgo } from "@/lib/format";
import { callFunction, friendlyError, supabase } from "@/lib/supabase";
import { ROLE_LABEL, type Member, type Role } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useAuth } from "@/state/AuthProvider";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const generatePassword = (): string => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint32Array(10);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
};

const RolePicker = ({ value, onChange }: { value: Role; onChange: (r: Role) => void }) => (
  <div className="grid grid-cols-2 gap-2" role="radiogroup">
    {(["officer", "admin"] as const).map((r) => (
      <button
        key={r}
        type="button"
        role="radio"
        aria-checked={value === r}
        onClick={() => onChange(r)}
        className={cn(
          "focus-ring rounded-lg border px-3 py-2.5 text-left transition-colors",
          value === r ? "border-ember/60 bg-ember/10" : "border-line bg-raised hover:border-[#6E7686]",
        )}
      >
        <div className={cn("text-sm font-medium", value === r ? "text-ember" : "text-ink")}>{ROLE_LABEL[r]}</div>
        <div className="mt-0.5 text-xs text-ink-3">{r === "admin" ? "Manages team + everything" : "Logs patrols & notes"}</div>
      </button>
    ))}
  </div>
);

const Team = () => {
  useDocumentTitle("Team");
  const { user, isAdmin, renameOrg } = useAuth();
  const queryClient = useQueryClient();
  const orgId = user?.orgId ?? "";
  const membersKey = useMemo(() => ["members", orgId] as const, [orgId]);

  const [addOpen, setAddOpen] = useState<boolean>(false);
  const [fullName, setFullName] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>(generatePassword);
  const [role, setRole] = useState<Role>("officer");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<{ name: string; email: string; password: string } | null>(null);

  const [resetFor, setResetFor] = useState<Member | null>(null);
  const [resetPassword, setResetPassword] = useState<string>("");
  const [removeFor, setRemoveFor] = useState<Member | null>(null);

  const [orgEdit, setOrgEdit] = useState<boolean>(false);
  const [orgDraft, setOrgDraft] = useState<string>(user?.orgName ?? "");

  const membersQuery = useQuery({
    queryKey: membersKey,
    enabled: !!orgId,
    queryFn: async (): Promise<Member[]> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, role, active, created_at")
        .eq("org_id", orgId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data.map((r) => ({
        id: r.id,
        name: r.full_name,
        email: r.email,
        role: r.role === "admin" ? "admin" : "officer",
        active: r.active,
        createdAt: r.created_at,
      }));
    },
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: membersKey });

  const createMutation = useMutation({
    mutationFn: (payload: { fullName: string; email: string; password: string; role: Role }) =>
      callFunction<{ ok: boolean }>("manage-members", { action: "create", ...payload }),
    onSuccess: (_d, vars) => {
      void refresh();
      setCreated({ name: vars.fullName, email: vars.email, password: vars.password });
      setAddOpen(false);
    },
    onError: (err) => toast.error(friendlyError(err)),
  });

  const updateMutation = useMutation({
    mutationFn: (payload: { memberId: string; role?: Role; active?: boolean }) =>
      callFunction<{ ok: boolean }>("manage-members", { action: "update", ...payload }),
    onSuccess: () => {
      void refresh();
      toast.success("Team member updated");
    },
    onError: (err) => toast.error(friendlyError(err)),
  });

  const resetMutation = useMutation({
    mutationFn: (payload: { memberId: string; password: string }) =>
      callFunction<{ ok: boolean }>("manage-members", { action: "reset-password", ...payload }),
    onSuccess: (_d, vars) => {
      const m = resetFor;
      setResetFor(null);
      if (m) setCreated({ name: m.name, email: m.email, password: vars.password });
    },
    onError: (err) => toast.error(friendlyError(err)),
  });

  const removeMutation = useMutation({
    mutationFn: (memberId: string) => callFunction<{ ok: boolean }>("manage-members", { action: "remove", memberId }),
    onSuccess: () => {
      void refresh();
      setRemoveFor(null);
      toast.success("Login removed");
    },
    onError: (err) => toast.error(friendlyError(err)),
  });

  const renameMutation = useMutation({
    mutationFn: (name: string) => renameOrg(name),
    onSuccess: () => {
      setOrgEdit(false);
      toast.success("Organization renamed");
    },
    onError: (err) => toast.error(friendlyError(err)),
  });

  if (!isAdmin) return <Navigate to="/" replace />;

  const members = membersQuery.data ?? [];
  const activeCount = members.filter((m) => m.active).length;

  const openAdd = () => {
    setFullName("");
    setEmail("");
    setPassword(generatePassword());
    setRole("officer");
    setErrors({});
    setAddOpen(true);
  };

  const submitAdd = (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!fullName.trim()) next.fullName = "Name is required";
    if (!EMAIL_RE.test(email.trim())) next.email = "Enter a valid email address";
    if (password.length < 8) next.password = "Use at least 8 characters";
    setErrors(next);
    if (Object.keys(next).length) return;
    createMutation.mutate({ fullName: fullName.trim(), email: email.trim().toLowerCase(), password, role });
  };

  const copyCredentials = async () => {
    if (!created) return;
    const text = `Phoenix Fire Watch login\n${window.location.origin}\nEmail: ${created.email}\nPassword: ${created.password}`;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Login details copied");
    } catch {
      toast.error("Couldn't copy — select the text manually");
    }
  };

  return (
    <>
      <PageHeader
        title="Team"
        subtitle={
          orgEdit ? undefined : (
            <span className="inline-flex items-center gap-2">
              {user?.orgName}
              <button
                type="button"
                onClick={() => {
                  setOrgDraft(user?.orgName ?? "");
                  setOrgEdit(true);
                }}
                aria-label="Rename organization"
                className="focus-ring rounded p-1 text-ink-3 hover:text-ember"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </span>
          )
        }
        actions={
          <Button size="lg" onClick={openAdd}>
            <UserPlus />
            Add Employee
          </Button>
        }
      />

      {orgEdit && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (orgDraft.trim()) renameMutation.mutate(orgDraft.trim());
          }}
          className="-mt-4 mb-6 flex max-w-lg gap-2"
        >
          <Input autoFocus value={orgDraft} onChange={(e) => setOrgDraft(e.target.value)} aria-label="Organization name" />
          <Button type="submit" disabled={!orgDraft.trim() || renameMutation.isPending}>
            {renameMutation.isPending ? <Loader2 className="animate-spin" /> : <Check />}
            Save
          </Button>
          <Button type="button" variant="ghost" onClick={() => setOrgEdit(false)}>
            Cancel
          </Button>
        </form>
      )}

      <Card>
        <CardHeader
          icon={Users}
          title="Employee Logins"
          subtitle={`${activeCount} active ${activeCount === 1 ? "member" : "members"} · everyone here shares your properties, patrols and notes`}
        />
        {membersQuery.isPending ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-ink-3" />
          </div>
        ) : membersQuery.isError ? (
          <EmptyState
            title="Couldn't load your team"
            description={friendlyError(membersQuery.error)}
            action={<Button variant="outline" onClick={() => void membersQuery.refetch()}>Try again</Button>}
          />
        ) : members.length <= 1 ? (
          <>
            <MemberList
              members={members}
              meId={user?.id ?? ""}
              onRole={(m, r) => updateMutation.mutate({ memberId: m.id, role: r })}
              onActive={(m, a) => updateMutation.mutate({ memberId: m.id, active: a })}
              onReset={(m) => {
                setResetPassword(generatePassword());
                setResetFor(m);
              }}
              onRemove={setRemoveFor}
            />
            <EmptyState
              icon={UserPlus}
              title="Add your first officer"
              description="Create a login for each fire watch officer. They'll sign in with the email and password you set."
              action={
                <Button onClick={openAdd}>
                  <UserPlus />
                  Add Employee
                </Button>
              }
            />
          </>
        ) : (
          <MemberList
            members={members}
            meId={user?.id ?? ""}
            onRole={(m, r) => updateMutation.mutate({ memberId: m.id, role: r })}
            onActive={(m, a) => updateMutation.mutate({ memberId: m.id, active: a })}
            onReset={(m) => {
              setResetPassword(generatePassword());
              setResetFor(m);
            }}
            onRemove={setRemoveFor}
          />
        )}
      </Card>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="border-line bg-surface text-ink sm:max-w-lg sm:rounded-xl">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">Add Employee</DialogTitle>
            <DialogDescription className="text-ink-2">
              Creates a login inside {user?.orgName}. Share the password with them securely.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitAdd} noValidate className="space-y-5">
            <div>
              <FieldLabel htmlFor="m-name" required>
                Full name
              </FieldLabel>
              <Input id="m-name" autoFocus value={fullName} aria-invalid={!!errors.fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g., Jonaven Viera" />
              <FieldError message={errors.fullName} />
            </div>
            <div>
              <FieldLabel htmlFor="m-email" required>
                Email (their username)
              </FieldLabel>
              <Input id="m-email" type="email" value={email} aria-invalid={!!errors.email} onChange={(e) => setEmail(e.target.value)} placeholder="officer@company.com" />
              <FieldError message={errors.email} />
            </div>
            <div>
              <FieldLabel htmlFor="m-password" required>
                Temporary password
              </FieldLabel>
              <div className="flex gap-2">
                <Input id="m-password" value={password} aria-invalid={!!errors.password} onChange={(e) => setPassword(e.target.value)} className="font-mono" />
                <Button type="button" variant="outline" onClick={() => setPassword(generatePassword())}>
                  Generate
                </Button>
              </div>
              {errors.password ? <FieldError message={errors.password} /> : <FieldHint>They can change it after signing in.</FieldHint>}
            </div>
            <div>
              <div className="mb-2 text-sm font-medium text-ink">Role</div>
              <RolePicker value={role} onChange={setRole} />
            </div>
            <div className="flex justify-end gap-3 pt-1">
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? <Loader2 className="animate-spin" /> : <UserPlus />}
                Create Login
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!created} onOpenChange={(o) => !o && setCreated(null)}>
        <DialogContent className="border-line bg-surface text-ink sm:max-w-md sm:rounded-xl">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">Login ready</DialogTitle>
            <DialogDescription className="text-ink-2">
              Share these details with {created?.name}. The password won't be shown again.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 rounded-lg border border-line bg-raised p-4 font-mono text-sm">
            <div>
              <div className="font-sans text-xs uppercase tracking-[0.14em] text-ink-3">Email</div>
              <div className="mt-1 select-all break-all text-ink">{created?.email}</div>
            </div>
            <div>
              <div className="font-sans text-xs uppercase tracking-[0.14em] text-ink-3">Password</div>
              <div className="mt-1 select-all text-ember">{created?.password}</div>
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => void copyCredentials()}>
              Copy details
            </Button>
            <Button onClick={() => setCreated(null)}>Done</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!resetFor} onOpenChange={(o) => !o && setResetFor(null)}>
        <DialogContent className="border-line bg-surface text-ink sm:max-w-md sm:rounded-xl">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">Reset password</DialogTitle>
            <DialogDescription className="text-ink-2">Set a new password for {resetFor?.name}.</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (resetFor && resetPassword.length >= 8) resetMutation.mutate({ memberId: resetFor.id, password: resetPassword });
            }}
            className="space-y-5"
          >
            <div className="flex gap-2">
              <Input value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} className="font-mono" aria-label="New password" />
              <Button type="button" variant="outline" onClick={() => setResetPassword(generatePassword())}>
                Generate
              </Button>
            </div>
            {resetPassword.length > 0 && resetPassword.length < 8 && <FieldError message="Use at least 8 characters" />}
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={() => setResetFor(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={resetPassword.length < 8 || resetMutation.isPending}>
                {resetMutation.isPending ? <Loader2 className="animate-spin" /> : <KeyRound />}
                Set Password
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!removeFor} onOpenChange={(o) => !o && setRemoveFor(null)}>
        <AlertDialogContent className="border-line bg-surface text-ink sm:rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-xl">Remove {removeFor?.name}?</AlertDialogTitle>
            <AlertDialogDescription className="text-ink-2">
              Their login will be deleted permanently. Patrols they logged stay in your records. To temporarily block
              access instead, use Deactivate.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-[#6E7686] bg-transparent text-ink hover:bg-raised hover:text-ink">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-status-incident text-white hover:bg-status-incident/90"
              onClick={(e) => {
                e.preventDefault();
                if (removeFor) removeMutation.mutate(removeFor.id);
              }}
            >
              {removeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Remove Login"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

const MemberList = ({
  members,
  meId,
  onRole,
  onActive,
  onReset,
  onRemove,
}: {
  members: Member[];
  meId: string;
  onRole: (m: Member, r: Role) => void;
  onActive: (m: Member, active: boolean) => void;
  onReset: (m: Member) => void;
  onRemove: (m: Member) => void;
}) => (
  <ul className="mt-5 divide-y divide-line border-t border-line">
    {members.map((m) => {
      const isMe = m.id === meId;
      return (
        <li key={m.id} className={cn("flex items-center gap-4 px-6 py-4 sm:px-7", !m.active && "opacity-55")}>
          <div
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold ring-1",
              m.role === "admin" ? "bg-ember/10 text-ember ring-ember/30" : "bg-raised text-silver ring-line",
            )}
          >
            {initials(m.name)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="truncate text-[15px] font-medium text-ink">{m.name}</span>
              {isMe && <span className="text-xs text-ink-3">(you)</span>}
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
                  m.role === "admin" ? "bg-ember/10 text-ember ring-ember/30" : "bg-raised text-ink-2 ring-line",
                )}
              >
                {ROLE_LABEL[m.role]}
              </span>
              {!m.active && (
                <span className="rounded-full bg-status-incident/10 px-2 py-0.5 text-[11px] font-medium text-status-incident ring-1 ring-inset ring-status-incident/30">
                  Deactivated
                </span>
              )}
            </div>
            <div className="mt-0.5 truncate text-sm text-ink-2">{m.email}</div>
          </div>
          <span className="hidden shrink-0 text-xs text-ink-3 md:block">Added {timeAgo(m.createdAt)}</span>
          {!isMe && (
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={`Manage ${m.name}`}
                className="focus-ring flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-3 hover:bg-raised hover:text-ink"
              >
                <MoreHorizontal className="h-5 w-5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52 border-line bg-surface text-ink">
                <DropdownMenuItem onClick={() => onReset(m)} className="gap-2 focus:bg-raised focus:text-ink">
                  <KeyRound className="h-4 w-4" /> Reset password
                </DropdownMenuItem>
                {m.role === "officer" ? (
                  <DropdownMenuItem onClick={() => onRole(m, "admin")} className="gap-2 focus:bg-raised focus:text-ink">
                    <Shield className="h-4 w-4" /> Make admin
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={() => onRole(m, "officer")} className="gap-2 focus:bg-raised focus:text-ink">
                    <ShieldOff className="h-4 w-4" /> Make officer
                  </DropdownMenuItem>
                )}
                {m.active ? (
                  <DropdownMenuItem onClick={() => onActive(m, false)} className="gap-2 focus:bg-raised focus:text-ink">
                    <UserX className="h-4 w-4" /> Deactivate
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={() => onActive(m, true)} className="gap-2 focus:bg-raised focus:text-ink">
                    <UserCheck className="h-4 w-4" /> Reactivate
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator className="bg-line" />
                <DropdownMenuItem
                  onClick={() => onRemove(m)}
                  className="gap-2 text-status-incident focus:bg-status-incident/10 focus:text-status-incident"
                >
                  <Trash2 className="h-4 w-4" /> Remove login
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </li>
      );
    })}
  </ul>
);

export default Team;
