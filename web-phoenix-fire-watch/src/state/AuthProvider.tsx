import createContextHook from "@nkzw/create-context-hook";
import type { Session } from "@supabase/supabase-js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useOnlineStatus } from "@/hooks/use-online";
import { clearOfflineCache, clearOpsForUser } from "@/lib/offline-store";
import { AUTH_STORAGE_KEY, callFunction, supabase } from "@/lib/supabase";
import type { Role, SessionUser } from "@/lib/types";

export interface SignUpInput {
  orgName: string;
  fullName: string;
  email: string;
  password: string;
  acceptedTerms: boolean;
}

export type AuthStatus = "loading" | "signed-out" | "needs-terms" | "ready" | "no-access";

const signInMessage = (message: string): string => {
  if (/invalid login credentials/i.test(message)) return "Incorrect email or password.";
  if (/banned/i.test(message)) return "This account has been deactivated. Contact your organization admin.";
  if (/Failed to fetch|NetworkError|Load failed/i.test(message)) {
    return "You're offline. Signing in for the first time on this device needs a connection.";
  }
  return message;
};

/** User id of the session saved on this device (used to open the app offline). */
const readStoredUserId = (): string | null => {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { user?: { id?: string } } | null;
    return parsed?.user?.id ?? null;
  } catch {
    return null;
  }
};

export const [AuthProvider, useAuth] = createContextHook(() => {
  const queryClient = useQueryClient();
  const online = useOnlineStatus();
  const [session, setSession] = useState<Session | null>(null);
  const [sessionReady, setSessionReady] = useState<boolean>(false);
  const [storedUserId, setStoredUserId] = useState<string | null>(readStoredUserId);
  // While a password recovery completes, the temporary session must not open the app.
  const [recovering, setRecovering] = useState<boolean>(false);

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data }) => setSession(data.session))
      .catch((err: unknown) => console.warn("[Auth] getSession failed", err))
      .finally(() => setSessionReady(true));
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      if (event === "SIGNED_OUT") setStoredUserId(null);
      else if (next) setStoredUserId(next.user.id);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // Offline, a saved session may be expired and unrefreshable — keep the officer working
  // from the device copy; changes queue locally and sync once the session refreshes online.
  const userId = session?.user.id ?? (!online ? storedUserId : null);

  const profileQuery = useQuery({
    queryKey: ["profile", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, role, active, org_id, terms_accepted_at, organizations(name, retention_days)")
        .eq("id", userId ?? "")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const user = useMemo<SessionUser | null>(() => {
    const p = profileQuery.data;
    if (!p || !p.active) return null;
    type OrgRow = { name: string; retention_days: number | null };
    const org = p.organizations as OrgRow | OrgRow[] | null;
    const orgRow = Array.isArray(org) ? org[0] : org;
    return {
      id: p.id,
      name: p.full_name,
      email: p.email,
      role: (p.role === "admin" ? "admin" : "officer") as Role,
      orgId: p.org_id,
      orgName: orgRow?.name ?? "",
      retentionDays: orgRow?.retention_days ?? null,
    };
  }, [profileQuery.data]);

  const termsAccepted = !!profileQuery.data?.terms_accepted_at;

  let status: AuthStatus = "loading";
  if (recovering) status = "signed-out";
  else if (sessionReady && !userId) status = "signed-out";
  else if (userId && profileQuery.data !== undefined) {
    if (!user) status = "no-access";
    else status = termsAccepted ? "ready" : "needs-terms";
  } else if (userId && profileQuery.isError) status = "no-access";

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error) throw new Error(signInMessage(error.message));
  }, []);

  const signUp = useCallback(
    async (input: SignUpInput) => {
      await callFunction<{ ok: boolean }>("create-organization", { ...input });
      await signIn(input.email, input.password);
    },
    [signIn],
  );

  /** Emails a one-time reset code. Returns false when email delivery isn't configured. */
  const requestPasswordReset = useCallback(async (email: string): Promise<boolean> => {
    const res = await callFunction<{ ok: boolean; reason?: string }>("password-reset", {
      email: email.trim().toLowerCase(),
    });
    return res.ok !== false;
  }, []);

  /** Verifies the emailed code, sets the new password, and signs the user in. */
  const completePasswordReset = useCallback(async (email: string, code: string, password: string) => {
    setRecovering(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token: code.replace(/\s+/g, ""),
        type: "recovery",
      });
      if (error) {
        if (/expired|invalid/i.test(error.message)) throw new Error("That code is invalid or has expired. Request a new one.");
        throw new Error(signInMessage(error.message));
      }
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
        throw new Error(
          /different from the old/i.test(updateError.message)
            ? "Choose a password that's different from your old one."
            : updateError.message,
        );
      }
    } finally {
      setRecovering(false);
    }
  }, []);

  const resetLocalData = useCallback(async () => {
    queryClient.clear();
    await clearOfflineCache();
  }, [queryClient]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut({ scope: "local" }).catch((err: unknown) => console.warn("[Auth] signOut failed", err));
    setStoredUserId(null);
    await resetLocalData();
  }, [resetLocalData]);

  const changePassword = useCallback(async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw new Error(error.message);
  }, []);

  const updateName = useCallback(
    async (fullName: string) => {
      if (!user) return;
      const { error } = await supabase.from("profiles").update({ full_name: fullName.trim() }).eq("id", user.id);
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ["profile", user.id] });
    },
    [queryClient, user],
  );

  const acceptTerms = useCallback(async () => {
    if (!userId) return;
    const { error } = await supabase
      .from("profiles")
      .update({ terms_accepted_at: new Date().toISOString() })
      .eq("id", userId);
    if (error) throw error;
    await queryClient.invalidateQueries({ queryKey: ["profile", userId] });
  }, [queryClient, userId]);

  const renameOrg = useCallback(
    async (name: string) => {
      if (!user) return;
      const { error } = await supabase.from("organizations").update({ name: name.trim() }).eq("id", user.orgId);
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ["profile", user.id] });
    },
    [queryClient, user],
  );

  const setRetention = useCallback(
    async (days: number | null) => {
      if (!user) return;
      const { error } = await supabase.from("organizations").update({ retention_days: days }).eq("id", user.orgId);
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ["profile", user.id] });
    },
    [queryClient, user],
  );

  /** Permanently deletes the caller's account, or (admins) the whole organization. */
  const deleteAccount = useCallback(
    async (scope: "self" | "organization", confirmName?: string) => {
      if (!user) return;
      const res = await callFunction<{ ok: boolean; deleted: "account" | "organization" }>("delete-account", {
        scope,
        confirmName: confirmName ?? "",
      });
      await clearOpsForUser(user.id);
      await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
      setStoredUserId(null);
      await resetLocalData();
      return res.deleted;
    },
    [user, resetLocalData],
  );

  return {
    status,
    user,
    isAdmin: user?.role === "admin",
    online,
    signIn,
    signUp,
    signOut,
    requestPasswordReset,
    completePasswordReset,
    changePassword,
    updateName,
    acceptTerms,
    renameOrg,
    setRetention,
    deleteAccount,
    retryProfile: profileQuery.refetch,
  };
});
