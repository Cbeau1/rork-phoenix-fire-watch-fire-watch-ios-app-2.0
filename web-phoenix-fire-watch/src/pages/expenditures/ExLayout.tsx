import { ShieldAlert } from "lucide-react";
import { Link, Outlet } from "react-router-dom";

import { ExNav } from "@/components/expenses/kit";
import { Button } from "@/components/ui/button";
import { ErrorBlock, Loading } from "@/components/workforce/kit";
import { useAuth } from "@/state/AuthProvider";
import { ExpensesProvider, useExAccess, useExpenses } from "@/state/ExpensesProvider";

const Denied = () => (
  <div className="mx-auto max-w-lg py-20 text-center">
    <ShieldAlert className="mx-auto h-12 w-12 text-ember" strokeWidth={1.5} />
    <h1 className="mt-5 font-display text-3xl font-extrabold text-ink">Financial access required</h1>
    <p className="mt-2 text-ink-2">
      Expenditures are limited to administrators with the Expenditures permission. An admin with permission-management access can grant it
      in Workforce settings → Permissions.
    </p>
    <Button asChild className="mt-7">
      <Link to="/">Return to Dashboard</Link>
    </Button>
  </div>
);

const Inner = () => {
  const ex = useExpenses();
  if (ex.loading) return <Loading label="Loading expenditures…" />;
  if (ex.error) return <ErrorBlock message={ex.error instanceof Error ? ex.error.message : "Couldn't load expenditures."} onRetry={ex.retry} />;
  return (
    <>
      <ExNav />
      <Outlet />
    </>
  );
};

/**
 * Gate for every /expenditures route. Hiding the UI is convenience only: every table is RLS-protected,
 * every change goes through permission-checked database functions, and receipts use server-authorized
 * 60-second links.
 */
const ExLayout = () => {
  const { isAdmin, online } = useAuth();
  const access = useExAccess();
  if (!isAdmin) return <Denied />;
  if (!online) return <ErrorBlock message="Expenditures need a connection. Financial records are never stored offline on this device." />;
  if (access.isLoading) return <Loading label="Checking access…" />;
  if (access.error) {
    return <ErrorBlock message={access.error instanceof Error ? access.error.message : "Couldn't verify access."} onRetry={() => void access.refetch()} />;
  }
  if (access.data !== true) return <Denied />;
  return (
    <ExpensesProvider>
      <Inner />
    </ExpensesProvider>
  );
};

export default ExLayout;
