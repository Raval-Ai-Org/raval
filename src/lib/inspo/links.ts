// Inspo reel links: which pasted links are read with yt-dlp, and which of the
// formats it lists is downloaded. Pure and browser-safe. The download itself
// always goes through safeFetch (src/server/brand-visuals/link-media.server.ts).

import { MAX_VIDEO_BYTES, MAX_VIDEO_SECONDS } from "./uploads";

/** Hosts a reel link may come from, with their m. and www. forms. */
const REEL_HOSTS = ["instagram.com", "tiktok.com", "youtube.com", "youtu.be"] as const;
const TIKTOK_SHORT = ["vm.tiktok.com", "vt.tiktok.com"];

/** Is this an https Instagram, TikTok or YouTube link? */
export function isReelLink(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (TIKTOK_SHORT.includes(host)) return true;
  const bare = host.replace(/^(www|m)\./, "");
  return (REEL_HOSTS as readonly string[]).includes(bare);
}

export type YtdlpFormat = {
  format_id?: string;
  url?: string;
  ext?: string;
  protocol?: string;
  vcodec?: string;
  acodec?: string;
  width?: number | null;
  height?: number | null;
  filesize?: number | null;
  filesize_approx?: number | null;
  tbr?: number | null;
  http_headers?: Record<string, unknown>;
};

export type YtdlpInfo = YtdlpFormat & {
  title?: string;
  duration?: number | null;
  is_live?: boolean | null;
  formats?: YtdlpFormat[];
};

export type ReelPick = {
  url: string;
  title: string;
  duration: number | null;
  height: number | null;
  /** Only ordinary request headers yt-dlp says the file needs. */
  headers: Record<string, string>;
};

const SAFE_HEADERS = ["user-agent", "accept", "accept-language", "referer"];
const MAX_HEIGHT = 1080;

const has = (codec?: string) => !!codec && codec !== "none";
const short = (h: number | null | undefined, w: number | null | undefined) =>
  Math.min(h ?? Infinity, w ?? Infinity);

function sizeOf(f: YtdlpFormat, duration: number | null): number | null {
  const size = f.filesize ?? f.filesize_approx;
  if (size && size > 0) return size;
  if (f.tbr && duration) return (f.tbr * 1000 * duration) / 8;
  return null;
}

function usable(f: YtdlpFormat, duration: number | null): boolean {
  if (!f.url || f.ext !== "mp4") return false;
  if (!/^https?$/.test(f.protocol ?? "https")) return false;
  if (!/^https:\/\//i.test(f.url)) return false;
  if (f.vcodec !== undefined && !has(f.vcodec)) return false;
  // The shorter side is the "p" number, so a tall 1080x1920 reel counts as 1080p.
  if (short(f.height, f.width) !== Infinity && short(f.height, f.width) > MAX_HEIGHT) return false;
  const size = sizeOf(f, duration);
  return size === null || size <= MAX_VIDEO_BYTES;
}

/**
 * One MP4 to download: a plain https file (no streaming playlist), 1080p or
 * less, with sound when there is such a format, the sharpest of those. Null
 * when the video is live, longer than 3 minutes, or nothing fits.
 */
export function pickReelFormat(info: YtdlpInfo): ReelPick | null {
  if (!info || info.is_live) return null;
  const duration = typeof info.duration === "number" && info.duration > 0 ? info.duration : null;
  if (duration !== null && duration > MAX_VIDEO_SECONDS + 0.5) return null;
  const candidates = (info.formats?.length ? info.formats : [info]).filter((f) =>
    usable(f, duration),
  );
  if (!candidates.length) return null;
  const score = (f: YtdlpFormat) =>
    (has(f.acodec) || f.acodec === undefined ? 1e6 : 0) +
    (short(f.height, f.width) === Infinity ? 0 : short(f.height, f.width)) * 100 +
    Math.min(f.tbr ?? 0, 99);
  const best = [...candidates].sort((a, b) => score(b) - score(a))[0];
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(best.http_headers ?? {}))
    if (
      SAFE_HEADERS.includes(name.toLowerCase()) &&
      typeof value === "string" &&
      value.length < 500
    )
      headers[name] = value;
  const height = short(best.height, best.width);
  return {
    url: best.url!,
    title: (info.title ?? "").replace(/\s+/g, " ").trim().slice(0, 100),
    duration,
    height: height === Infinity ? null : height,
    headers,
  };
}
