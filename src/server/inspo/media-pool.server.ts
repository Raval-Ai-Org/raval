// The brand's own Inspo media as a rotation pool, and when each was last used.
// Read with the service role, always filtered by the VERIFIED workspace id;
// storage paths are checked by readSources. Never throws: no pool is no pool.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { readSources } from "@/server/brand-visuals/service.server";
import { loadBrandLook } from "@/server/brand-look/resolve.server";
import {
  frequencyOf,
  lifetimeOf,
  pickNamedMedia,
  pickRotationMedia,
  type MediaUseRecord,
  type OwnMediaFrequency,
  type RotationMedia,
  type RotationPick,
} from "@/lib/inspo/media-rotation";

const db = () => supabaseAdmin as unknown as SupabaseClient;
const USE_WINDOW_DAYS = 60;

export type InspoMediaPool = {
  media: RotationMedia[];
  uses: MediaUseRecord[];
  frequency: OwnMediaFrequency;
  /** The brand's newest piece already carried one of these photos. */
  lastPieceUsedMedia: boolean;
};

const EMPTY: InspoMediaPool = {
  media: [],
  uses: [],
  frequency: "sometimes",
  lastPieceUsedMedia: false,
};

export async function loadInspoMediaPool(workspaceId: string): Promise<InspoMediaPool> {
  try {
    const [sources, loaded] = await Promise.all([
      readSources(workspaceId),
      loadBrandLook(workspaceId).catch(() => null),
    ]);
    const media: RotationMedia[] = sources.flatMap((s) => {
      if (s.status !== "approved") return [];
      if (s.purpose !== "product" && s.purpose !== "person") return [];
      const mime = s.asset?.mime_type ?? "";
      const kind = mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : null;
      if (!kind) return [];
      return [
        {
          assetId: s.asset_id,
          kind,
          purpose: s.purpose,
          lifetime: lifetimeOf(s),
          addedAt: s.created_at,
          // The person's own words win over the file name.
          label: s.notes?.trim() || s.label || undefined,
          folder: folderOf(s.region) ?? undefined,
        } satisfies RotationMedia,
      ];
    });
    const frequency = frequencyOf(loaded?.look.visual.ownMedia);
    if (!media.length) return { ...EMPTY, frequency };
    const ids = new Set(media.map((m) => m.assetId));
    const since = new Date(Date.now() - USE_WINDOW_DAYS * 86_400_000).toISOString();
    const { data } = await db()
      .from("studio_jobs")
      .select("input, created_at, parent_job_id")
      .eq("workspace_id", workspaceId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(300);
    const uses: MediaUseRecord[] = [];
    let lastPieceUsedMedia: boolean | null = null;
    for (const row of (data ?? []) as {
      input: unknown;
      created_at: string;
      parent_job_id: string | null;
    }[]) {
      // A revision of a piece isn't a new use of its photos.
      if (row.parent_job_id) continue;
      const refs = referenceIdsOf(row.input).filter((id) => ids.has(id));
      if (lastPieceUsedMedia === null) lastPieceUsedMedia = refs.length > 0;
      for (const id of refs) uses.push({ assetId: id, at: row.created_at });
    }
    return { media, uses, frequency, lastPieceUsedMedia: !!lastPieceUsedMedia };
  } catch (error) {
    console.warn("[inspo-media] pool unavailable; nothing added", error);
    return EMPTY;
  }
}

function referenceIdsOf(input: unknown): string[] {
  const controls = (input as { controls?: Record<string, unknown> } | null)?.controls;
  const ids = [
    ...(Array.isArray(controls?.referenceAssetIds) ? controls.referenceAssetIds : []),
    ...(Array.isArray(controls?.sourceVideoAssetIds) ? controls.sourceVideoAssetIds : []),
  ];
  return ids.filter((id): id is string => typeof id === "string");
}

function folderOf(region: unknown): string | null {
  const folder = (region as { folder?: unknown } | null | undefined)?.folder;
  return typeof folder === "string" && folder.trim() ? folder.trim() : null;
}

/**
 * Own photos for one new piece (Autopilot, campaigns, Write it for me,
 * Studio), or none. Photos the brief names by folder or label always come
 * first; otherwise the rotation's roll decides.
 */
export async function pickInspoMediaFor(
  workspaceId: string,
  format: string,
  seed: string,
  brief?: string,
): Promise<RotationPick | null> {
  const pool = await loadInspoMediaPool(workspaceId);
  if (!pool.media.length) return null;
  const now = new Date();
  const named = brief ? pickNamedMedia({ media: pool.media, brief, format, now }) : null;
  if (named) return named;
  return pickRotationMedia({ ...pool, now, format, seed });
}

/** Only photos the brief names (folder or label), or none. Never a random roll. */
export async function namedInspoMediaFor(
  workspaceId: string,
  format: string,
  brief: string,
): Promise<RotationPick | null> {
  const pool = await loadInspoMediaPool(workspaceId);
  if (!pool.media.length) return null;
  return pickNamedMedia({ media: pool.media, brief, format, now: new Date() });
}
