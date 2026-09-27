import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { PHOTO_BUCKET, supabase } from "@/lib/supabase";

const isInline = (p: string): boolean => p.startsWith("data:") || p.startsWith("http") || p.startsWith("blob:");

/** Creates short-lived signed URLs for private patrol photo paths. */
export async function signPhotoUrls(paths: string[], expiresIn = 3600): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const storagePaths = paths.filter((p) => !isInline(p));
  for (const p of paths) if (isInline(p)) map.set(p, p);
  if (storagePaths.length === 0) return map;
  const { data, error } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(storagePaths, expiresIn);
  if (error) throw error;
  for (const item of data) {
    if (item.path && item.signedUrl) map.set(item.path, item.signedUrl);
  }
  return map;
}

/** Resolves patrol photo paths into displayable URLs (null while loading or if missing). */
export const usePhotoUrls = (paths: string[], enabled = true) => {
  const storagePaths = useMemo(() => paths.filter((p) => !isInline(p)), [paths]);
  const query = useQuery({
    queryKey: ["photo-urls", storagePaths],
    enabled: enabled && storagePaths.length > 0,
    retry: 1,
    staleTime: 50 * 60 * 1000,
    queryFn: () => signPhotoUrls(storagePaths),
  });
  const urls = useMemo<(string | null)[]>(
    () => paths.map((p) => (isInline(p) ? p : (query.data?.get(p) ?? null))),
    [paths, query.data],
  );
  return { urls, isLoading: query.isLoading };
};
