import { supabase } from "@/integrations/supabase/client";
import { exchangeAuthCode } from "@/lib/auth-code";

/** The caller captures and removes credentials from the URL before invoking this. */
export async function preparePasswordRecovery(href: string): Promise<boolean> {
  const url = new URL(href);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  const query = url.searchParams;

  if (
    hash.has("error") ||
    hash.has("error_description") ||
    query.has("error") ||
    query.has("error_description")
  ) {
    throw new Error("The password reset link is invalid or has expired.");
  }

  const accessToken = hash.get("access_token");
  const refreshToken = hash.get("refresh_token");
  const code = query.get("code");

  if (hash.has("access_token") || hash.has("refresh_token")) {
    if (!accessToken || !refreshToken) throw new Error("The password reset link is incomplete.");
    const { data, error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) throw error;
    return Boolean(data.session);
  }

  if (query.has("code")) {
    if (!code) throw new Error("The password reset link is incomplete.");
    // Supabase expects the one-time code, not the full reset URL.
    const { data, error } = await exchangeAuthCode(url);
    if (error) throw error;
    return Boolean(data.session);
  }

  // Email confirmation may already have established the recovery session.
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return Boolean(data.session);
}
