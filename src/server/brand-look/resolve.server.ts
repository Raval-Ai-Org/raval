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
import { applyVisualTaste } from "@/lib/brand-visuals/apply";
import { loadGenerationVisualSnapshot } from "@/server/brand-visuals/service.server";
import { ProfileSchema, type VisualSnapshot } from "@/lib/brand-visuals/contracts";
import { ownDesignLine } from "@/lib/brand-visuals/bible";

export type LoadedLook = {
  visualTaste?: VisualSnapshot | null;
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

/**
 * The brand's own learned design in words (the active style direction from
 * Inspo's site or post read), or null. One small read by the verified
 * workspace id; a missing table or a failed read is "no design", never an error.
 */
async function loadOwnDesign(workspaceId: string): Promise<string | null> {
  try {
    const settings = await admin()
      .from("brand_visual_settings")
      .select("active_profile_id")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    const id = (settings.data as { active_profile_id?: string | null } | null)?.active_profile_id;
    if (!id) return null;
    const row = await admin()
      .from("brand_visual_profiles")
      .select("profile")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .eq("status", "approved")
      .maybeSingle();
    const parsed = ProfileSchema.safeParse((row.data as { profile?: unknown } | null)?.profile);
    if (!parsed.success) return null;
    return ownDesignLine(parsed.data.directions[parsed.data.selected]);
  } catch {
    return null;
  }
}

export async function loadBrandLook(
  workspaceId: string,
  opts: { dna?: Record<string, unknown> | null; includeVisualTaste?: boolean } = {},
): Promise<LoadedLook> {
  // Existing writing/chat callers retain the original Look. Media callers opt in.
  const withVisualTaste = async (value: LoadedLook): Promise<LoadedLook> => {
    if (!opts.includeVisualTaste) return value;
    const visualTaste = await loadGenerationVisualSnapshot(workspaceId, "image");
    return {
      ...value,
      visualTaste,
      look: applyVisualTaste(value.look, value.dna?.look, visualTaste),
    };
  };
  if (opts.dna !== undefined) {
    const ownDesign = await loadOwnDesign(workspaceId);
    return withVisualTaste({
      look: resolveLook(opts.dna as never, { ownDesign }),
      dna: opts.dna ?? null,
    });
  }
  const hit = cache.get(workspaceId);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return withVisualTaste(hit.value);
  }
  const [stored, ownDesign] = await Promise.all([
    readBrandDna(admin(), workspaceId).catch(() => null),
    loadOwnDesign(workspaceId),
  ]);
  const dna = stored?.dna ?? null;
  const value: LoadedLook = { look: resolveLook(dna as never, { ownDesign }), dna };
  cache.set(workspaceId, { at: Date.now(), value });
  return withVisualTaste(value);
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
