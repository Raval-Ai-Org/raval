// supabase-ref.ts — the Supabase project the dev server's browser client talks
// to, for Playwright specs that stub its network and seed a fake session.
//
// Derived rather than hardcoded: the specs used to pin an old project ref, so
// once .env moved to a new project the fake session landed under the wrong
// localStorage key and every stub matched the wrong host. Resolution mirrors
// the app (src/integrations/supabase/client.ts reads NEXT_PUBLIC_SUPABASE_URL,
// then SUPABASE_URL) and Next's env loading (.env.local overrides .env).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const URL_KEYS = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"] as const;

function readEnvFile(file: string): Record<string, string> {
  const full = path.resolve(process.cwd(), file);
  if (!existsSync(full)) return {};
  const vars: Record<string, string> = {};
  for (const line of readFileSync(full, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) vars[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  return vars;
}

function resolveSupabaseUrl(): string {
  const sources = [process.env, readEnvFile(".env.local"), readEnvFile(".env")];
  for (const key of URL_KEYS) {
    for (const source of sources) {
      const value = source[key];
      if (value) return value;
    }
  }
  throw new Error(
    "tests/fixtures/supabase-ref: set NEXT_PUBLIC_SUPABASE_URL (env or .env) so specs stub the same Supabase project as the dev server.",
  );
}

function refFromUrl(url: string): string {
  const host = new URL(url).hostname;
  const m = host.match(/^([a-z0-9]+)\.supabase\.co$/);
  if (!m)
    throw new Error(`tests/fixtures/supabase-ref: "${host}" is not a *.supabase.co project URL.`);
  return m[1];
}

export const SUPABASE_REF = refFromUrl(resolveSupabaseUrl());
export const SUPABASE_HOST = `${SUPABASE_REF}.supabase.co`;
/** supabase-js's default session key in localStorage for this project. */
export const STORAGE_KEY = `sb-${SUPABASE_REF}-auth-token`;
