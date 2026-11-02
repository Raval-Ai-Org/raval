// Inspo uploads (ADR-0037): what a person may add in one go, and how a video's
// still frames are chosen. Pure and browser-safe; the browser checks a file
// before sending it and the server checks it again on start and on finish.

import type { ClipAnalysis } from "@/lib/studio/smart-cut";

export const MAX_FILES_PER_BATCH = 30;
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 300 * 1024 * 1024;
export const MAX_VIDEO_SECONDS = 180;
/** Still frames kept per video: one per scene, at most this many. */
export const MAX_VIDEO_FRAMES = 8;
/** Board and Media references per brand. A video's frames don't count. */
export const MAX_REFERENCES = 300;
/** Files uploaded at the same time from one browser. */
export const PARALLEL_UPLOADS = 3;

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"] as const;
export const ACCEPT_ATTRIBUTE = [...IMAGE_TYPES, ...VIDEO_TYPES].join(",");

export type UploadKind = "image" | "video";
export type UploadFileInfo = { name: string; type: string; size: number };

export const UPLOAD_MESSAGES = {
  type: "Use a PNG, JPEG or WebP photo, or an MP4, MOV or WebM video.",
  empty: "This file is empty.",
  imageSize: "Too big: photos up to 25 MB.",
  videoSize: "Too big: videos up to 300 MB.",
  tooLong: "Too long: up to 3 minutes.",
  unreadable: "This video format can't be read.",
  tooWide: "Too big: videos up to 4K.",
  photoUnreadable: "This photo can't be read.",
  missing: "This file didn't finish uploading. Try again.",
  saveFailed: "This couldn't be saved. Try again.",
  link: "We couldn't download this link. Save the video and upload it instead.",
} as const;

export function uploadKind(type: string): UploadKind | null {
  if ((IMAGE_TYPES as readonly string[]).includes(type)) return "image";
  if ((VIDEO_TYPES as readonly string[]).includes(type)) return "video";
  return null;
}

/** Some browsers leave `type` empty for .mov files; the name decides then. */
export function uploadType(file: { name: string; type: string }): string {
  if (file.type) return file.type;
  const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase();
  const byExt: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    mp4: "video/mp4",
    m4v: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
  };
  return (ext && byExt[ext]) || "";
}

/** A plain reason this file can't be added, or null when it can. */
export function uploadProblem(file: UploadFileInfo): string | null {
  const kind = uploadKind(file.type);
  if (!kind) return UPLOAD_MESSAGES.type;
  if (!Number.isFinite(file.size) || file.size <= 0) return UPLOAD_MESSAGES.empty;
  if (kind === "image" && file.size > MAX_IMAGE_BYTES) return UPLOAD_MESSAGES.imageSize;
  if (kind === "video" && file.size > MAX_VIDEO_BYTES) return UPLOAD_MESSAGES.videoSize;
  return null;
}

/** A video's measured length, checked after it is read. */
export function videoLengthProblem(seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds <= 0) return UPLOAD_MESSAGES.unreadable;
  return seconds > MAX_VIDEO_SECONDS + 0.5 ? UPLOAD_MESSAGES.tooLong : null;
}

export function uploadExtension(type: string): string {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
  };
  return map[type] ?? "bin";
}

/** The reference's name, from the file name without its extension. */
export function uploadLabel(name: string): string {
  return (
    name
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[\r\n\t]+/g, " ")
      .trim()
      .slice(0, 100) || "Inspo"
  );
}

/**
 * Finish calls for one drop: each call reads and saves its files on the
 * server, so a call holds at most 10 files and at most 3 videos.
 */
export function finishGroups<T extends { kind: UploadKind }>(
  items: T[],
  maxItems = 10,
  maxVideos = 3,
): T[][] {
  const groups: T[][] = [];
  let current: T[] = [];
  let videos = 0;
  for (const item of items) {
    const video = item.kind === "video";
    if (current.length >= maxItems || (video && videos >= maxVideos)) {
      groups.push(current);
      current = [];
      videos = 0;
    }
    current.push(item);
    if (video) videos += 1;
  }
  if (current.length) groups.push(current);
  return groups;
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * When to take a video's still frames: the middle of each scene the measuring
 * pass found (scenes under half a second are skipped), spread evenly when
 * there are more than `max`. A video with one scene gets three stills across
 * it, so a single long take still shows how it moves. A time inside black
 * footage moves to the nearest visible moment in its scene when there is one.
 */
export function sceneFrameTimes(a: ClipAnalysis, max = MAX_VIDEO_FRAMES): number[] {
  const duration = a.duration;
  if (!(duration > 0)) return [];
  const edges = [0, ...a.cuts.filter((t) => t > 0 && t < duration), duration];
  const scenes: { start: number; end: number }[] = [];
  for (let i = 0; i < edges.length - 1; i++)
    if (edges[i + 1] - edges[i] >= 0.5) scenes.push({ start: edges[i], end: edges[i + 1] });
  const dark = (t: number) => a.dark.some((s) => t >= s.start && t <= s.end);
  const visible = (scene: { start: number; end: number }) => {
    const mid = (scene.start + scene.end) / 2;
    if (!dark(mid)) return mid;
    for (const step of [0.25, 0.75, 0.1, 0.9]) {
      const t = scene.start + (scene.end - scene.start) * step;
      if (!dark(t)) return t;
    }
    return mid;
  };
  if (scenes.length <= 1) {
    return [...new Set([Math.min(0.1, duration * 0.05), duration / 2, duration * 0.95].map(round))]
      .filter((t) => t < duration)
      .slice(0, Math.max(1, max));
  }
  let picked = scenes;
  if (scenes.length > max) {
    const step = scenes.length / max;
    picked = Array.from({ length: max }, (_, i) => scenes[Math.floor(i * step + step / 2)]);
  }
  return picked.map((s) => round(visible(s)));
}
