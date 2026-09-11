import { emitAppEvent } from "@/lib/app-events";
import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const AUTH_NEXT_KEY = "raval:auth-next";

// Workspace / session-scoped localStorage keys cleared on sign-out so the
// next user never inherits the previous account's context.
const WORKSPACE_STORAGE_KEYS = [
  "workspace:selected",
  "workspace:name",
  "workspace:website",
  "pending:invite_token",
  "raval:studioOpen",
  "app:navOpen",
  "chat:width",
  "chat:collapsed",
  "raval:persona",
] as const;

/**
 * Clear auth session + workspace-scoped caches and hard-redirect to /login.
 * Hard navigation drops every in-memory store (React state, router context,
 * query cache) so the next signed-in user starts with fresh workspace context.
 */
export async function signOutAndRedirect(queryClient?: QueryClient) {
  try {
    await queryClient?.cancelQueries();
  } catch {}
  try {
    queryClient?.clear();
  } catch {}
  try {
    await supabase.auth.signOut();
  } catch {}
  if (typeof window !== "undefined") {
    try {
      for (const key of WORKSPACE_STORAGE_KEYS) window.localStorage.removeItem(key);
      window.sessionStorage.removeItem(AUTH_NEXT_KEY);
    } catch {}
    emitAppEvent("workspace:changed", { id: null });
    window.location.replace("/login");
  }
}

export function safeNextPath(value: string | null | undefined, fallback = "/app") {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback;
  return value;
}

export function authCallbackUrl(nextPath = "/app") {
  const next = safeNextPath(nextPath);
  if (typeof window !== "undefined") {
    window.sessionStorage.setItem(AUTH_NEXT_KEY, next);
  }
  return `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
}

export function consumeStoredNextPath(fallback = "/app") {
  if (typeof window === "undefined") return fallback;
  const fromQuery = new URLSearchParams(window.location.search).get("next");
  const fromStorage = window.sessionStorage.getItem(AUTH_NEXT_KEY);
  window.sessionStorage.removeItem(AUTH_NEXT_KEY);
  return safeNextPath(fromQuery || fromStorage, fallback);
}

export function passwordResetUrl() {
  return `${window.location.origin}/reset-password`;
}

export function friendlyAuthError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "Authentication failed");
  const lower = message.toLowerCase();

  if (lower.includes("invalid login credentials")) {
    return "Email or password is incorrect. Please check both and try again.";
  }
  if (lower.includes("email not confirmed") || lower.includes("confirm your email")) {
    return "Please confirm your email address first, then sign in again.";
  }
  if (
    lower.includes("provider") &&
    lower.includes("google") &&
    (lower.includes("not supported") || lower.includes("missing oauth secret"))
  ) {
    return "Google sign-in is not enabled correctly. Enable Google in Supabase → Authentication → Sign In / Providers and save it, then try again.";
  }
  if (
    lower.includes("redirect_uri") ||
    lower.includes("redirect uri") ||
    lower.includes("redirect url") ||
    lower.includes("redirect_to_not_allowed") ||
    lower.includes("redirect to is not allowed")
  ) {
    return "Google sign-in could not start because its callback URL is not configured. Check the Google Cloud and Supabase redirect settings, then try again.";
  }
  if (
    lower.includes("invalid client") ||
    lower.includes("unauthorized_client") ||
    lower.includes("client_id") ||
    lower.includes("client secret")
  ) {
    return "Google sign-in is not configured correctly. Check the Google credentials in Supabase, then try again.";
  }
  if (lower.includes("popup") && lower.includes("blocked")) {
    return "Your browser blocked the Google sign-in window. Allow popups for this app and try again.";
  }
  if (
    lower.includes("cancelled") ||
    lower.includes("canceled") ||
    lower.includes("access_denied") ||
    lower.includes("user denied")
  ) {
    return "Google sign-in was cancelled before it finished.";
  }
  if (
    lower.includes("code verifier") ||
    lower.includes("expired") ||
    lower.includes("invalid code")
  ) {
    return "That Google sign-in attempt expired. Please try again.";
  }
  if (lower.includes("network") || lower.includes("fetch")) {
    return "Google sign-in could not reach the authentication service. Check your connection and try again.";
  }
  return "Authentication could not be completed. Please try again.";
}

export async function signInWithGoogle(nextPath = "/app") {
  // Native Supabase Google OAuth. The browser is redirected to Google, then
  // Supabase returns the user to /auth/callback, which exchanges the PKCE
  // code for a session (see authCallbackUrl).
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: authCallbackUrl(nextPath),
    },
  });

  if (error) throw error;

  // signInWithOAuth triggers a full-page redirect to Google. Fall back to an
  // explicit navigation if the URL was returned without redirecting.
  if (data?.url && typeof window !== "undefined") {
    window.location.assign(data.url);
  }

  // The page is leaving for Google; signal the caller not to run the
  // post-login workspace/navigation flow that applies to inline sessions.
  return { redirected: true } as const;
}
