import { Building2, ChevronRight, Clock, MapPin, Phone, Plus, Search, User, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { Card, EmptyState, PageHeader } from "@/components/fw/primitives";
import { Button } from "@/components/ui/button";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { timeAgo } from "@/lib/format";
import { useFireWatch } from "@/state/FireWatchProvider";

const Properties = () => {
  useDocumentTitle("Properties");
  const { properties, patrols } = useFireWatch();
  const [query, setQuery] = useState<string>("");

  const patrolCounts = useMemo<Map<string, number>>(() => {
    const m = new Map<string, number>();
    for (const p of patrols) m.set(p.propertyId, (m.get(p.propertyId) ?? 0) + 1);
    return m;
  }, [patrols]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return properties;
    return properties.filter((p) => p.name.toLowerCase().includes(q) || p.address.toLowerCase().includes(q));
  }, [properties, query]);

  return (
    <>
      <PageHeader
        title="Properties"
        subtitle="Manage all monitored locations and fire watch properties"
        actions={
          <Button asChild size="lg">
            <Link to="/properties/new">
              <Plus />
              Add Property
            </Link>
          </Button>
        }
      />

      <div className="relative mb-5">
        <Search className="pointer-events-none absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-3" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search properties by name or address..."
          aria-label="Search properties"
          className="h-14 w-full rounded-xl border border-line bg-surface pl-14 pr-12 text-[15px] text-ink placeholder:text-ink-3 transition-colors hover:border-[#2e3034] focus-visible:border-ember/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember/25 [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="focus-ring absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-ink-3 hover:bg-raised hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <Card>
          {properties.length === 0 ? (
            <EmptyState
              icon={Building2}
              title="No properties yet"
              description="Add your first monitored location to start logging fire watch patrols."
              action={
                <Button asChild>
                  <Link to="/properties/new">
                    <Plus />
                    Add Property
                  </Link>
                </Button>
              }
            />
          ) : (
            <EmptyState icon={Search} title="No matches" description={`Nothing found for “${query}”.`} />
          )}
        </Card>
      ) : (
        <ul className="space-y-3">
          {filtered.map((p, i) => {
            const count = patrolCounts.get(p.id) ?? 0;
            return (
              <li key={p.id} className="animate-fade-up" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
                <Link
                  to={`/properties/${p.id}`}
                  className="focus-ring group flex flex-col gap-4 rounded-xl border border-line bg-surface p-5 transition-colors hover:border-[#34363b] hover:bg-[#1a1b1d] md:flex-row md:items-center md:gap-0 md:p-6"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-5 md:pr-6">
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-raised ring-1 ring-line transition-colors group-hover:ring-ember/30 md:h-[88px] md:w-[88px]">
                      <Building2 className="h-8 w-8 text-silver md:h-10 md:w-10" strokeWidth={1.5} />
                    </div>
                    <div className="min-w-0">
                      <h2 className="truncate font-display text-lg font-bold text-ink sm:text-xl">{p.name}</h2>
                      <p className="mt-1.5 flex items-start gap-2 text-sm text-ink-2 sm:text-[15px]">
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />
                        <span className="line-clamp-2">{p.address}</span>
                      </p>
                      <p className="mt-2 text-xs text-ink-3">
                        {count} {count === 1 ? "patrol" : "patrols"} logged
                      </p>
                    </div>
                  </div>

                  {(p.contactName || p.contactPhone) && (
                    <div className="flex flex-col gap-2 border-line md:w-56 md:self-stretch md:justify-center md:border-l md:px-6">
                      {p.contactName && (
                        <span className="flex items-center gap-2.5 text-[15px] text-ink">
                          <User className="h-4 w-4 text-ink-3" />
                          <span className="truncate">{p.contactName}</span>
                        </span>
                      )}
                      {p.contactPhone && (
                        <span className="flex items-center gap-2.5 font-mono text-sm text-ink-2">
                          <Phone className="h-4 w-4 text-ink-3" />
                          {p.contactPhone}
                        </span>
                      )}
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-3 border-line md:w-60 md:self-stretch md:border-l md:pl-6">
                    <span className="flex items-center gap-2 text-sm text-ink-2">
                      <Clock className="h-4 w-4 text-ink-3" />
                      Added {timeAgo(p.createdAt)}
                    </span>
                    <ChevronRight className="h-5 w-5 text-ink-3 transition-transform group-hover:translate-x-0.5 group-hover:text-ember" />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
};

export default Properties;
