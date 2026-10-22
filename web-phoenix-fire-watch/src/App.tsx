import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { CloudOff, Loader2, LogOut, RefreshCw } from "lucide-react";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import { AppShell } from "@/components/fw/AppShell";
import { Crest } from "@/components/fw/Crest";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { queryPersister } from "@/lib/offline-store";
import { friendlyError } from "@/lib/supabase";
import { AuthProvider, useAuth } from "@/state/AuthProvider";
import { FireWatchProvider, useFireWatch } from "@/state/FireWatchProvider";
import { PatrolTimerProvider } from "@/state/PatrolTimerProvider";
import { ThemeProvider } from "@/state/ThemeProvider";

import AcceptTerms from "./pages/AcceptTerms";
import AcknowledgeGuide from "./pages/AcknowledgeGuide";
import Account from "./pages/Account";
import AllPatrols from "./pages/AllPatrols";
import Dashboard from "./pages/Dashboard";
import LogPatrol from "./pages/LogPatrol";
import MyHours from "./pages/MyHours";
import Payroll from "./pages/Payroll";
import Profit from "./pages/Profit";
import NotFound from "./pages/NotFound";
import Privacy from "./pages/Privacy";
import Properties from "./pages/Properties";
import Schedule from "./pages/Schedule";
import PropertyDetail from "./pages/PropertyDetail";
import PropertyForm from "./pages/PropertyForm";
import SignContract from "./pages/SignContract";
import ShiftLink from "./pages/ShiftLink";
import Dispatch from "./pages/Dispatch";
import SignIn from "./pages/SignIn";
import ClientDetail from "./pages/clients/ClientDetail";
import ClientList from "./pages/clients/ClientList";
import ClientsLayout from "./pages/clients/ClientsLayout";
import CrmSettings from "./pages/clients/CrmSettings";
import DealDetail from "./pages/clients/DealDetail";
import Pipeline from "./pages/clients/Pipeline";
import Support from "./pages/Support";
import Team from "./pages/Team";
import Terms from "./pages/Terms";
import WatchNotes from "./pages/WatchNotes";
import ExDetail from "./pages/expenditures/ExDetail";
import ExLayout from "./pages/expenditures/ExLayout";
import ExOverview from "./pages/expenditures/ExOverview";
import ExRecords from "./pages/expenditures/ExRecords";
import ExRecurring from "./pages/expenditures/ExRecurring";
import ExReimbursements from "./pages/expenditures/ExReimbursements";
import ExReports from "./pages/expenditures/ExReports";
import ExSettings from "./pages/expenditures/ExSettings";
import { AgencyList, AgencyProfile } from "./pages/workforce/Agencies";
import Directory from "./pages/workforce/Directory";
import { InvoiceDetail, InvoiceList } from "./pages/workforce/Invoices";
import Placements from "./pages/workforce/Placements";
import Reminders from "./pages/workforce/Reminders";
import Reports from "./pages/workforce/Reports";
import WorkforceSettings from "./pages/workforce/Settings";
import WorkerProfile from "./pages/workforce/WorkerProfile";
import WorkforceHome from "./pages/workforce/WorkforceHome";
import WorkforceLayout from "./pages/workforce/WorkforceLayout";

const WEEK = 7 * 24 * 60 * 60 * 1000;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, gcTime: WEEK, retry: 1, refetchOnWindowFocus: true },
  },
});

/** Only persist plain, successful data queries (signed photo URLs are short-lived Maps). */
const PERSISTED_KEYS = new Set<string>(["profile", "properties", "patrols", "notes", "members", "staff", "shifts"]);

const Splash = () => (
  <div className="canvas-glow flex min-h-screen flex-col items-center justify-center gap-8">
    <Crest size="lg" />
    <Loader2 className="h-6 w-6 animate-spin text-link" />
  </div>
);

const NoAccess = () => {
  const { signOut, retryProfile } = useAuth();
  return (
    <div className="canvas-glow flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        <Crest size="lg" className="mb-8" />
        <h1 className="font-display text-2xl font-bold text-ink">No active access</h1>
        <p className="mt-2 text-ink-2">
          This login isn't linked to an active organization. It may have been deactivated — contact your organization
          admin.
        </p>
        <div className="mt-7 flex justify-center gap-3">
          <Button variant="outline" onClick={() => void retryProfile()}>
            <RefreshCw />
            Try again
          </Button>
          <Button onClick={() => void signOut()}>
            <LogOut />
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
};

const OfflineFirstLoad = () => (
  <div className="canvas-glow flex min-h-screen items-center justify-center px-4 text-center">
    <div className="max-w-md">
      <Crest size="lg" className="mb-8" />
      <CloudOff className="mx-auto h-9 w-9 text-status-follow" strokeWidth={1.6} />
      <h1 className="mt-4 font-display text-2xl font-bold text-ink">Waiting for a connection</h1>
      <p className="mt-2 text-ink-2">
        Your team's data hasn't been downloaded to this device yet. Connect once and the app will keep working offline
        from then on.
      </p>
    </div>
  </div>
);

const AppRoutes = () => {
  const { isLoading, loadError, reload, sync } = useFireWatch();
  useDocumentTitle();

  if (isLoading) return sync.online ? <Splash /> : <OfflineFirstLoad />;
  if (loadError) {
    return (
      <div className="canvas-glow flex min-h-screen items-center justify-center px-4 text-center">
        <div>
          <Crest size="lg" className="mb-8" />
          <h1 className="font-display text-2xl font-bold text-ink">Couldn't load your data</h1>
          <p className="mt-2 text-ink-2">{friendlyError(loadError)}</p>
          <Button className="mt-6" onClick={reload}>
            <RefreshCw />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/patrols" element={<AllPatrols />} />
        <Route path="/properties" element={<Properties />} />
        <Route path="/properties/new" element={<PropertyForm />} />
        <Route path="/properties/:id" element={<PropertyDetail />} />
        <Route path="/properties/:id/edit" element={<PropertyForm />} />
        <Route path="/properties/:id/log" element={<LogPatrol />} />
        <Route path="/notes" element={<WatchNotes />} />
        <Route path="/schedule" element={<Schedule />} />
        <Route path="/dispatch" element={<Dispatch />} />
        <Route path="/team" element={<Team />} />
        <Route path="/hours" element={<MyHours />} />
        <Route path="/payroll" element={<Payroll />} />
        <Route path="/profit" element={<Profit />} />
        <Route path="/account" element={<Account />} />
        <Route path="/settings" element={<Account />} />
        <Route path="/workforce" element={<WorkforceLayout />}>
          <Route index element={<WorkforceHome />} />
          <Route path="directory" element={<Directory />} />
          <Route path="workers/:id" element={<WorkerProfile />} />
          <Route path="agencies" element={<AgencyList />} />
          <Route path="agencies/:id" element={<AgencyProfile />} />
          <Route path="placements" element={<Placements />} />
          <Route path="invoices" element={<InvoiceList />} />
          <Route path="invoices/:id" element={<InvoiceDetail />} />
          <Route path="reminders" element={<Reminders />} />
          <Route path="reports" element={<Reports />} />
          <Route path="settings" element={<WorkforceSettings />} />
          <Route path="*" element={<NotFound embedded />} />
        </Route>
        <Route path="/clients" element={<ClientsLayout />}>
          <Route index element={<Pipeline />} />
          <Route path="deals/:id" element={<DealDetail />} />
          <Route path="list" element={<ClientList />} />
          <Route path="c/:id" element={<ClientDetail />} />
          <Route path="settings" element={<CrmSettings />} />
          <Route path="*" element={<NotFound embedded />} />
        </Route>
        <Route path="/expenditures" element={<ExLayout />}>
          <Route index element={<ExOverview />} />
          <Route path="records" element={<ExRecords />} />
          <Route path="records/:id" element={<ExDetail />} />
          <Route path="recurring" element={<ExRecurring />} />
          <Route path="reimbursements" element={<ExReimbursements />} />
          <Route path="reports" element={<ExReports />} />
          <Route path="settings" element={<ExSettings />} />
          <Route path="*" element={<NotFound embedded />} />
        </Route>
        <Route path="*" element={<NotFound embedded />} />
      </Route>
    </Routes>
  );
};

const Gate = () => {
  const { status } = useAuth();
  if (status === "loading") return <Splash />;
  if (status === "signed-out") return <SignIn />;
  if (status === "no-access") return <NoAccess />;
  if (status === "needs-terms") return <AcceptTerms />;
  if (status === "needs-guide") return <AcknowledgeGuide />;
  return <AppRoutes />;
};

const App = () => (
  <PersistQueryClientProvider
    client={queryClient}
    persistOptions={{
      persister: queryPersister,
      maxAge: WEEK,
      buster: "pfw-1",
      dehydrateOptions: {
        shouldDehydrateQuery: (q) =>
          q.state.status === "success" && PERSISTED_KEYS.has(String(q.queryKey[0] ?? "")),
      },
    }}
  >
    <ThemeProvider>
    <AuthProvider>
      <FireWatchProvider>
        <PatrolTimerProvider>
        <TooltipProvider>
          <Toaster position="bottom-right" />
          <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <Routes>
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/terms" element={<Terms />} />
              <Route path="/support" element={<Support />} />
              <Route path="/sign/:token" element={<SignContract />} />
              <Route path="/shift/:token" element={<ShiftLink />} />
              <Route path="*" element={<Gate />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
        </PatrolTimerProvider>
      </FireWatchProvider>
    </AuthProvider>
    </ThemeProvider>
  </PersistQueryClientProvider>
);

export default App;
