import { describe, expect, it } from "vitest";
import {
  DEFAULT_VIDEO_DURATION,
  VIDEO_DURATION_OPTIONS,
  outputDurations,
  planVideoSegments,
  segmentVideoPrompt,
  studioVideoUnits,
} from "./duration";
import { durationsFor, specFor, UGC_MODELS, UGC_MODEL_KEYS, checkRenderSettings } from "./models";
import { estimateRender } from "@/server/ugc/models.server";
import { BriefSchema, StartRenderBody } from "./schemas";
import { CreateJobSchema } from "@/lib/studio/jobs";

describe("video output duration", () => {
  it("defaults to ten seconds and offers up to one minute", () => {
    expect(DEFAULT_VIDEO_DURATION).toBe(10);
    expect(VIDEO_DURATION_OPTIONS).toEqual([10, 15, 20, 30, 40, 60]);
    const parsed = StartRenderBody.parse({
      workspaceId: "00000000-0000-4000-8000-000000000001",
      projectId: "00000000-0000-4000-8000-000000000002",
      idempotencyKey: "duration-test",
      aspectRatio: "9:16",
      resolution: "720p",
    });
    expect(parsed.durationSec).toBe(10);
    expect(BriefSchema.parse({ durationSec: 60 }).durationSec).toBe(60);
    expect(BriefSchema.safeParse({ durationSec: 61 }).success).toBe(false);
    const job = {
      workspaceId: parsed.workspaceId,
      idempotencyKey: "duration-test",
      type: "video",
      intent: { brief: "A product demo" },
      controls: { durationSec: 61 },
    };
    expect(CreateJobSchema.safeParse(job).success).toBe(false);
    expect(CreateJobSchema.safeParse({ ...job, type: "script" }).success).toBe(true);
  });

  it("plans every offered length using real provider limits, including photo restrictions", () => {
    for (const key of UGC_MODEL_KEYS)
      for (const provider of ["kie", "openrouter"] as const)
        for (const photos of [false, true]) {
          const model = specFor(UGC_MODELS[key], provider)!;
          const native = durationsFor(model, photos);
          for (const seconds of VIDEO_DURATION_OPTIONS) {
            const clips = planVideoSegments(seconds, native);
            expect(clips.reduce((sum, clip) => sum + clip.seconds, 0)).toBe(seconds);
            expect(
              clips.every(
                (clip) => native.includes(clip.renderSeconds) && clip.renderSeconds >= clip.seconds,
              ),
            ).toBe(true);
            expect(outputDurations(native)).toContain(seconds);
            expect(
              checkRenderSettings(model, {
                model: key,
                durationSec: seconds,
                aspectRatio: model.aspectRatios[0],
                resolution: model.defaultResolution,
                imageCount: photos ? 1 : 0,
              }),
            ).toEqual([]);
          }
        }
    expect(
      planVideoSegments(40, UGC_MODELS.long.durations).map((clip) => clip.renderSeconds),
    ).toEqual([14, 13, 13]);
    expect(() => planVideoSegments(61, [8])).toThrow();
  });

  it("charges for every generated clip, including padding required by photo modes", () => {
    const short = estimateRender(UGC_MODELS.standard, "720p", 8, 1);
    const longer = estimateRender(UGC_MODELS.standard, "720p", 10, 1);
    expect(longer.usd).toBe(short.usd * 2);
    expect(longer.units).toBe(short.units * 2);
    expect(estimateRender(UGC_MODELS.long, "720p", 60).usd).toBeCloseTo(
      estimateRender(UGC_MODELS.long, "720p", 15).usd * 4,
    );
    expect(studioVideoUnits(10)).toBe(200);
    expect(studioVideoUnits(40)).toBe(800);
    expect(studioVideoUnits(60)).toBe(1200);
  });

  it("splits dialogue at clip boundaries without repeating or dropping words", () => {
    const prompt =
      'CREATOR: same person\nBEAT SHEET:\n[0–10s] HOOK: The creator says: "one two three four five six seven eight nine ten"\n[10–20s] CALL TO ACTION: The creator says: "Try it today"';
    const clips = planVideoSegments(20, [10]);
    const first = segmentVideoPrompt(prompt, clips[0], 20);
    const last = segmentVideoPrompt(prompt, clips[1], 20);
    expect(first).toContain('"one two three four five six seven eight nine ten"');
    expect(first).not.toContain('"Try it today"');
    expect(last).toContain("[0–10s] CALL TO ACTION:");
    expect(last).not.toContain('"one two');
    const crossing =
      '[0–20s] BEAT: The creator says: "one two three four five six seven eight nine ten"';
    expect(segmentVideoPrompt(crossing, clips[0], 20)).toContain('"one two three four five"');
    expect(segmentVideoPrompt(crossing, clips[1], 20)).toContain('"six seven eight nine ten"');
  });
});
