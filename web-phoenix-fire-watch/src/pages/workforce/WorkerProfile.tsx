import { useMutation } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Camera, ChevronDown, FileDown, FileText, History, Loader2, Pencil, ShieldAlert, Trash2, UserPlus, Users, Wrench, Activity, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { PageHeader } from "@/components/fw/primitives";
import { LoginReadyDialog, type LoginCredentials } from "@/components/fw/TeamLogin";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { DocumentsPanel } from "@/components/workforce/DocumentsPanel";
import { ConfirmDialog, MetaPill, Pill } from "@/components/workforce/kit";
import { PlacementsTab } from "@/components/workforce/placements";
import { ActivityTab } from "@/components/workforce/profile/ActivityTab";
import { EmploymentTab, PayRatesCard } from "@/components/workforce/profile/EmploymentTab";
import { EquipmentTab } from "@/components/workforce/profile/EquipmentTab";
import { OverviewTab } from "@/components/workforce/profile/OverviewTab";
import { PersonnelTab } from "@/components/workforce/profile/PersonnelTab";
import { WorkHistoryTab } from "@/components/workforce/profile/WorkHistoryTab";
import { WorkerTimeTicketsPanel } from "@/components/workforce/TimeTickets";
import { WorkerSummaryDialog } from "@/components/workforce/WorkerSummaryDialog";
import { useWorkerPhotos, WorkerAvatar } from "@/components/workforce/WorkerAvatar";
import { AddToTeamDialog } from "@/components/workforce/AddToTeamDialog";
import { WorkerFormDialog, type NewLoginState } from "@/components/workforce/WorkerFormDialog";
import * as api from "@/lib/workforce/api";
import { fullName, SOURCE_LABEL, WORKER_STATUS, type WorkerSource } from "@/lib/workforce/constants";
import { hasOpenPlacement } from "@/lib/workforce/derive";
import { cn } from "@/lib/utils";
import NotFound from "@/pages/NotFound";
import { useAuth } from "@/state/AuthProvider";
import { useWorkforce } from "@/state/WorkforceProvider";

const WorkerProfile = () => {
  const { id = "" } = useParams();
  const wf = useWorkforce();
  const navigate = useNavigate();
  const location = useLocation();
  const { isAdmin } = useAuth();
  const [params, setParams] = useSearchParams();
  const [teamOpen, setTeamOpen] = useState<boolean>(false);
  const [credentials, setCredentials] = useState<LoginCredentials | null>(null);
  const worker = wf.workerById.get(id);
  const [editOpen, setEditOpen] = useState<boolean>(false);
  const [archiveOpen, setArchiveOpen] = useState<boolean>(false);
  const [purgeOpen, setPurgeOpen] = useState<boolean>(false);
  const [purgeText, setPurgeText] = useState<string>("");
  const [summaryOpen, setSummaryOpen] = useState<boolean>(false);
  const photoRef = useRef<HTMLInputElement>(null);
  const photos = useWorkerPhotos(worker ? [worker] : []);

  // One-time login details from "Add worker" (also added to Team); cleared from history so they don't reappear.
  useEffect(() => {
    const st = location.state as NewLoginState | null;
    if (!st?.newLogin) return;
    setCredentials(st.newLogin);
    navigate(location.pathname + location.search, { replace: true, state: null });
  }, [location.state]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (worker) void api.logEvent("view", "wf_workers", "Viewed worker profile", { entityId: worker.id, workerId: worker.id }).catch(() => undefined);
  }, [worker?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const archive = useMutation({
    mutationFn: () =>
      api.updateWorker(
        id,
        worker?.archived_at ? { archived_at: null, archived_by: null } : { archived_at: new Date().toISOString(), archived_by: wf.user?.id ?? null },
      ),
    onSuccess: (w) => {
      wf.invalidate("workers");
      setArchiveOpen(false);
      toast.success(w.archived_at ? "Profile archived — history preserved" : "Profile restored");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't update."),
  });
  const purge = useMutation({
    mutationFn: () => api.purgeWorker(id, purgeText.trim()),
    onSuccess: () => {
      wf.invalidate("workers", "documents", "versions", "placements", "checklist", "equipment");
      toast.success("Profile permanently deleted");
      navigate("/workforce/directory");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't delete."),
  });
  const photo = useMutation({
    mutationFn: (f: File) => api.uploadWorkerPhoto(id, f),
    onSuccess: () => {
      wf.invalidate("workers", "photos");
      toast.success("Photo updated");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Upload failed."),
  });

  if (!worker) return <NotFound embedded />;
  const isAgency = worker.source === "agency";
  // Temp agency workers get a short profile: everything record-keeping lives under “More”.
  const recordTabs: { id: string; label: string; icon: LucideIcon }[] = [
    { id: "documents", label: "Documents", icon: FileText },
    { id: "history", label: "Work History", icon: History },
    { id: "personnel", label: "Personnel Records", icon: ShieldAlert },
    { id: "equipment", label: "Equipment", icon: Wrench },
    { id: "activity", label: "Activity", icon: Activity },
  ];
  const tabs = isAgency
    ? [
        { id: "overview", label: "Overview" },
        { id: "tickets", label: "Time tickets" },
        { id: "employment", label: "Pay & placement" },
      ]
    : [
        { id: "overview", label: "Overview" },
        { id: "documents", label: "Documents" },
        { id: "tickets", label: "Time tickets" },
        { id: "employment", label: "Employment" },
        ...recordTabs.filter((t) => t.id !== "documents").map((t) => ({ id: t.id, label: t.label })),
      ];
  const allTabIds = [...tabs.map((t) => t.id), ...recordTabs.map((t) => t.id)];
  const tab = allTabIds.includes(params.get("tab") ?? "") ? (params.get("tab") as string) : "overview";
  const inMore = isAgency && recordTabs.some((t) => t.id === tab);
  const name = fullName(worker);

  return (
    <div>
      <PageHeader
        backTo="/workforce/directory"
        backLabel="Workforce directory"
        title={
          <span className="flex items-center gap-4">
            <span className="relative">
              <WorkerAvatar name={name} url={photos[worker.id]} size="lg" />
              <button
                type="button"
                onClick={() => photoRef.current?.click()}
                aria-label="Change profile photo"
                className="focus-ring absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-white ring-2 ring-canvas"
              >
                {photo.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
              </button>
              <input
                ref={photoRef}
                type="file"
                accept="image/jpeg,image/png"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  const bad = api.checkFile(f);
                  if (bad || f.type === "application/pdf") toast.error(bad ?? "Profile photos must be JPG or PNG.");
                  else photo.mutate(f);
                }}
              />
            </span>
            <span className="min-w-0">
              <span className="block truncate">{name}</span>
            </span>
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm">{worker.worker_code}</span>
            <Pill tone={isAgency ? "blue" : "slate"}>{SOURCE_LABEL[worker.source as WorkerSource]}</Pill>
            <MetaPill meta={WORKER_STATUS} value={worker.status} />
            {worker.archived_at && <Pill tone="slate">Archived</Pill>}
            {isAgency && worker.agency_id && <span className="text-sm">{wf.agencyById.get(worker.agency_id)?.name}</span>}
            {worker.profile_id && (
              <Link
                to="/team"
                className="focus-ring inline-flex items-center gap-1 rounded-full bg-surface px-2.5 py-0.5 text-xs font-medium text-ink-2 ring-1 ring-inset ring-line hover:text-link hover:ring-link/40"
              >
                <Users className="h-3 w-3" />
                On Team
              </Link>
            )}
          </span>
        }
        actions={
          <>
            {!worker.profile_id && !worker.archived_at && isAdmin && (
              <Button onClick={() => setTeamOpen(true)}>
                <UserPlus />
                Add to Team
              </Button>
            )}
            <Button variant="outline" onClick={() => setSummaryOpen(true)}>
              <FileDown />
              Summary PDF
            </Button>
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil />
              Edit
            </Button>
            <Button variant="ghost" onClick={() => (worker.archived_at ? archive.mutate() : setArchiveOpen(true))}>
              {worker.archived_at ? <ArchiveRestore /> : <Archive />}
              {worker.archived_at ? "Restore" : "Archive"}
            </Button>
            {worker.archived_at && wf.perms.purge && (
              <Button variant="destructive-outline" onClick={() => setPurgeOpen(true)}>
                <Trash2 />
                Delete
              </Button>
            )}
          </>
        }
      />

      <div className="-mx-4 mb-5 overflow-x-auto px-4 sm:mx-0 sm:px-0" role="tablist" aria-label="Worker profile sections">
        <div className="flex w-max gap-1 border-b border-line">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setParams({ tab: t.id }, { replace: true })}
              className={cn(
                "focus-ring -mb-px whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors",
                tab === t.id ? "border-primary text-link" : "border-transparent text-ink-2 hover:text-ink",
              )}
            >
              {t.label}
            </button>
          ))}
          {isAgency && (
            <DropdownMenu>
              <DropdownMenuTrigger
                role="tab"
                aria-label="More record sections"
                aria-selected={inMore}
                className={cn(
                  "focus-ring -mb-px flex items-center gap-1 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors",
                  inMore ? "border-primary text-link" : "border-transparent text-ink-2 hover:text-ink",
                )}
              >
                More
                <ChevronDown className="h-4 w-4" aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="border-line bg-surface text-ink">
                {recordTabs.map((t) => (
                  <DropdownMenuItem
                    key={t.id}
                    onClick={() => setParams({ tab: t.id }, { replace: true })}
                    className={cn("gap-2 focus:bg-raised focus:text-ink", tab === t.id && "bg-raised text-link")}
                  >
                    <t.icon className="h-4 w-4" aria-hidden />
                    {t.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <div role="tabpanel">
        {tab === "overview" && <OverviewTab worker={worker} />}
        {tab === "tickets" && <WorkerTimeTicketsPanel worker={worker} name={name} />}
        {tab === "documents" && (
          <DocumentsPanel ownerType="worker" ownerId={worker.id} source={worker.source} filter={(d) => d.worker_id === worker.id && d.owner_type === "worker"} />
        )}
        {tab === "employment" && (isAgency ? (
            <div className="space-y-5">
              <PayRatesCard worker={worker} />
              <PlacementsTab workerId={worker.id} />
            </div>
          ) : (
            <EmploymentTab worker={worker} />
          ))}
        {tab === "history" && <WorkHistoryTab worker={worker} />}
        {tab === "personnel" && <PersonnelTab worker={worker} />}
        {tab === "equipment" && <EquipmentTab worker={worker} />}
        {tab === "activity" && <ActivityTab workerId={worker.id} />}
      </div>

      <WorkerFormDialog open={editOpen} onOpenChange={setEditOpen} worker={worker} />
      <AddToTeamDialog
        worker={worker}
        takenEmails={wf.members.map((m) => m.email)}
        open={teamOpen}
        onOpenChange={setTeamOpen}
        onCreated={(c) => {
          setCredentials(c);
          toast.success(`${c.name} added to Team`);
        }}
      />
      <LoginReadyDialog credentials={credentials} onClose={() => setCredentials(null)} />
      <WorkerSummaryDialog open={summaryOpen} onOpenChange={setSummaryOpen} worker={worker} />
      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title="Archive this profile?"
        description={
          <>
            Archiving removes the profile from the active directory. All shifts, reports, documents, placements and personnel records are kept and
            can be restored.
            {isAgency && hasOpenPlacement(worker.id, wf.placements) && " This worker still has an open placement — end it first if the assignment is over."}
          </>
        }
        confirmLabel="Archive"
        busy={archive.isPending}
        onConfirm={() => archive.mutate()}
      />
      <ConfirmDialog
        open={purgeOpen}
        onOpenChange={(o) => {
          setPurgeOpen(o);
          setPurgeText("");
        }}
        title="Permanently delete profile?"
        description={`This permanently deletes ${name}'s profile, documents, placements, personnel records and files. Shifts and patrol reports in the main app are not affected. This cannot be undone.`}
        confirmLabel="Delete permanently"
        destructive
        busy={purge.isPending}
        disabled={purgeText.trim() !== worker.worker_code}
        onConfirm={() => purge.mutate()}
      >
        <div>
          <label htmlFor="purge-confirm" className="mb-2 block text-sm text-ink">
            Type <span className="font-mono font-semibold">{worker.worker_code}</span> to confirm
          </label>
          <Input id="purge-confirm" value={purgeText} onChange={(e) => setPurgeText(e.target.value)} autoComplete="off" />
        </div>
      </ConfirmDialog>
    </div>
  );
};

export default WorkerProfile;
