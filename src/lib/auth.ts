import { emitAppEvent } from "@/lib/app-events";
import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { safeNextPath } from "@/lib/redirects";
import { toast } from "@/lib/toast";

export { authNextPath, safeNextPath } from "@/lib/redirects";

const AUTH_NEXT_KEY = "mellox:auth-next";
/** A confirmation email is usually opened in a new tab, which has no sessionStorage. */
const AUTH_NEXT_TTL_MS = 24 * 60 * 60 * 1000;

function rememberNextPath(next: string) {
  try {
    window.sessionStorage.setItem(AUTH_NEXT_KEY, next);
  } catch {
    /* The other storage and the link can still carry the destination. */
  }
  try {
    if (next === "/projects") window.localStorage.removeItem(AUTH_NEXT_KEY);
    else window.localStorage.setItem(AUTH_NEXT_KEY, JSON.stringify({ next, at: Date.now() }));
  } catch {
    /* storage unavailable: the link's own ?next= still carries it */
  }
}

function takeRememberedNextPath(): string | null {
  const take = (store: () => Storage): string | null => {
    try {
      const storage = store();
      const value = storage.getItem(AUTH_NEXT_KEY);
      storage.removeItem(AUTH_NEXT_KEY);
      return value;
    } catch {
      return null;
    }
  };
  const fromTab = take(() => window.sessionStorage);
  const raw = take(() => window.localStorage);
  if (fromTab) return fromTab;
  try {
    const saved = raw ? (JSON.parse(raw) as { next?: unknown; at?: unknown }) : null;
    if (typeof saved?.next !== "string" || typeof saved.at !== "number") return null;
    const age = Date.now() - saved.at;
    return Number.isFinite(age) && age >= 0 && age < AUTH_NEXT_TTL_MS ? saved.next : null;
  } catch {
    return null;
  }
}

// Workspace / session-scoped localStorage keys cleared on sign-out so the
// next user never inherits the previous account's context.
const WORKSPACE_STORAGE_KEYS = [
  "workspace:selected",
  "workspace:name",
  "workspace:website",
  "workspace:last-opened",
  "pending:invite_token",
  "mellox:studioOpen",
  "app:navOpen",
  "chat:width",
  "chat:collapsed",
  "profile:persona",
  "social:connect:pending",
] as const;

// Key prefixes that hold one account's workspace data (Brand DNA cache, Studio
// drafts and jobs, coach briefings, notes, calendars, agent settings…).
export const ACCOUNT_DATA_PREFIXES = [
  "brand-dna:",
  "design-md:",
  "studio:",
  "coach:",
  "notes:",
  "notes-",
  "content-calendar:",
  "calendar:",
  "geo:",
  "market-brain:",
  "agent-",
  "ai-tokens:",
  "mellox:first-prompt-fired:",
  "onboarding:",
  "agency:",
  "chat:prefill:",
] as const;

export function isAccountDataKey(key: string): boolean {
  return ACCOUNT_DATA_PREFIXES.some((p) => key.startsWith(p));
}

function clearAccountData(store: Storage) {
  const doomed: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (k && isAccountDataKey(k)) doomed.push(k);
  }
  for (const k of doomed) store.removeItem(k);
}

/**
 * Clear auth session + workspace-scoped caches and hard-redirect to the public home.
 * Hard navigation drops every in-memory store (React state, router context,
 * query cache) so the next signed-in user starts with fresh workspace context.
 */
export async function signOutAndRedirect(queryClient?: QueryClient) {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  } catch {
    toast.error("Could not sign out", { description: "Check your connection and try again." });
    return false;
  }
  try {
    await queryClient?.cancelQueries();
  } catch {}
  try {
    queryClient?.clear();
  } catch {}
  if (typeof window !== "undefined") {
    for (const getStore of [() => window.localStorage, () => window.sessionStorage]) {
      try {
        const storage = getStore();
        for (const key of WORKSPACE_STORAGE_KEYS) storage.removeItem(key);
        clearAccountData(storage);
        storage.removeItem(AUTH_NEXT_KEY);
      } catch {}
    }
    emitAppEvent("workspace:changed", { id: null });
    window.location.replace("/");
  }
  return true;
}

export function authCallbackUrl(nextPath = "/projects") {
  const next = safeNextPath(nextPath);
  if (typeof window !== "undefined") rememberNextPath(next);
  return `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
}

export function consumeStoredNextPath(fallback = "/projects") {
  if (typeof window === "undefined") return fallback;
  const fromQuery = new URLSearchParams(window.location.search).get("next");
  const fromStorage = takeRememberedNextPath();
  return safeNextPath(fromQuery || fromStorage, fallback);
}

export function passwordResetUrl() {
  return `${window.location.origin}/reset-password`;
}

export function friendlyAuthError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "Authentication failed");
  const lower = message.toLowerCase();

  if (lower.includes("captcha") || lower.includes("security check")) {
    return "Please complete the security check and try again.";
  }

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
  if (lower.includes("google sign-in could not load")) {
    return "Google sign-in could not load. Check your connection or browser restrictions and retry.";
  }
  if (lower.includes("google sign-in configuration unavailable")) {
    return "Google sign-in is unavailable right now. Please retry or use email.";
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

export async function signInWithGoogle(credential: string, nonce: string, captchaToken?: string) {
  if (!credential || !nonce) throw new Error("Missing Google sign-in credential");
  // Supabase validates Google's signature, audience, expiry and hashed nonce.
  // Reuse the existing SSR browser client so cookies and auth listeners agree.
  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: "google",
    token: credential,
    nonce,
    ...(captchaToken ? { options: { captchaToken } } : {}),
  });
  if (error) throw error;
  if (!data.session || !data.user) throw new Error("Google sign-in returned no session");
  return data;
}
