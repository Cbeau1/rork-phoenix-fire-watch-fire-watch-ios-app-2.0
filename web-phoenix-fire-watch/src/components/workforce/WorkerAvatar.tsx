import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { initials } from "@/lib/format";
import * as api from "@/lib/workforce/api";
import type { Worker } from "@/lib/workforce/constants";
import { cn } from "@/lib/utils";

/** Short-lived signed photo URLs for a set of workers (memory only, refreshed every few minutes). */
export const useWorkerPhotos = (workers: Pick<Worker, "id" | "photo_path">[]) => {
  const ids = useMemo(
    () => workers.filter((w) => w.photo_path).map((w) => `${w.id}:${w.photo_path}`).sort(),
    [workers],
  );
  const q = useQuery({
    queryKey: ["wf", "photos", ids],
    enabled: ids.length > 0,
    staleTime: 4 * 60_000,
    gcTime: 4 * 60_000,
    retry: 1,
    queryFn: () => api.photoUrls(ids.map((x) => x.split(":")[0] ?? "")),
  });
  return q.data ?? {};
};

export const WorkerAvatar = ({
  name,
  url,
  size = "md",
  className,
}: {
  name: string;
  url?: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}) => {
  const dim = size === "lg" ? "h-20 w-20 text-xl" : size === "sm" ? "h-9 w-9 text-xs" : "h-11 w-11 text-sm";
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface font-semibold text-silver ring-1 ring-line",
        dim,
        className,
      )}
    >
      {url ? <img src={url} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" /> : initials(name)}
    </div>
  );
};
