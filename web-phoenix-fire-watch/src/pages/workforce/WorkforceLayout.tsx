import { Outlet } from "react-router-dom";

import { AccessDenied, ErrorBlock, Loading, WorkforceNav } from "@/components/workforce/kit";
import { useAuth } from "@/state/AuthProvider";
import { useWfPerms, useWorkforce, WorkforceProvider } from "@/state/WorkforceProvider";

const Inner = () => {
  const wf = useWorkforce();
  if (wf.coreLoading) return <Loading label="Loading Workforce Management…" />;
  if (wf.coreError) {
    return <ErrorBlock message={wf.coreError instanceof Error ? wf.coreError.message : "Couldn't load workforce records."} onRetry={wf.retry} />;
  }
  return (
    <>
      <WorkforceNav finance={wf.perms.finance} />
      <Outlet />
    </>
  );
};

/**
 * Gate for every /workforce route. The UI check is convenience only — every query and file
 * operation is independently authorized server-side (RLS + security-definer functions).
 */
const WorkforceLayout = () => {
  const { isAdmin, online } = useAuth();
  const perms = useWfPerms();
  if (!isAdmin) return <AccessDenied />;
  if (!online && !perms.data) {
    return <ErrorBlock message="Workforce Management needs a connection. Personnel records are never stored offline on this device." />;
  }
  if (perms.isLoading) return <Loading label="Checking access…" />;
  if (perms.error) return <ErrorBlock message={perms.error instanceof Error ? perms.error.message : "Couldn't verify access."} onRetry={() => void perms.refetch()} />;
  if (!perms.data?.manage) return <AccessDenied />;
  return (
    <WorkforceProvider>
      <Inner />
    </WorkforceProvider>
  );
};

export default WorkforceLayout;
