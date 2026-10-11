import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, relative } from "node:path";
import { safeFetch } from "@/server/safe-fetch";
import { cache, digest } from "@/server/cache/store";
import { getRequestScope } from "@/server/request-context";
import { assertSafeMediaImages, MediaSafetyError } from "./media-safety.server";

const MAX_VIDEO_BYTES = 120 * 1024 * 1024;
const MAX_FRAMES = 90;
const run = promisify(execFile);
export type VideoFrameExtractor = (bytes: Buffer) => Promise<string[]>;
const defaultExtractor: VideoFrameExtractor = async (bytes) => {
  const tempRoot = resolve(tmpdir());
  const directory = await mkdtemp(join(tempRoot, "mellox-safety-"));
  try {
    const input = join(directory, "source.bin");
    await writeFile(input, bytes);
    // File-only input; never let a playlist or container make network requests.
    // One frame every two seconds; reject overflow instead of silently truncating.
    await run(
      process.env.FFMPEG_PATH || "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-threads",
        "1",
        "-protocol_whitelist",
        "file,pipe",
        "-format_whitelist",
        "mov,matroska,webm,avi,mpeg,ogg",
        "-i",
        input,
        "-an",
        "-vf",
        "fps=1/2,scale=512:512:force_original_aspect_ratio=decrease",
        "-frames:v",
        String(MAX_FRAMES + 1),
        join(directory, "frame-%03d.jpg"),
      ],
      { timeout: 60_000, maxBuffer: 1024 * 1024, windowsHide: true },
    );
    const files = (await readdir(directory))
      .filter((file) => /^frame-\d{3}\.jpg$/.test(file))
      .sort();
    if (!files.length || files.length > MAX_FRAMES) throw new MediaSafetyError(true);
    return Promise.all(
      files.map(
        async (file) =>
          `data:image/jpeg;base64,${(await readFile(join(directory, file))).toString("base64")}`,
      ),
    );
  } finally {
    const withinTemp = relative(tempRoot, resolve(directory));
    if (withinTemp && !withinTemp.startsWith("..") && !withinTemp.includes(":"))
      await rm(directory, { recursive: true, force: true });
  }
};
let extractFrames = defaultExtractor;
/** Server-only fixture seam; not controllable by requests or feature flags. */
export function setVideoFrameExtractor(next: VideoFrameExtractor | null) {
  extractFrames = next ?? defaultExtractor;
}

/** Sample actual bytes, never infer safety from an editable kind or file extension. */
export async function assertSafeVideo(source: string): Promise<void> {
  let bytes: Buffer;
  try {
    if (source.startsWith("data:")) {
      const match = /^data:video\/[a-z0-9.+-]+;base64,([a-z0-9+/=]+)$/i.exec(source);
      if (!match || match[1].length > Math.ceil((MAX_VIDEO_BYTES * 4) / 3))
        throw new MediaSafetyError(true);
      bytes = Buffer.from(match[1], "base64");
    } else {
      const response = await safeFetch(source, {
        timeoutMs: 30_000,
        maxBytes: MAX_VIDEO_BYTES,
        onOverflow: "error",
      });
      if (!response.ok) throw new MediaSafetyError(true);
      bytes = Buffer.from(response.bytes);
    }
    if (!bytes.length || bytes.length > MAX_VIDEO_BYTES) throw new MediaSafetyError(true);
    const scope = getRequestScope();
    const key = `video-safety:v1:${await digest(`${scope.workspaceId ?? scope.userId ?? "anonymous"}|${bytes.toString("base64")}`)}`;
    if (await cache.get<boolean>(key)) return;
    const frames = await extractFrames(bytes);
    if (!frames.length || frames.length > MAX_FRAMES) throw new MediaSafetyError(true);
    for (let index = 0; index < frames.length; index += 4) {
      await Promise.all(
        frames.slice(index, index + 4).map((frame) => assertSafeMediaImages([frame])),
      );
    }
    await cache.set(key, true, 7 * 24 * 3600);
  } catch (error) {
    if (error instanceof MediaSafetyError) throw error;
    throw new MediaSafetyError(true);
  }
}
