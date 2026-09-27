import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

const supabaseUrl = import.meta.env.EXPO_PUBLIC_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string;

export const AUTH_STORAGE_KEY = "phoenix-fire-watch-auth";

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: AUTH_STORAGE_KEY,
  },
});

/** True for errors caused by lost connectivity or an expired token — safe to retry later. */
export const isRetryableError = (err: unknown): boolean => {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  const message =
    err instanceof Error
      ? err.message
      : err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : String(err ?? "");
  return /Failed to fetch|NetworkError|Load failed|network|fetch failed|timed? ?out|JWT expired|ERR_INTERNET|503|502|504/i.test(
    message,
  );
};

/** Postgres unique-violation code (record already exists — treat retried inserts as done). */
export const isDuplicateError = (err: unknown): boolean =>
  !!err && typeof err === "object" && "code" in err && (err as { code: unknown }).code === "23505";

export const PHOTO_BUCKET = "patrol-photos";

/** Invokes an edge function and surfaces its `{ error }` message as a readable Error. */
export async function callFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let message = "Something went wrong. Please try again.";
    const ctx = (error as { context?: unknown }).context;
    if (ctx instanceof Response) {
      try {
        const payload = (await ctx.json()) as { error?: string };
        if (payload.error) message = payload.error;
      } catch {
        // response body was not JSON
      }
    } else if (error.message && !/non-2xx/i.test(error.message)) {
      message = error.message.includes("Failed to fetch") ? "Network error — check your connection." : error.message;
    }
    throw new Error(message);
  }
  if (data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string") {
    throw new Error((data as { error: string }).error);
  }
  return data as T;
}

/** Converts Supabase/PostgREST errors into user-friendly messages. */
export const friendlyError = (err: unknown, fallback = "Something went wrong. Please try again."): string => {
  if (err instanceof Error && err.message) {
    if (/row-level security|permission denied/i.test(err.message)) return "You don't have permission to do that.";
    if (/Failed to fetch|NetworkError/i.test(err.message)) return "Network error — check your connection.";
    return err.message;
  }
  if (err && typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string") {
    return friendlyError(new Error((err as { message: string }).message), fallback);
  }
  return fallback;
};
