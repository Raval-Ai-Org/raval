// A ready-made creator's photo (public/creators/<id>.jpg, an original
// generated person) becomes a workspace asset once, so a video provider gets
// the same signed, validated reference as any other image. Never throws: no
// photo means the creator is described in words instead.
import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { creatorPhotoPath, stockCreator } from "@/lib/ugc/creators";
import { storeReferenceBytes } from "@/server/assets/reference-image.server";
import { log } from "@/server/observability/logger";

export async function stockCreatorAsset(workspaceId: string, id: string): Promise<string | null> {
  const creator = stockCreator(id);
  const path = creator ? creatorPhotoPath(creator.id) : null;
  if (!creator || !path) return null;
  try {
    const bytes = await readFile(join(process.cwd(), "public", path));
    const stored = await storeReferenceBytes(
      workspaceId,
      new Uint8Array(bytes),
      `creator-${creator.id}.jpg`,
      null,
      // Same key, same asset: one copy per workspace and photo version.
      { source: "ugc-creator", idempotencyKey: `ugc-creator:${creator.id}:v1` },
    );
    return stored.assetId;
  } catch (error) {
    log.warn("ugc.creator_photo_unavailable", {
      creator: creator.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
