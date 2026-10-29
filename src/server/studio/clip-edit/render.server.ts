// "Brand my clips" and "Recap from my photos": the brand's own footage (or
// photos) is never redrawn. The image model makes the opening design that is
// laid over the first seconds and a designed end card built around a real
// frame; FFmpeg does the rest. Runs after the response (no queue service):
// the job's media task is collected by advanceStudioJob from the result
// parked here, and a render that stopped is started again from its steps
// (stored files and image calls are keyed, so a restart repeats no charge).
import "server-only";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";
import { cache } from "@/server/cache/store";
import { getRequestScope, runWithScope } from "@/server/request-context";
import { generateImage, type ImageSize } from "@/lib/openrouter-image.server";
import { persistAsset } from "@/server/assets/persist.server";
import { downloadAssetObject } from "@/server/assets/storage.server";
import { isWorkspaceStoragePath } from "@/lib/workspace/storage-path";
import type { AspectRatio } from "@/lib/studio/aspect";
import type { CopyLine } from "@/lib/studio/creative-knowledge";
import {
  END_CARD_SECONDS,
  RECAP_PHOTO_SECONDS,
  planClips,
  videoCanvas,
} from "@/lib/studio/clip-edit";
import { isTalky, pickTransition, transitionFor } from "@/lib/studio/smart-cut";
import {
  CAPTION_BAND_NOTE,
  MIN_SPEECH_SHARE,
  believableSegments,
  buildCues,
  captionBox,
  captionColours,
  speechShare,
} from "@/lib/studio/captions";
import { judgeFaces, judgeLayer } from "@/lib/studio/photo-design/checks";
import {
  findRegions,
  layerOverlay,
  photoMask,
  visibleShare,
} from "@/lib/studio/photo-design/geometry";
import { planPhotoDesign, type PhotoDesignPlan } from "@/lib/studio/photo-design/plan";
import { designLayerPrompt, type PhotoDesignBrand } from "@/lib/studio/photo-design/prompt";
import type { PhotoReading } from "@/lib/studio/photo-design/read";
import { resolveStudioClips, resolveStudioReferences } from "../references.server";
import { logoLayers, type LogoCorner } from "../logo-overlay.server";
import { composePhotoDesign } from "../photo-design/compose.server";
import {
  loadDesignPhotos,
  readDesignPhotos,
  type DesignPhoto,
} from "../photo-design/photos.server";
import {
  analyzeClip,
  audioSilences,
  brandVideo,
  fitClip,
  grabFrame,
  joinWithTransitions,
  probeVideo,
  siteScroll,
  stillClip,
  writeCaptionTrack,
} from "./ffmpeg.server";
import { siteFramePng } from "./site-frame.server";
import {
  MAX_SITE_SCREENS,
  scrollExpression,
  siteDevice,
  siteFrame,
  siteStops,
  siteTimeline,
} from "@/lib/studio/site-reel";
import { captionsDrawable, renderCaptionImages } from "./captions.server";
import { transcribeVideo } from "./transcribe.server";

export const CLIP_EDIT_PREFIX = "clip-edit:";

/** Stored on the Studio media task while the video is put together. */
export type ClipEditTask = {
  /** "site": the brand's website capture scrolling in a device (site-reel.ts). */
  mode: "brand" | "recap" | "site";
  motion?: "camera" | "ai";
  /** "Brand my clips": the person's clips, by asset id. */
  clipAssetIds: string[];
  /** "Recap": the person's photos, by asset id, in their order. */
  photoAssetIds: string[];
  /** AI motion: the media slots of the animated photos this waits for. */
  waitFor?: string[];
  /** Set once the render has been started (or started again). */
  startedAt?: number;
  ratio: AspectRatio;
  brief: string;
  copy: CopyLine[];
  endCopy: CopyLine[];
  brand: PhotoDesignBrand;
  logo?: { url: string; corner: LogoCorner };
  revision?: string;
  emphasisSeed: string;
  /** "Brand my clips": captions of what is said (on unless turned off). */
  captions?: boolean;
};

export type ClipEditResult =
  | { state: "running"; at: number }
  | { state: "done"; assetId: string; storagePath: string; warnings: string[] }
  | { state: "failed"; message: string };

/** No sign of life for this long and the render is started again. */
export const CLIP_EDIT_STALL_MS = 6 * 60_000;
const RESULT_TTL = 24 * 60 * 60;

export const CLIP_EDIT_FAILED =
  "We couldn't put your video together. Try again, or use fewer or shorter clips.";

const key = (taskId: string) => `studio:clip-edit:${taskId}`;

export function readClipEdit(taskId: string): Promise<ClipEditResult | null> {
  return cache.get<ClipEditResult>(key(taskId));
}

function park(taskId: string, result: ClipEditResult) {
  return cache.set(key(taskId), result, RESULT_TTL);
}

const SIZE: Record<AspectRatio, ImageSize> = {
  "1:1": "1024x1024",
  "4:5": "1024x1280",
  "3:4": "1024x1280",
  "4:3": "1792x1024",
  "16:9": "1792x1024",
  "9:16": "1024x1792",
};

export type ClipEditArgs = {
  client: SupabaseClient;
  workspaceId: string;
  jobId: string;
  taskId: string;
  task: ClipEditTask;
  contentItemIds: string[];
  /** AI motion: the stored animated clips, in photo order. */
  motionPaths?: string[];
};

/** Start (or start again) the render after the response is sent. */
export function startClipEdit(args: ClipEditArgs): void {
  const scope = getRequestScope();
  const run = () => runWithScope({ ...scope }, () => renderClipEdit(args));
  void park(args.taskId, { state: "running", at: Date.now() });
  try {
    after(run);
  } catch {
    // No request to wait behind (a worker or a test): run it detached.
    void run();
  }
}

/** A cover crop of a photo around its focus point, at `width`×`height`. */
async function coverAt(
  photo: DesignPhoto,
  focus: { x: number; y: number },
  width: number,
  height: number,
) {
  const scale = Math.max(width / photo.width, height / photo.height);
  const w = Math.max(width, Math.ceil(photo.width * scale));
  const h = Math.max(height, Math.ceil(photo.height * scale));
  const left = Math.round(Math.min(w - width, Math.max(0, focus.x * w - width / 2)));
  const top = Math.round(Math.min(h - height, Math.max(0, focus.y * h - height / 2)));
  return sharp(photo.bytes).resize(w, h).extract({ left, top, width, height }).png().toBuffer();
}

async function asPhoto(bytes: Buffer): Promise<DesignPhoto> {
  const { data, info } = await sharp(bytes).png().toBuffer({ resolveWithObject: true });
  return { bytes: data, width: info.width, height: info.height };
}

const asDataUrl = async (photo: DesignPhoto) =>
  `data:image/jpeg;base64,${(await sharp(photo.bytes).resize(1024, 1024, { fit: "inside" }).jpeg({ quality: 82 }).toBuffer()).toString("base64")}`;

async function layerImage(prompt: string, ratio: AspectRatio, references: string[]) {
  const image = await generateImage({
    prompt,
    size: SIZE[ratio],
    routing: { referenceAssets: references },
    background: process.env.IMAGE_DESIGN_LAYER_TRANSPARENT === "yes" ? "transparent" : undefined,
  });
  return Buffer.from(image.b64, "base64");
}

const VIDEO_NOTE =
  "This layer is laid over the opening seconds of a moving video. Keep the design light: words and shapes along the edges and in a lower third, the middle of the frame left open so the footage reads. Nothing that only makes sense as a still poster.";

/**
 * The opening design as a see-through PNG at the video's size. One more is
 * asked for if the first hides too much of the footage or a face; null when
 * neither works (the render then fails, never shows a stand-in design).
 */
async function openingOverlay(
  task: ClipEditTask,
  hero: DesignPhoto,
  reading: PhotoReading,
  canvas: { width: number; height: number },
  captionBand: boolean,
): Promise<Buffer | null> {
  const plan: PhotoDesignPlan = planPhotoDesign({
    readings: [reading],
    sizes: [canvas],
    ratio: task.ratio,
    copy: task.copy,
    brief: task.brief,
    brandColours: task.brand.colours,
    layout: "overlay",
  });
  const reference = await asDataUrl(hero);
  let feedback: string | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt = [
      designLayerPrompt({
        plan,
        brand: task.brand,
        brief: task.brief,
        revision: task.revision,
        feedback,
        emphasisSeed: task.emphasisSeed,
      }),
      VIDEO_NOTE,
      captionBand ? CAPTION_BAND_NOTE : "",
      "The reference is a frame of the video, for colour and mood only.",
    ]
      .filter(Boolean)
      .join("\n\n");
    const layer = await sharp(await layerImage(prompt, task.ratio, [reference]))
      .resize(canvas.width, canvas.height, { fit: "cover" })
      .ensureAlpha()
      .raw()
      .toBuffer();
    const design = new Uint8Array(layer.buffer, layer.byteOffset, layer.length);
    const mask = photoMask(design, canvas.width, canvas.height, plan.key);
    const { regions } = findRegions(mask, canvas.width, canvas.height);
    const verdict = judgeLayer(plan, regions, canvas);
    const faces = verdict.ok
      ? judgeFaces(
          plan.avoid.map((box) =>
            visibleShare(
              mask,
              canvas.width,
              canvas.height,
              Array.from({ length: 25 }, (_, i) => ({
                x: (box.x + (box.w * ((i % 5) + 0.5)) / 5) * canvas.width,
                y: (box.y + (box.h * (Math.floor(i / 5) + 0.5)) / 5) * canvas.height,
              })),
            ),
          ),
        )
      : verdict;
    if (faces.ok)
      return sharp(Buffer.from(layerOverlay(design, mask, plan.key)), {
        raw: { width: canvas.width, height: canvas.height, channels: 4 },
      })
        .png()
        .toBuffer();
    console.warn("[clip-edit] opening design rejected", faces.reason);
    feedback = `${faces.reason} ${faces.feedback}`;
  }
  return null;
}

/** The end card: a designed still built around real frames or photos. Null if it can't be made. */
async function endCard(
  task: ClipEditTask,
  photos: DesignPhoto[],
  readings: PhotoReading[],
  canvas: { width: number; height: number },
): Promise<Buffer | null> {
  try {
    const plan = planPhotoDesign({
      readings,
      sizes: photos,
      ratio: task.ratio,
      copy: task.endCopy,
      brief: `${task.brief}\nThe closing card of the video: the brand's sign-off.`,
      brandColours: task.brand.colours,
      layout: "windows",
    });
    const references = await Promise.all(photos.slice(0, 2).map(asDataUrl));
    let feedback: string | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      const layer = await layerImage(
        [
          designLayerPrompt({
            plan,
            brand: task.brand,
            brief: plan.copy.length ? "A closing card that signs off the video." : task.brief,
            feedback,
            emphasisSeed: `${task.emphasisSeed}:end`,
          }),
          "The references are frames of the video, for colour and mood only.",
        ].join("\n\n"),
        task.ratio,
        references,
      );
      const composed = await composePhotoDesign({ layer, photos, readings, plan });
      if (composed.ok)
        return sharp(composed.png)
          .resize(canvas.width * 2, canvas.height * 2, { fit: "cover" })
          .png()
          .toBuffer();
      feedback = `${composed.reason} ${composed.feedback}`;
    }
  } catch (error) {
    console.warn("[clip-edit] end card skipped", error instanceof Error ? error.message : error);
  }
  return null;
}

/** The caption track for the joined video, or null (with a plain warning) when there is none. */
async function captionTrack(
  task: ClipEditTask,
  dir: string,
  joined: string,
  total: number,
  canvas: { width: number; height: number },
  warnings: string[],
): Promise<{ list: string; y: number } | null> {
  const skipped = "Captions were left out: the speech couldn't be heard clearly.";
  try {
    const silences = await audioSilences(joined, total);
    if (speechShare(total, silences) < MIN_SPEECH_SHARE) return null;
    const transcript = await transcribeVideo({ video: joined, dir, duration: total });
    const segments = transcript ? believableSegments(transcript.segments, total, silences) : [];
    const cues = buildCues(segments, task.ratio, total);
    if (!cues.length) {
      warnings.push(skipped);
      return null;
    }
    if (!captionsDrawable(cues)) {
      warnings.push("Captions were left out: this language can't be drawn yet.");
      return null;
    }
    const box = captionBox(task.ratio, canvas);
    const { blank, images } = await renderCaptionImages({
      dir,
      cues,
      colours: captionColours(task.brand.colours),
      box,
      font: task.brand.fonts?.[0] ?? null,
    });
    const list = await writeCaptionTrack({
      directory: dir,
      blank,
      cues: cues.map((cue, i) => ({ start: cue.start, end: cue.end, image: images[i] })),
      duration: total,
    });
    return { list, y: box.y };
  } catch (error) {
    console.warn("[clip-edit] captions failed", error instanceof Error ? error.message : error);
    warnings.push(skipped);
    return null;
  }
}

async function download(client: SupabaseClient, path: string, out: string) {
  const downloaded = await downloadAssetObject(client, path);
  if (downloaded.error || !downloaded.data) throw new Error("A clip could not be opened.");
  await writeFile(out, Buffer.from(await downloaded.data.arrayBuffer()));
}

/**
 * "From my website": the brand's own capture scrolls inside a device drawn by
 * code. No model is asked for anything; the capture is never redrawn.
 */
async function siteReel(args: ClipEditArgs, dir: string): Promise<string> {
  const { task, client, workspaceId } = args;
  const [capture] = await resolveStudioReferences(client, workspaceId, task.photoAssetIds);
  if (!capture || !isWorkspaceStoragePath(capture.storagePath, workspaceId))
    throw new Error("The website capture is unavailable.");
  const source = join(dir, "site-source");
  await download(client, capture.storagePath, source);
  const meta = await sharp(source, { limitInputPixels: 120_000_000 }).metadata();
  if (!meta.width || !meta.height) throw new Error("The website capture could not be read.");
  const canvas = videoCanvas(task.ratio);
  const device = siteDevice(meta.width);
  const { screen } = siteFrame(canvas, device);
  // The page at the screen's width, cut to the screens the reel can reach.
  const scaled = Math.round((meta.height * screen.w) / meta.width);
  const pageHeight = Math.min(scaled, screen.h * MAX_SITE_SCREENS);
  const page = join(dir, "site-page.png");
  await sharp(source, { limitInputPixels: 120_000_000 })
    .resize(screen.w, scaled)
    .extract({ left: 0, top: 0, width: screen.w, height: pageHeight })
    .png()
    .toFile(page);
  const stops = siteStops(pageHeight, screen.h);
  if (!stops.length) throw new Error("The page is too short to scroll.");
  const { segments, total } = siteTimeline(stops);
  const frame = join(dir, "site-frame.png");
  await writeFile(frame, await siteFramePng({ canvas, device, colours: task.brand.colours ?? [] }));
  const scrolled = join(dir, "site.mp4");
  await siteScroll({
    page,
    frame,
    output: scrolled,
    ...canvas,
    screen,
    scroll: scrollExpression(segments),
    seconds: total,
  });
  await park(args.taskId, { state: "running", at: Date.now() });

  let logo: { path: string; x: number; y: number } | null = null;
  if (task.logo) {
    const backdrop = await sharp(frame).flatten({ background: "#000000" }).png().toBuffer();
    const layers = await logoLayers(backdrop, task.logo.url, task.logo.corner);
    if (layers) {
      logo = { path: join(dir, "logo.png"), x: 0, y: 0 };
      await sharp({
        create: { ...canvas, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
      })
        .composite(layers)
        .png()
        .toFile(logo.path);
    }
  }
  if (!logo) return scrolled;
  const finished = join(dir, "finished.mp4");
  await brandVideo({ input: scrolled, output: finished, overlay: null, logo });
  return finished;
}

async function saveVideo(
  args: ClipEditArgs,
  finished: string,
  warnings: string[],
  metadata: Record<string, unknown>,
): Promise<ClipEditResult> {
  const { task } = args;
  const saved = await persistAsset({
    workspaceId: args.workspaceId,
    idempotencyKey: `studio:${args.jobId}:main:${args.taskId}`,
    bytes: await readFile(finished),
    mimeType: "video/mp4",
    assetType: "video",
    contentItemIds: args.contentItemIds,
    filename: `mellox-video-${task.ratio.replace(":", "x")}-${args.jobId.slice(0, 8)}`,
    platform: null,
    metadata: {
      source: "studio_clip_edit",
      job_id: args.jobId,
      aspect_ratio: task.ratio,
      studio_type: "video",
      video_mode: task.mode,
      ...metadata,
    },
  });
  if (!saved.ok || !saved.asset.storage_path)
    throw new Error(saved.ok ? "No file was stored." : saved.message);
  const result: ClipEditResult = {
    state: "done",
    assetId: saved.asset.id,
    storagePath: saved.asset.storage_path,
    warnings,
  };
  await park(args.taskId, result);
  return result;
}

export async function renderClipEdit(args: ClipEditArgs): Promise<ClipEditResult> {
  const { task, client, workspaceId } = args;
  const beat = () => park(args.taskId, { state: "running", at: Date.now() });
  const dir = await mkdtemp(join(tmpdir(), "mellox-clip-"));
  try {
    if (task.mode === "site")
      return await saveVideo(args, await siteReel(args, dir), [], {
        source_asset_ids: task.photoAssetIds,
        source_preserved: true,
      });
    const canvas = videoCanvas(task.ratio);
    const clips: string[] = [];
    /** Each piece's real length, for the transitions between them. */
    const lengths: number[] = [];
    const stills: DesignPhoto[] = [];
    const warnings: string[] = [];
    let readings: PhotoReading[] = [];
    let talky = false;
    let sound = false;

    if (task.mode === "brand" || task.motion === "ai") {
      const sources =
        task.mode === "brand"
          ? (await resolveStudioClips(client, workspaceId, task.clipAssetIds)).map(
              (c) => c.storagePath,
            )
          : (args.motionPaths ?? []);
      if (!sources.length || sources.some((path) => !isWorkspaceStoragePath(path, workspaceId)))
        throw new Error("The clips for this video are unavailable.");
      const probes = [];
      for (const [index, path] of sources.entries()) {
        const file = join(dir, `source-${index}`);
        await download(client, path, file);
        const probe = await probeVideo(file);
        // Scene changes, dead footage and pauses decide which part is used.
        probes.push({ file, probe, analysis: await analyzeClip(file, probe) });
      }
      talky = probes.some((p) => isTalky(p.analysis));
      sound = task.mode === "brand" && probes.some((p) => p.probe.hasAudio);
      const plan = planClips(probes.map((p) => p.analysis));
      if (!plan.length) throw new Error("The clips are too short to use.");
      if (plan.length < probes.length)
        warnings.push("A clip was too short to use, so it was left out.");
      for (const piece of plan) {
        const out = join(dir, `clip-${piece.index}.mp4`);
        await fitClip({
          input: probes[piece.index].file,
          output: out,
          ...canvas,
          start: piece.start,
          seconds: piece.seconds,
          hasAudio: probes[piece.index].probe.hasAudio,
        });
        clips.push(out);
        lengths.push(piece.seconds);
        stills.push(
          await asPhoto(
            await grabFrame(
              out,
              Math.min(1, piece.seconds / 2),
              join(dir, `frame-${piece.index}.png`),
            ),
          ),
        );
        await beat();
      }
      readings = (await readDesignPhotos(stills)).photos;
    } else {
      const references = await resolveStudioReferences(client, workspaceId, task.photoAssetIds);
      const photos = await loadDesignPhotos(client, references);
      readings = (await readDesignPhotos(photos)).photos;
      for (const [index, photo] of photos.entries()) {
        const image = join(dir, `photo-${index}.png`);
        await writeFile(
          image,
          await coverAt(photo, readings[index].focus, canvas.width * 2, canvas.height * 2),
        );
        const out = join(dir, `clip-${index}.mp4`);
        await stillClip({ image, output: out, ...canvas, seconds: RECAP_PHOTO_SECONDS });
        clips.push(out);
        lengths.push(RECAP_PHOTO_SECONDS);
        stills.push(
          await asPhoto(await coverAt(photo, readings[index].focus, canvas.width, canvas.height)),
        );
        await beat();
      }
    }

    // The opening design over the start, judged on the first frame.
    const wantCaptions = task.mode === "brand" && task.captions !== false && talky;
    const overlay = await openingOverlay(task, stills[0], readings[0], canvas, wantCaptions);
    if (!overlay) throw new Error("The opening design kept covering the footage.");
    const overlayPath = join(dir, "overlay.png");
    await writeFile(overlayPath, overlay);
    await beat();

    const card = await endCard(task, stills.slice(0, 3), readings.slice(0, 3), canvas);
    if (card) {
      const image = join(dir, "end.png");
      await writeFile(image, card);
      const out = join(dir, "end.mp4");
      await stillClip({ image, output: out, ...canvas, seconds: END_CARD_SECONDS, zoom: 1.04 });
      clips.push(out);
      lengths.push(END_CARD_SECONDS);
    } else warnings.push("The closing card couldn't be made, so the video ends on your footage.");
    await beat();

    const joined = join(dir, "joined.mp4");
    const fade = transitionFor(lengths);
    await joinWithTransitions({
      directory: dir,
      clips,
      durations: lengths,
      transition: pickTransition(task.emphasisSeed, task.mode),
      seconds: fade,
      output: joined,
    });
    const total = lengths.reduce((sum, l) => sum + l, 0) - fade * Math.max(0, clips.length - 1);
    await beat();

    // Captions of what is said, timed on the finished timeline. Nobody
    // talking means no transcript is asked for at all.
    let captions: { list: string; y: number } | null = null;
    if (wantCaptions) {
      captions = await captionTrack(task, dir, joined, total, canvas, warnings);
      await beat();
    }
    let logo: { path: string; x: number; y: number } | null = null;
    if (task.logo) {
      const layers = await logoLayers(stills[0].bytes, task.logo.url, task.logo.corner);
      if (layers) {
        logo = { path: join(dir, "logo.png"), x: 0, y: 0 };
        await sharp({
          create: { ...canvas, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
        })
          .composite(layers)
          .png()
          .toFile(logo.path);
      }
    }
    const finished = join(dir, "finished.mp4");
    await brandVideo({
      input: joined,
      output: finished,
      overlay: overlayPath,
      logo,
      captions,
      loudness: sound,
    });

    return await saveVideo(args, finished, warnings, {
      ...(task.motion ? { recap_motion: task.motion } : {}),
      source_asset_ids: task.mode === "brand" ? task.clipAssetIds : task.photoAssetIds,
      source_preserved: task.motion !== "ai",
      ...(captions ? { captions: true } : {}),
    });
  } catch (error) {
    console.warn("[clip-edit] render failed", error instanceof Error ? error.message : error);
    const result: ClipEditResult = { state: "failed", message: CLIP_EDIT_FAILED };
    await park(args.taskId, result);
    return result;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
