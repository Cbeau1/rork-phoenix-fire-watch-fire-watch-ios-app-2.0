import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Briefcase,
  Check,
  Clock,
  DollarSign,
  KeyRound,
  Star,
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
import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { toast } from "sonner";

import { EditMemberDialog } from "@/components/fw/EditMemberDialog";
import { generatePassword, LoginReadyDialog } from "@/components/fw/TeamLogin";
import { AddToTeamDialog } from "@/components/workforce/AddToTeamDialog";
import { WorkerFormDialog, type NewLoginState } from "@/components/workforce/WorkerFormDialog";
import { Card, CardHeader, EmptyState, FieldError, PageHeader } from "@/components/fw/primitives";
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
import { refreshPeople } from "@/lib/people";
import { loadWorkerTypes, personType, type PersonType, type WorkerTypeIndex } from "@/lib/payrollGroups";
import { linkTeamMember, loadTeamLinks, type TeamLink } from "@/lib/workforce/api";
import { fullName as workerName, WORKER_STATUS, type Worker } from "@/lib/workforce/constants";
import { callFunction, friendlyError, supabase } from "@/lib/supabase";
import { loadPayRates, rateKey, rateOn, type RateRow } from "@/lib/timeclock";
import { ROLE_LABEL, type Member, type Role } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useAuth } from "@/state/AuthProvider";

const Team = () => {
  useDocumentTitle("Team");
  const { user, isAdmin, renameOrg } = useAuth();
  const queryClient = useQueryClient();
  const orgId = user?.orgId ?? "";
  const membersKey = useMemo(() => ["members", orgId] as const, [orgId]);

  const [addOpen, setAddOpen] = useState<boolean>(false);
  const [editWorker, setEditWorker] = useState<Worker | null>(null);
  const [created, setCreated] = useState<{ name: string; email: string; password: string } | null>(null);

  const [resetFor, setResetFor] = useState<Member | null>(null);
  const [resetPassword, setResetPassword] = useState<string>("");
  const [removeFor, setRemoveFor] = useState<Member | null>(null);
  const [editFor, setEditFor] = useState<Member | null>(null);
  const [loginFor, setLoginFor] = useState<Worker | null>(null);

  const [orgEdit, setOrgEdit] = useState<boolean>(false);
  const [orgDraft, setOrgDraft] = useState<string>(user?.orgName ?? "");

  const membersQuery = useQuery({
    queryKey: membersKey,
    enabled: !!orgId,
    queryFn: async (): Promise<Member[]> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, role, active, created_at, field_guide_acknowledged_at")
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
        guideAcknowledgedAt: r.field_guide_acknowledged_at,
      }));
    },
  });

  const linksQuery = useQuery({
    queryKey: ["wf", "team-links", orgId],
    enabled: !!orgId && isAdmin,
    queryFn: loadTeamLinks,
  });
  const links = useMemo(() => {
    const map = new Map<string, TeamLink>();
    for (const l of linksQuery.data ?? []) map.set(l.profileId, l);
    return map;
  }, [linksQuery.data]);
  const canLink = !!linksQuery.data;

  // Workforce employees who don't have an app login yet still belong on the Team page.
  const noLoginQuery = useQuery({
    queryKey: ["wf", "no-login", orgId],
    enabled: !!orgId && isAdmin,
    queryFn: async (): Promise<Worker[]> => {
      const { data, error } = await supabase
        .from("wf_workers")
        .select("*")
        .eq("org_id", orgId)
        .is("profile_id", null)
        .is("archived_at", null)
        .order("first_name")
        .order("last_name");
      if (error) throw error;
      return data;
    },
  });
  const noLogin = noLoginQuery.data ?? [];

  const ratesQuery = useQuery({
    queryKey: ["tc", "rates", orgId],
    enabled: !!orgId && isAdmin,
    staleTime: 60_000,
    queryFn: loadPayRates,
  });
  const rates = ratesQuery.data ?? new Map<string, RateRow[]>();

  // Direct vs. temp agency, so every row can show who they work for.
  const typesQuery = useQuery({
    queryKey: ["wf", "pay-types", orgId],
    enabled: !!orgId && isAdmin,
    staleTime: 60_000,
    queryFn: loadWorkerTypes,
  });
  const types = typesQuery.data;

  // Timesheets waiting on the admin's approval — the daily routine starts here.
  const pendingQuery = useQuery({
    queryKey: ["tc", "pending-card", orgId],
    enabled: !!orgId && isAdmin,
    staleTime: 30_000,
    queryFn: async (): Promise<{ count: number; minutes: number }> => {
      const { data, error } = await supabase.from("time_entries").select("clock_in, clock_out").eq("status", "pending");
      if (error) throw error;
      let minutes = 0;
      for (const r of data ?? []) {
        const a = new Date(r.clock_in).getTime();
        const b = r.clock_out ? new Date(r.clock_out).getTime() : NaN;
        if (!Number.isNaN(a) && !Number.isNaN(b)) minutes += Math.max(0, (b - a) / 60_000);
      }
      return { count: (data ?? []).length, minutes };
    },
  });
  const pending = pendingQuery.data ?? { count: 0, minutes: 0 };

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: membersKey }),
      queryClient.invalidateQueries({ queryKey: ["wf"] }),
    ]);

  const linkMutation = useMutation({
    mutationFn: (m: Member) => linkTeamMember(m.id),
    onSuccess: (_d, m) => {
      void refresh();
      toast.success(`${m.name} added to Workforce`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : friendlyError(err)),
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
  const totalPeople = members.length + noLogin.length;

  const openAdd = () => setAddOpen(true);

  /** A person saved from the Team page stays here — logins surface in the existing dialog. */
  const onPersonSaved = ({ state }: { w: Worker; state: NewLoginState }) => {
    refreshPeople(queryClient);
    void refresh();
    if (state.newLogin) setCreated(state.newLogin);
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
                className="focus-ring rounded p-1 text-ink-3 hover:text-link"
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

      {isAdmin && <ApprovalCard count={pending.count} minutes={pending.minutes} pending={pendingQuery.isPending} />}

      <Card>
        <CardHeader
          icon={Users}
          title="Employee Logins"
          subtitle={`${totalPeople} ${totalPeople === 1 ? "employee" : "employees"} · ${activeCount} with an active app login`}
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
              links={links}
              rates={rates}
              types={types}
              canLink={canLink}
              onEdit={setEditFor}
              onLink={(m) => linkMutation.mutate(m)}
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
            links={links}
            rates={rates}
            types={types}
            canLink={canLink}
            onEdit={setEditFor}
            onLink={(m) => linkMutation.mutate(m)}
            onRole={(m, r) => updateMutation.mutate({ memberId: m.id, role: r })}
            onActive={(m, a) => updateMutation.mutate({ memberId: m.id, active: a })}
            onReset={(m) => {
              setResetPassword(generatePassword());
              setResetFor(m);
            }}
            onRemove={setRemoveFor}
          />
        )}
        {noLogin.length > 0 && (
          <div className="border-t border-line p-3 sm:p-4">
            <div className="mb-3 px-1">
              <h3 className="text-sm font-semibold text-ink">No app login yet</h3>
              <p className="text-xs text-ink-3">
                On your Workforce roster and Schedule. Create a login so they can clock in from the app.
              </p>
            </div>
            <ul className="space-y-2.5">
              {noLogin.map((w) => (
                <NoLoginRow
                  key={w.id}
                  worker={w}
                  rate={rateOn(rates.get(rateKey(null, workerName(w))), new Date().toLocaleDateString("en-CA"))}
                  type={personType(types, { profileId: null, name: workerName(w) })}
                  onCreate={() => setLoginFor(w)}
                  onEdit={() => setEditWorker(w)}
                />
              ))}
            </ul>
          </div>
        )}
      </Card>

      {loginFor && (
        <AddToTeamDialog
          worker={loginFor}
          takenEmails={members.map((m) => m.email)}
          open={!!loginFor}
          onOpenChange={(o) => !o && setLoginFor(null)}
          onCreated={(c) => {
            setLoginFor(null);
            setCreated(c);
            void refresh();
          }}
        />
      )}

      <WorkerFormDialog open={addOpen} onOpenChange={setAddOpen} defaultSource="direct" onCreated={onPersonSaved} />

      {editWorker && (
        <WorkerFormDialog open worker={editWorker} onOpenChange={(o) => !o && setEditWorker(null)} onCreated={onPersonSaved} />
      )}

      <LoginReadyDialog credentials={created} onClose={() => setCreated(null)} />

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

      <EditMemberDialog
        member={editFor}
        isMe={editFor?.id === user?.id}
        workerId={editFor ? (links.get(editFor.id)?.workerId ?? null) : null}
        onClose={() => setEditFor(null)}
      />

      <AlertDialog open={!!removeFor} onOpenChange={(o) => !o && setRemoveFor(null)}>
        <AlertDialogContent className="border-line bg-surface text-ink sm:rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-xl">Remove {removeFor?.name}?</AlertDialogTitle>
            <AlertDialogDescription className="text-ink-2">
              Their login will be deleted permanently. Patrols they logged and their Workforce profile stay in your
              records. To temporarily block access instead, use Deactivate.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-line-strong bg-transparent text-ink hover:bg-raised hover:text-ink">Cancel</AlertDialogCancel>
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

const TypePill = ({ type }: { type: PersonType }) =>
  type.group === "agency" ? (
    <span className="rounded-full bg-status-follow/10 px-2 py-0.5 text-[11px] font-medium text-status-follow ring-1 ring-inset ring-status-follow/30">
      {type.agency ? `Temp agency · ${type.agency}` : "Temp agency"}
    </span>
  ) : (
    <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-ink-2 ring-1 ring-inset ring-line">Direct</span>
  );

const ApprovalCard = ({ count, minutes, pending }: { count: number; minutes: number; pending: boolean }) => (
  <Card
    className={cn(
      "mb-5 flex flex-wrap items-center gap-x-5 gap-y-3 border-l-4 px-4 py-3.5 sm:px-5",
      count > 0 ? "border-status-follow bg-status-follow/[0.06]" : "border-status-clear/60",
    )}
  >
    <div
      className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-full ring-1",
        count > 0 ? "bg-status-follow/10 text-status-follow ring-status-follow/30" : "bg-status-clear/10 text-status-clear ring-status-clear/30",
      )}
      aria-hidden
    >
      <Clock className="h-5 w-5" />
    </div>
    <div className="min-w-0 flex-1">
      <div className="text-sm font-semibold text-ink">Timesheets to approve</div>
      <div className="text-xs text-ink-2" role="status">
        {pending
          ? "Checking…"
          : count > 0
            ? `${count} ${count === 1 ? "entry" : "entries"}${minutes >= 1 ? ` · ${(minutes / 60).toFixed(2)} hrs` : ""} waiting for your approval`
            : "All caught up — nothing is waiting on you."}
      </div>
    </div>
    <Button asChild variant={count > 0 ? "default" : "outline"} size="sm" className="shrink-0">
      <Link to="/payroll">Review in Payroll</Link>
    </Button>
  </Card>
);

const NoLoginRow = ({ worker, rate, type, onCreate, onEdit }: { worker: Worker; rate: number | null; type: PersonType; onCreate: () => void; onEdit: () => void }) => {
  const name = workerName(worker);
  const status = WORKER_STATUS[worker.status]?.label ?? worker.status;
  return (
    <li className="flex items-center gap-4 rounded-lg border border-dashed border-line-strong bg-raised/50 px-4 py-3.5 sm:px-5">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface text-sm font-semibold text-ink-3 ring-1 ring-line">
        {initials(name)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-[15px] font-medium text-ink">{name}</span>
          <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-ink-2 ring-1 ring-inset ring-line">
            {worker.position || "Fire Watch Officer"}
          </span>
          <span className="rounded-full bg-status-follow/10 px-2 py-0.5 text-[11px] font-medium text-status-follow ring-1 ring-inset ring-status-follow/30">
            No login
          </span>
          <TypePill type={type} />
          {rate !== null && (
            <span className="rounded-full bg-status-clear/10 px-2 py-0.5 font-mono text-[11px] font-medium tabular-nums text-status-clear ring-1 ring-inset ring-status-clear/30">
              ${rate.toFixed(2)}/hr
            </span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-2">
          <span className="truncate">{worker.email || `${worker.source === "agency" ? "Agency" : "Direct"} · ${status}`}</span>
          <Link
            to={`/workforce/workers/${worker.id}`}
            className="focus-ring inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-ink-2 ring-1 ring-inset ring-line hover:text-link hover:ring-link/40"
          >
            <Briefcase className="h-3 w-3" />
            {worker.worker_code}
          </Link>
        </div>
      </div>
      <Button asChild variant="outline" size="sm" className="shrink-0">
        <Link to={`/workforce/workers/${worker.id}?tab=employment`} aria-label={`Pay rate for ${name}`}>
          <DollarSign />
          <span className="hidden sm:inline">{rate === null ? "Set pay" : "Pay"}</span>
        </Link>
      </Button>
      <Button variant="outline" size="sm" onClick={onEdit} aria-label={`Edit ${name}`} className="shrink-0">
        <Pencil />
        <span className="hidden sm:inline">Edit</span>
      </Button>
      <Button size="sm" onClick={onCreate} aria-label={`Create login for ${name}`} className="shrink-0">
        <KeyRound />
        <span className="hidden sm:inline">Create login</span>
      </Button>
    </li>
  );
};

const MemberList = ({
  members,
  meId,
  links,
  rates,
  types,
  canLink,
  onEdit,
  onLink,
  onRole,
  onActive,
  onReset,
  onRemove,
}: {
  members: Member[];
  meId: string;
  links: Map<string, TeamLink>;
  rates: Map<string, RateRow[]>;
  types: WorkerTypeIndex | undefined;
  canLink: boolean;
  onEdit: (m: Member) => void;
  onLink: (m: Member) => void;
  onRole: (m: Member, r: Role) => void;
  onActive: (m: Member, active: boolean) => void;
  onReset: (m: Member) => void;
  onRemove: (m: Member) => void;
}) => (
  <ul className="mt-5 space-y-2.5 border-t border-line p-3 sm:p-4">
    {members.map((m) => {
      const today = new Date().toLocaleDateString("en-CA");
      const isMe = m.id === meId;
      const link = links.get(m.id);
      const rate = rateOn(rates.get(m.id), today);
      const type = personType(types, { profileId: m.id, name: m.name });
      return (
        <li key={m.id} className={cn("flex items-center gap-4 rounded-lg border border-line bg-raised px-4 py-3.5 sm:px-5", !m.active && "opacity-55")}>
          <div
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold ring-1",
              m.role === "admin" ? "bg-primary/10 text-link ring-link/30" : "bg-surface text-silver ring-line",
            )}
          >
            {initials(m.name)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="truncate text-[15px] font-medium text-ink">{m.name}</span>
              {isMe && <span className="text-xs text-ink-3">(you)</span>}
              <TypePill type={type} />
              {m.guideAcknowledgedAt && (
                <span
                  title={`Field guide acknowledged ${new Date(m.guideAcknowledgedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`}
                  className="focus-ring inline-flex cursor-help items-center"
                  aria-label="Field guide acknowledged"
                >
                  <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                </span>
              )}
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
                  m.role === "admin" ? "bg-primary/10 text-link ring-link/30" : "bg-surface text-ink-2 ring-line",
                )}
              >
                {ROLE_LABEL[m.role]}
              </span>
              {rate !== null && (
                <span className="rounded-full bg-status-clear/10 px-2 py-0.5 font-mono text-[11px] font-medium tabular-nums text-status-clear ring-1 ring-inset ring-status-clear/30">
                  ${rate.toFixed(2)}/hr
                </span>
              )}
              {!m.active && (
                <span className="rounded-full bg-status-incident/10 px-2 py-0.5 text-[11px] font-medium text-status-incident-ink ring-1 ring-inset ring-status-incident/30">
                  Deactivated
                </span>
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-2">
              <span className="truncate">{m.email}</span>
              {link ? (
                <Link
                  to={`/workforce/workers/${link.workerId}`}
                  className="focus-ring inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-ink-2 ring-1 ring-inset ring-line hover:text-link hover:ring-link/40"
                >
                  <Briefcase className="h-3 w-3" />
                  {link.code}
                </Link>
              ) : canLink ? (
                <button
                  type="button"
                  onClick={() => onLink(m)}
                  className="focus-ring inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium text-status-followup ring-1 ring-inset ring-status-followup/40 hover:bg-status-followup/10"
                >
                  <Briefcase className="h-3 w-3" />
                  Add to Workforce
                </button>
              ) : null}
            </div>
          </div>
          <span className="hidden shrink-0 text-xs text-ink-3 md:block">Added {timeAgo(m.createdAt)}</span>
          {link ? (
            <Button asChild variant="outline" size="sm" className="shrink-0">
              <Link to={`/workforce/workers/${link.workerId}?tab=employment`} aria-label={`Pay rate for ${m.name}`}>
                <DollarSign />
                <span className="hidden sm:inline">{rate === null ? "Set pay" : "Pay"}</span>
              </Link>
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => onEdit(m)} aria-label={`Edit ${m.name}`} className="shrink-0">
            <Pencil />
            <span className="hidden sm:inline">Edit</span>
          </Button>
          {!isMe && (
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={`Manage ${m.name}`}
                className="focus-ring flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-3 hover:bg-surface hover:text-ink"
              >
                <MoreHorizontal className="h-5 w-5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52 border-line bg-surface text-ink">
                <DropdownMenuItem onClick={() => onEdit(m)} className="gap-2 focus:bg-raised focus:text-ink">
                  <Pencil className="h-4 w-4" /> Edit profile & pay
                </DropdownMenuItem>
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
                  className="gap-2 text-status-incident-ink focus:bg-status-incident/10 focus:text-status-incident-ink"
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
