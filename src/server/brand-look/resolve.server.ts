// resolve.server.ts — the ONE way a generator gets the brand's look.
//
// Callers pass the request's VERIFIED workspace id. Brand DNA (and the look
// stored on it as `dna.look`) is read here on the server, never taken from the
// browser.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { readBrandDna } from "@/server/workspaces/brand-dna.server";
import { resolveLook, type BrandLook } from "@/lib/brand-look/resolve";

export type LoadedLook = {
  look: BrandLook;
  /** The stored Brand DNA this was resolved against (server copy, never the browser's). */
  dna: Record<string, unknown> | null;
};

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: LoadedLook }>();

/** Brand DNA saves call this (see saveBrandDna). */
export function invalidateLookCache(workspaceId: string) {
  cache.delete(workspaceId);
}

const admin = () => supabaseAdmin as unknown as SupabaseClient;

export async function loadBrandLook(
  workspaceId: string,
  opts: { dna?: Record<string, unknown> | null } = {},
): Promise<LoadedLook> {
  if (opts.dna !== undefined) {
    return { look: resolveLook(opts.dna as never), dna: opts.dna ?? null };
  }
  const hit = cache.get(workspaceId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const stored = await readBrandDna(admin(), workspaceId).catch(() => null);
  const dna = stored?.dna ?? null;
  const value: LoadedLook = { look: resolveLook(dna as never), dna };
  cache.set(workspaceId, { at: Date.now(), value });
  return value;
}

/**
 * Look text for a text generator, or "" when the brand hasn't set anything
 * beyond its Brand DNA facts (those already reach the prompt as brand context).
 * Never throws — generation without a look is still generation.
 */
export async function lookTextFor(workspaceId: string, format: string): Promise<string> {
  try {
    const [{ styleBlockFor }, loaded] = await Promise.all([
      import("@/lib/brand-look/prompt"),
      loadBrandLook(workspaceId),
    ]);
    if (!loaded.look.customized) return "";
    return styleBlockFor(loaded.look, format);
  } catch (error) {
    console.error("[brand-look] look text failed, using Brand DNA only", error);
    return "";
  }
}
