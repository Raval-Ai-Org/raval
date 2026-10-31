// Checks a finished Studio AI video before anyone sees it. The file is
// measured by FFmpeg and its sampled frames are scored by a vision model
// (route `studio.video.qa`); src/lib/studio/video/checks.ts alone decides
// what fails. The model only scores what it sees.
import "server-only";
import { runStructuredPrompt } from "@/lib/ai";
import {
  qaFrameTimes,
  technicalIssues,
  visualFailures,
  VideoJudgeSchema,
  type ClipFailure,
  type VideoProbe,
} from "@/lib/studio/video/checks";
import { videoKind, type VideoKindId } from "@/lib/studio/video/kinds";
import type { ClipPlan } from "@/lib/studio/video/lengths";
import type { VideoStoryboard } from "@/lib/studio/video/storyboard";
import { DISSOLVE_SECONDS } from "@/server/ugc/providers/assemble.server";
import { probeVideo, sampleFrames } from "./finish.server";

export type VideoCheckResult = {
  failures: ClipFailure[];
  /** The frames the checker saw, kept for staff. */
  frames: { time: number; bytes: Buffer }[];
  probe: VideoProbe;
  /** The visual check could not run; only the file itself was checked. */
  visualUnavailable?: boolean;
};

const JUDGE_SYSTEM = [
  "You check short AI-made marketing videos before they are published. You are strict: a viewer notices any change in a face, a product or a place between shots, and any warped, melting or garbled detail.",
  "You see frames in order, each labelled with its clip and position, plus the storyboard the video was made from. When a reference picture comes first, it is the brand's post (or product photo) the video must stay true to.",
  "Score every clip from 0 to 10:",
  "- sameSubject: the people, product and place look the same as in the clip before and as the storyboard's bible describes (10 = identical; below 6 = a viewer would notice a different face, outfit, product shape, label or room).",
  "- clean: no warped hands or faces, extra fingers, melting objects, garbled or misspelled letters, drifting logos, or objects appearing from nowhere (10 = flawless).",
  "- followsPlan: the clip shows what its part of the storyboard describes.",
  "Also score `ending` (the last frame is a calm, finished moment, not mid-action or mid-blur) and, only when a reference picture is given, `sourceFaithful` (the first frame and the product, colours and words match the reference).",
  "In `problem`, name what is wrong in at most 20 plain words, or leave it empty. Never praise; only report.",
  'Return JSON: {"clips": [{"clip": number, "sameSubject": number, "clean": number, "followsPlan": number, "problem": string}], "ending": number, "sourceFaithful"?: number, "summary": string}',
].join("\n");

const jpeg = (bytes: Buffer) => ({
  mediaType: "image/jpeg" as const,
  data: bytes.toString("base64"),
});

export async function checkStudioVideo(args: {
  dataUrl: string;
  kind: VideoKindId;
  plan: ClipPlan;
  storyboard: VideoStoryboard;
  audio: boolean;
  /** The post's picture or the product photo the video must stay true to. */
  reference?: Buffer | null;
}): Promise<VideoCheckResult> {
  const kind = videoKind(args.kind);
  const dissolve = kind.join === "cut" ? DISSOLVE_SECONDS : 0;
  const probe = await probeVideo(args.dataUrl);
  const failures = technicalIssues(probe, args.plan, {
    audio: args.audio,
    dissolveSeconds: dissolve,
  });
  // Frame times on the joined timeline (dissolves pull later clips earlier).
  const times = qaFrameTimes(args.plan).map((frame) => ({
    ...frame,
    time: Math.min(Math.max(0, probe.duration - 0.1), frame.time - dissolve * frame.clip),
  }));
  const bytes = await sampleFrames(
    args.dataUrl,
    times.map((frame) => frame.time),
  );
  const frames = times.map((frame, i) => ({ time: frame.time, bytes: bytes[i] }));
  const storyboard = args.storyboard.clips
    .map((clip, i) =>
      [
        `Clip ${i + 1}: opens on ${clip.opensOn || "(start)"}; ${clip.shots.map((shot) => shot.action).join("; ")}; ends on ${clip.endsOn}.`,
      ].join(" "),
    )
    .join("\n");
  const bible = [
    ...args.storyboard.bible.cast.map((member) => `${member.id}: ${member.look}`),
    args.storyboard.bible.product && `Product: ${args.storyboard.bible.product}`,
    args.storyboard.bible.setting && `Setting: ${args.storyboard.bible.setting}`,
    args.storyboard.bible.lighting && `Light: ${args.storyboard.bible.lighting}`,
  ]
    .filter(Boolean)
    .join("\n");
  try {
    const judge = await runStructuredPrompt({
      route: "studio.video.qa",
      system: JUDGE_SYSTEM,
      user: [
        `Kind of video: ${kind.label}. ${args.plan.length} clip(s).`,
        `Story: ${args.storyboard.logline}`,
        bible ? `Bible (must stay the same):\n${bible}` : "",
        `Storyboard:\n${storyboard}`,
        args.reference
          ? "Image 1 is the reference picture. The frames follow in order:"
          : "The frames, in order:",
        times
          .map(
            (frame, i) =>
              `${i + 1 + (args.reference ? 1 : 0)}. ${frame.label} (${frame.time.toFixed(1)} s)`,
          )
          .join("\n"),
      ]
        .filter(Boolean)
        .join("\n\n"),
      schema: VideoJudgeSchema,
      maxTokens: 1200,
      temperature: 0,
      images: [...(args.reference ? [jpeg(args.reference)] : []), ...bytes.map(jpeg)],
    });
    failures.push(...visualFailures(judge, args.kind, args.plan));
    return { failures, frames, probe };
  } catch (error) {
    // The file itself was still checked; a checker outage never loses a video.
    console.warn(
      "[studio] video check unavailable",
      error instanceof Error ? error.message : error,
    );
    return { failures, frames, probe, visualUnavailable: true };
  }
}
