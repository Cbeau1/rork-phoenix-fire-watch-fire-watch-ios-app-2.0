import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Briefcase, DollarSign, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { fmtDate, FormDialog, isDate, Pill, Restricted, SelectField, TextField, toNum } from "@/components/workforce/kit";
import { callFunction } from "@/lib/supabase";
import { ROLE_LABEL, type Member, type Role } from "@/lib/types";
import * as api from "@/lib/workforce/api";
import { money } from "@/lib/workforce/constants";
import { todayKey } from "@/lib/workforce/derive";
import { useWfPerms } from "@/state/WorkforceProvider";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Admin editor for a Team login: name, email, role and hourly pay rate.
 * Pay rates are effective-dated and append-only (history is kept); they need the
 * Workforce "Employee pay" permission and live on the linked Workforce profile.
 */
export const EditMemberDialog = ({
  member,
  isMe,
  workerId,
  onClose,
}: {
  member: Member | null;
  isMe: boolean;
  workerId: string | null;
  onClose: () => void;
}) => {
  const qc = useQueryClient();
  const permsQ = useWfPerms();
  const canPay = permsQ.data?.pay === true;

  const [name, setName] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [role, setRole] = useState<Role>("officer");
  const [rate, setRate] = useState<string>("");
  const [eff, setEff] = useState<string>(todayKey());
  const [note, setNote] = useState<string>("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!member) return;
    setName(member.name);
    setEmail(member.email);
    setRole(member.role);
    setRate("");
    setEff(todayKey());
    setNote("");
    setErrors({});
  }, [member]);

  const payQ = useQuery({
    queryKey: ["wf", "pay", workerId ?? ""],
    enabled: !!member && !!workerId && canPay,
    queryFn: () => api.listPay(workerId ?? ""),
  });
  const today = todayKey();
  const pay = useMemo(() => payQ.data ?? [], [payQ.data]);
  const current = useMemo(
    () => [...pay].filter((p) => p.effective_date <= today).sort((a, b) => b.effective_date.localeCompare(a.effective_date))[0],
    [pay, today],
  );

  const profileDirty = !!member && (name.trim() !== member.name || email.trim().toLowerCase() !== member.email.toLowerCase() || role !== member.role);
  const payDirty = rate.trim() !== "";

  const save = useMutation({
    mutationFn: async () => {
      if (!member) return;
      if (profileDirty) {
        await callFunction<{ ok: boolean }>("manage-members", {
          action: "update",
          memberId: member.id,
          fullName: name.trim(),
          email: email.trim().toLowerCase(),
          ...(isMe ? {} : { role }),
        });
      }
      if (payDirty) {
        const wid = workerId ?? (await api.linkTeamMember(member.id));
        await api.addPay(wid, toNum(rate) ?? 0, eff, note.trim());
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["members"] });
      void qc.invalidateQueries({ queryKey: ["wf"] });
      void qc.invalidateQueries({ queryKey: ["tc"] });
      toast.success(payDirty && profileDirty ? "Profile and pay rate saved" : payDirty ? "Pay rate saved — history kept" : "Profile saved");
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save."),
  });

  const submit = () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = "Name is required.";
    if (!EMAIL_RE.test(email.trim())) e.email = "Enter a valid email address.";
    if (payDirty) {
      const n = toNum(rate);
      if (n === null || n <= 0) e.rate = "Enter an hourly rate above zero.";
      else if (n > 1000) e.rate = "That rate looks too high — check it.";
      else if (!/^\d+(\.\d{1,2})?$/.test(rate.trim())) e.rate = "Use dollars and cents, e.g. 22.50";
      if (!isDate(eff)) e.eff = "Effective date is required.";
    }
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    if (!profileDirty && !payDirty) {
      onClose();
      return;
    }
    save.mutate();
  };

  return (
    <FormDialog
      open={!!member}
      onOpenChange={(v) => !v && onClose()}
      title={member ? `Edit ${member.name}` : "Edit employee"}
      description="Update their profile and hourly pay rate."
      dirty={profileDirty || payDirty || note !== ""}
      saving={save.isPending}
      onSubmit={submit}
      submitLabel="Save changes"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField label="Full name" required value={name} onChange={setName} error={errors.name} maxLength={120} />
        <TextField
          label="Email (their username)"
          required
          type="email"
          inputMode="email"
          value={email}
          onChange={setEmail}
          error={errors.email}
          maxLength={200}
          hint={member && email.trim().toLowerCase() !== member.email.toLowerCase() ? "They'll sign in with the new email from now on." : undefined}
        />
      </div>
      <SelectField
        label="Role"
        value={role}
        onChange={(v) => setRole(v === "admin" ? "admin" : "officer")}
        disabled={isMe}
        hint={isMe ? "You can't change your own role." : undefined}
        options={(["officer", "admin"] as const).map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
      />

      <div className="rounded-xl border border-line bg-raised/60 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-status-clear/10 text-status-clear ring-1 ring-status-clear/30">
              <DollarSign className="h-4 w-4" />
            </span>
            <div>
              <div className="text-sm font-semibold text-ink">Hourly pay rate</div>
              <div className="text-xs text-ink-3">Confidential · used for gross pay on the Payroll tab</div>
            </div>
          </div>
          {canPay && (
            <div className="text-right">
              <div className="text-[11px] uppercase tracking-[0.14em] text-ink-3">Current</div>
              <div className="font-display text-2xl font-extrabold tabular-nums text-ink">
                {payQ.isLoading ? "…" : current ? money(Number(current.hourly_rate)) : "Not set"}
                {current && <span className="text-sm font-medium text-ink-3"> /hr</span>}
              </div>
            </div>
          )}
        </div>

        {permsQ.isLoading ? null : !canPay ? (
          <Restricted what="Viewing and setting pay rates" />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <TextField
                label={current ? "New hourly rate (USD)" : "Hourly rate (USD)"}
                inputMode="decimal"
                value={rate}
                onChange={setRate}
                error={errors.rate}
                placeholder={current ? String(Number(current.hourly_rate).toFixed(2)) : "22.50"}
                maxLength={10}
              />
              <TextField label="Effective date" type="date" value={eff} onChange={setEff} error={errors.eff} />
            </div>
            <TextField className="mt-4" label="Note (optional)" value={note} onChange={setNote} placeholder="e.g. Raise after 90-day review" maxLength={300} />
            <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-3">
              <Plus className="h-3 w-3" />
              Adds a new rate from the effective date. Earlier rates stay in the history and keep pricing older hours.
            </p>

            {pay.length > 0 && (
              <ul className="mt-4 space-y-1.5 border-t border-line pt-3">
                {pay.slice(0, 6).map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex items-center gap-2">
                      <span className="font-mono tabular-nums text-ink">{money(Number(p.hourly_rate))}</span>
                      {p.id === current?.id && <Pill tone="green">Current</Pill>}
                      {p.effective_date > today && <Pill tone="blue">Scheduled</Pill>}
                      {p.note && <span className="hidden truncate text-xs text-ink-3 sm:inline">{p.note}</span>}
                    </span>
                    <span className="shrink-0 text-xs text-ink-3">from {fmtDate(p.effective_date)}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {workerId && (
        <Button asChild variant="ghost" size="sm" className="justify-self-start">
          <Link to={`/workforce/workers/${workerId}`}>
            <Briefcase />
            Open full Workforce profile (phone, address, emergency contact…)
          </Link>
        </Button>
      )}
    </FormDialog>
  );
};
