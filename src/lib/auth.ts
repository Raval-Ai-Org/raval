import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";

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
  try { await queryClient?.cancelQueries(); } catch {}
  try { queryClient?.clear(); } catch {}
  try { await supabase.auth.signOut(); } catch {}
  if (typeof window !== "undefined") {
    try {
      for (const key of WORKSPACE_STORAGE_KEYS) window.localStorage.removeItem(key);
      window.sessionStorage.removeItem(AUTH_NEXT_KEY);
    } catch {}
    window.dispatchEvent(new CustomEvent("workspace:changed", { detail: { id: null } }));
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
  if (lower.includes("provider") && lower.includes("google") && (lower.includes("not supported") || lower.includes("missing oauth secret"))) {
    return "Google sign-in is not enabled correctly in Lovable Cloud yet. Enable Google in Cloud → Users → Auth Providers and save it, then try again.";
  }
  if (lower.includes("popup") && lower.includes("blocked")) {
    return "Your browser blocked the Google sign-in window. Allow popups for this app and try again.";
  }
  if (lower.includes("cancelled")) {
    return "Google sign-in was cancelled before it finished.";
  }
  return message;
}

export async function signInWithGoogle(nextPath = "/app") {
  // Google must go through Lovable Cloud's managed OAuth broker. Never call
  // supabase.auth.signInWithOAuth("google") here: that direct flow needs a
  // project Google secret and fails with "missing OAuth secret" in Cloud.
  const result = await lovable.auth.signInWithOAuth("google", {
    redirect_uri: authCallbackUrl(nextPath),
    extraParams: { prompt: "select_account" },
  });

  if (result.error) throw result.error;
  if (result.redirected) return { redirected: true } as const;

  if (result.tokens) {
    const { error: sessionError } = await supabase.auth.setSession(result.tokens);
    if (sessionError) throw sessionError;
  }

  const { data, error: getSessionError } = await supabase.auth.getSession();
  if (getSessionError) throw getSessionError;
  if (!data.session) throw new Error("Google sign-in finished without a valid session. Please try again.");
  return { redirected: false } as const;
}
