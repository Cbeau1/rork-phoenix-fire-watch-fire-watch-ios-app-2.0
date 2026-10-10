import { Check, Link2, Loader2, Pencil, Plus, Trash2, Users, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { initials } from "@/lib/format";
import type { Staff } from "@/lib/schedule";
import { friendlyError } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { ScheduleApi } from "@/state/useSchedule";

const NO_LOGIN = "__none__";

/** Admin dialog for the schedule roster: add, rename, link to a team login, or remove staff names. */
export const StaffDialog = ({
  open,
  onOpenChange,
  schedule,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schedule: ScheduleApi;
}) => {
  const { staff, members, addStaff, updateStaff, deleteStaff } = schedule;
  const [name, setName] = useState<string>("");
  const [profileId, setProfileId] = useState<string>(NO_LOGIN);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState<string>("");
  const [editProfile, setEditProfile] = useState<string>(NO_LOGIN);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const linkedIds = new Set(staff.map((s) => s.profileId).filter((x): x is string => !!x));
  const memberName = (id: string | null) => members.find((m) => m.id === id)?.name;

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await addStaff.mutateAsync({ name, profileId: profileId === NO_LOGIN ? null : profileId });
      setName("");
      setProfileId(NO_LOGIN);
      toast.success("Staff member added");
    } catch (err) {
      toast.error(friendlyError(err, "Couldn't add staff member"));
    }
  };

  const startEdit = (s: Staff) => {
    setEditingId(s.id);
    setEditName(s.name);
    setEditProfile(s.profileId ?? NO_LOGIN);
    setConfirmId(null);
  };

  const saveEdit = async () => {
    if (!editingId || !editName.trim()) return;
    try {
      await updateStaff.mutateAsync({
        id: editingId,
        name: editName,
        profileId: editProfile === NO_LOGIN ? null : editProfile,
      });
      setEditingId(null);
      toast.success("Staff member updated");
    } catch (err) {
      toast.error(friendlyError(err, "Couldn't update staff member"));
    }
  };

  const remove = async (s: Staff) => {
    if (confirmId !== s.id) {
      setConfirmId(s.id);
      return;
    }
    try {
      await deleteStaff.mutateAsync(s.id);
      setConfirmId(null);
      toast.success(`${s.name} removed from the schedule`);
    } catch (err) {
      toast.error(friendlyError(err, "Couldn't remove staff member"));
    }
  };

  const loginOptions = (current: string | null) =>
    members.filter((m) => m.active && (!linkedIds.has(m.id) || m.id === current));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto border-line bg-surface text-ink sm:max-w-lg sm:rounded-xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Staff</DialogTitle>
          <DialogDescription className="text-ink-2">
            Names you can put on the schedule. Link a name to a team login so that officer sees their own shifts
            highlighted.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => void add(e)} className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Staff name"
            maxLength={80}
            aria-label="New staff name"
          />
          <Button type="submit" disabled={!name.trim() || addStaff.isPending}>
            {addStaff.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
            Add
          </Button>
          {members.length > 0 && (
            <Select value={profileId} onValueChange={setProfileId}>
              <SelectTrigger aria-label="Link to team login" className="h-10 border-line-strong bg-field text-ink-2 sm:col-span-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-line bg-surface text-ink">
                <SelectItem value={NO_LOGIN} className="focus:bg-primary focus:text-white">
                  Not linked to a login
                </SelectItem>
                {loginOptions(null).map((m) => (
                  <SelectItem key={m.id} value={m.id} className="focus:bg-primary focus:text-white">
                    Link to {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </form>

        {staff.length === 0 ? (
          <div className="flex flex-col items-center rounded-xl border border-dashed border-line py-10 text-center">
            <Users className="h-8 w-8 text-ink-3" strokeWidth={1.5} />
            <p className="mt-3 text-sm text-ink-2">No staff yet — add the first name above.</p>
          </div>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {staff.map((s) =>
              editingId === s.id ? (
                <li key={s.id} className="grid gap-2 bg-raised/50 p-3">
                  <Input
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    maxLength={80}
                    aria-label="Staff name"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void saveEdit();
                      }
                    }}
                  />
                  {members.length > 0 && (
                    <Select value={editProfile} onValueChange={setEditProfile}>
                      <SelectTrigger aria-label="Linked login" className="h-10 border-line-strong bg-field text-ink-2">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="border-line bg-surface text-ink">
                        <SelectItem value={NO_LOGIN} className="focus:bg-primary focus:text-white">
                          Not linked to a login
                        </SelectItem>
                        {loginOptions(s.profileId).map((m) => (
                          <SelectItem key={m.id} value={m.id} className="focus:bg-primary focus:text-white">
                            Link to {m.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <div className="flex justify-end gap-2">
                    <Button type="button" size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                      <X />
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void saveEdit()}
                      disabled={!editName.trim() || updateStaff.isPending}
                    >
                      {updateStaff.isPending ? <Loader2 className="animate-spin" /> : <Check />}
                      Save
                    </Button>
                  </div>
                </li>
              ) : (
                <li key={s.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-raised text-xs font-semibold text-silver ring-1 ring-line">
                    {initials(s.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink">{s.name}</div>
                    {s.profileId && (
                      <div className="flex items-center gap-1 truncate text-xs text-ink-3">
                        <Link2 className="h-3 w-3" />
                        {memberName(s.profileId) ?? "Linked login"}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => startEdit(s)}
                    aria-label={`Edit ${s.name}`}
                    className="focus-ring flex h-9 w-9 items-center justify-center rounded-lg text-ink-3 hover:bg-raised hover:text-ink"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(s)}
                    aria-label={confirmId === s.id ? `Confirm removing ${s.name}` : `Remove ${s.name}`}
                    className={cn(
                      "focus-ring flex h-9 items-center justify-center rounded-lg text-xs font-medium transition-all",
                      confirmId === s.id
                        ? "bg-status-incident px-3 text-white"
                        : "w-9 text-ink-3 hover:bg-status-incident/10 hover:text-status-incident-ink",
                    )}
                  >
                    {deleteStaff.isPending && confirmId === s.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : confirmId === s.id ? (
                      "Remove + shifts"
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </button>
                </li>
              ),
            )}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
};
