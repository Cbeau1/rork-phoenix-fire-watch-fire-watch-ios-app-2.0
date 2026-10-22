import { Building2, ChevronRight, Plus, Search, UsersRound } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { PageHeader } from "@/components/fw/primitives";
import { Empty, ErrorBlock, Loading, Pill } from "@/components/workforce/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useClients } from "@/lib/crm/api";
import { STAGE_META, type Stage } from "@/lib/crm/types";
import { friendlyError } from "@/lib/supabase";

import { IntakeDialog } from "./IntakeDialog";

const OPEN: Stage[] = ["lead", "quoted", "contract_sent"];

const ClientList = () => {
  const clients = useClients();
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState(false);
  const [intake, setIntake] = useState(false);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (clients.data ?? [])
      .filter((c) => (archived ? !!c.archived_at : !c.archived_at))
      .filter((c) => !q || [c.name, c.billing_email, ...c.contacts.flatMap((x) => [x.name, x.email, x.phone])].some((s) => (s ?? "").toLowerCase().includes(q)));
  }, [clients.data, search, archived]);
  const archivedCount = (clients.data ?? []).filter((c) => c.archived_at).length;

  return (
    <div>
      <PageHeader
        title="Clients"
        subtitle="Companies you quote and serve, with their contacts and properties."
        actions={
          <Button onClick={() => setIntake(true)}>
            <Plus />
            New intake
          </Button>
        }
      />
      {clients.isLoading ? (
        <Loading label="Loading clients…" />
      ) : clients.error ? (
        <ErrorBlock message={friendlyError(clients.error)} onRetry={() => void clients.refetch()} />
      ) : (clients.data ?? []).length === 0 ? (
        <Empty
          title="No clients yet"
          description="Clients are created from a new intake, so their contacts and property are captured in one step."
          action={
            <Button onClick={() => setIntake(true)}>
              <Plus />
              New intake
            </Button>
          }
        />
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex flex-1 items-center gap-2 rounded-lg border border-line-strong bg-field px-3">
              <Search className="h-4 w-4 text-ink-3" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by client, contact, email or phone"
                aria-label="Search clients"
                className="h-11 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
              />
            </div>
            {archivedCount > 0 && (
              <Button variant="outline" onClick={() => setArchived((v) => !v)}>
                {archived ? "Show active" : `Archived (${archivedCount})`}
              </Button>
            )}
          </div>
          {rows.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-ink-3">No clients match "{search}".</p>
          ) : (
            <ul className="grid gap-2.5">
              {rows.map((c) => {
                const open = c.deals.filter((d) => OPEN.includes(d.stage as Stage)).length;
                const active = c.deals.filter((d) => d.stage === "active" || d.stage === "signed").length;
                const main = c.contacts.find((x) => x.role !== "billing") ?? c.contacts[0];
                return (
                  <li key={c.id}>
                    <Link
                      to={`/clients/c/${c.id}`}
                      className="focus-ring flex items-center gap-4 rounded-xl border border-line bg-surface px-4 py-3.5 transition-colors hover:border-line-strong hover:bg-surface-hover"
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-raised text-link">
                        <Building2 className="h-5 w-5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-display text-base font-bold text-ink">{c.name}</p>
                        <p className="truncate text-sm text-ink-2">
                          {main ? `${main.name}${main.phone ? ` · ${main.phone}` : main.email ? ` · ${main.email}` : ""}` : "No contacts"}
                        </p>
                      </div>
                      <div className="hidden items-center gap-2 sm:flex">
                        <span className="inline-flex items-center gap-1 text-xs text-ink-3">
                          <UsersRound className="h-3.5 w-3.5" />
                          {c.contacts.length}
                        </span>
                        {active > 0 && <Pill tone={STAGE_META.active.tone}>{active} active</Pill>}
                        {open > 0 && <Pill tone="primary">{open} open</Pill>}
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-ink-3" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      <IntakeDialog open={intake} onOpenChange={setIntake} />
    </div>
  );
};

export default ClientList;
