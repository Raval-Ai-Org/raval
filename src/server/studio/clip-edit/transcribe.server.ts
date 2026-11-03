// What is said in a branded video, for its captions. Two engines:
//
// - whisper.cpp on this machine, when WHISPER_CPP_PATH (the whisper-cli
//   binary) and WHISPER_MODEL_PATH (a ggml model) are set: no model call, no
//   cost;
// - otherwise the OpenRouter gateway (route `studio.transcribe`), which hears
//   one small mono MP3 of the finished video's sound.
//
// The transcript is keyed by the sound's hash, so a render started again
// never pays twice. Every failure returns null: the video is still made,
// without captions, and says so.
import "server-only";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { llmJson } from "@/lib/ai-gateway.server";
import type { Segment } from "@/lib/studio/captions";
import { cache } from "@/server/cache/store";
import { extractAudio } from "./ffmpeg.server";

const run = promisify(execFile);
const TTL = 7 * 24 * 60 * 60;

export type Transcript = { segments: Segment[]; engine: "whisper.cpp" | "model" };

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["speech", "segments"],
  properties: {
    speech: { type: "boolean" },
    segments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["start", "end", "text"],
        properties: {
          start: { type: "number" },
          end: { type: "number" },
          text: { type: "string" },
        },
      },
    },
  },
} as const;

const SYSTEM = [
  "You transcribe the speech in a short social video for its on-screen captions.",
  "Write exactly the words that are spoken, in the language they are spoken in. Never translate, summarise, correct grammar or add words that were not said.",
  "Leave out music, lyrics of background songs, sound effects and filler noises.",
  "Split the speech into phrases of at most twelve words. Give each phrase its start and end in seconds from the start of the audio, as precisely as you can hear them.",
  'If nobody speaks, answer {"speech": false, "segments": []}.',
].join("\n");

function whisperConfig(): { bin: string; model: string } | null {
  const bin = process.env.WHISPER_CPP_PATH?.trim();
  const model = process.env.WHISPER_MODEL_PATH?.trim();
  return bin && model ? { bin, model } : null;
}

type WhisperJson = {
  transcription?: { offsets?: { from?: number; to?: number }; text?: string }[];
};

/** whisper-cli's JSON (offsets in milliseconds) as segments. */
export function whisperSegments(raw: WhisperJson): Segment[] {
  return (raw.transcription ?? [])
    .map((t) => ({
      start: Number(t.offsets?.from) / 1000,
      end: Number(t.offsets?.to) / 1000,
      text: String(t.text ?? "").trim(),
    }))
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.text);
}

async function withWhisper(
  config: { bin: string; model: string },
  video: string,
  dir: string,
): Promise<Segment[]> {
  const wav = join(dir, "speech.wav");
  await extractAudio(video, wav, "wav");
  const out = join(dir, "speech");
  await run(
    config.bin,
    ["-m", config.model, "-f", wav, "-l", "auto", "-oj", "-of", out, "-np", "-t", "2"],
    { timeout: 240_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
  );
  return whisperSegments(JSON.parse(await readFile(`${out}.json`, "utf8")) as WhisperJson);
}

async function withModel(audio: Buffer, duration: number): Promise<Segment[]> {
  const answer = await llmJson<{ speech: boolean; segments: Segment[] }>({
    route: "studio.transcribe",
    system: SYSTEM,
    user: `The audio is ${duration.toFixed(1)} seconds long. Transcribe it.`,
    audio: [{ format: "mp3", data: audio.toString("base64") }],
    outputSchema: SCHEMA as unknown as Record<string, unknown>,
    fallback: { speech: false, segments: [] },
    timeoutMs: 90_000,
  });
  return answer.speech && Array.isArray(answer.segments) ? answer.segments : [];
}

/** The speech in `video` (its first audio track), or null when it can't be heard. */
export async function transcribeVideo(args: {
  video: string;
  dir: string;
  duration: number;
}): Promise<Transcript | null> {
  try {
    const audio = await extractAudio(args.video, join(args.dir, "speech.mp3"), "mp3");
    const whisper = whisperConfig();
    const engine: Transcript["engine"] = whisper ? "whisper.cpp" : "model";
    const key = `studio:transcript:${engine}:${createHash("sha256").update(audio).digest("hex")}`;
    const hit = await cache.get<Transcript>(key);
    if (hit) return hit;
    const segments = whisper
      ? await withWhisper(whisper, args.video, args.dir)
      : await withModel(audio, args.duration);
    const transcript: Transcript = { segments, engine };
    await cache.set(key, transcript, TTL);
    return transcript;
  } catch (error) {
    console.warn("[clip-edit] captions skipped", error instanceof Error ? error.message : error);
    return null;
  }
}
