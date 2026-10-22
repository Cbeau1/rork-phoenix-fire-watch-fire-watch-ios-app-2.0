import { Link, Outlet, useLocation } from "react-router-dom";

import { AccessDenied, ErrorBlock } from "@/components/workforce/kit";
import { cn } from "@/lib/utils";
import { useAuth } from "@/state/AuthProvider";

const ClientsNav = () => {
  const { pathname } = useLocation();
  const items = [
    { to: "/clients", label: "Pipeline", match: (p: string) => p === "/clients" || p.startsWith("/clients/deals") },
    { to: "/clients/list", label: "Clients", match: (p: string) => p.startsWith("/clients/list") || p.startsWith("/clients/c/") },
    { to: "/clients/settings", label: "Templates & settings", match: (p: string) => p.startsWith("/clients/settings") },
  ];
  return (
    <nav aria-label="Clients" className="-mx-4 mb-6 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex w-max gap-1 rounded-xl border border-line bg-rail/60 p-1">
        {items.map((i) => {
          const active = i.match(pathname);
          return (
            <li key={i.to}>
              <Link
                to={i.to}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "focus-ring block whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-medium transition-colors",
                  active ? "bg-primary text-white" : "text-ink-2 hover:bg-raised hover:text-ink",
                )}
              >
                {i.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};

/**
 * Gate for every /clients route. The admin check here is convenience only — the CRM tables are
 * admin-only under row-level security and every write is validated on the server.
 */
const ClientsLayout = () => {
  const { isAdmin, online } = useAuth();
  if (!isAdmin) return <AccessDenied />;
  if (!online) return <ErrorBlock message="Clients & quotes need a connection. Reconnect to view the pipeline." />;
  return (
    <>
      <ClientsNav />
      <Outlet />
    </>
  );
};

export default ClientsLayout;
