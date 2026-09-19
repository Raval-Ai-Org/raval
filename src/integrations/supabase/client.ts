import { createBrowserClient } from "@supabase/ssr";
import { createSupabaseFetch } from "./fetch";
import type { Database } from "./types";

function createSupabaseClient() {
  // Direct process.env access allows Next.js static analysis (SWC/Webpack) to
  // safely inline NEXT_PUBLIC_* variables into client bundles during `next build`.
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;

  const SUPABASE_PUBLISHABLE_KEY =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    const missing = [
      ...(!SUPABASE_URL ? ["NEXT_PUBLIC_SUPABASE_URL / SUPABASE_URL"] : []),
      ...(!SUPABASE_PUBLISHABLE_KEY
        ? ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY / SUPABASE_PUBLISHABLE_KEY"]
        : []),
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
      "project. Fix: edit the project .env and replace the placeholders with real " +
      "credentials from 1Password or a teammate. Then restart `npm run dev`.";
    console.error(message);
    throw new Error(message);
  }

  const client = createBrowserClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    global: {
      fetch: createSupabaseFetch(SUPABASE_PUBLISHABLE_KEY),
    },
  });

  if (typeof window !== "undefined") {
    try {
      const projectRef = new URL(SUPABASE_URL).hostname.split(".")[0];
      const legacy = window.localStorage.getItem(`sb-${projectRef}-auth-token`);
      if (legacy && !document.cookie.includes(`sb-${projectRef}-auth-token`)) {
        const parsed: unknown = JSON.parse(legacy);
        if (
          parsed &&
          typeof parsed === "object" &&
          "access_token" in parsed &&
          "refresh_token" in parsed &&
          typeof parsed.access_token === "string" &&
          typeof parsed.refresh_token === "string"
        ) {
          void client.auth.setSession({
            access_token: parsed.access_token,
            refresh_token: parsed.refresh_token,
          });
        }
      }
    } catch {}
  }

  return client;
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
