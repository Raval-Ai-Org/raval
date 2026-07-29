import { supabase } from "@/integrations/supabase/client";

// Authenticated fetch for our /api/* server routes.
// Attaches the Supabase access token as a Bearer header.
export async function authedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const headers = new Headers(init.headers);
  if (token && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${token}`);
  }
  return fetch(input, { ...init, headers });
}
