// prompt-media.server.ts — the person's own photos and clips, for "Write it
// for me". The description is written around what is really in them, so the
// piece uses each one where it fits.
//
// Asset ids only, checked against the verified workspace (the same checks as
// generation). Photos are read like the writing step reads them; a clip is
// seen through one still near its start. Anything unreadable is left out:
// the description is still written, never failed, because of a picture.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import type { LlmImageInput } from "@/lib/ai-gateway.server";
import type { StudioControls } from "@/lib/studio/jobs";
import type { StudioType } from "@/lib/studio/formats";
import { signAssetPath } from "@/server/assets/persist.server";
import { safeFetch } from "@/server/safe-fetch";
import { isWorkspaceStoragePath } from "@/lib/workspace/storage-path";
import {
  resolveStudioClips,
  resolveStudioReferences,
  studioReferenceImages,
} from "./references.server";
import { grabFrame } from "./clip-edit/ffmpeg.server";

export type PromptMedia = {
  images: LlmImageInput[];
  /** What the images are, in order, for the prompt. Empty when there are none. */
  note: string;
};

const NONE: PromptMedia = { images: [], note: "" };
const MAX_CLIP_STILLS = 5;

const MODE_NOTE: Record<NonNullable<StudioControls["referenceMode"]>, string> = {
  design: "Mellox will design around these photos and keep them exactly as shot.",
  preserve: "Mellox will post the first photo as it is.",
  edit: "Mellox will edit the first photo as described.",
  inspire: "Mellox will use the photos only as inspiration for a new picture.",
  hero: "Mellox will stage the product from these photos.",
};

/** Which media the description should be written around, from the controls. */
export function attachedMedia(type: StudioType, controls: Partial<StudioControls> | undefined) {
  const c = controls ?? {};
  const videoMode = type === "video" ? (c.videoMode ?? "generate") : null;
  if (videoMode === "site") return { photoIds: [], clipIds: [] };
  if (videoMode === "brand") return { photoIds: [], clipIds: c.sourceVideoAssetIds ?? [] };
  return { photoIds: c.referenceAssetIds ?? [], clipIds: [] };
}

export async function loadPromptMedia(args: {
  client: SupabaseClient;
  workspaceId: string;
  type: StudioType;
  controls?: Partial<StudioControls>;
}): Promise<PromptMedia> {
  const { photoIds, clipIds } = attachedMedia(args.type, args.controls);
  if (!photoIds.length && !clipIds.length) return NONE;
  try {
    if (clipIds.length) {
      const stills = await clipStills(args.client, args.workspaceId, clipIds);
      if (!stills.length) return NONE;
      return {
        images: stills,
        note: [
          `The person attached ${clipIds.length} video clip${clipIds.length === 1 ? "" : "s"} of their own. The images are one still from each clip, in order (Clip 1, Clip 2, …).`,
          "Mellox cuts the best part of each clip and adds the brand's design; the footage itself is kept.",
          "Write the description around this footage: name each clip by number, say what it shows, the order they play in, and the words or captions that go over each.",
        ].join("\n"),
      };
    }
    const references = await resolveStudioReferences(args.client, args.workspaceId, photoIds);
    const images = await studioReferenceImages(references);
    if (!images.length) return NONE;
    const mode = args.controls?.referenceMode ?? "preserve";
    const recap = args.type === "video" && args.controls?.videoMode === "recap";
    return {
      images,
      note: [
        `The person attached ${images.length} photo${images.length === 1 ? "" : "s"} of their own. The images are those photos, in order (Photo 1, Photo 2, …).`,
        recap ? "Mellox will make a video from these photos in this order." : MODE_NOTE[mode],
        "Write the description around these photos: name each photo by number, say what it shows, and where it is used (the cover, a slide, a frame, the main picture). Describe only what is really visible.",
      ].join("\n"),
    };
  } catch (error) {
    console.warn(
      "[studio] attached media left out of the prompt",
      error instanceof Error ? error.message.slice(0, 200) : "unreadable",
    );
    return NONE;
  }
}

/** One still per clip, about a second in, as WebP. A clip that can't be read is skipped. */
async function clipStills(
  client: SupabaseClient,
  workspaceId: string,
  clipIds: string[],
): Promise<LlmImageInput[]> {
  const clips = await resolveStudioClips(client, workspaceId, clipIds.slice(0, MAX_CLIP_STILLS));
  const dir = await mkdtemp(join(tmpdir(), "mellox-prompt-"));
  try {
    const stills: LlmImageInput[] = [];
    for (const [index, clip] of clips.entries()) {
      try {
        const url = await signAssetPath(clip.storagePath);
        if (!url) continue;
        const { bytes } = await safeFetch(url, {
          maxBytes: 60 * 1024 * 1024,
          timeoutMs: 30_000,
          onOverflow: "error",
        });
        const input = join(dir, `clip-${index}`);
        await writeFile(input, Buffer.from(bytes));
        const frame = await grabFrame(input, 1, join(dir, `still-${index}.png`)).catch(() =>
          grabFrame(input, 0, join(dir, `still-${index}-0.png`)),
        );
        const image = await sharp(frame)
          .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: 80 })
          .toBuffer();
        stills.push({ mediaType: "image/webp", data: image.toString("base64") });
      } catch (error) {
        console.warn(
          "[studio] clip still left out of the prompt",
          clip.id,
          error instanceof Error ? error.message.slice(0, 200) : "unreadable",
        );
      }
    }
    return stills;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * The top of the brand's own website (the newest full-page capture from the
 * Brand DNA scan), so the writer sees what the brand sells and how it looks.
 * Context only: it is never the piece's photo. Read with the caller's client,
 * so RLS keeps it to the workspace; anything unreadable is left out.
 */
export async function loadSiteGlance(
  client: SupabaseClient,
  workspaceId: string,
): Promise<PromptMedia> {
  try {
    const { data } = await client
      .from("assets")
      .select("id,storage_path,metadata,created_at")
      .eq("workspace_id", workspaceId)
      .eq("metadata->>source", "website_capture")
      .eq("metadata->region->>type", "full")
      .order("created_at", { ascending: false })
      .limit(1);
    const row = (data ?? [])[0] as { storage_path?: string | null } | undefined;
    if (!row?.storage_path || !isWorkspaceStoragePath(row.storage_path, workspaceId)) return NONE;
    const url = await signAssetPath(row.storage_path);
    if (!url) return NONE;
    const { bytes } = await safeFetch(url, {
      maxBytes: 45 * 1024 * 1024,
      timeoutMs: 20_000,
      onOverflow: "error",
    });
    const source = sharp(Buffer.from(bytes), { limitInputPixels: 1024 * 18_000 * 4 });
    const meta = await source.metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (!width || !height) return NONE;
    // The first two screens: the hero, the offer and the way the brand speaks.
    const top = Math.min(height, Math.round(width * 1.25));
    const image = await source
      .extract({ left: 0, top: 0, width, height: top })
      .resize(1024, 1280, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 72 })
      .toBuffer();
    return {
      images: [{ mediaType: "image/webp", data: image.toString("base64") }],
      note: "The image is the top of the brand's own website, for context only: what it sells, its headline, its colours and the way it speaks. Make the piece fit this brand; never describe this screenshot as the piece's picture and never copy its words unless they are the brand's own offer.",
    };
  } catch (error) {
    console.warn(
      "[studio] site capture left out of the prompt",
      error instanceof Error ? error.message.slice(0, 200) : "unreadable",
    );
    return NONE;
  }
}
