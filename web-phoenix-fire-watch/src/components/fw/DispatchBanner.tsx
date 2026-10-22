import { ArrowRight, BellRing, MapPinOff } from "lucide-react";
import { Link } from "react-router-dom";

import { useDispatchBoard } from "@/lib/dispatch/useBoard";
import { useAuth } from "@/state/AuthProvider";

/** Admin-only Dashboard strip: off-site check-in requests and unacknowledged dispatch alerts. */
export const DispatchBanner = () => {
  const { isAdmin } = useAuth();
  const { data } = useDispatchBoard(isAdmin);
  if (!isAdmin || !data) return null;

  const requests = data.shifts.filter((s) => s.request?.status === "pending");
  const alerts = data.alerts.filter((a) => !a.acknowledged_at);
  const incidents = data.incidents.length;
  if (!requests.length && !alerts.length && !incidents) return null;

  const first = requests[0];
  const headline = first
    ? requests.length === 1
      ? `${first.staff.name} needs approval to check in off-site at ${first.property.name}`
      : `${requests.length} guards need approval to check in off-site`
    : alerts.length
      ? `${alerts.length} dispatch alert${alerts.length === 1 ? "" : "s"} need${alerts.length === 1 ? "s" : ""} attention`
      : `${incidents} open incident${incidents === 1 ? "" : "s"} reported`;

  const extra = [
    requests.length && alerts.length ? `${alerts.length} alert${alerts.length === 1 ? "" : "s"}` : "",
    (requests.length || alerts.length) && incidents ? `${incidents} open incident${incidents === 1 ? "" : "s"}` : "",
  ].filter(Boolean);

  const Icon = first ? MapPinOff : BellRing;
  return (
    <Link
      to="/dispatch"
      className="focus-ring group mb-6 flex items-center gap-4 rounded-xl border border-status-incident/45 bg-status-incident/10 px-4 py-3.5 transition-colors hover:bg-status-incident/15 sm:px-5"
      role="alert"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-status-incident/15">
        <Icon className="h-5 w-5 animate-pulse text-status-incident-ink" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-ink">{headline}</span>
        <span className="block text-sm text-ink-2">{extra.length ? `Also: ${extra.join(" · ")}. ` : ""}Open Dispatch to review.</span>
      </span>
      <ArrowRight className="h-5 w-5 shrink-0 text-ink-2 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
};
