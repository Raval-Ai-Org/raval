import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, relative } from "node:path";

const run = promisify(execFile);
const ffmpeg = () => process.env.FFMPEG_PATH || "ffmpeg";
const options = { timeout: 120_000, maxBuffer: 1024 * 1024, windowsHide: true };

export async function assertVideoEncoder() {
  await run(ffmpeg(), ["-version"], options);
}

/** A short dissolve between clips that are not chained (mood pieces). */
export const DISSOLVE_SECONDS = 0.3;

function videoBytes(dataUrl: string): Buffer {
  const match = /^data:video\/[a-z0-9.+-]+;base64,([a-z0-9+/=]+)$/i.exec(dataUrl);
  if (!match) throw new Error("Invalid generated video bytes.");
  return Buffer.from(match[1], "base64");
}

/**
 * The very last frame of a clip, as a JPEG: the next chained clip starts from
 * it, so the person, product and place carry straight on.
 */
export async function lastVideoFrame(dataUrl: string): Promise<Buffer> {
  const directory = await mkdtemp(join(tmpdir(), "mellox-frame-"));
  try {
    const input = join(directory, "clip.mp4");
    const output = join(directory, "last.jpg");
    await writeFile(input, videoBytes(dataUrl));
    await run(
      ffmpeg(),
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-y",
        "-protocol_whitelist",
        "file,pipe",
        "-format_whitelist",
        "mov,matroska,webm,avi,mpeg,ogg",
        "-sseof",
        "-0.25",
        "-i",
        input,
        "-update",
        "1",
        "-q:v",
        "2",
        output,
      ],
      options,
    );
    return await readFile(output);
  } finally {
    const withinTemp = relative(resolve(tmpdir()), resolve(directory));
    if (withinTemp && !withinTemp.startsWith("..") && !withinTemp.includes(":"))
      await rm(directory, { recursive: true, force: true });
  }
}

/** Re-encode before concatenation so provider/fallback codecs and audio tracks match. */
export async function assembleVideoClips(
  clips: { dataUrl: string; seconds: number }[],
  audio: boolean,
  opts: { dissolve?: boolean } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "mellox-video-"));
  try {
    let width = 0;
    let height = 0;
    let inputBytes = 0;
    for (let i = 0; i < clips.length; i++) {
      const match = /^data:video\/[a-z0-9.+-]+;base64,([a-z0-9+/=]+)$/i.exec(clips[i].dataUrl);
      if (!match) throw new Error("Invalid generated video bytes.");
      const bytes = Buffer.from(match[1], "base64");
      inputBytes += bytes.length;
      if (inputBytes > 240 * 1024 * 1024)
        throw new Error("Generated clips exceed the video size limit.");
      const input = join(directory, `input-${i}.mp4`);
      await writeFile(input, bytes);
      // Decode the video stream to measure real footage, rather than trusting
      // a container duration that might include longer audio or bogus metadata.
      const probe = await run(
        ffmpeg(),
        [
          "-hide_banner",
          "-nostdin",
          "-threads",
          "1",
          "-protocol_whitelist",
          "file,pipe",
          "-format_whitelist",
          "mov,matroska,webm,avi,mpeg,ogg",
          "-i",
          input,
          "-map",
          "0:v:0",
          "-an",
          "-progress",
          "pipe:1",
          "-f",
          "null",
          "-",
        ],
        options,
      );
      const dimensions = /Video:[^\r\n]*?\b(\d{2,5})x(\d{2,5})\b/.exec(probe.stderr);
      const times = [...probe.stdout.matchAll(/out_time_us=(\d+)/g)];
      const duration = Number(times.at(-1)?.[1]) / 1_000_000;
      if (!dimensions || !Number.isFinite(duration) || duration + 0.15 < clips[i].seconds)
        throw new Error("A generated clip was shorter than requested. Please generate again.");
      if (!width) {
        const sourceWidth = Number(dimensions[1]);
        const sourceHeight = Number(dimensions[2]);
        const scale = Math.min(1, 1920 / Math.max(sourceWidth, sourceHeight));
        width = Math.floor((sourceWidth * scale) / 2) * 2;
        height = Math.floor((sourceHeight * scale) / 2) * 2;
      }
      const hasAudio = /Stream[^\r\n]*Audio:/.test(probe.stderr);
      await run(
        ffmpeg(),
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-nostdin",
          "-y",
          "-threads",
          "1",
          "-protocol_whitelist",
          "file,pipe",
          "-format_whitelist",
          "mov,matroska,webm,avi,mpeg,ogg",
          "-i",
          input,
          ...(audio && !hasAudio ? ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"] : []),
          "-map",
          "0:v:0",
          "-vf",
          `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,tpad=stop_mode=clone:stop_duration=0.15`,
          "-r",
          "30",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "20",
          "-pix_fmt",
          "yuv420p",
          ...(audio
            ? [
                "-map",
                hasAudio ? "0:a:0" : "1:a:0",
                "-af",
                "apad",
                "-c:a",
                "aac",
                "-ar",
                "48000",
                "-ac",
                "2",
              ]
            : ["-an"]),
          "-t",
          String(clips[i].seconds),
          "-movflags",
          "+faststart",
          join(directory, `clip-${i}.mp4`),
        ],
        options,
      );
    }
    const output = join(directory, "output.mp4");
    if (opts.dissolve && clips.length > 1) {
      // Each clip overlaps the next by the dissolve; offsets are on the joined timeline.
      const inputs = clips.flatMap((_, i) => ["-i", join(directory, `clip-${i}.mp4`)]);
      const parts: string[] = [];
      let video = "[0:v]";
      let sound = "[0:a]";
      let offset = 0;
      for (let i = 1; i < clips.length; i++) {
        offset += clips[i - 1].seconds - DISSOLVE_SECONDS;
        parts.push(
          `${video}[${i}:v]xfade=transition=fade:duration=${DISSOLVE_SECONDS}:offset=${offset.toFixed(2)}[v${i}]`,
        );
        video = `[v${i}]`;
        if (audio) {
          parts.push(`${sound}[${i}:a]acrossfade=d=${DISSOLVE_SECONDS}[a${i}]`);
          sound = `[a${i}]`;
        }
      }
      await run(
        ffmpeg(),
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-nostdin",
          "-y",
          "-threads",
          "1",
          "-protocol_whitelist",
          "file,pipe",
          ...inputs,
          "-filter_complex",
          parts.join(";"),
          "-map",
          video,
          ...(audio ? ["-map", sound, "-c:a", "aac", "-ar", "48000", "-ac", "2"] : ["-an"]),
          "-r",
          "30",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "20",
          "-pix_fmt",
          "yuv420p",
          "-movflags",
          "+faststart",
          output,
        ],
        options,
      );
      const joined = await readFile(output);
      if (joined.length > 120 * 1024 * 1024)
        throw new Error("The assembled video exceeds the storage size limit.");
      return {
        dataUrl: `data:video/mp4;base64,${joined.toString("base64")}`,
        bytes: joined.length,
      };
    }
    await writeFile(
      join(directory, "clips.txt"),
      clips.map((_, i) => `file 'clip-${i}.mp4'`).join("\n"),
    );
    await run(
      ffmpeg(),
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-y",
        "-f",
        "concat",
        "-safe",
        "1",
        "-protocol_whitelist",
        "file,pipe",
        "-i",
        join(directory, "clips.txt"),
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        output,
      ],
      options,
    );
    const bytes = await readFile(output);
    if (bytes.length > 120 * 1024 * 1024)
      throw new Error("The assembled video exceeds the storage size limit.");
    return { dataUrl: `data:video/mp4;base64,${bytes.toString("base64")}`, bytes: bytes.length };
  } finally {
    const withinTemp = relative(resolve(tmpdir()), resolve(directory));
    if (withinTemp && !withinTemp.startsWith("..") && !withinTemp.includes(":"))
      await rm(directory, { recursive: true, force: true });
  }
}
