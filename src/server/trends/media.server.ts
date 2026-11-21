// media.server.ts — Trend Radar reference media (ADR-0052).
//
// Staff upload pictures and clips for a trend from the admin console. They
// live in the private asset bucket under platform/trends/<key>/, outside every
// workspace's folder, so no customer can list or write them; the server signs
// them when a generator or the admin screen needs to show one. This is an
// explicit service path (no workspace owns these files).
import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ASSET_BUCKET, signStoragePaths } from "@/server/assets/storage.server";
import { IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, VIDEO_TYPES } from "@/lib/inspo/uploads";
import type { RadarMedia } from "@/lib/trends/radar";

const PREFIX = "platform/trends/";
/** Largest single trend file (pictures and short clips). */
export const TREND_MEDIA_MAX_BYTES = 50 * 1024 * 1024;
const PATH = /^platform\/trends\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.[a-z0-9]{2,5}$/;

function db(): SupabaseClient {
  return supabaseAdmin as unknown as SupabaseClient;
}

/** A path this module wrote (never a workspace path, never a traversal). */
export function isTrendMediaPath(path: string): boolean {
  return PATH.test(path);
}

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

export class TrendMediaError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/**
 * Store one file for a trend. `key` groups a trend's files (its id, or a
 * draft key before the first save). Returns the stored media entry.
 */
export async function storeTrendMedia(args: {
  key: string;
  file: File;
  caption?: string | null;
}): Promise<RadarMedia> {
  if (!/^[0-9a-f-]{36}$/.test(args.key)) throw new TrendMediaError("Bad trend key.");
  const type = (args.file.type || "").toLowerCase();
  const video = (VIDEO_TYPES as readonly string[]).includes(type);
  const image = (IMAGE_TYPES as readonly string[]).includes(type);
  if (!video && !image) throw new TrendMediaError("Upload a picture or a video.");
  // One request carries the file, so it stays well under a request body's
  // limit; staff trim long clips first.
  const limit = Math.min(video ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES, TREND_MEDIA_MAX_BYTES);
  if (args.file.size > limit) throw new TrendMediaError("That file is too large.", 413);
  const ext = EXT[type] ?? (video ? "mp4" : "jpg");
  const path = `${PREFIX}${args.key}/${randomUUID()}.${ext}`;
  const bytes = Buffer.from(await args.file.arrayBuffer());
  const { error } = await db().storage.from(ASSET_BUCKET).upload(path, bytes, {
    contentType: type,
    upsert: false,
  });
  if (error) throw new TrendMediaError(`Could not store the file: ${error.message}`, 502);
  return {
    path,
    kind: video ? "video" : "image",
    caption: args.caption?.trim().slice(0, 200) || null,
    stills: [],
  };
}

/** Signed links for trend media (only paths this module wrote). */
export async function signTrendMedia(
  paths: string[],
  ttlSeconds = 3600,
): Promise<Map<string, string>> {
  const safe = paths.filter(isTrendMediaPath);
  if (!safe.length) return new Map();
  try {
    return await signStoragePaths(db(), safe, ttlSeconds);
  } catch (error) {
    console.warn("[trends] could not sign media", error instanceof Error ? error.message : error);
    return new Map();
  }
}

/** The pictures of a trend a writer may look at (images, then video stills). */
export function trendPicturePaths(media: readonly RadarMedia[], limit = 2): string[] {
  return media
    .flatMap((m) => (m.kind === "image" ? [m.path] : (m.stills ?? [])))
    .filter(isTrendMediaPath)
    .slice(0, limit);
}
