import { AlarmClock, Briefcase, Building2, CalendarDays, Clock, FileText, LayoutGrid, LogOut, Menu, ReceiptText, UserCog, Users, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { initials } from "@/lib/format";
import { ROLE_LABEL } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useAuth } from "@/state/AuthProvider";
import { useExAccess } from "@/state/ExpensesProvider";
import { usePatrolTimers } from "@/state/PatrolTimerProvider";
import { useTimeClockRealtime } from "@/state/useTimeClock";

import { Crest } from "./Crest";
import { PatrolTimerAlerts } from "./PatrolTimerAlerts";
import { SyncStatus } from "./SyncStatus";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutGrid, match: (p: string) => p === "/" || p.startsWith("/patrols") },
  { to: "/properties", label: "Properties", icon: Building2, match: (p: string) => p.startsWith("/properties") },
  { to: "/schedule", label: "Schedule", icon: CalendarDays, match: (p: string) => p.startsWith("/schedule") },
  { to: "/notes", label: "Watch Notes", icon: FileText, match: (p: string) => p.startsWith("/notes") },
];

const HOURS_NAV = { to: "/hours", label: "My Hours", icon: Clock, match: (p: string) => p.startsWith("/hours") };
const PAYROLL_NAV = { to: "/payroll", label: "Payroll", icon: Wallet, match: (p: string) => p.startsWith("/payroll") };
const TEAM_NAV = { to: "/team", label: "Team", icon: Users, match: (p: string) => p.startsWith("/team") };
const WORKFORCE_NAV = {
  to: "/workforce",
  label: "Workforce Management",
  icon: Briefcase,
  match: (p: string) => p.startsWith("/workforce"),
};
const EXPENSES_NAV = {
  to: "/expenditures",
  label: "Expenditures",
  icon: ReceiptText,
  match: (p: string) => p.startsWith("/expenditures"),
};
const ACCOUNT_NAV = { to: "/account", label: "Account", icon: UserCog, match: (p: string) => p.startsWith("/account") };

const SidebarContent = ({ onNavigate }: { onNavigate?: () => void }) => {
  const { pathname } = useLocation();
  const { user, isAdmin, signOut } = useAuth();
  const navigate = useNavigate();
  const exAccess = useExAccess();
  const items = isAdmin
    ? [...NAV, HOURS_NAV, TEAM_NAV, PAYROLL_NAV, WORKFORCE_NAV, ...(exAccess.data === true ? [EXPENSES_NAV] : []), ACCOUNT_NAV]
    : [...NAV, HOURS_NAV, ACCOUNT_NAV];

  return (
    <div className="flex min-h-full flex-col">
      <div className="px-6 pb-6 pt-8">
        <Crest />
        {user?.orgName && (
          <div className="mt-5 truncate rounded-lg border border-line bg-surface px-3 py-2 text-center text-xs font-medium text-ink-2">
            {user.orgName}
          </div>
        )}
      </div>

      <nav aria-label="Main" className="flex flex-col gap-1">
        {items.map(({ to, label, icon: Icon, match }) => {
          const active = match(pathname);
          return (
            <NavLink
              key={to}
              to={to}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "focus-ring group relative flex items-center gap-3.5 px-7 py-3.5 text-[15px] font-medium transition-colors",
                active
                  ? "bg-gradient-to-r from-ember/[0.14] to-transparent text-ember"
                  : "text-ink-2 hover:bg-white/[0.03] hover:text-ink",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "absolute inset-y-0 left-0 w-[3px] rounded-r bg-ember transition-transform duration-200",
                  active ? "scale-y-100" : "scale-y-0",
                )}
              />
              <Icon className={cn("h-5 w-5", active ? "text-ember" : "text-ink-3 group-hover:text-ink-2")} />
              {label}
            </NavLink>
          );
        })}
      </nav>

      <div className="mt-auto px-5 pb-6">
        <RunningTimers onNavigate={onNavigate} />
        <div className="mb-3">
          <SyncStatus />
        </div>
        <div className="mb-3 h-px bg-line" />
        <div className="flex items-center gap-3 rounded-xl px-2 py-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-raised text-sm font-semibold text-silver ring-1 ring-line">
            {initials(user?.name ?? "")}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-ink">{user?.name}</div>
            <div className="truncate text-xs text-ink-3">{user ? ROLE_LABEL[user.role] : ""}</div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            onNavigate?.();
            navigate("/");
            void signOut();
          }}
          className="focus-ring flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-ink-2 transition-colors hover:bg-white/[0.03] hover:text-ink"
        >
          <LogOut className="h-[18px] w-[18px]" />
          Sign Out
        </button>
      </div>
    </div>
  );
};

/** Sidebar list of this officer's running patrol timers (tap to open the property). */
const RunningTimers = ({ onNavigate }: { onNavigate?: () => void }) => {
  const { activeTimers } = usePatrolTimers();
  if (activeTimers.length === 0) return null;
  return (
    <div className="mb-3 rounded-xl border border-ember/30 bg-ember/[0.06] p-2">
      <div className="flex items-center gap-2 px-2 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-ember">
        <AlarmClock className="h-3.5 w-3.5" />
        Patrol timers on
      </div>
      {activeTimers.map(({ property }) => (
        <NavLink
          key={property.id}
          to={`/properties/${property.id}`}
          onClick={onNavigate}
          className="focus-ring flex items-center gap-2 truncate rounded-lg px-2 py-1.5 text-sm text-ink-2 hover:bg-white/[0.04] hover:text-ink"
        >
          <span className="h-1.5 w-1.5 shrink-0 animate-ember-pulse rounded-full bg-ember" />
          <span className="truncate">{property.name}</span>
        </NavLink>
      ))}
    </div>
  );
};

/** Persistent sidebar layout; collapses to a top bar + drawer on narrow viewports. */
export const AppShell = () => {
  const [open, setOpen] = useState<boolean>(false);
  const { pathname } = useLocation();
  useTimeClockRealtime();

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);

  return (
    <div className="canvas-glow min-h-screen">
      <PatrolTimerAlerts />
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[268px] overflow-y-auto border-r border-line bg-rail lg:block">
        <SidebarContent />
      </aside>

      {/* Safe-area padding keeps the bar below the status bar / notch when installed to the home screen. */}
      <header className="sticky top-0 z-30 border-b border-line bg-rail/90 pt-[var(--safe-top)] backdrop-blur lg:hidden">
        <div className="flex h-16 items-center justify-between pl-[max(1rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]">
          <Crest size="sm" />
          <div className="flex items-center gap-2">
            <SyncStatus compact />
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label="Open navigation"
              className="focus-ring flex h-11 w-11 items-center justify-center rounded-lg text-ink-2 hover:bg-raised hover:text-ink"
            >
              <Menu className="h-6 w-6" />
            </button>
          </div>
        </div>
      </header>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="left"
          className="w-[280px] overflow-y-auto overscroll-contain border-line bg-rail p-0 pb-[var(--safe-bottom)] pl-[env(safe-area-inset-left)] pt-[var(--safe-top)] text-ink"
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarContent onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>

      <main className="lg:pl-[268px]">
        <div key={pathname} className="mx-auto w-full max-w-[1320px] animate-fade-up px-4 py-6 sm:px-6 md:px-8 lg:py-9">
          <Outlet />
        </div>
      </main>
    </div>
  );
};
