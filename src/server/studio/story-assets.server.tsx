// story-assets.server.tsx — the frame images of a Story: drawn, stored in the
// workspace's own asset folder, and linked to its content rows so the
// publisher sends every frame, in order.
//
// Same contract as carousel slides (carousel-assets.server.ts): the images are
// a function of (frames, look, background pictures), that is hashed, a row
// whose stored hash matches is current, anything else is redrawn right before
// publishing. Rendering failure leaves the editorial draft intact. Publishing
// refuses a designed Story until its current frames are stored successfully.
import "server-only";
import { createHash } from "node:crypto";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { mergeMeta } from "@/lib/content-lifecycle";
import { canRenderText, safeDesign, safeTheme } from "@/lib/studio/carousel/design";
import type { CarouselSpecOutput } from "@/lib/studio/jobs";
import { StoryArt } from "@/lib/stories/StoryArt";
import { framesFromMeta, type StoryFrame } from "@/lib/stories/frames";
import { STORY_CANVAS, cleanMentions } from "@/lib/stories/placement";
import { isWorkspaceStoragePath } from "@/lib/workspace/storage-path";
import { ASSET_BUCKET, persistAsset } from "@/server/assets/persist.server";
import { loadFonts } from "./carousel-render.server";

const RENDER_VERSION = "story-design-1";

function db(): SupabaseClient {
  return supabaseAdmin as unknown as SupabaseClient;
}

export type StoryLook = Pick<CarouselSpecOutput, "design" | "theme" | "brand" | "site">;

export function storyHash(
  frames: StoryFrame[],
  look: StoryLook,
  backgrounds: (string | null)[],
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        v: RENDER_VERSION,
        frames: frames.map((f) => [
          f.role,
          f.kicker ?? "",
          f.heading,
          f.emphasis ?? "",
          f.body,
          (f.options ?? []).join("|"),
        ]),
        design: look.design,
        theme: look.theme,
        brand: look.brand,
        site: look.site ?? "",
        backgrounds: backgrounds.map((b) => b ?? ""),
      }),
    )
    .digest("hex");
}

export function storyRenderable(frames: StoryFrame[], brand: string): boolean {
  return canRenderText(
    [
      brand,
      ...frames.flatMap((f) => [f.heading, f.body, f.kicker ?? "", ...(f.options ?? [])]),
    ].join(" "),
  );
}

async function readPicture(workspaceId: string, path: string | null): Promise<string | null> {
  if (!path || !isWorkspaceStoragePath(path, workspaceId)) return null;
  try {
    const { data, error } = await db().storage.from(ASSET_BUCKET).download(path);
    if (error || !data) return null;
    const fitted = await sharp(Buffer.from(await data.arrayBuffer()))
      .resize(STORY_CANVAS.width, STORY_CANVAS.height, { fit: "cover" })
      .jpeg({ quality: 88 })
      .toBuffer();
    return `data:image/jpeg;base64,${fitted.toString("base64")}`;
  } catch (error) {
    console.warn("[story] background unreadable, drawing without it", error);
    return null;
  }
}

/** One JPEG per frame, in order. Throws if a frame can't be drawn. */
export async function renderStoryFrames(input: {
  frames: StoryFrame[];
  look: StoryLook;
  backgrounds: (string | null)[];
}): Promise<Buffer[]> {
  const design = safeDesign(input.look.design);
  const theme = safeTheme(input.look.theme);
  if (!design || !theme) throw new Error("Story look is not valid");
  const { width, height } = STORY_CANVAS;
  const fonts = await loadFonts([theme.headingFont, theme.bodyFont]);
  const out: Buffer[] = [];
  for (let index = 0; index < input.frames.length; index++) {
    const image = new ImageResponse(
      <StoryArt
        frames={input.frames}
        index={index}
        design={design}
        theme={theme}
        width={width}
        height={height}
        brand={input.look.brand}
        site={input.look.site}
        background={input.backgrounds[index] ?? null}
      />,
      { width, height, ...(fonts.length ? { fonts } : {}) },
    );
    const png = Buffer.from(await image.arrayBuffer());
    out.push(await sharp(png).jpeg({ quality: 90, mozjpeg: true }).toBuffer());
  }
  return out;
}

function cleanBackgrounds(workspaceId: string, paths: unknown, count: number): (string | null)[] {
  const list = Array.isArray(paths) ? paths : [];
  return Array.from({ length: count }, (_, i) => {
    const p = list[i];
    return typeof p === "string" && isWorkspaceStoragePath(p, workspaceId) ? p : null;
  });
}

/**
 * Draw the frames, store them, and point the content rows at them. Returns
 * null (and changes nothing) when the frames can't be drawn or stored.
 */
export async function storeStoryFrames(args: {
  workspaceId: string;
  contentItemIds: string[];
  frames: StoryFrame[];
  look: StoryLook;
  /** Storage paths of pictures behind frames, by frame index. */
  backgroundPaths?: (string | null)[];
}): Promise<{ paths: string[]; hash: string } | null> {
  const { workspaceId, look } = args;
  const frames = args.frames;
  if (!frames.length || !safeDesign(look.design) || !safeTheme(look.theme)) return null;
  if (!storyRenderable(frames, look.brand)) return null;
  const backgroundPaths = cleanBackgrounds(workspaceId, args.backgroundPaths, frames.length);
  const hash = storyHash(frames, look, backgroundPaths);
  try {
    const backgrounds = await Promise.all(backgroundPaths.map((p) => readPicture(workspaceId, p)));
    const images = await renderStoryFrames({ frames, look, backgrounds });
    const stored: { id: string; path: string }[] = [];
    for (const [i, image] of images.entries()) {
      const saved = await persistAsset({
        workspaceId,
        idempotencyKey: `story:${hash.slice(0, 32)}:${i}`,
        dataUrl: `data:image/jpeg;base64,${image.toString("base64")}`,
        assetType: "image",
        filename: `mellox-story-${hash.slice(0, 8)}-${String(i + 1).padStart(2, "0")}`,
        provider: "mellox",
        model: RENDER_VERSION,
        promptVersion: RENDER_VERSION,
        metadata: { source: "studio-story", frame: i + 1, frames: images.length, hash },
      });
      if (!saved.ok || !saved.asset.storage_path) {
        console.warn("[story] frame not stored", saved.ok ? "no path" : saved.message);
        return null;
      }
      stored.push({ id: saved.asset.id, path: saved.asset.storage_path });
    }
    const paths = stored.map((s) => s.path);
    await linkStory(workspaceId, args.contentItemIds, {
      hash,
      paths,
      firstAssetId: stored[0].id,
      backgroundPaths,
      look,
    });
    return { paths, hash };
  } catch (error) {
    console.error("[story] frames could not be drawn", error);
    return null;
  }
}

async function linkStory(
  workspaceId: string,
  contentItemIds: string[],
  link: {
    hash: string;
    paths: string[];
    firstAssetId: string;
    backgroundPaths: (string | null)[];
    look: StoryLook;
  },
) {
  if (!contentItemIds.length) return;
  const { data: rows, error: readError } = await db()
    .from("content_items")
    .select("id, meta")
    .in("id", contentItemIds)
    .eq("workspace_id", workspaceId);
  if (readError) throw new Error(readError.message);
  if ((rows ?? []).length !== contentItemIds.length)
    throw new Error("Story content changed during rendering");
  for (const row of (rows ?? []) as Array<{ id: string; meta: unknown }>) {
    const meta = record(row.meta);
    const story = record(meta.story);
    const { error } = await db()
      .from("content_items")
      .update({
        media_url: null,
        meta: mergeMeta(row.meta, {
          story: {
            ...story,
            spec: { ...record(story.spec), ...link.look },
            background_paths: link.backgroundPaths,
            hash: link.hash,
          },
          asset_storage_paths: link.paths,
          asset_id: link.firstAssetId,
          asset_storage_path: link.paths[0],
          asset_status: "ready",
          media_type: "image",
        }),
      })
      .eq("id", row.id)
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(`Story content link failed: ${error.message}`);
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** The stored look of a Story row, re-validated (meta is user-editable). */
export function storyLookFromMeta(meta: unknown): StoryLook | null {
  const story = record(record(meta).story);
  const spec = record(story.spec);
  const design = safeDesign(spec.design);
  const theme = safeTheme(spec.theme);
  if (!design || !theme) return null;
  return {
    design,
    theme,
    brand: typeof spec.brand === "string" ? spec.brand.slice(0, 80) : "",
    site: typeof spec.site === "string" ? spec.site.slice(0, 80) : undefined,
  };
}

/**
 * The frame images to publish for a Story row, drawn again first if the frames
 * changed since they were stored. Null means a video Story, another content
 * type, or a rendering failure. The publisher refuses a designed frame Story
 * when this function returns null, so an edit cannot send stale artwork.
 */
export async function ensureStoryMedia(item: {
  id: string;
  workspace_id: string;
  kind?: string | null;
  meta?: unknown;
}): Promise<string[] | null> {
  const meta = record(item.meta);
  if (item.kind !== "story" && meta.studio_type !== "story") return null;
  const story = record(meta.story);
  if (story.mode === "video") return null;
  const look = storyLookFromMeta(meta);
  const frames = framesFromMeta(meta);
  if (!look || !frames.length) return null;
  const backgroundPaths = cleanBackgrounds(
    item.workspace_id,
    story.background_paths,
    frames.length,
  );
  const paths = Array.isArray(meta.asset_storage_paths)
    ? (meta.asset_storage_paths as unknown[])
    : typeof meta.asset_storage_path === "string"
      ? [meta.asset_storage_path]
      : [];
  const current =
    story.hash === storyHash(frames, look, backgroundPaths) &&
    paths.length === frames.length &&
    paths.every((p) => isWorkspaceStoragePath(p, item.workspace_id));
  if (current) return paths as string[];
  const redrawn = await storeStoryFrames({
    workspaceId: item.workspace_id,
    contentItemIds: [item.id],
    frames,
    look,
    backgroundPaths,
  });
  return redrawn?.paths ?? null;
}

/** Instagram usernames to tag, from a Story row's meta. */
export function storyMentions(meta: unknown): string[] {
  return cleanMentions(record(record(meta).story).mentions);
}
