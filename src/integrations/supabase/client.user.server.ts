// User-scoped server Supabase client. It carries the caller's own JWT, so every
// query runs AS THE USER and is RLS-enforced. This is the default client for
// server code; reach for `supabaseAdmin` (client.server.ts) only when a query
// must deliberately bypass RLS.
import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseFetch } from "./fetch";
import type { Database } from "./types";

export type UserSupabaseClient = SupabaseClient<Database>;

export function createUserClient(accessToken: string): UserSupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    const missing = [
      ...(!url ? ["SUPABASE_URL"] : []),
      ...(!key ? ["SUPABASE_PUBLISHABLE_KEY"] : []),
    ];
    throw new Error(
      `Missing Supabase environment variable(s): ${missing.join(", ")}. Configure the variables for the Mellox AI deployment.`,
    );
  }
  return createClient<Database>(url, key, {
    global: {
      fetch: createSupabaseFetch(key),
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}
