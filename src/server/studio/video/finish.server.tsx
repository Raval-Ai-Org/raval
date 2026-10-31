// The code half of a Studio AI video (src/lib/studio/video/): measuring the
// finished file, sampling its frames for the checks, framing a post's picture
// for the video's shape, drawing the offer's end card with exact words, and
// adding the ending. FFmpeg and next/og only; no model call, nothing to pay.
import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import type { VideoProbe } from "@/lib/studio/video/checks";
import { loadFonts } from "@/server/studio/carousel-render.server";

const run = promisify(execFile);
const ffmpeg = () => process.env.FFMPEG_PATH || "ffmpeg";
const options = { timeout: 120_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true };
const SAFE_INPUT = [
  "-protocol_whitelist",
  "file,pipe",
  "-format_whitelist",
  "mov,matroska,webm,avi,mpeg,ogg,image2,png_pipe,jpeg_pipe",
];

/** How the ending is added: a dissolve into the still, then the still held. */
export const ENDING_FADE_SECONDS = 0.5;
export const ENDING_HOLD_SECONDS = 1.2;

async function withTemp<T>(work: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "mellox-studio-video-"));
  try {
    return await work(dir);
  } finally {
    const inside = relative(resolve(tmpdir()), resolve(dir));
    if (inside && !inside.startsWith("..") && !inside.includes(":"))
      await rm(dir, { recursive: true, force: true });
  }
}

export function videoBuffer(dataUrl: string): Buffer {
  const match = /^data:video\/[a-z0-9.+-]+;base64,([a-z0-9+/=]+)$/i.exec(dataUrl);
  if (!match) throw new Error("Invalid video bytes.");
  return Buffer.from(match[1], "base64");
}

const spans = (log: string, kind: "black" | "freeze"): { start: number; end: number }[] => {
  if (kind === "black")
    return [...log.matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)/g)].map((m) => ({
      start: Number(m[1]),
      end: Number(m[2]),
    }));
  const starts = [...log.matchAll(/freeze_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...log.matchAll(/freeze_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  return starts.map((start, i) => ({ start, end: ends[i] ?? Number.POSITIVE_INFINITY }));
};

/** What the checks need to know about the file: length, size, sound, dead footage. */
export async function probeVideo(dataUrl: string): Promise<VideoProbe> {
  return withTemp(async (dir) => {
    const input = join(dir, "in.mp4");
    await writeFile(input, videoBuffer(dataUrl));
    const result = await run(
      ffmpeg(),
      [
        "-hide_banner",
        "-nostdin",
        "-threads",
        "1",
        ...SAFE_INPUT,
        "-i",
        input,
        "-map",
        "0:v:0",
        "-vf",
        "blackdetect=d=0.5:pix_th=0.08,freezedetect=n=0.002:d=0.9",
        "-an",
        "-progress",
        "pipe:1",
        "-f",
        "null",
        "-",
      ],
      options,
    );
    const size = /Video:[^\r\n]*?\b(\d{2,5})x(\d{2,5})\b/.exec(result.stderr);
    const times = [...result.stdout.matchAll(/out_time_us=(\d+)/g)];
    const duration = Number(times.at(-1)?.[1] ?? 0) / 1_000_000;
    const frozen = spans(result.stderr, "freeze").map((span) => ({
      start: span.start,
      end: Math.min(span.end, duration),
    }));
    return {
      duration,
      width: Number(size?.[1] ?? 0),
      height: Number(size?.[2] ?? 0),
      hasAudio: /Stream[^\r\n]*Audio:/.test(result.stderr),
      black: spans(result.stderr, "black"),
      frozen,
    };
  });
}

/** JPEG frames at these times (seconds), small enough for the checker to read. */
export async function sampleFrames(dataUrl: string, times: readonly number[]): Promise<Buffer[]> {
  return withTemp(async (dir) => {
    const input = join(dir, "in.mp4");
    await writeFile(input, videoBuffer(dataUrl));
    const out: Buffer[] = [];
    for (const [i, time] of times.entries()) {
      const file = join(dir, `f${i}.jpg`);
      await run(
        ffmpeg(),
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-nostdin",
          "-y",
          "-ss",
          Math.max(0, time).toFixed(2),
          ...SAFE_INPUT,
          "-i",
          input,
          "-frames:v",
          "1",
          "-vf",
          "scale=512:-2",
          "-q:v",
          "4",
          file,
        ],
        options,
      );
      out.push(await readFile(file));
    }
    return out;
  });
}

/** The pixel size of a video at this ratio, as providers make it at 720p. */
export function videoCanvasFor(ratio: string): { width: number; height: number } {
  if (ratio === "16:9") return { width: 1280, height: 720 };
  if (ratio === "1:1") return { width: 1080, height: 1080 };
  if (ratio === "4:3") return { width: 1024, height: 768 };
  if (ratio === "3:4") return { width: 768, height: 1024 };
  if (ratio === "4:5") return { width: 864, height: 1080 };
  return { width: 720, height: 1280 };
}

/**
 * A post's picture placed whole on the video's canvas, over a soft, blurred
 * copy of itself. The model's first frame is then the entire post (a square
 * post is never cropped into a vertical video), and the ending can dissolve
 * back into exactly this frame.
 */
export async function frameForVideo(picture: Buffer, ratio: string): Promise<Buffer> {
  const { width, height } = videoCanvasFor(ratio);
  const meta = await sharp(picture).metadata();
  const sameShape =
    meta.width && meta.height && Math.abs(meta.width / meta.height - width / height) < 0.02;
  if (sameShape)
    return sharp(picture).resize(width, height, { fit: "cover" }).jpeg({ quality: 92 }).toBuffer();
  const backdrop = await sharp(picture)
    .resize(width, height, { fit: "cover" })
    .blur(36)
    .modulate({ brightness: 0.82 })
    .toBuffer();
  const front = await sharp(picture)
    .resize(width, height, { fit: "inside", withoutEnlargement: false })
    .toBuffer();
  return sharp(backdrop)
    .composite([{ input: front, gravity: "center" }])
    .jpeg({ quality: 92 })
    .toBuffer();
}

export type EndCardInput = {
  headline: string;
  detail?: string;
  brandName: string;
  ratio: string;
  /** Brand colours (hex): background and text. */
  background: string;
  ink: string;
  accent?: string;
  font?: string;
  /** The real logo as a data URL, placed by code. */
  logo?: string | null;
};

const HEX = /^#[0-9a-f]{6}$/i;

/** The offer's last card, drawn by code with the exact words. */
export async function renderEndCard(input: EndCardInput): Promise<Buffer> {
  const { width, height } = videoCanvasFor(input.ratio);
  const fonts = input.font ? await loadFonts([input.font]) : [];
  const family = fonts[0]?.name ?? "sans-serif";
  const background = HEX.test(input.background) ? input.background : "#111111";
  const ink = HEX.test(input.ink) ? input.ink : "#ffffff";
  const accent = input.accent && HEX.test(input.accent) ? input.accent : ink;
  const unit = Math.min(width, height);
  const image = new ImageResponse(
    <div
      style={{
        width,
        height,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background,
        color: ink,
        fontFamily: family,
        padding: Math.round(unit * 0.1),
        textAlign: "center",
      }}
    >
      {input.logo ? (
        <img
          src={input.logo}
          alt=""
          style={{ height: Math.round(unit * 0.09), marginBottom: Math.round(unit * 0.07) }}
        />
      ) : (
        <div
          style={{
            fontSize: Math.round(unit * 0.045),
            letterSpacing: 2,
            marginBottom: Math.round(unit * 0.07),
            opacity: 0.85,
          }}
        >
          {input.brandName.toUpperCase()}
        </div>
      )}
      <div
        style={{
          fontSize: Math.round(unit * 0.11),
          fontWeight: 700,
          lineHeight: 1.05,
          display: "flex",
        }}
      >
        {input.headline}
      </div>
      {input.detail ? (
        <div
          style={{
            marginTop: Math.round(unit * 0.05),
            fontSize: Math.round(unit * 0.05),
            color: accent,
            display: "flex",
          }}
        >
          {input.detail}
        </div>
      ) : null}
    </div>,
    { width, height, ...(fonts.length ? { fonts } : {}) },
  );
  return sharp(Buffer.from(await image.arrayBuffer()))
    .jpeg({ quality: 92 })
    .toBuffer();
}

/**
 * The video dissolving into a still (the post itself, or the offer card),
 * then the still held. The still is scaled to the video's own size, and the
 * sound fades out under it.
 */
export async function endOnStill(
  dataUrl: string,
  still: Buffer,
  opts: { duration: number; width: number; height: number; audio: boolean },
): Promise<{ dataUrl: string; bytes: number }> {
  return withTemp(async (dir) => {
    const input = join(dir, "in.mp4");
    const picture = join(dir, "still.jpg");
    const output = join(dir, "out.mp4");
    await writeFile(input, videoBuffer(dataUrl));
    await writeFile(
      picture,
      await sharp(still).resize(opts.width, opts.height, { fit: "cover" }).jpeg().toBuffer(),
    );
    const offset = Math.max(0, opts.duration - ENDING_FADE_SECONDS);
    const tail = ENDING_FADE_SECONDS + ENDING_HOLD_SECONDS;
    const filters = [
      `[0:v]fps=30,format=yuv420p,setsar=1[v0]`,
      `[1:v]fps=30,format=yuv420p,setsar=1,trim=duration=${tail}[v1]`,
      `[v0][v1]xfade=transition=fade:duration=${ENDING_FADE_SECONDS}:offset=${offset.toFixed(2)}[v]`,
      ...(opts.audio
        ? [
            `[0:a]apad=pad_dur=${ENDING_HOLD_SECONDS},afade=t=out:st=${offset.toFixed(2)}:d=${tail}[a]`,
          ]
        : []),
    ];
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
        ...SAFE_INPUT,
        "-i",
        input,
        "-loop",
        "1",
        "-t",
        String(tail),
        "-i",
        picture,
        "-filter_complex",
        filters.join(";"),
        "-map",
        "[v]",
        ...(opts.audio ? ["-map", "[a]", "-c:a", "aac", "-ar", "48000", "-ac", "2"] : ["-an"]),
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
    const bytes = await readFile(output);
    return { dataUrl: `data:video/mp4;base64,${bytes.toString("base64")}`, bytes: bytes.length };
  });
}
