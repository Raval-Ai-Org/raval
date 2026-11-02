// Inspo reel links (flag FEATURE_FLAG_INSPO_LINKS_ENABLED, off unless set):
// yt-dlp only lists a public Instagram, TikTok or YouTube video's formats;
// it never downloads. The chosen MP4 is fetched through safeFetch like any
// other user-supplied URL, so the SSRF guard and the size cap still apply.
import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { assertPublicUrl, safeFetch } from "@/server/safe-fetch";
import { isReelLink, pickReelFormat, type YtdlpInfo } from "@/lib/inspo/links";
import { MAX_VIDEO_BYTES } from "@/lib/inspo/uploads";

const run = promisify(execFile);
const ytdlp = () => process.env.YTDLP_PATH || "yt-dlp";

export type LinkVideo = { bytes: Buffer; mime: string; title: string; url: string };

/** The video behind a reel link, or null when it can't be read (the caller says "upload it"). */
export async function fetchReelVideo(raw: string): Promise<LinkVideo | null> {
  if (!isReelLink(raw)) return null;
  const link = raw.trim();
  try {
    assertPublicUrl(link);
  } catch {
    return null;
  }
  let info: YtdlpInfo;
  try {
    const { stdout } = await run(
      ytdlp(),
      [
        "--dump-single-json",
        "--no-playlist",
        "--no-warnings",
        "--skip-download",
        "--no-config",
        "--socket-timeout",
        "15",
        "--",
        link,
      ],
      { timeout: 45_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
    );
    info = JSON.parse(stdout) as YtdlpInfo;
  } catch {
    return null;
  }
  const pick = pickReelFormat(info);
  if (!pick) return null;
  const fetched = await safeFetch(pick.url, {
    headers: pick.headers,
    timeoutMs: 120_000,
    maxBytes: MAX_VIDEO_BYTES,
    onOverflow: "error",
  }).catch(() => null);
  if (!fetched?.ok) return null;
  return {
    bytes: Buffer.from(fetched.bytes),
    mime: "video/mp4",
    title: pick.title,
    url: link,
  };
}
