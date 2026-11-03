// Inspo uploads, server half: a file the browser put straight into storage
// (or a reel Mellox downloaded) becomes a board reference. Photos are
// normalised like before; a video is read with FFmpeg (length, size, scene
// changes), gets a poster and one still per scene, and is saved together with
// those stills. If any part fails, everything this file made is removed, so a
// video never stays without its frames.
import "server-only";
import { mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  ASSET_BUCKET,
  assetObjectSize,
  downloadAssetObjectToFile,
  isR2StorageEnabled,
  r2AssetPath,
  removeAssetObjects,
  uploadAssetObject,
} from "@/server/assets/storage.server";
import { persistAsset, registerStoredAsset } from "@/server/assets/persist.server";
import { matchesMediaType } from "@/server/assets/upload-validation";
import { PHOTO_PIXEL_LIMIT } from "@/server/assets/image-limits";
import { HttpError } from "@/server/http-error";
import { analyzeClip, grabFrame, probeVideo } from "@/server/studio/clip-edit/ffmpeg.server";
import { isWorkspaceStoragePath } from "@/lib/workspace/storage-path";
import {
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  UPLOAD_MESSAGES,
  sceneFrameTimes,
  uploadExtension,
  uploadKind,
  videoLengthProblem,
} from "@/lib/inspo/uploads";
import type { VisualSource } from "@/lib/brand-visuals/contracts";
import { addVisualSource, type VisualCaller } from "./service.server";
import { createVisualPreview } from "./preview.server";

const db = () => supabaseAdmin as unknown as SupabaseClient;

/** A failure the person can act on; its message is shown as it is. */
export class UploadProblem extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadProblem";
  }
}

export type ReferenceTarget = {
  purpose: VisualSource["purpose"];
  label: string;
  notes?: string;
  format?: string;
  campaign?: string;
  sourceUrl?: string;
};

/** Where a direct upload waits: inside the workspace, under `uploads/<id>/`. */
export function inboxPath(workspaceId: string, uploadId: string, type: string): string {
  const name = `original.${uploadExtension(type)}`;
  return isR2StorageEnabled()
    ? r2AssetPath(workspaceId, `uploads/${uploadId}`, name)
    : `workspace/${workspaceId}/assets/uploads/${uploadId}/${name}`;
}

/** Everything one reference made, so a failure can take it all back. */
type Made = { sourceAssetIds: string[]; assetIds: string[]; paths: string[] };

async function undo(workspaceId: string, made: Made) {
  try {
    if (made.sourceAssetIds.length)
      await db()
        .from("brand_visual_sources")
        .delete()
        .eq("workspace_id", workspaceId)
        .in("asset_id", made.sourceAssetIds);
    // Frames first: they point at their video.
    for (const id of [...made.assetIds].reverse())
      await db().from("assets").delete().eq("workspace_id", workspaceId).eq("id", id);
    const paths = made.paths.filter((p) => isWorkspaceStoragePath(p, workspaceId));
    if (paths.length) await removeAssetObjects(paths);
  } catch (error) {
    console.warn("[inspo-upload] cleanup incomplete", error instanceof Error ? error.message : "");
  }
}

function sourceFields(target: ReferenceTarget, video: boolean) {
  const format = target.format ?? "all";
  return {
    purpose: target.purpose,
    notes: (target.notes ?? "").slice(0, 600),
    formats: format !== "all" ? [format] : video ? ["video", "ugc"] : [],
    campaign: target.campaign,
    kind: "upload" as const,
  };
}

async function readHead(file: string): Promise<Buffer> {
  const handle = await open(file, "r");
  try {
    const head = Buffer.alloc(16);
    await handle.read(head, 0, 16, 0);
    return head;
  } finally {
    await handle.close();
  }
}

/** A photo's bytes, normalised to PNG and saved as a reference. */
export async function ingestImage(
  c: VisualCaller,
  input: Buffer,
  mime: string,
  target: ReferenceTarget,
): Promise<{ assetId: string }> {
  if (!matchesMediaType(input, mime)) throw new UploadProblem(UPLOAD_MESSAGES.photoUnreadable);
  let bytes: Buffer;
  try {
    bytes = await sharp(input, { limitInputPixels: PHOTO_PIXEL_LIMIT, failOn: "none" })
      .rotate()
      .resize({ width: 3000, height: 3000, fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
  } catch {
    throw new UploadProblem(UPLOAD_MESSAGES.photoUnreadable);
  }
  const saved = await persistAsset({
    workspaceId: c.workspaceId,
    idempotencyKey: `visual-upload:${crypto.randomUUID()}`,
    bytes,
    preserveBytes: true,
    assetType: "image",
    mimeType: "image/png",
    filename: target.label,
    metadata: { source: "visual_reference", purpose: target.purpose, source_url: target.sourceUrl },
  });
  if (!saved.ok) throw new UploadProblem(UPLOAD_MESSAGES.saveFailed);
  const made: Made = {
    sourceAssetIds: [saved.asset.id],
    assetIds: [saved.asset.id],
    paths: saved.asset.storage_path
      ? [saved.asset.storage_path, saved.asset.storage_path.replace(/\/[^/]+$/, "/preview.jpg")]
      : [],
  };
  try {
    await createVisualPreview(c.workspaceId, saved.asset, bytes);
    await addVisualSource(c, {
      assetId: saved.asset.id,
      label: target.label,
      sourceUrl: target.sourceUrl,
      ...sourceFields(target, false),
    });
    return { assetId: saved.asset.id };
  } catch (error) {
    await undo(c.workspaceId, made);
    throw error;
  }
}

/**
 * A video already stored at `storagePath` (its row id is `assetId`), read
 * from the local copy `file`: checked, its stills taken, and saved together.
 */
export async function ingestVideo(
  c: VisualCaller,
  args: {
    file: string;
    directory: string;
    mime: string;
    assetId: string;
    storagePath: string;
    target: ReferenceTarget;
  },
): Promise<{ assetId: string }> {
  const { file, directory, target } = args;
  if (!matchesMediaType(await readHead(file), args.mime))
    throw new UploadProblem(UPLOAD_MESSAGES.unreadable);
  let probe: Awaited<ReturnType<typeof probeVideo>>;
  try {
    probe = await probeVideo(file);
  } catch {
    throw new UploadProblem(UPLOAD_MESSAGES.unreadable);
  }
  const tooLong = videoLengthProblem(probe.duration);
  if (tooLong) throw new UploadProblem(tooLong);
  if (probe.width * probe.height > 12_000_000) throw new UploadProblem(UPLOAD_MESSAGES.tooWide);
  const analysis = await analyzeClip(file, probe);
  const frames: { time: number; bytes: Buffer }[] = [];
  for (const [index, time] of sceneFrameTimes(analysis).entries()) {
    try {
      const raw = await grabFrame(file, time, join(directory, `frame-${index}.png`));
      const bytes = await sharp(raw, { limitInputPixels: PHOTO_PIXEL_LIMIT, failOn: "none" })
        .resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true })
        .png()
        .toBuffer();
      frames.push({ time, bytes });
    } catch {
      // A still that can't be taken is skipped; the others still teach the look.
    }
  }
  if (!frames.length) throw new UploadProblem(UPLOAD_MESSAGES.unreadable);

  const made: Made = {
    sourceAssetIds: [],
    assetIds: [],
    paths: [args.storagePath, args.storagePath.replace(/\/[^/]+$/, "/preview.jpg")],
  };
  try {
    const video = await registerStoredAsset({
      workspaceId: c.workspaceId,
      assetId: args.assetId,
      idempotencyKey: `visual-direct:${args.assetId}`,
      storagePath: args.storagePath,
      assetType: "video",
      mimeType: args.mime,
      filename: target.label,
      width: probe.width,
      height: probe.height,
      metadata: {
        source: "visual_reference",
        purpose: target.purpose,
        source_url: target.sourceUrl,
        duration: probe.duration,
        scenes: analysis.cuts.length + 1,
      },
    });
    if (!video.ok) throw new UploadProblem(UPLOAD_MESSAGES.saveFailed);
    if (video.deduplicated) return { assetId: video.asset.id };
    made.assetIds.push(video.asset.id);
    // The first still is the video's poster.
    await createVisualPreview(c.workspaceId, video.asset, frames[0].bytes);
    made.sourceAssetIds.push(video.asset.id);
    await addVisualSource(c, {
      assetId: video.asset.id,
      label: target.label,
      sourceUrl: target.sourceUrl,
      ...sourceFields(target, true),
    });
    for (const [index, frame] of frames.entries()) {
      const asset = await persistAsset({
        workspaceId: c.workspaceId,
        idempotencyKey: `visual-frame:${video.asset.id}:${index}`,
        bytes: frame.bytes,
        preserveBytes: true,
        assetType: "image",
        mimeType: "image/png",
        filename: `${target.label}-${index + 1}`,
        parentAssetId: video.asset.id,
        metadata: { source: "visual_video_frame", time: frame.time, duration: probe.duration },
      });
      if (!asset.ok) throw new UploadProblem(UPLOAD_MESSAGES.saveFailed);
      made.assetIds.push(asset.asset.id);
      if (asset.asset.storage_path)
        made.paths.push(
          asset.asset.storage_path,
          asset.asset.storage_path.replace(/\/[^/]+$/, "/preview.jpg"),
        );
      await createVisualPreview(c.workspaceId, asset.asset, frame.bytes);
      made.sourceAssetIds.push(asset.asset.id);
      // Inspo hides a video's stills by this label ("<label> · 1.2s").
      await addVisualSource(c, {
        assetId: asset.asset.id,
        label: `${target.label} · ${frame.time.toFixed(1)}s`,
        ...sourceFields(target, true),
      });
    }
    return { assetId: video.asset.id };
  } catch (error) {
    await undo(c.workspaceId, made);
    throw error;
  }
}

/** A plain message for anything that went wrong with one file. */
export function problemMessage(error: unknown, kind: "image" | "video"): string {
  if (error instanceof UploadProblem) return error.message;
  if (error instanceof HttpError && error.status === 409) return error.message;
  return kind === "video" ? UPLOAD_MESSAGES.saveFailed : UPLOAD_MESSAGES.photoUnreadable;
}

export type FinishItem = { id: string; name: string; type: string; size: number };

/** One file the browser uploaded: read back by its workspace path, then saved. */
export async function finishUpload(
  c: VisualCaller,
  item: FinishItem,
  target: Omit<ReferenceTarget, "label"> & { label: string },
): Promise<{ assetId: string }> {
  const kind = uploadKind(item.type);
  if (!kind) throw new UploadProblem(UPLOAD_MESSAGES.type);
  const path = inboxPath(c.workspaceId, item.id, item.type);
  if (!isWorkspaceStoragePath(path, c.workspaceId))
    throw new UploadProblem(UPLOAD_MESSAGES.missing);
  const limit = kind === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  const size = await assetObjectSize(path).catch(() => null);
  if (size === null || size === 0) throw new UploadProblem(UPLOAD_MESSAGES.missing);
  if (size > limit) {
    await removeAssetObjects([path]).catch(() => {});
    throw new UploadProblem(
      kind === "video" ? UPLOAD_MESSAGES.videoSize : UPLOAD_MESSAGES.imageSize,
    );
  }
  const directory = await mkdtemp(join(tmpdir(), "inspo-upload-"));
  try {
    const file = join(directory, `original.${uploadExtension(item.type)}`);
    await downloadAssetObjectToFile(path, file, limit);
    if (kind === "image") {
      const result = await ingestImage(c, await readFile(file), item.type, target);
      // The photo was saved as its own PNG; the raw upload isn't needed.
      await removeAssetObjects([path]).catch(() => {});
      return result;
    }
    try {
      return await ingestVideo(c, {
        file,
        directory,
        mime: item.type,
        assetId: item.id,
        storagePath: path,
        target,
      });
    } catch (error) {
      await removeAssetObjects([path]).catch(() => {});
      throw error;
    }
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

/** A video Mellox fetched itself (a reel link): stored, then saved like an upload. */
export async function ingestFetchedVideo(
  c: VisualCaller,
  bytes: Buffer,
  mime: string,
  target: ReferenceTarget,
): Promise<{ assetId: string }> {
  if (bytes.length > MAX_VIDEO_BYTES) throw new UploadProblem(UPLOAD_MESSAGES.videoSize);
  const assetId = crypto.randomUUID();
  const path = inboxPath(c.workspaceId, assetId, mime);
  const directory = await mkdtemp(join(tmpdir(), "inspo-link-"));
  try {
    const file = join(directory, `original.${uploadExtension(mime)}`);
    await writeFile(file, bytes);
    if (path.includes("/assets/r2/")) await uploadAssetObject(path, bytes, mime);
    else {
      const { error } = await db()
        .storage.from(ASSET_BUCKET)
        .upload(path, bytes, { contentType: mime, upsert: false });
      if (error) throw new UploadProblem(UPLOAD_MESSAGES.saveFailed);
    }
    try {
      return await ingestVideo(c, { file, directory, mime, assetId, storagePath: path, target });
    } catch (error) {
      await removeAssetObjects([path]).catch(() => {});
      throw error;
    }
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}
