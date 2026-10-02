// carousel-assets.server.ts — the slide images of a carousel: drawn, stored in
// the workspace's own asset folder, and linked to its content rows so the
// publisher sends every slide, not just a cover.
//
// The images are a function of (slides, look, cover picture). That is hashed;
// a row whose stored hash matches is already up to date, anything else is
// redrawn. Editing a slide therefore never publishes a stale image: the
// publisher asks ensureCarouselMedia() right before it sends.
//
// Everything here fails open. A carousel that can't be drawn (a script the
// fonts don't cover, a storage hiccup) keeps working exactly as it did before
// slide images existed.
import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { mergeMeta } from "@/lib/content-lifecycle";
import { safeDesign, safeTheme } from "@/lib/studio/carousel/design";
import { normalizeSlides } from "@/lib/studio/carousel/story";
import type { CarouselSlide, CarouselSpecOutput } from "@/lib/studio/jobs";
import { isWorkspaceStoragePath } from "@/lib/workspace/storage-path";
import { ASSET_BUCKET, persistAsset } from "@/server/assets/persist.server";
import { carouselRenderable, renderCarouselSlides } from "./carousel-render.server";

const RENDER_VERSION = "carousel-design-1";

export type StoredCarousel = { paths: string[]; hash: string };

type Spec = CarouselSpecOutput & { ratio?: string | null };

function db(): SupabaseClient {
  return supabaseAdmin as unknown as SupabaseClient;
}

export function carouselHash(
  slides: CarouselSlide[],
  spec: Spec,
  coverPath: string | null,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        v: RENDER_VERSION,
        slides: slides.map((s) => [s.role, s.kicker ?? "", s.heading, s.emphasis ?? "", s.body]),
        design: spec.design,
        theme: spec.theme,
        brand: spec.brand,
        site: spec.site ?? "",
        ratio: spec.ratio ?? "4:5",
        cover: coverPath ?? "",
      }),
    )
    .digest("hex");
}

async function readCover(workspaceId: string, path: string | null): Promise<Buffer | null> {
  if (!path || !isWorkspaceStoragePath(path, workspaceId)) return null;
  const { data, error } = await db().storage.from(ASSET_BUCKET).download(path);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

/**
 * Draw the slides, store them, and point the content rows at them. Returns
 * null (and changes nothing) when the slides can't be drawn or stored.
 */
export async function storeCarouselSlides(args: {
  workspaceId: string;
  contentItemIds: string[];
  slides: CarouselSlide[];
  spec: Spec;
  /** Storage path of the generated cover picture, if there is one. */
  coverPath?: string | null;
}): Promise<StoredCarousel | null> {
  const { workspaceId, spec } = args;
  const design = safeDesign(spec.design);
  const theme = safeTheme(spec.theme);
  const slides = normalizeSlides(args.slides, args.slides.length);
  if (!design || !theme || slides.length < 2) return null;
  if (!carouselRenderable({ slides, brand: spec.brand })) return null;
  const coverPath =
    args.coverPath && isWorkspaceStoragePath(args.coverPath, workspaceId) ? args.coverPath : null;
  const hash = carouselHash(slides, spec, coverPath);

  try {
    const images = await renderCarouselSlides({
      slides,
      design,
      theme,
      ratio: spec.ratio,
      brand: spec.brand,
      site: spec.site,
      coverArt: await readCover(workspaceId, coverPath),
    });
    const stored: { id: string; path: string }[] = [];
    for (const [i, image] of images.entries()) {
      const saved = await persistAsset({
        workspaceId,
        idempotencyKey: `carousel:${hash.slice(0, 32)}:${i}`,
        dataUrl: `data:image/jpeg;base64,${image.toString("base64")}`,
        assetType: "image",
        filename: `mellox-carousel-${hash.slice(0, 8)}-${String(i + 1).padStart(2, "0")}`,
        provider: "mellox",
        model: RENDER_VERSION,
        promptVersion: RENDER_VERSION,
        metadata: { source: "studio-carousel", slide: i + 1, slides: images.length, hash },
      });
      if (!saved.ok || !saved.asset.storage_path) {
        console.warn("[carousel] slide not stored", saved.ok ? "no path" : saved.message);
        return null;
      }
      stored.push({ id: saved.asset.id, path: saved.asset.storage_path });
    }
    const paths = stored.map((s) => s.path);
    await linkCarousel(workspaceId, args.contentItemIds, spec, {
      hash,
      paths,
      coverPath,
      firstAssetId: stored[0].id,
    });
    return { paths, hash };
  } catch (error) {
    console.error("[carousel] slides could not be drawn", error);
    return null;
  }
}

async function linkCarousel(
  workspaceId: string,
  contentItemIds: string[],
  spec: Spec,
  link: { hash: string; paths: string[]; coverPath: string | null; firstAssetId: string },
) {
  if (!contentItemIds.length) return;
  const { data: rows } = await db()
    .from("content_items")
    .select("id, meta")
    .in("id", contentItemIds)
    .eq("workspace_id", workspaceId);
  for (const row of (rows ?? []) as Array<{ id: string; meta: unknown }>) {
    const { error } = await db()
      .from("content_items")
      .update({
        media_url: null,
        meta: mergeMeta(row.meta, {
          carousel: { ...spec, cover_path: link.coverPath, hash: link.hash },
          asset_storage_paths: link.paths,
          // The first slide stands for the post everywhere one picture is shown.
          asset_id: link.firstAssetId,
          asset_storage_path: link.paths[0],
          asset_status: "ready",
          media_type: "image",
        }),
      })
      .eq("id", row.id)
      .eq("workspace_id", workspaceId);
    if (error) console.warn("[carousel] content link failed", row.id, error.message);
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * The slide images to publish for a content row, drawn again first if the
 * slides changed since they were stored. Null means "not a designed carousel"
 * or "couldn't draw": the caller then publishes the row as it always did.
 *
 * `item.meta` is user-editable, so every path is checked against the row's own
 * workspace and the look is re-validated before anything is drawn.
 */
export async function ensureCarouselMedia(item: {
  id: string;
  workspace_id: string;
  kind?: string | null;
  meta?: unknown;
}): Promise<string[] | null> {
  const meta = record(item.meta);
  if (item.kind !== "carousel" && meta.studio_type !== "carousel") return null;
  const stored = record(meta.carousel);
  const rawSlides = Array.isArray(meta.slides) ? meta.slides : [];
  if (!stored.design || !stored.theme || rawSlides.length < 2) return null;
  const design = safeDesign(stored.design);
  const theme = safeTheme(stored.theme);
  if (!design || !theme) return null;

  const spec: Spec = {
    design,
    theme,
    brand: typeof stored.brand === "string" ? stored.brand.slice(0, 80) : "",
    site: typeof stored.site === "string" ? stored.site.slice(0, 80) : undefined,
    structure: typeof stored.structure === "string" ? stored.structure : undefined,
    ratio:
      typeof stored.ratio === "string"
        ? stored.ratio
        : typeof meta.aspect_ratio === "string"
          ? meta.aspect_ratio
          : "4:5",
  };
  const slides = normalizeSlides(rawSlides, rawSlides.length);
  const coverPath =
    typeof stored.cover_path === "string" &&
    isWorkspaceStoragePath(stored.cover_path, item.workspace_id)
      ? stored.cover_path
      : null;
  const paths = Array.isArray(meta.asset_storage_paths)
    ? (meta.asset_storage_paths as unknown[])
    : [];
  const current =
    stored.hash === carouselHash(slides, spec, coverPath) &&
    paths.length === slides.length &&
    paths.every((p) => isWorkspaceStoragePath(p, item.workspace_id));
  if (current) return paths as string[];

  const redrawn = await storeCarouselSlides({
    workspaceId: item.workspace_id,
    contentItemIds: [item.id],
    slides,
    spec,
    coverPath,
  });
  return redrawn?.paths ?? null;
}
