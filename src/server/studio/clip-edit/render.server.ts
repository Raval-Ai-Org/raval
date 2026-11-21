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
  motionPostSeconds,
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
  type Cue,
} from "@/lib/studio/captions";
import type { MotionMoxElementId } from "@/lib/studio/motionmox/elements";
import { planMotionMox, wantsDesignedOpening } from "@/lib/studio/motionmox/plan";
import { groundSpec, type MotionMoxSegment } from "@/lib/studio/motionmox/spec";
import { OVERLAY_SECONDS } from "@/lib/studio/clip-edit";
import { judgeFaces, judgeLayer, lenientWindows } from "@/lib/studio/photo-design/checks";
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
import { makeMotionGraphic, type MotionRatio } from "../motion/compose.server";
import {
  collectSoundtrack,
  meterSoundtrack,
  mixSoundtrack,
  startSoundtrack,
  type SoundtrackTasks,
} from "../audio/soundtrack.server";
import { musicMood } from "@/lib/studio/audio/soundtrack";
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
  /**
   * "site": the brand's website capture scrolling in a device (site-reel.ts).
   * "motion": a motion graphic designed by the model and drawn by code (ADR-0043).
   */
  mode: "brand" | "recap" | "site" | "motion";
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
  /**
   * What MotionMox animates in (src/lib/studio/motionmox/elements.ts): the
   * person's chips, else what their brief asks for. Absent when MotionMox is off.
   */
  motionElements?: MotionMoxElementId[];
  /**
   * A motion post (src/lib/studio/video/kinds.ts): the photos are a finished
   * post that already carries its words, so no design is laid over them and
   * one picture is held long enough to read.
   */
  post?: boolean;
  /** A motion graphic: what the design call gets, all read for the verified workspace. */
  graphic?: {
    seconds: number;
    brandText: string;
    knownFacts: string;
    approvedCopy?: string[];
    recentLayouts?: string[];
    /** A music bed is made for it (sound on). */
    music: boolean;
    musicLook?: string;
    userId?: string | null;
  };
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
  "2:3": "1024x1536",
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
    keepBottomClear: captionBand,
  });
  const reference = await asDataUrl(hero);
  let feedback: string | undefined;
  let last: { design: Uint8Array; mask: Float32Array } | null = null;
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
    last = { design, mask };
  }
  // Last chance: keep the second layer if enough footage still shows, with
  // every face area cleared of the design. Else no opening design at all.
  if (!last) return null;
  const { regions } = findRegions(last.mask, canvas.width, canvas.height);
  if (!lenientWindows(plan, regions, canvas)) return null;
  for (const box of plan.avoid) {
    const x0 = Math.max(0, Math.floor((box.x - box.w * 0.15) * canvas.width));
    const x1 = Math.min(canvas.width, Math.ceil((box.x + box.w * 1.15) * canvas.width));
    const y0 = Math.max(0, Math.floor((box.y - box.h * 0.15) * canvas.height));
    const y1 = Math.min(canvas.height, Math.ceil((box.y + box.h * 1.15) * canvas.height));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) last.mask[y * canvas.width + x] = 1;
  }
  return sharp(Buffer.from(layerOverlay(last.design, last.mask, plan.key)), {
    raw: { width: canvas.width, height: canvas.height, channels: 4 },
  })
    .png()
    .toBuffer();
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
      // The second layer is the last: use what it left rather than drop the card.
      const composed = await composePhotoDesign({
        layer,
        photos,
        readings,
        plan,
        lenient: attempt === 1,
      });
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

const CAPTIONS_SKIPPED = "Captions were left out: the speech couldn't be heard clearly.";

/** What is said in the joined video, as timed cues, or null (with a plain warning) when there is nothing to show. */
async function heardCues(
  task: ClipEditTask,
  dir: string,
  joined: string,
  total: number,
  warnings: string[],
): Promise<Cue[] | null> {
  try {
    const silences = await audioSilences(joined, total);
    if (speechShare(total, silences) < MIN_SPEECH_SHARE) return null;
    const transcript = await transcribeVideo({ video: joined, dir, duration: total });
    const segments = transcript ? believableSegments(transcript.segments, total, silences) : [];
    const cues = buildCues(segments, task.ratio, total);
    if (!cues.length) {
      warnings.push(CAPTIONS_SKIPPED);
      return null;
    }
    if (!captionsDrawable(cues)) {
      warnings.push("Captions were left out: this language can't be drawn yet.");
      return null;
    }
    return cues;
  } catch (error) {
    console.warn("[clip-edit] captions failed", error instanceof Error ? error.message : error);
    warnings.push(CAPTIONS_SKIPPED);
    return null;
  }
}

/** The caption track for the joined video (FFmpeg path), or null when there is none. */
async function captionTrack(
  task: ClipEditTask,
  dir: string,
  cues: Cue[] | null,
  total: number,
  canvas: { width: number; height: number },
  warnings: string[],
): Promise<{ list: string; y: number } | null> {
  if (!cues?.length) return null;
  try {
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
    warnings.push(CAPTIONS_SKIPPED);
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
  const scaled = Math.max(1, Math.round((meta.height * screen.w) / meta.width));
  // A capture shorter than the screen is extended with its own last row, so
  // the screen is always full.
  const pageHeight = Math.max(screen.h, Math.min(scaled, screen.h * MAX_SITE_SCREENS));
  const page = join(dir, "site-page.png");
  await sharp(source, { limitInputPixels: 120_000_000 })
    .resize(screen.w, scaled, { fit: "fill" })
    .extend({ bottom: Math.max(0, pageHeight - scaled), extendWith: "copy" })
    .extract({ left: 0, top: 0, width: screen.w, height: pageHeight })
    .png()
    .toFile(page);
  // Too short to scroll: the reel holds on the page, then moves the little
  // it can (or not at all), instead of failing.
  const found = siteStops(pageHeight, screen.h);
  const stops = found.length ? found : [0, Math.max(0, pageHeight - screen.h)];
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

export const MOTION_FAILED =
  "We couldn't make this motion graphic look right. You weren't charged. Try different words.";

/** How long a finished motion graphic waits for its music before going out without it. */
const MOTION_MUSIC_WAIT_MS = 3 * 60_000;

function motionRatio(ratio: AspectRatio): MotionRatio {
  if (ratio === "1:1") return "1:1";
  if (ratio === "16:9" || ratio === "4:3") return "16:9";
  if (ratio === "9:16") return "9:16";
  return "4:5";
}

/** A stable number from the job's seed, so a restart designs the same piece. */
function hashSeed(seed: string): number {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/**
 * A motion graphic (ADR-0043): the model designs it, code checks and draws
 * it (src/server/studio/motion/). Its music bed is made at the same time and
 * mixed in; a slow or failed bed leaves the piece silent, never fails it.
 */
async function motionGraphic(args: ClipEditArgs, dir: string): Promise<ClipEditResult> {
  const { task, client, workspaceId } = args;
  const graphic = task.graphic;
  if (!graphic) throw new Error("The motion graphic has no brief.");
  const beat = () => park(args.taskId, { state: "running", at: Date.now() });
  // The brand's own photos and logo go into the design's slots, placed by code.
  const photos: string[] = [];
  for (const ref of await resolveStudioReferences(client, workspaceId, task.photoAssetIds)) {
    if (!isWorkspaceStoragePath(ref.storagePath, workspaceId)) continue;
    const stored = await downloadAssetObject(client, ref.storagePath);
    if (stored.data)
      photos.push(await asDataUrl(await asPhoto(Buffer.from(await stored.data.arrayBuffer()))));
  }
  let logo: string | null = null;
  if (task.logo) {
    const { safeFetch } = await import("@/server/safe-fetch");
    const response = await safeFetch(task.logo.url, {
      maxBytes: 5 * 1024 * 1024,
      timeoutMs: 15_000,
    }).catch(() => null);
    const png = response?.ok
      ? await sharp(Buffer.from(response.bytes))
          .resize(512, 512, { fit: "inside" })
          .png()
          .toBuffer()
          .catch(() => null)
      : null;
    if (png) logo = `data:image/png;base64,${png.toString("base64")}`;
  }
  // The music starts while the design is made, on the mood the motion follows.
  const mood = musicMood(`${graphic.musicLook ?? ""} ${task.brief}`);
  const music = graphic.music
    ? await startSoundtrack({
        seconds: graphic.seconds,
        music: { mood, look: graphic.musicLook, title: task.brand.brandName },
        seed: workspaceId,
      }).catch(() => ({}) as SoundtrackTasks)
    : ({} as SoundtrackTasks);
  const made = await makeMotionGraphic({
    workspaceId,
    brief: [task.brief, task.revision].filter(Boolean).join("\n\n"),
    seconds: graphic.seconds,
    ratio: motionRatio(task.ratio),
    brandText: graphic.brandText,
    brandName: task.brand.brandName,
    knownFacts: graphic.knownFacts,
    approvedCopy: graphic.approvedCopy,
    logo,
    photos,
    recentLayouts: graphic.recentLayouts,
    mood,
    seed: hashSeed(task.emphasisSeed),
  });
  await beat();
  if (!made.ok) {
    console.warn("[clip-edit] motion graphic refused", made.reason, made.issues.slice(0, 4));
    const result: ClipEditResult = { state: "failed", message: MOTION_FAILED };
    await park(args.taskId, result);
    return result;
  }
  let dataUrl = `data:video/mp4;base64,${made.video.toString("base64")}`;
  if (music.music) {
    const waitUntil = Date.now() + MOTION_MUSIC_WAIT_MS;
    let sound = await collectSoundtrack(music);
    while (sound.pending && Date.now() < waitUntil) {
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      await beat();
      sound = await collectSoundtrack(music);
    }
    if (sound.musicUrl) {
      dataUrl = await mixSoundtrack(
        dataUrl,
        { musicUrl: sound.musicUrl },
        { seconds: graphic.seconds, keepClipAudio: false },
      );
      meterSoundtrack(sound, { workspaceId, userId: graphic.userId });
    }
  }
  const finished = join(dir, "motion.mp4");
  await writeFile(finished, Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"));
  return saveVideo(args, finished, [], {
    motion_layout: made.layout,
    motion_mood: made.mood,
    source_asset_ids: task.photoAssetIds,
    source_preserved: true,
  });
}

export async function renderClipEdit(args: ClipEditArgs): Promise<ClipEditResult> {
  const { task, client, workspaceId } = args;
  const beat = () => park(args.taskId, { state: "running", at: Date.now() });
  const dir = await mkdtemp(join(tmpdir(), "mellox-clip-"));
  try {
    if (task.mode === "motion") return await motionGraphic(args, dir);
    if (task.mode === "site")
      return await saveVideo(args, await siteReel(args, dir), [], {
        source_asset_ids: task.photoAssetIds,
        source_preserved: true,
      });
    const canvas = videoCanvas(task.ratio);
    const clips: string[] = [];
    /** Each piece's real length, for the transitions between them. */
    const lengths: number[] = [];
    /** The same pieces as MotionMox draws them (a recap photo is a still it pushes into). */
    const segments: MotionMoxSegment[] = [];
    const motionMox = task.motionElements !== undefined;
    const asked = task.motionElements ?? [];
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
        segments.push({
          kind: "video",
          src: `clip-${piece.index}.mp4`,
          seconds: piece.seconds,
          sound: task.mode === "brand" && probes[piece.index].probe.hasAudio,
        });
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
        const seconds = motionPostSeconds(photos.length, !!task.post);
        await stillClip({ image, output: out, ...canvas, seconds });
        clips.push(out);
        lengths.push(seconds);
        segments.push({
          kind: "image",
          src: `photo-${index}.png`,
          seconds,
          // The photo is already cut around its focus point (coverAt).
          focus: { x: 0.5, y: 0.5 },
          zoom: 1.08,
        });
        stills.push(
          await asPhoto(await coverAt(photo, readings[index].focus, canvas.width, canvas.height)),
        );
        await beat();
      }
    }

    // The opening design over the start, judged on the first frame.
    const wantCaptions = task.mode === "brand" && task.captions !== false && talky;
    // A motion post already carries its own words: nothing is laid over it.
    // MotionMox animating the headline itself needs no designed opening.
    let overlayPath: string | null = null;
    const makeOpening = async () => {
      const overlay = await openingOverlay(
        task,
        stills[0],
        readings[0],
        canvas,
        wantCaptions,
      ).catch((error: unknown) => {
        console.warn("[clip-edit] opening design failed", error);
        return null;
      });
      if (!overlay) {
        // The video is still made, just without the designed opening.
        warnings.push(
          "The opening design was left out: it kept covering the footage. Ask for a change to try again.",
        );
        return;
      }
      overlayPath = join(dir, "overlay.png");
      await writeFile(overlayPath, overlay);
    };
    if (!task.post && (!motionMox || wantsDesignedOpening(asked))) await makeOpening();
    await beat();

    const card = await endCard(task, stills.slice(0, 3), readings.slice(0, 3), canvas);
    if (card) {
      const image = join(dir, "end.png");
      await writeFile(image, card);
      const out = join(dir, "end.mp4");
      await stillClip({ image, output: out, ...canvas, seconds: END_CARD_SECONDS, zoom: 1.04 });
      clips.push(out);
      lengths.push(END_CARD_SECONDS);
      segments.push({ kind: "image", src: "end.png", seconds: END_CARD_SECONDS, zoom: 1.04 });
    } else warnings.push("The closing card couldn't be made, so the video ends on your footage.");
    await beat();

    // Joined by FFmpeg either way: it is the timeline captions are heard on,
    // and the video that goes out if MotionMox can't draw this one.
    const joined = join(dir, "joined.mp4");
    const fade = transitionFor(lengths);
    const transition = pickTransition(task.emphasisSeed, task.mode);
    await joinWithTransitions({
      directory: dir,
      clips,
      durations: lengths,
      transition,
      seconds: fade,
      output: joined,
    });
    const total = lengths.reduce((sum, l) => sum + l, 0) - fade * Math.max(0, clips.length - 1);
    await beat();

    // Captions of what is said, timed on the finished timeline. Nobody
    // talking means no transcript is asked for at all.
    const wantHeard =
      wantCaptions || (motionMox && task.mode === "brand" && talky && asked.includes("captions"));
    const cues = wantHeard ? await heardCues(task, dir, joined, total, warnings) : null;
    if (wantHeard) await beat();
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
    const meta = {
      ...(task.motion ? { recap_motion: task.motion } : {}),
      source_asset_ids: task.mode === "brand" ? task.clipAssetIds : task.photoAssetIds,
      source_preserved: task.motion !== "ai",
    };

    // MotionMox draws the video with the asked-for elements animated in. If
    // it can't, the FFmpeg path below makes the same video, as before.
    if (motionMox) {
      try {
        const {
          spec: planned,
          allowedText,
          notes,
        } = planMotionMox({
          canvas,
          segments,
          endCard: !!card,
          transition,
          transitionSeconds: fade,
          copy: task.post ? [] : task.copy,
          endCopy: task.endCopy,
          brief: task.brief,
          brandName: task.brand.brandName,
          asked,
          overlay: overlayPath ? "overlay.png" : null,
          overlaySeconds: OVERLAY_SECONDS,
          captions: (cues ?? []).map((c) => ({
            start: c.start,
            end: c.end,
            lines: c.lines,
            emphasis: c.emphasis,
          })),
          logo: logo ? "logo.png" : null,
          colours: task.brand.colours,
          font: task.brand.fonts?.[0] ?? null,
        });
        const { spec, dropped } = groundSpec(planned, allowedText);
        if (dropped.length) console.warn("[clip-edit] motionmox dropped", dropped.slice(0, 4));
        const { renderMotionMox } = await import("../motionmox/render.server");
        const drawn = await renderMotionMox({ spec, dir, onProgress: () => void beat() });
        await beat();
        // The sound is brought to -14 LUFS the same way as before.
        await brandVideo({
          input: drawn,
          output: finished,
          overlay: null,
          logo: null,
          captions: null,
          loudness: sound,
        });
        return await saveVideo(args, finished, [...warnings, ...notes], {
          ...meta,
          renderer: "motionmox",
          motion_elements: asked,
          ...(spec.captions.length ? { captions: true } : {}),
        });
      } catch (error) {
        console.warn(
          "[clip-edit] motionmox failed, using ffmpeg",
          error instanceof Error ? error.message : error,
        );
        if (!task.post && !overlayPath) await makeOpening();
      }
    }

    const captions = wantCaptions
      ? await captionTrack(task, dir, cues, total, canvas, warnings)
      : null;
    await brandVideo({
      input: joined,
      output: finished,
      overlay: overlayPath,
      logo,
      captions,
      loudness: sound,
    });

    return await saveVideo(args, finished, warnings, {
      ...meta,
      ...(motionMox ? { renderer: "ffmpeg" } : {}),
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
