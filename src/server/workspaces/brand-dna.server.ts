// brand-dna.server.ts — Brand DNA lives in public.workspace_brand_dna, one row
// per workspace. AI paths load it by the request's VERIFIED workspace id, so a
// prompt can only ever carry the brand it runs for.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type StoredBrandDna = {
  dna: Record<string, unknown>;
  version: number;
  updatedAt: string;
};

const MAX_DNA_BYTES = 400_000;

// Transient extraction state is per browser, not part of the brand.
const TRANSIENT_FIELDS = ["status", "lastError"] as const;

export function sanitizeBrandDna(dna: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...dna };
  for (const f of TRANSIENT_FIELDS) delete out[f];
  return out;
}

export async function readBrandDna(
  db: SupabaseClient,
  workspaceId: string,
): Promise<StoredBrandDna | null> {
  const { data, error } = await db
    .from("workspace_brand_dna")
    .select("dna, version, updated_at")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    dna: (data.dna ?? {}) as Record<string, unknown>,
    version: Number(data.version) || 1,
    updatedAt: data.updated_at as string,
  };
}

/** Service-role write; the caller has already checked the workspace role. */
export async function writeBrandDna(args: {
  workspaceId: string;
  userId: string;
  dna: Record<string, unknown>;
}): Promise<StoredBrandDna> {
  const dna = sanitizeBrandDna(args.dna);
  if (JSON.stringify(dna).length > MAX_DNA_BYTES) {
    throw new Error("Brand DNA is too large to save");
  }
  const db = supabaseAdmin as unknown as SupabaseClient;
  const existing = await readBrandDna(db, args.workspaceId);
  const version = (existing?.version ?? 0) + 1;
  const updatedAt = new Date().toISOString();
  const { error } = await db.from("workspace_brand_dna").upsert(
    {
      workspace_id: args.workspaceId,
      dna,
      version,
      updated_by: args.userId,
      updated_at: updatedAt,
    },
    { onConflict: "workspace_id" },
  );
  if (error) {
    console.error("[brand-dna] save failed", error.code, error.message);
    throw new Error("Could not save Brand DNA");
  }
  return { dna, version, updatedAt };
}
