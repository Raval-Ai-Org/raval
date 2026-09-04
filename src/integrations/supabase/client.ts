import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

function createSupabaseFetch(supabaseKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );

    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }

    // New Supabase API keys are opaque strings, not bearer JWTs.
    if (
      isNewSupabaseApiKey(supabaseKey) &&
      headers.get("Authorization") === `Bearer ${supabaseKey}`
    ) {
      headers.delete("Authorization");
    }

    headers.set("apikey", supabaseKey);
    return fetch(input, { ...init, headers });
  };
}

function createSupabaseClient() {
  // Direct process.env access allows Next.js static analysis (SWC/Webpack) to 
  // safely inline NEXT_PUBLIC_* variables into client bundles during `next build`.
  const SUPABASE_URL =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL;

  const SUPABASE_PUBLISHABLE_KEY =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    const missing = [
      ...(!SUPABASE_URL ? ["NEXT_PUBLIC_SUPABASE_URL / SUPABASE_URL"] : []),
      ...(!SUPABASE_PUBLISHABLE_KEY ? ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY / SUPABASE_PUBLISHABLE_KEY"] : []),
    ];
    const message = `Missing Supabase environment variable(s): ${missing.join(", ")}. Configure the variables for the Mellox AI deployment.`;
    console.error(`[Supabase] ${message}`);
    throw new Error(message);
  }

  // Detect placeholder values from .env.example.
  const PLACEHOLDER_PATTERNS = [
    "YOUR_PROJECT_REF",
    "YOUR_PUBLISHABLE",
    "YOUR_SERVICE_ROLE",
    "placeholder",
  ];
  const isPlaceholder = (value: string) => PLACEHOLDER_PATTERNS.some((p) => value.includes(p));

  if (isPlaceholder(SUPABASE_URL) || isPlaceholder(SUPABASE_PUBLISHABLE_KEY)) {
    const message =
      "[Supabase] .env contains placeholder values (YOUR_PROJECT_REF etc.). " +
      "The dev server will start and /login will load, but authentication will " +
      "silently fail because the Supabase client is pointed at a non-existent " +
      "project. Fix: edit raval/.env and replace the placeholders with real " +
      "credentials from 1Password or a teammate. Then restart `npm run dev`.";
    console.error(message);
    throw new Error(message);
  }

  return createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    global: {
      fetch: createSupabaseFetch(SUPABASE_PUBLISHABLE_KEY),
    },
    auth: {
      storage: typeof window !== "undefined" ? localStorage : undefined,
      persistSession: true,
      autoRefreshToken: true,
      flowType: "pkce",
    },
  });
}

let _supabase: ReturnType<typeof createSupabaseClient> | undefined;

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";
export const supabase = new Proxy({} as ReturnType<typeof createSupabaseClient>, {
  get(_, prop, receiver) {
    if (!_supabase) _supabase = createSupabaseClient();
    return Reflect.get(_supabase, prop, receiver);
  },
});