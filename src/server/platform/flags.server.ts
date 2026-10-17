// Database feature flags — the runtime half of the admin console's Flags page.
//
// Use this for NEW gates: `await isFlagOn("new-editor", workspaceId)`. The older
// env-var flags in src/lib/feature-flags.ts are unchanged. Order of precedence:
//   1. env var FEATURE_FLAG_<KEY> (key upper-cased, "." and "-" → "_"), true/false
//   2. the platform_flags row, judged by the pure rules in src/lib/flags/evaluate.ts
//   3. otherwise off — a flag nobody created, or a table that can't be read, is off,
//      because a new feature should never turn itself on by accident.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { evaluateFlag, type FlagRule } from "@/lib/flags/evaluate";

const TTL_MS = 15_000;

export type FlagReader = () => Promise<Record<string, FlagRule>>;

const defaultReader: FlagReader = async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const client = supabaseAdmin as unknown as SupabaseClient;
  const { data, error } = await client
    .from("platform_flags")
    .select("key, enabled, rollout_percent, workspace_ids, expires_at");
  if (error) throw new Error(error.message);
  const out: Record<string, FlagRule> = {};
  for (const row of (data ?? []) as Array<{
    key: string;
    enabled: boolean;
    rollout_percent: number;
    workspace_ids: string[] | null;
    expires_at: string | null;
  }>) {
    out[row.key] = {
      enabled: row.enabled === true,
      rolloutPercent: Number(row.rollout_percent ?? 0),
      workspaceIds: row.workspace_ids ?? [],
      expiresAt: row.expires_at,
    };
  }
  return out;
};

let reader: FlagReader = defaultReader;
let cached: { at: number; value: Record<string, FlagRule> } | null = null;

/** Tests inject a reader. */
export function setFlagReader(next: FlagReader | null): void {
  reader = next ?? defaultReader;
  cached = null;
}

export function clearFlagCache(): void {
  cached = null;
}

export function envFlagName(key: string): string {
  return `FEATURE_FLAG_${key.toUpperCase().replace(/[.-]/g, "_")}`;
}

async function rules(): Promise<Record<string, FlagRule>> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  try {
    const value = await reader();
    cached = { at: Date.now(), value };
    return value;
  } catch (error) {
    console.error(
      "[flags] read failed, treating as off",
      error instanceof Error ? error.message : error,
    );
    return cached?.value ?? {};
  }
}

export async function isFlagOn(key: string, workspaceId?: string | null): Promise<boolean> {
  const env = process.env[envFlagName(key)]?.trim().toLowerCase();
  if (env === "true" || env === "1" || env === "yes") return true;
  if (env === "false" || env === "0" || env === "no") return false;
  const rule = (await rules())[key];
  return rule ? evaluateFlag(key, rule, workspaceId) : false;
}
