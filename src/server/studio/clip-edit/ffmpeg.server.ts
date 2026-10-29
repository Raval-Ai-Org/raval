// FFmpeg steps for branding the brand's own clips and making photo recaps.
// Every input is a file Mellox wrote into its own temporary folder; inputs
// are limited to local files and known containers.
import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { OVERLAY_FADE_SECONDS, OVERLAY_SECONDS, RECAP_ZOOM } from "@/lib/studio/clip-edit";
import {
  ANALYSIS_AUDIO_FILTER,
  ANALYSIS_VIDEO_FILTER,
  LOUDNESS_FILTER,
  parseAnalysis,
  xfadeOffsets,
  type ClipAnalysis,
  type Span,
  type Transition,
} from "@/lib/studio/smart-cut";

const run = promisify(execFile);
const ffmpeg = () => process.env.FFMPEG_PATH || "ffmpeg";
const options = { timeout: 300_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true };
const SAFE_INPUT = [
  "-protocol_whitelist",
  "file,pipe",
  "-format_whitelist",
  "mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,avi,mpeg,ogg,image2,png_pipe,lavfi",
];
const QUIET = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-threads", "2"];
const H264 = [
  "-c:v",
  "libx264",
  "-preset",
  "veryfast",
  "-crf",
  "22",
  "-pix_fmt",
  "yuv420p",
  "-r",
  "30",
];
const AAC = ["-c:a", "aac", "-ar", "48000", "-ac", "2"];

export type Probe = { width: number; height: number; duration: number; hasAudio: boolean };

/** Decode the video stream to measure it, rather than trusting container metadata. */
export async function probeVideo(path: string): Promise<Probe> {
  const result = await run(
    ffmpeg(),
    [
      "-hide_banner",
      "-nostdin",
      "-threads",
      "1",
      ...SAFE_INPUT,
      "-i",
      path,
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
  const size = /Video:[^\r\n]*?\b(\d{2,5})x(\d{2,5})\b/.exec(result.stderr);
  const times = [...result.stdout.matchAll(/out_time_us=(\d+)/g)];
  const duration = Number(times.at(-1)?.[1]) / 1_000_000;
  if (!size || !Number.isFinite(duration) || duration <= 0)
    throw new Error("This clip could not be read. Use an MP4, MOV or WebM video.");
  return {
    width: Number(size[1]),
    height: Number(size[2]),
    duration,
    hasAudio: /Stream[^\r\n]*Audio:/.test(result.stderr),
  };
}

/**
 * One quick pass over a clip (video scaled down) that measures scene
 * changes, black and frozen stretches and pauses. Measuring never fails a
 * render: an unreadable log is a clip with nothing measured.
 */
export async function analyzeClip(path: string, probe: Probe): Promise<ClipAnalysis> {
  try {
    const result = await run(
      ffmpeg(),
      [
        "-hide_banner",
        "-nostats",
        "-nostdin",
        "-threads",
        "2",
        ...SAFE_INPUT,
        "-i",
        path,
        "-filter_complex",
        probe.hasAudio
          ? `[0:v]${ANALYSIS_VIDEO_FILTER}[v];[0:a]${ANALYSIS_AUDIO_FILTER}[a]`
          : `[0:v]${ANALYSIS_VIDEO_FILTER}[v]`,
        "-map",
        "[v]",
        ...(probe.hasAudio ? ["-map", "[a]"] : []),
        "-f",
        "null",
        "-",
      ],
      { ...options, maxBuffer: 16 * 1024 * 1024 },
    );
    return parseAnalysis(result.stderr, probe.duration, probe.hasAudio);
  } catch (error) {
    console.warn("[clip-edit] measuring skipped", error instanceof Error ? error.message : error);
    return parseAnalysis("", probe.duration, probe.hasAudio);
  }
}

/** The pauses in a video's sound (captions show no words in silence). */
export async function audioSilences(path: string, duration: number): Promise<Span[]> {
  const result = await run(
    ffmpeg(),
    [
      "-hide_banner",
      "-nostats",
      "-nostdin",
      ...SAFE_INPUT,
      "-i",
      path,
      "-map",
      "0:a:0",
      "-af",
      ANALYSIS_AUDIO_FILTER,
      "-f",
      "null",
      "-",
    ],
    { ...options, maxBuffer: 16 * 1024 * 1024 },
  );
  return parseAnalysis(result.stderr, duration, true).silences;
}

/** The sound as small mono audio for a transcriber: MP3, or 16 kHz WAV for whisper.cpp. */
export async function extractAudio(
  input: string,
  output: string,
  format: "mp3" | "wav",
): Promise<Buffer> {
  await run(
    ffmpeg(),
    [
      ...QUIET,
      ...SAFE_INPUT,
      "-i",
      input,
      "-map",
      "0:a:0",
      "-ac",
      "1",
      "-ar",
      "16000",
      ...(format === "mp3" ? ["-c:a", "libmp3lame", "-b:a", "48k"] : ["-c:a", "pcm_s16le"]),
      output,
    ],
    options,
  );
  return readFile(output);
}

/** One still from a clip, as PNG. */
export async function grabFrame(path: string, seconds: number, out: string): Promise<Buffer> {
  await run(
    ffmpeg(),
    [...QUIET, "-ss", seconds.toFixed(2), ...SAFE_INPUT, "-i", path, "-frames:v", "1", out],
    options,
  );
  return readFile(out);
}

/**
 * A clip fitted to the post's shape: the whole picture shown, with a blurred
 * copy of itself filling any spare space, 30 fps, and always an audio track
 * (silence when the clip has none) so clips join cleanly.
 */
export async function fitClip(args: {
  input: string;
  output: string;
  width: number;
  height: number;
  start: number;
  seconds: number;
  hasAudio: boolean;
}): Promise<void> {
  const { width: w, height: h } = args;
  await run(
    ffmpeg(),
    [
      ...QUIET,
      "-ss",
      args.start.toFixed(2),
      "-t",
      args.seconds.toFixed(2),
      ...SAFE_INPUT,
      "-i",
      args.input,
      ...(args.hasAudio
        ? []
        : ["-f", "lavfi", "-t", args.seconds.toFixed(2), "-i", "anullsrc=r=48000:cl=stereo"]),
      "-filter_complex",
      `[0:v]split[a][b];[a]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=20:2[bg];[b]scale=${w}:${h}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1,format=yuv420p[v]`,
      "-map",
      "[v]",
      "-map",
      args.hasAudio ? "0:a:0" : "1:a:0",
      ...H264,
      ...AAC,
      "-af",
      "apad",
      "-t",
      args.seconds.toFixed(2),
      "-movflags",
      "+faststart",
      args.output,
    ],
    options,
  );
}

/**
 * A still picture as a short clip with a slow push-in, and silence. The
 * picture should already be the post's shape at about twice its size, so the
 * zoom stays sharp.
 */
export async function stillClip(args: {
  image: string;
  output: string;
  width: number;
  height: number;
  seconds: number;
  zoom?: number;
}): Promise<void> {
  const frames = Math.round(args.seconds * 30);
  const zoom = args.zoom ?? RECAP_ZOOM;
  await run(
    ffmpeg(),
    [
      ...QUIET,
      ...SAFE_INPUT,
      "-i",
      args.image,
      "-f",
      "lavfi",
      "-t",
      args.seconds.toFixed(2),
      "-i",
      "anullsrc=r=48000:cl=stereo",
      "-filter_complex",
      `[0:v]zoompan=z='1+${(zoom - 1).toFixed(4)}*on/${frames}':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${args.width}x${args.height}:fps=30,setsar=1,format=yuv420p[v]`,
      "-map",
      "[v]",
      "-map",
      "1:a:0",
      ...H264,
      ...AAC,
      "-t",
      args.seconds.toFixed(2),
      "-movflags",
      "+faststart",
      args.output,
    ],
    options,
  );
}

/** Join clips made by fitClip/stillClip (same size, rate and audio). */
export async function joinClips(directory: string, clips: string[], output: string) {
  const { writeFile } = await import("node:fs/promises");
  const list = join(directory, "join.txt");
  await writeFile(list, clips.map((clip) => `file '${clip.replace(/'/g, "")}'`).join("\n"));
  await run(
    ffmpeg(),
    [
      ...QUIET,
      "-f",
      "concat",
      "-safe",
      "0",
      "-protocol_whitelist",
      "file,pipe",
      "-i",
      list,
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      output,
    ],
    options,
  );
}

/**
 * Join pieces with one short transition between each (FFmpeg xfade, and a
 * crossfade of the sound); the end card always dissolves in. `durations` are
 * the pieces' real lengths. Falls back to a straight join if it can't be made.
 */
export async function joinWithTransitions(args: {
  directory: string;
  clips: string[];
  durations: number[];
  transition: Transition;
  seconds: number;
  output: string;
}): Promise<void> {
  const { clips, seconds: t } = args;
  if (clips.length < 2 || t <= 0) return joinClips(args.directory, clips, args.output);
  const offsets = xfadeOffsets(args.durations, t);
  const filters: string[] = [];
  let v = "0:v";
  let a = "0:a";
  for (let i = 1; i < clips.length; i++) {
    const kind = i === clips.length - 1 ? "fade" : args.transition;
    filters.push(
      `[${v}][${i}:v]xfade=transition=${kind}:duration=${t}:offset=${offsets[i - 1]}[v${i}]`,
      `[${a}][${i}:a]acrossfade=d=${t}:c1=tri:c2=tri[a${i}]`,
    );
    v = `v${i}`;
    a = `a${i}`;
  }
  try {
    await run(
      ffmpeg(),
      [
        ...QUIET,
        ...clips.flatMap((clip) => [...SAFE_INPUT, "-i", clip]),
        "-filter_complex",
        `${filters.join(";")};[${v}]format=yuv420p[vout]`,
        "-map",
        "[vout]",
        "-map",
        `[${a}]`,
        ...H264,
        ...AAC,
        "-movflags",
        "+faststart",
        args.output,
      ],
      options,
    );
  } catch (error) {
    console.warn("[clip-edit] transitions skipped", error instanceof Error ? error.message : error);
    await joinClips(args.directory, clips, args.output);
  }
}

/**
 * Caption pictures as one timed track (FFmpeg's concat list of PNGs, a clear
 * picture in the gaps), so any number of cues is one overlay input. Every
 * picture is the same size: the caption band.
 */
export async function writeCaptionTrack(args: {
  directory: string;
  blank: string;
  cues: { start: number; end: number; image: string }[];
  duration: number;
}): Promise<string> {
  const { writeFile } = await import("node:fs/promises");
  const lines: string[] = [];
  const entry = (file: string, seconds: number) => {
    if (seconds < 0.01) return;
    lines.push(`file '${file.replace(/'/g, "")}'`, `duration ${seconds.toFixed(3)}`);
  };
  let at = 0;
  for (const cue of args.cues) {
    entry(args.blank, cue.start - at);
    entry(cue.image, cue.end - Math.max(cue.start, at));
    at = Math.max(at, cue.end);
  }
  entry(args.blank, args.duration - at);
  // The list's last picture is named again so its duration is kept.
  lines.push(`file '${args.blank.replace(/'/g, "")}'`);
  const list = join(args.directory, "captions.txt");
  await writeFile(list, lines.join("\n"));
  return list;
}

/**
 * The opening design laid over the start of the video, fading in and out,
 * captions in their band, and the real logo in a corner for the whole video.
 * With `loudness` the sound is brought to the level social apps play at.
 */
export async function brandVideo(args: {
  input: string;
  output: string;
  /** RGBA PNG at the video's size, or null for none. */
  overlay: string | null;
  /** RGBA PNG and where its top-left goes, or null for none. */
  logo: { path: string; x: number; y: number } | null;
  /** A caption track from writeCaptionTrack and the band's top, or null. */
  captions?: { list: string; y: number } | null;
  /** Bring the sound to TARGET_LUFS (off keeps it as recorded). */
  loudness?: boolean;
}): Promise<void> {
  const inputs = [...SAFE_INPUT, "-i", args.input];
  const filters: string[] = [];
  let last = "0:v";
  let next = 1;
  if (args.overlay) {
    inputs.push("-loop", "1", "-t", String(OVERLAY_SECONDS), "-i", args.overlay);
    const fadeOut = OVERLAY_SECONDS - OVERLAY_FADE_SECONDS;
    filters.push(
      `[${next}:v]format=rgba,fade=t=in:st=0:d=${OVERLAY_FADE_SECONDS}:alpha=1,fade=t=out:st=${fadeOut}:d=${OVERLAY_FADE_SECONDS}:alpha=1[ov]`,
      `[${last}][ov]overlay=0:0:enable='between(t,0,${OVERLAY_SECONDS})':eof_action=pass[v${next}]`,
    );
    last = `v${next}`;
    next += 1;
  }
  if (args.captions) {
    inputs.push(
      "-f",
      "concat",
      "-safe",
      "0",
      "-protocol_whitelist",
      "file,pipe",
      "-format_whitelist",
      "concat,image2,png_pipe",
      "-i",
      args.captions.list,
    );
    filters.push(
      `[${next}:v]format=rgba[cap]`,
      `[${last}][cap]overlay=0:${args.captions.y}:eof_action=pass[v${next}]`,
    );
    last = `v${next}`;
    next += 1;
  }
  if (args.logo) {
    inputs.push("-loop", "1", "-i", args.logo.path);
    filters.push(
      `[${next}:v]format=rgba[lg]`,
      `[${last}][lg]overlay=${args.logo.x}:${args.logo.y}:shortest=1[v${next}]`,
    );
    last = `v${next}`;
    next += 1;
  }
  await run(
    ffmpeg(),
    [
      ...QUIET,
      ...inputs,
      ...(filters.length
        ? ["-filter_complex", `${filters.join(";")};[${last}]format=yuv420p[out]`, "-map", "[out]"]
        : ["-map", "0:v:0"]),
      "-map",
      "0:a?",
      ...H264,
      ...(args.loudness ? [...AAC, "-af", LOUDNESS_FILTER] : ["-c:a", "copy"]),
      "-movflags",
      "+faststart",
      args.output,
    ],
    options,
  );
}
