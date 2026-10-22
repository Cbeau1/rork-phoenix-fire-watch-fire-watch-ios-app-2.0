import {
  AlarmClock,
  Briefcase,
  Building2,
  CalendarDays,
  Clock,
  FileText,
  Handshake,
  LayoutGrid,
  LogOut,
  Menu,
  RadioTower,
  ReceiptText,
  Settings,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
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

import { LogPatrolGate } from "./ClockInGate";
import { Crest } from "./Crest";
import { PatrolTimerAlerts } from "./PatrolTimerAlerts";
import { SyncStatus } from "./SyncStatus";

type NavItem = { to: string; label: string; short: string; icon: LucideIcon; match: (p: string) => boolean };

const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", short: "Home", icon: LayoutGrid, match: (p: string) => p === "/" || p.startsWith("/patrols") },
  { to: "/properties", label: "Properties", short: "Sites", icon: Building2, match: (p: string) => p.startsWith("/properties") },
  { to: "/schedule", label: "Schedule", short: "Schedule", icon: CalendarDays, match: (p: string) => p.startsWith("/schedule") },
  { to: "/notes", label: "Watch Notes", short: "Notes", icon: FileText, match: (p: string) => p.startsWith("/notes") },
];

const CLIENTS_NAV: NavItem = { to: "/clients", label: "Clients", short: "Clients", icon: Handshake, match: (p: string) => p.startsWith("/clients") };
const DISPATCH_NAV: NavItem = { to: "/dispatch", label: "Dispatch", short: "Dispatch", icon: RadioTower, match: (p: string) => p.startsWith("/dispatch") };
const HOURS_NAV: NavItem = { to: "/hours", label: "My Hours", short: "Hours", icon: Clock, match: (p: string) => p.startsWith("/hours") };
const PAYROLL_NAV: NavItem = { to: "/payroll", label: "Payroll", short: "Payroll", icon: Wallet, match: (p: string) => p.startsWith("/payroll") };
const TEAM_NAV: NavItem = { to: "/team", label: "Team", short: "Team", icon: Users, match: (p: string) => p.startsWith("/team") };
const WORKFORCE_NAV: NavItem = {
  to: "/workforce",
  label: "Workforce Management",
  short: "Workforce",
  icon: Briefcase,
  match: (p: string) => p.startsWith("/workforce"),
};
const EXPENSES_NAV: NavItem = {
  to: "/expenditures",
  label: "Expenditures",
  short: "Expenses",
  icon: ReceiptText,
  match: (p: string) => p.startsWith("/expenditures"),
};
const ACCOUNT_NAV: NavItem = {
  to: "/settings",
  label: "Settings",
  short: "Settings",
  icon: Settings,
  match: (p: string) => p.startsWith("/settings") || p.startsWith("/account"),
};

const useNavItems = (): NavItem[] => {
  const { isAdmin } = useAuth();
  const exAccess = useExAccess();
  return isAdmin
    ? [NAV[0], DISPATCH_NAV, NAV[1], CLIENTS_NAV, ...NAV.slice(2), HOURS_NAV, TEAM_NAV, PAYROLL_NAV, WORKFORCE_NAV, ...(exAccess.data === true ? [EXPENSES_NAV] : []), ACCOUNT_NAV]
    : [...NAV, HOURS_NAV, ACCOUNT_NAV];
};

/** Compact icon rail for tablets (768–1023px): every destination one tap away, without a drawer. */
const TabletRail = () => {
  const { pathname } = useLocation();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const items = useNavItems();
  const { activeTimers } = usePatrolTimers();

  return (
    <aside
      aria-label="Main"
      className="fixed inset-y-0 left-0 z-30 hidden flex-col overflow-y-auto border-r border-line bg-rail pb-[max(1rem,var(--safe-bottom))] pl-[env(safe-area-inset-left)] pt-[max(1rem,var(--safe-top))] md:flex lg:hidden"
      style={{ width: "calc(88px + env(safe-area-inset-left))" }}
    >
      <div className="flex justify-center pb-4">
        <Crest size="sm" markOnly />
      </div>
      <nav className="flex flex-col gap-1 px-2">
        {items.map(({ to, short, label, icon: Icon, match }) => {
          const active = match(pathname);
          const timerDot = to === "/properties" && activeTimers.length > 0;
          return (
            <NavLink
              key={to}
              to={to}
              aria-label={label}
              aria-current={active ? "page" : undefined}
              className={cn(
                "focus-ring relative flex min-h-[58px] flex-col items-center justify-center gap-1 rounded-xl px-1 text-[11px] font-medium transition-colors",
                active ? "bg-primary/[0.16] text-link" : "text-ink-2 hover:bg-ink/[0.05] hover:text-ink",
              )}
            >
              <Icon className="h-[22px] w-[22px]" />
              <span className="max-w-full truncate">{short}</span>
              {timerDot && <span className="absolute right-4 top-2.5 h-2 w-2 animate-primary-pulse rounded-full bg-link" />}
            </NavLink>
          );
        })}
      </nav>
      <div className="mt-auto flex flex-col items-center gap-3 px-2 pt-4">
        <SyncStatus iconOnly />
        <div
          title={user?.name}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-raised text-sm font-semibold text-silver ring-1 ring-line"
        >
          {initials(user?.name ?? "")}
        </div>
        <button
          type="button"
          onClick={() => {
            navigate("/");
            void signOut();
          }}
          aria-label="Sign out"
          className="focus-ring flex h-11 w-11 items-center justify-center rounded-lg text-ink-3 hover:bg-ink/[0.05] hover:text-ink"
        >
          <LogOut className="h-5 w-5" />
        </button>
      </div>
    </aside>
  );
};

const SidebarContent = ({ onNavigate }: { onNavigate?: () => void }) => {
  const { pathname } = useLocation();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const items = useNavItems();

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
                  ? "bg-gradient-to-r from-primary/[0.14] to-transparent text-link"
                  : "text-ink-2 hover:bg-ink/[0.05] hover:text-ink",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "absolute inset-y-0 left-0 w-[3px] rounded-r bg-primary transition-transform duration-200",
                  active ? "scale-y-100" : "scale-y-0",
                )}
              />
              <Icon className={cn("h-5 w-5", active ? "text-link" : "text-ink-3 group-hover:text-ink-2")} />
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
          className="focus-ring flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-ink-2 transition-colors hover:bg-ink/[0.05] hover:text-ink"
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
    <div className="mb-3 rounded-xl border border-primary/30 bg-primary/[0.06] p-2">
      <div className="flex items-center gap-2 px-2 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-link">
        <AlarmClock className="h-3.5 w-3.5" />
        Patrol timers on
      </div>
      {activeTimers.map(({ property }) => (
        <NavLink
          key={property.id}
          to={`/properties/${property.id}`}
          onClick={onNavigate}
          className="focus-ring flex items-center gap-2 truncate rounded-lg px-2 py-1.5 text-sm text-ink-2 hover:bg-ink/[0.05] hover:text-ink"
        >
          <span className="h-1.5 w-1.5 shrink-0 animate-primary-pulse rounded-full bg-link" />
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
    <LogPatrolGate>
    <div className="canvas-glow min-h-screen">
      <PatrolTimerAlerts />
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[268px] overflow-y-auto border-r border-line bg-rail lg:block">
        <SidebarContent />
      </aside>
      <TabletRail />

      {/* Safe-area padding keeps the bar below the status bar / notch when installed to the home screen. */}
      <header className="sticky top-0 z-30 border-b border-line bg-rail/90 pt-[var(--safe-top)] backdrop-blur md:hidden">
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

      <main className="md:pl-[calc(88px+env(safe-area-inset-left))] lg:pl-[268px]">
        <div key={pathname} className="mx-auto w-full max-w-[1320px] animate-fade-up px-4 py-6 sm:px-6 md:px-8 md:pt-[max(1.5rem,var(--safe-top))] lg:py-9">
          <Outlet />
        </div>
      </main>
    </div>
    </LogPatrolGate>
  );
};
