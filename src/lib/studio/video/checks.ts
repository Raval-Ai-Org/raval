// Checks a finished Studio video before anyone sees it. Pure and
// browser-safe: the server measures the file (FFmpeg) and asks a vision model
// to score sampled frames; this module alone decides what passes, which clips
// are made again, and when a video is not delivered at all.
//
// The rule: a bad clip is never shown as finished. One round of re-making is
// on Mellox; a video that still fails ends plainly and costs the person nothing.

import { z } from "zod";
import { videoKind, type VideoKindId } from "./kinds";
import type { ClipPlan } from "./lengths";

/** Rounds of re-making a video may get. */
export const VIDEO_REDO_ROUNDS = 1;
/** A score (0-10) below this fails the clip. */
export const PASS_SCORE = 6;
/** A black or frozen stretch longer than this (seconds) fails the clip it is in. */
export const MAX_DEAD_SECONDS = 0.8;
/** The made video may differ from the plan by this much (seconds). */
export const DURATION_TOLERANCE = 0.4;

export type ClipFailure = { clip: number; reason: string };

/** What the server measured on the finished file. */
export type VideoProbe = {
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
  black: { start: number; end: number }[];
  frozen: { start: number; end: number }[];
};

function clipAt(plan: ClipPlan, time: number): number {
  const index = plan.findIndex((clip) => time < clip.start + clip.seconds);
  return index === -1 ? plan.length - 1 : index;
}

/** Problems with the file itself: length, dead footage, missing sound, size. */
export function technicalIssues(
  probe: VideoProbe,
  plan: ClipPlan,
  opts: { audio: boolean; minShortSide?: number; dissolveSeconds?: number },
): ClipFailure[] {
  const out: ClipFailure[] = [];
  // Dissolved clips overlap, so the joined video is that much shorter.
  const expected =
    plan.reduce((sum, clip) => sum + clip.seconds, 0) -
    (opts.dissolveSeconds ?? 0) * Math.max(0, plan.length - 1);
  if (probe.duration + DURATION_TOLERANCE < expected)
    out.push({
      clip: clipAt(plan, Math.max(0, probe.duration - 0.1)),
      reason: `The video is ${probe.duration.toFixed(1)} s instead of ${expected} s; the end is missing.`,
    });
  for (const [list, word] of [
    [probe.black, "black"],
    [probe.frozen, "frozen"],
  ] as const)
    for (const span of list)
      if (span.end - span.start > MAX_DEAD_SECONDS && span.start < expected - 1.2)
        out.push({
          clip: clipAt(plan, span.start),
          reason: `The picture is ${word} from ${span.start.toFixed(1)} s to ${span.end.toFixed(1)} s.`,
        });
  if (opts.audio && !probe.hasAudio)
    out.push({ clip: plan.length - 1, reason: "The video has no sound." });
  if (opts.minShortSide && Math.min(probe.width, probe.height) + 8 < opts.minShortSide)
    out.push({ clip: 0, reason: "The video is smaller than the quality chosen." });
  return out;
}

/** The frame times the judge sees: the start, middle and end of every clip, and both sides of each join. */
export function qaFrameTimes(plan: ClipPlan): { time: number; clip: number; label: string }[] {
  const out: { time: number; clip: number; label: string }[] = [];
  plan.forEach((clip, i) => {
    const end = clip.start + clip.seconds;
    out.push({ time: clip.start + (i === 0 ? 0.1 : 0.15), clip: i, label: `clip ${i + 1} start` });
    out.push({ time: clip.start + clip.seconds / 2, clip: i, label: `clip ${i + 1} middle` });
    out.push({ time: end - 0.15, clip: i, label: `clip ${i + 1} end` });
  });
  return out;
}

const score = z.coerce.number().min(0).max(10).catch(5);

/** What the judge returns; it only scores, code decides. */
export const VideoJudgeSchema = z.object({
  clips: z
    .array(
      z.object({
        clip: z.coerce.number().int(),
        sameSubject: score,
        clean: score,
        followsPlan: score,
        problem: z.string().max(240).catch(""),
      }),
    )
    .max(8),
  ending: score,
  sourceFaithful: score.optional(),
  summary: z.string().max(300).catch(""),
});

export type VideoJudge = z.infer<typeof VideoJudgeSchema>;

/** Which clips the judge's scores fail, with the reason in plain words. */
export function visualFailures(
  judge: VideoJudge,
  kind: VideoKindId,
  plan: ClipPlan,
): ClipFailure[] {
  const out: ClipFailure[] = [];
  for (const row of judge.clips) {
    const clip = row.clip - 1;
    if (clip < 0 || clip >= plan.length) continue;
    const problem = row.problem ? ` ${row.problem}` : "";
    if (row.sameSubject < PASS_SCORE)
      out.push({ clip, reason: `The person, product or place changes in this clip.${problem}` });
    else if (row.clean < PASS_SCORE)
      out.push({ clip, reason: `Something looks wrong (warped, melting or garbled).${problem}` });
    else if (row.followsPlan < PASS_SCORE - 2)
      out.push({ clip, reason: `The clip doesn't show what was planned.${problem}` });
  }
  if (judge.ending < PASS_SCORE && videoKind(kind).ending !== "back-to-source")
    out.push({
      clip: plan.length - 1,
      reason: "The video doesn't end cleanly; it stops mid-action.",
    });
  if (kind === "living-picture" && (judge.sourceFaithful ?? 10) < PASS_SCORE)
    out.push({ clip: 0, reason: "The post's picture, words or product changed." });
  return out;
}

export type RedoPlan = { clips: number[]; notes: Record<number, string> } | null;

/**
 * What to make again. Chained clips depend on the one before, so a redo
 * starts at the first failing clip and remakes every clip after it. Null
 * when the video passes, or when its redo round is used up.
 */
export function redoPlan(
  failures: readonly ClipFailure[],
  clipCount: number,
  opts: { chained: boolean; redone: number },
): RedoPlan {
  if (!failures.length || opts.redone >= VIDEO_REDO_ROUNDS) return null;
  const notes: Record<number, string> = {};
  for (const failure of failures)
    notes[failure.clip] = notes[failure.clip]
      ? `${notes[failure.clip]} ${failure.reason}`
      : failure.reason;
  const failing = [...new Set(failures.map((failure) => failure.clip))].sort((a, b) => a - b);
  const clips = opts.chained
    ? Array.from({ length: clipCount - failing[0] }, (_, i) => failing[0] + i)
    : failing;
  return { clips, notes };
}

/** The line the review shows when a video passed its checks. */
export function passedNote(kind: VideoKindId, clipCount: number): string {
  if (kind === "living-picture")
    return "Checked: the post stays as it is and the video ends on it.";
  return clipCount > 1
    ? "Checked: the same subject in every clip, and a clean ending."
    : "Checked: clean picture and a clean ending.";
}

/** What a person sees when a video could not be made right. */
export const NOT_DELIVERED_MESSAGE =
  "We couldn't make this video look right, so we didn't keep it and you weren't charged. Try another kind of video, or Premium.";
