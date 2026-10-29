// Live check of captions for "Brand my clips": a short spoken clip is heard
// through the real OpenRouter route (`studio.transcribe`, audio input), and
// the transcript is turned into cues the way the renderer does it. Opt-in
// (real spend, well under a cent):
//   CAPTIONS_LIVE_AI=yes FFMPEG_PATH=... npx vitest run --config vitest.live.config.ts tests/live/clip-captions.live.ts
// The speech is CAPTIONS_LIVE_SAMPLE (any video or audio with speech), or on
// Windows a sentence spoken by the system voice. Usage is metered as usual.
import { execFile, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UsageRecord } from "@/server/ai/metering";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env — the suite skips below.
}

const run = promisify(execFile);
const encoder = process.env.FFMPEG_PATH || "ffmpeg";
const hasFfmpeg = spawnSync(encoder, ["-version"], { windowsHide: true }).status === 0;
const canSpeak = !!process.env.CAPTIONS_LIVE_SAMPLE || process.platform === "win32";
const describeLive =
  process.env.CAPTIONS_LIVE_AI === "yes" && process.env.OPENROUTER_API_KEY && hasFfmpeg && canSpeak
    ? describe
    : describe.skip;

const SENTENCE =
  "Our new bakery opens on Saturday. Fresh bread comes out of the oven at six every morning.";

describeLive("Captions from a clip's speech (live)", () => {
  let dir = "";
  const rows: UsageRecord[] = [];
  let restoreSink: (() => void) | null = null;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "mellox-captions-live-"));
    const { setUsageSink } = await import("@/server/ai/metering");
    restoreSink = setUsageSink(async (row) => {
      rows.push(row);
    });
  });
  afterAll(async () => {
    restoreSink?.();
    await rm(dir, { recursive: true, force: true });
  });

  it("hears what is said and times it into readable cues", async () => {
    let speech = process.env.CAPTIONS_LIVE_SAMPLE ?? "";
    if (!speech) {
      speech = join(dir, "speech.wav");
      const script = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SetOutputToWaveFile('${speech}'); $s.Speak('${SENTENCE}'); $s.Dispose()`;
      await run("powershell", ["-NoProfile", "-Command", script]);
    }
    const video = join(dir, "clip.mp4");
    await run(encoder, [
      ...["-hide_banner", "-loglevel", "error", "-y"],
      ...["-f", "lavfi", "-i", "color=gray:s=360x640:r=30"],
      ...["-i", speech, "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac"],
      video,
    ]);
    const { probeVideo, audioSilences } = await import("@/server/studio/clip-edit/ffmpeg.server");
    const { transcribeVideo } = await import("@/server/studio/clip-edit/transcribe.server");
    const { believableSegments, buildCues, speechShare } = await import("@/lib/studio/captions");
    const probe = await probeVideo(video);
    const silences = await audioSilences(video, probe.duration);
    expect(speechShare(probe.duration, silences)).toBeGreaterThan(0.3);

    const transcript = await transcribeVideo({ video, dir, duration: probe.duration });
    console.info("[live] transcript", JSON.stringify(transcript));
    expect(transcript?.segments.length).toBeGreaterThan(0);
    const text = transcript!.segments
      .map((s) => s.text)
      .join(" ")
      .toLowerCase();
    if (!process.env.CAPTIONS_LIVE_SAMPLE) {
      for (const word of ["bakery", "saturday", "bread", "morning"]) expect(text).toContain(word);
    }
    const cues = buildCues(
      believableSegments(transcript!.segments, probe.duration, silences),
      "9:16",
      probe.duration,
    );
    console.info("[live] cues", JSON.stringify(cues));
    expect(cues.length).toBeGreaterThan(2);
    expect(cues.at(-1)!.end).toBeLessThanOrEqual(probe.duration);
    if (transcript!.engine === "model") {
      const calls = rows.filter((row) => row.route === "studio.transcribe");
      console.info("[live] transcribe calls", JSON.stringify(calls));
      expect(calls.length).toBe(1);
    }

    // Asking again for the same sound is answered from the cache, unbilled.
    const again = await transcribeVideo({ video, dir, duration: probe.duration });
    expect(again).toEqual(transcript);
    expect(rows.filter((row) => row.route === "studio.transcribe").length).toBeLessThanOrEqual(1);
  }, 180_000);
});
