// The code half of a Studio AI video (src/lib/studio/video/): measuring the
// finished file, sampling its frames for the checks, framing a post's picture
// for the video's shape, drawing the offer's end card and the storyboard's
// words with exact spelling, and adding the ending. FFmpeg and next/og only;
// no model call, nothing to pay.
import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import type { VideoProbe } from "@/lib/studio/video/checks";
import { cueFades, type TextCue } from "@/lib/studio/video/overlay";
import { coverCrop, MAX_ZOOM_CROP } from "@/lib/studio/video/opening-frame";
import type { HookCue } from "@/lib/ugc/hook-text";
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
      const grab = (at: number) =>
        run(
          ffmpeg(),
          [
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-y",
            "-ss",
            Math.max(0, at).toFixed(2),
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
      await grab(time);
      // A seek into the last few frames can come back empty; step back a little.
      const frame =
        (await readFile(file).catch(() => null)) ??
        (await grab(time - 0.5).then(() => readFile(file)));
      out.push(frame as Buffer);
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
  // The same shape, or one a thin edge's zoom fills: no bars at all.
  const crop = coverCrop({ width: meta.width ?? 0, height: meta.height ?? 0 }, ratio);
  if (meta.width && meta.height && crop <= MAX_ZOOM_CROP)
    return sharp(picture)
      .resize(width, height, { fit: "cover", position: "attention" })
      .jpeg({ quality: 92 })
      .toBuffer();
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

export type WordStyle = { font?: string; accent?: string };

/** One cue's words as a transparent picture the size of the video, drawn with the brand's font. */
async function renderCue(
  cue: TextCue,
  size: { width: number; height: number },
  style: WordStyle,
): Promise<Buffer> {
  const { width, height } = size;
  const fonts = style.font ? await loadFonts([style.font]) : [];
  const family = fonts[0]?.name ?? "sans-serif";
  const unit = Math.min(width, height);
  const hook = cue.role === "hook";
  const fontSize = Math.round(unit * (hook ? (cue.text.length > 40 ? 0.062 : 0.075) : 0.06));
  const image = new ImageResponse(
    <div
      style={{
        width,
        height,
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        // Clear of the app's top bar and of the caption and buttons at the bottom.
        paddingTop: Math.round(height * (hook ? 0.2 : 0.16)),
        paddingLeft: Math.round(width * 0.09),
        paddingRight: Math.round(width * 0.09),
      }}
    >
      <div
        style={{
          display: "flex",
          textAlign: "center",
          justifyContent: "center",
          color: "#ffffff",
          fontFamily: family,
          fontSize,
          fontWeight: 700,
          lineHeight: 1.15,
          padding: `${Math.round(fontSize * 0.35)}px ${Math.round(fontSize * 0.55)}px`,
          borderRadius: Math.round(fontSize * 0.4),
          background: "rgba(0,0,0,0.42)",
          textShadow: "0 2px 8px rgba(0,0,0,0.55)",
          // The brand's accent as a thin underline, only when it is a real colour.
          ...(style.accent && HEX.test(style.accent)
            ? { borderBottom: `${Math.max(3, Math.round(unit * 0.006))}px solid ${style.accent}` }
            : {}),
        }}
      >
        {cue.text}
      </div>
    </div>,
    { width, height, ...(fonts.length ? { fonts } : {}) },
  );
  return Buffer.from(await image.arrayBuffer());
}

/* ── Creator video hook text (src/lib/ugc/hook-text.ts) ───────────────── */

const OUTLINE = (px: number) =>
  [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ]
    .map(([x, y]) => `${x * px}px ${y * px}px 0 #000`)
    .join(", ");

/** Lines of at most `max` characters, broken between words. */
function wrapLines(text: string, max: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && `${line} ${word}`.length > max) {
      out.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out;
}

/** One hook cue as a transparent picture the size of the video, in its Reels-style preset. */
export async function renderHookCue(
  cue: HookCue,
  size: { width: number; height: number },
  style: WordStyle,
): Promise<Buffer> {
  const { width, height } = size;
  const fonts = await loadFonts([style.font ?? "Montserrat"]);
  const family = fonts[0]?.name ?? "sans-serif";
  const unit = Math.min(width, height);
  const accent = style.accent && HEX.test(style.accent) ? style.accent : "#ffe14d";
  const big = cue.preset === "stacked";
  const fontSize = Math.round(
    unit * (big ? 0.11 : cue.preset === "pov" ? 0.068 : cue.text.length > 36 ? 0.07 : 0.08),
  );
  const lines = wrapLines(cue.text, big ? 12 : cue.preset === "headline" ? 24 : 18);
  const lower = cue.preset === "headline";
  const side = cue.side;
  const pad = Math.round(width * 0.07);

  const lineBox = (text: string, i: number) => {
    const base = {
      display: "flex",
      fontFamily: family,
      fontSize,
      fontWeight: 700,
      lineHeight: 1.12,
      textAlign: "center" as const,
    };
    switch (cue.preset) {
      case "bubble":
        return (
          <div
            key={i}
            style={{
              ...base,
              color: "#111111",
              background: "#ffffff",
              padding: `${Math.round(fontSize * 0.18)}px ${Math.round(fontSize * 0.42)}px`,
              borderRadius: Math.round(fontSize * 0.32),
              marginTop: i ? -Math.round(fontSize * 0.08) : 0,
            }}
          >
            {text}
          </div>
        );
      case "highlight":
        return (
          <div
            key={i}
            style={{
              ...base,
              color: "#111111",
              background: "#ffe14d",
              padding: `${Math.round(fontSize * 0.06)}px ${Math.round(fontSize * 0.28)}px`,
              borderRadius: Math.round(fontSize * 0.12),
              marginTop: Math.round(fontSize * 0.08),
            }}
          >
            {text}
          </div>
        );
      case "stacked": {
        // The longest word carries the brand's accent.
        const words = text.split(" ");
        const key = cue.text.split(" ").reduce((a, b) => (b.length > a.length ? b : a), "");
        return (
          <div
            key={i}
            style={{
              ...base,
              color: "#ffffff",
              textShadow: OUTLINE(Math.max(3, Math.round(fontSize * 0.07))),
              gap: Math.round(fontSize * 0.22),
            }}
          >
            {words.map((w, j) => (
              <span key={j} style={{ color: w === key ? accent : "#ffffff" }}>
                {w}
              </span>
            ))}
          </div>
        );
      }
      case "pov":
        return (
          <div
            key={i}
            style={{
              ...base,
              color: "#ffffff",
              fontWeight: 700,
              textShadow: "0 2px 10px rgba(0,0,0,0.65)",
            }}
          >
            {text}
          </div>
        );
      default:
        return (
          <div
            key={i}
            style={{
              ...base,
              color: "#ffffff",
              // The Reels "classic": a heavy black outline plus a hard drop.
              WebkitTextStroke: `${Math.max(2, Math.round(fontSize * 0.09))}px #000000`,
              textShadow: `0 ${Math.max(2, Math.round(fontSize * 0.06))}px 0 #000000`,
            }}
          >
            {text}
          </div>
        );
    }
  };

  let body;
  if (cue.preset === "reply") {
    body = (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          background: "#ffffff",
          borderRadius: Math.round(fontSize * 0.45),
          padding: `${Math.round(fontSize * 0.45)}px ${Math.round(fontSize * 0.6)}px`,
          maxWidth: width - pad * 2,
          boxShadow: "0 6px 24px rgba(0,0,0,0.25)",
        }}
      >
        {cue.label ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: Math.round(fontSize * 0.3),
              fontFamily: family,
              fontSize: Math.round(fontSize * 0.55),
              color: "#6b6b6b",
              marginBottom: Math.round(fontSize * 0.2),
            }}
          >
            <div
              style={{
                display: "flex",
                width: Math.round(fontSize * 0.75),
                height: Math.round(fontSize * 0.75),
                borderRadius: 999,
                background: "#d9d9d9",
              }}
            />
            {cue.label}
          </div>
        ) : null}
        <div
          style={{
            display: "flex",
            fontFamily: family,
            fontSize: Math.round(fontSize * 0.8),
            fontWeight: 700,
            color: "#111111",
            lineHeight: 1.2,
          }}
        >
          {cue.text}
        </div>
      </div>
    );
  } else if (cue.preset === "headline") {
    body = (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          width: width - pad * 2,
        }}
      >
        <div
          style={{
            display: "flex",
            fontFamily: family,
            fontSize: Math.round(fontSize * 0.55),
            fontWeight: 700,
            color: "#ffffff",
            background: "#d7263d",
            padding: `${Math.round(fontSize * 0.12)}px ${Math.round(fontSize * 0.35)}px`,
            letterSpacing: 2,
          }}
        >
          BREAKING
        </div>
        <div
          style={{
            display: "flex",
            fontFamily: family,
            fontSize: Math.round(fontSize * 0.75),
            fontWeight: 700,
            color: "#111111",
            background: "#ffffff",
            padding: `${Math.round(fontSize * 0.2)}px ${Math.round(fontSize * 0.35)}px`,
            textTransform: "uppercase",
          }}
        >
          {cue.text}
        </div>
      </div>
    );
  } else {
    body = (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        {lines.map(lineBox)}
      </div>
    );
  }

  // Where it sits: the upper third, clear of the app's top bar; a news bar low;
  // a split label at the top of its own half.
  const box = {
    left: side === "right" ? width / 2 : 0,
    top: 0,
    w: side ? width / 2 : width,
    h: height,
  };
  const image = new ImageResponse(
    <div style={{ width, height, display: "flex", position: "relative" }}>
      <div
        style={{
          position: "absolute",
          left: box.left,
          top: box.top,
          width: box.w,
          height: box.h,
          display: "flex",
          justifyContent: "center",
          alignItems: lower ? "flex-end" : "flex-start",
          paddingTop: lower ? 0 : Math.round(box.h * (side ? 0.14 : 0.17)),
          paddingBottom: lower ? Math.round(height * 0.28) : 0,
          paddingLeft: side ? Math.round(pad / 2) : pad,
          paddingRight: side ? Math.round(pad / 2) : pad,
        }}
      >
        {body}
      </div>
    </div>,
    { width, height, ...(fonts.length ? { fonts } : {}) },
  );
  return Buffer.from(await image.arrayBuffer());
}

/**
 * A Creator video's hook text drawn on the finished video, exactly as
 * written, each cue fading in and out on its own timing. Same FFmpeg pass as
 * `overlayWords`; no cues: the video is unchanged.
 */
export async function overlayHookText(
  dataUrl: string,
  cues: readonly HookCue[],
  style: WordStyle = {},
): Promise<string> {
  if (!cues.length) return dataUrl;
  const probe = await probeVideo(dataUrl);
  if (!probe.width || !probe.height || probe.duration < 1) return dataUrl;
  const timed: TextCue[] = cues.map((c) => ({
    text: c.text,
    start: c.start,
    end: Math.min(c.end, probe.duration - 0.1),
    role: "hook",
  }));
  return overlayPictures(
    dataUrl,
    timed,
    await Promise.all(cues.map((c) => renderHookCue(c, probe, style))),
    probe.duration,
  );
}

/**
 * The storyboard's words drawn on the finished video, exactly as written,
 * each fading in and out on its own cue. No cues: the video is unchanged.
 */
export async function overlayWords(
  dataUrl: string,
  cues: readonly TextCue[],
  opts: { duration: number; width: number; height: number; style: WordStyle },
): Promise<string> {
  if (!cues.length || !opts.width || !opts.height) return dataUrl;
  const drawn: Buffer[] = [];
  for (const cue of cues) drawn.push(await renderCue(cue, opts, opts.style));
  return overlayPictures(dataUrl, cues, drawn, opts.duration);
}

/** Lay one transparent picture per cue over the video, each fading on its cue's timing. */
async function overlayPictures(
  dataUrl: string,
  cues: readonly TextCue[],
  drawn: readonly Buffer[],
  duration: number,
): Promise<string> {
  return withTemp(async (dir) => {
    const input = join(dir, "in.mp4");
    const output = join(dir, "out.mp4");
    await writeFile(input, videoBuffer(dataUrl));
    const pictures: string[] = [];
    for (const [i, png] of drawn.entries()) {
      const file = join(dir, `cue${i}.png`);
      await writeFile(file, png);
      pictures.push(file);
    }
    const length = duration.toFixed(2);
    const filters: string[] = [`[0:v]fps=30,format=yuv420p,setsar=1[b0]`];
    cues.forEach((cue, i) => {
      const fade = cueFades(cue);
      filters.push(
        `[${i + 1}:v]format=rgba,fade=t=in:st=${fade.inAt}:d=${fade.seconds}:alpha=1,fade=t=out:st=${fade.outAt}:d=${fade.seconds}:alpha=1[w${i}]`,
        `[b${i}][w${i}]overlay=0:0:eof_action=pass:format=auto[b${i + 1}]`,
      );
    });
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
        ...pictures.flatMap((file) => ["-loop", "1", "-t", length, "-i", file]),
        "-filter_complex",
        filters.join(";"),
        "-map",
        `[b${cues.length}]`,
        "-map",
        "0:a?",
        "-c:a",
        "copy",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-t",
        length,
        "-movflags",
        "+faststart",
        output,
      ],
      options,
    );
    const bytes = await readFile(output);
    return `data:video/mp4;base64,${bytes.toString("base64")}`;
  });
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
