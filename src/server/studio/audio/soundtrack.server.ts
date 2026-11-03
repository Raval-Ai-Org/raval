// A video's voiceover and music bed, made on KIE (ElevenLabs text-to-speech,
// Suno instrumental music) and mixed under the finished picture with FFmpeg.
// Pure rules (which voice, which words, the music style, the mix graph) are in
// src/lib/studio/audio/soundtrack.ts.
//
// Fails open everywhere: a voice or a track that can't be made, isn't ready in
// time or won't mix leaves the video with its own sound, never fails it.
//
// Use: start both as soon as the storyboard is settled (they run while the
// clips render), keep the returned task ids on the job, collect them when the
// picture is finished, meter once, then mix.
import "server-only";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createKieTask, getKieTask } from "@/lib/kie-gateway.server";
import {
  MUSIC_NEGATIVE_TAGS,
  mixPlan,
  musicStyle,
  pickVoice,
  voiceSpeed,
  voiceoverText,
  type MusicMood,
} from "@/lib/studio/audio/soundtrack";
import { recordUsage } from "@/server/ai/metering";
import { log } from "@/server/observability/logger";
import { kieUsdPerCredit } from "@/server/ugc/models.server";

const run = promisify(execFile);
const ffmpeg = () => process.env.FFMPEG_PATH || "ffmpeg";

/** KIE model ids, switchable without a deploy. */
const voiceModel = () =>
  process.env.KIE_VOICE_MODEL?.trim() || "elevenlabs/text-to-speech-turbo-2-5";
const musicModel = () => process.env.KIE_MUSIC_MODEL?.trim() || "ai-music-api/generate";
const musicVersion = () => process.env.KIE_MUSIC_VERSION?.trim() || "V6";

/** Off with VIDEO_SOUNDTRACK_ENABLED=false (the clips keep their own sound). */
export function isSoundtrackEnabled(): boolean {
  return (process.env.VIDEO_SOUNDTRACK_ENABLED ?? "").trim().toLowerCase() !== "false";
}

export type SoundtrackTasks = {
  voice?: { taskId: string; text: string; voiceId: string };
  music?: { taskId: string; mood: MusicMood };
};

/**
 * Start the voice and the music for one video. Each is optional and starts
 * on its own; a refused start is logged and left out.
 */
export async function startSoundtrack(args: {
  seconds: number;
  /** The storyboard's voiceover lines, in order; none means no voice. */
  voiceLines?: readonly string[];
  /** The brand's voice description, for the choice of voice. */
  brandVoice?: string;
  voiceGender?: "female" | "male";
  /** A music bed is wanted, and its feel. */
  music?: { mood: MusicMood; bpm?: number; look?: string; title?: string };
  /** Keeps the same brand on the same voice. */
  seed: string;
}): Promise<SoundtrackTasks> {
  if (!isSoundtrackEnabled()) return {};
  const tasks: SoundtrackTasks = {};
  const text = args.voiceLines?.length ? voiceoverText(args.voiceLines, args.seconds) : null;
  const starts: Promise<void>[] = [];
  if (text) {
    const voice = pickVoice({
      brandVoice: args.brandVoice,
      gender: args.voiceGender,
      seed: args.seed,
    });
    starts.push(
      createKieTask({
        model: voiceModel(),
        input: {
          text,
          voice: voice.id,
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.2,
          speed: voiceSpeed(text, args.seconds),
        },
      })
        .then(({ taskId }) => {
          tasks.voice = { taskId, text, voiceId: voice.id };
        })
        .catch((error) =>
          log.warn("studio.soundtrack.voice_start_failed", { error: String(error) }),
        ),
    );
  }
  if (args.music) {
    const { mood, bpm, look, title } = args.music;
    starts.push(
      createKieTask({
        model: musicModel(),
        input: {
          custom_mode: true,
          instrumental: true,
          model: musicVersion(),
          title: (title || "Mellox video bed").slice(0, 80),
          style: musicStyle(mood, { bpm, look }),
          negative_tags: MUSIC_NEGATIVE_TAGS,
          // A little longer than the video, so it is trimmed with its fade, never looped.
          duration: Math.min(360, Math.max(10, Math.ceil(args.seconds) + 4)),
        },
      })
        .then(({ taskId }) => {
          tasks.music = { taskId, mood };
        })
        .catch((error) =>
          log.warn("studio.soundtrack.music_start_failed", { error: String(error) }),
        ),
    );
  }
  await Promise.all(starts);
  return tasks;
}

export type SoundtrackResult = {
  voiceUrl?: string;
  musicUrl?: string;
  /** At least one part is still being made. */
  pending: boolean;
  /** What the finished parts cost, for metering once. */
  costs: { part: "voice" | "music"; usd: number; model: string }[];
};

const AUDIO_URL = /\.(mp3|wav|m4a|aac|ogg|flac)(?:\?|$)/i;

async function readPart(taskId: string) {
  try {
    const record = await getKieTask(taskId);
    if (record.state !== "success") return { state: record.state, url: undefined, credits: null };
    const url =
      record.urls.find((u) => AUDIO_URL.test(u)) ??
      record.urls.find((u) => !/\.(png|jpe?g|webp)(?:\?|$)/i.test(u));
    return {
      state: url ? ("success" as const) : ("failed" as const),
      url,
      credits: record.creditsConsumed,
    };
  } catch (error) {
    log.warn("studio.soundtrack.read_failed", { taskId, error: String(error) });
    return { state: "pending" as const, url: undefined, credits: null };
  }
}

/** One read of both parts. A failed part is simply absent. */
export async function collectSoundtrack(tasks: SoundtrackTasks): Promise<SoundtrackResult> {
  const [voice, music] = await Promise.all([
    tasks.voice ? readPart(tasks.voice.taskId) : null,
    tasks.music ? readPart(tasks.music.taskId) : null,
  ]);
  const costs: SoundtrackResult["costs"] = [];
  const usd = (credits: number | null) =>
    Math.round(Math.max(0, credits ?? 0) * kieUsdPerCredit() * 1_000_000) / 1_000_000;
  if (voice?.url) costs.push({ part: "voice", usd: usd(voice.credits), model: voiceModel() });
  if (music?.url) costs.push({ part: "music", usd: usd(music.credits), model: musicModel() });
  return {
    voiceUrl: voice?.url,
    musicUrl: music?.url,
    pending: voice?.state === "pending" || music?.state === "pending",
    costs,
  };
}

/** Record what a collected soundtrack cost. Call once, when the job keeps it. */
export function meterSoundtrack(
  result: SoundtrackResult,
  scope: { workspaceId: string; userId?: string | null },
): void {
  for (const cost of result.costs) {
    recordUsage({
      provider: "kie",
      model: cost.model,
      kind: "video",
      route: cost.part === "voice" ? "studio.video.voice" : "studio.video.music",
      units: 1,
      estCostUsd: cost.usd,
      workspaceId: scope.workspaceId,
      userId: scope.userId ?? null,
    });
  }
}

async function download(url: string): Promise<Buffer | null> {
  try {
    const { safeFetch } = await import("@/server/safe-fetch");
    const response = await safeFetch(url, {
      timeoutMs: 30_000,
      maxBytes: 25 * 1024 * 1024,
      onOverflow: "error",
    });
    return response.ok ? Buffer.from(response.bytes) : null;
  } catch (error) {
    log.warn("studio.soundtrack.download_failed", { error: String(error) });
    return null;
  }
}

const videoBytes = (dataUrl: string) =>
  Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");

async function hasAudio(path: string): Promise<boolean> {
  try {
    const out = await run(
      ffmpeg(),
      ["-hide_banner", "-nostdin", "-i", path, "-map", "0:a:0", "-t", "0.1", "-f", "null", "-"],
      { timeout: 60_000, windowsHide: true },
    );
    return !/matches no streams/i.test(`${out.stderr}`);
  } catch {
    return false;
  }
}

/**
 * Lay the voice and music under a finished video (a data URL, as the Studio
 * finishing steps pass it). The picture is copied untouched. Returns the
 * original when there is nothing to add or the mix fails.
 */
export async function mixSoundtrack(
  dataUrl: string,
  sound: { voiceUrl?: string; musicUrl?: string },
  opts: { seconds: number; keepClipAudio?: boolean },
): Promise<string> {
  if (!sound.voiceUrl && !sound.musicUrl) return dataUrl;
  const dir = await mkdtemp(join(tmpdir(), "mellox-soundtrack-"));
  try {
    const video = join(dir, "in.mp4");
    await writeFile(video, videoBytes(dataUrl));
    const files: Partial<Record<"voice" | "music", string>> = {};
    for (const part of ["voice", "music"] as const) {
      const url = part === "voice" ? sound.voiceUrl : sound.musicUrl;
      if (!url) continue;
      const bytes = await download(url);
      if (!bytes) continue;
      files[part] = join(dir, `${part}.audio`);
      await writeFile(files[part]!, bytes);
    }
    const plan = mixPlan({
      seconds: opts.seconds,
      voice: Boolean(files.voice),
      music: Boolean(files.music),
      videoAudio: await hasAudio(video),
      keepClipAudio: opts.keepClipAudio ?? true,
    });
    if (!plan) return dataUrl;
    const output = join(dir, "out.mp4");
    await run(
      ffmpeg(),
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-y",
        "-threads",
        "2",
        "-protocol_whitelist",
        "file,pipe",
        "-i",
        video,
        ...plan.inputs.flatMap((part) => ["-i", files[part]!]),
        "-filter_complex",
        plan.filter,
        "-map",
        "0:v:0",
        "-map",
        "[aout]",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-ar",
        "48000",
        "-ac",
        "2",
        "-movflags",
        "+faststart",
        output,
      ],
      { timeout: 180_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
    );
    return `data:video/mp4;base64,${(await readFile(output)).toString("base64")}`;
  } catch (error) {
    log.warn("studio.soundtrack.mix_failed", { error: String(error).slice(0, 300) });
    return dataUrl;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
