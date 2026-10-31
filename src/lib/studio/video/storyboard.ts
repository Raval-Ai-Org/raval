// A Studio video's storyboard: one record of who and what is on screen (the
// bible), then the clips in order, each with its shots, the frame it opens
// on and the frame it ends on. Pure and browser-safe.
//
// The model writes the storyboard; code decides whether it is usable
// (`storyboardIssues`), fits it to the clips the model will really make
// (`fitStoryboard`), and turns each clip into the exact render prompt
// (`clipPrompt`). Every clip carries the whole bible, so the person, product
// and place stay the same from the first clip to the last.

import { z } from "zod";
import { videoKind, type VideoKindId } from "./kinds";
import type { ClipPlan } from "./lengths";

const text = (max: number) =>
  z
    .string()
    .default("")
    .transform((value) => value.replace(/\s+/g, " ").trim().slice(0, max));

const ShotSchema = z.object({
  start: z.coerce.number().default(0),
  end: z.coerce.number().default(0),
  camera: text(160),
  action: text(400),
  cast: z.array(z.string().max(24)).max(4).default([]),
});

const ClipSchema = z.object({
  opensOn: text(300),
  shots: z.array(ShotSchema).min(1).max(6),
  endsOn: text(300),
  sound: text(200),
  onScreen: text(60),
});

/** What the storyboard call returns (validated, then fitted and checked by code). */
export const StoryboardSchema = z.object({
  logline: text(240),
  bible: z.object({
    cast: z
      .array(z.object({ id: z.string().max(24), look: text(300) }))
      .max(3)
      .default([]),
    product: text(300),
    setting: text(300),
    lighting: text(200),
    palette: text(160),
    camera: text(200),
  }),
  clips: z.array(ClipSchema).min(1).max(4),
  /** Offer: the exact words for the code-drawn end card. */
  endCard: z.object({ headline: text(60), detail: text(80) }).optional(),
});

export type VideoStoryboard = z.infer<typeof StoryboardSchema>;
export type StoryboardShot = VideoStoryboard["clips"][number]["shots"][number];

/** What a video job keeps about its plan (job output `videoPlan`). */
export type VideoPlanOutput = {
  kind: VideoKindId;
  model: string;
  clipSeconds: number[];
  storyboard: VideoStoryboard;
  /** The checks after rendering, once they ran. */
  check?: { passed: boolean; redone: number; notes: string[] };
};

const round = (n: number) => Math.round(n * 10) / 10;

/**
 * Fit the model's shots into the clips that will be made: every shot sits
 * inside its own clip, in order, edge to edge, with the clip's last shot
 * running to its end. A storyboard with the wrong number of clips is not
 * fitted (that is an issue for the model to repair).
 */
export function fitStoryboard(sb: VideoStoryboard, plan: ClipPlan): VideoStoryboard {
  if (sb.clips.length !== plan.length) return sb;
  return {
    ...sb,
    clips: sb.clips.map((clip, i) => {
      const seconds = plan[i].seconds;
      const shots = [...clip.shots].sort((a, b) => a.start - b.start);
      // Times may be written for the whole video or for this clip; either
      // way they are scaled to this clip. Missing times share it evenly.
      const base = Math.max(0, Math.min(...shots.map((shot) => shot.start)));
      const declared = Math.max(...shots.map((shot) => shot.end), 0) - base;
      const scale = declared > 0 ? seconds / declared : 0;
      let at = 0;
      const fitted = shots.map((shot, s) => {
        const wanted = scale
          ? round((shot.end - base) * scale)
          : round(((s + 1) * seconds) / shots.length);
        const end =
          s === shots.length - 1 ? seconds : Math.min(seconds, Math.max(at + 0.8, wanted));
        const out = { ...shot, start: round(at), end: round(end) };
        at = end;
        return out;
      });
      return { ...clip, shots: fitted.filter((shot) => shot.end > shot.start) };
    }),
  };
}

export type StoryboardCheckContext = {
  kind: VideoKindId;
  plan: ClipPlan;
  /** Everything the brand has said (brief, Brand DNA, product facts): numbers must come from here. */
  knownFacts: string;
  /** Competitor names that must never appear. */
  competitors?: readonly string[];
  /** The video starts from a finished post picture. */
  fromPicture?: boolean;
};

const words = (value: string) => value.split(/\s+/).filter(Boolean).length;
const normal = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Numbers in a line that the brand never gave. */
function unknownNumbers(line: string, known: string): string[] {
  const facts = normal(known);
  return (line.match(/\d+(?:[.,]\d+)?/g) ?? []).filter((n) => !facts.includes(n));
}

/**
 * Why a storyboard can't be made yet, in words the model can fix. Empty when
 * it is ready. Code decides; the model only writes.
 */
export function storyboardIssues(sb: VideoStoryboard, ctx: StoryboardCheckContext): string[] {
  const kind = videoKind(ctx.kind);
  const issues: string[] = [];
  if (sb.clips.length !== ctx.plan.length)
    issues.push(
      `Write exactly ${ctx.plan.length} clip(s) of ${ctx.plan.map((c) => c.seconds).join(" + ")} seconds; you wrote ${sb.clips.length}.`,
    );
  if (!sb.logline) issues.push("Give the video a one-line story (logline).");
  if (!sb.bible.setting) issues.push("Describe the one setting every clip happens in.");
  if (!sb.bible.lighting) issues.push("Describe the light that stays the same in every clip.");
  const castIds = new Set(sb.bible.cast.map((member) => member.id));
  if (kind.people === "cast" && !ctx.fromPicture && castIds.size === 0)
    issues.push(
      "A short story needs its cast in the bible: who they are and exactly how they look.",
    );
  if ((kind.people === "none" || kind.people === "hands") && castIds.size > 0)
    issues.push(
      `A ${kind.label.toLowerCase()} shows no faces: remove the cast and use hands only.`,
    );
  for (const member of sb.bible.cast)
    if (words(member.look) < 6)
      issues.push(
        `Describe ${member.id}'s look fully (face, hair, age, clothes) so it can be kept.`,
      );

  const hookFirst = kind.id !== "living-picture" && kind.id !== "mood-broll";
  const firstShot = sb.clips[0]?.shots[0];
  // The hook starts on frame one (fitStoryboard starts every clip at 0); a
  // long first shot is a slow open, not a hook.
  if (hookFirst && firstShot && firstShot.end - firstShot.start > 4)
    issues.push(
      "The first shot is the hook: keep it to 4 seconds or less, with the action from frame one.",
    );
  const opening = firstShot ? normal(firstShot.action).slice(0, 48) : "";

  sb.clips.forEach((clip, i) => {
    const n = i + 1;
    if (words(clip.endsOn) < 3) issues.push(`Clip ${n} needs the exact frame it ends on.`);
    if (i > 0 && words(clip.opensOn) < 3)
      issues.push(`Clip ${n} must open on the frame clip ${i} ended on.`);
    if (i > 0 && opening && normal(clip.shots[0]?.action ?? "").startsWith(opening))
      issues.push(`Clip ${n} repeats the opening; continue the story instead.`);
    for (const shot of clip.shots) {
      if (!shot.action) issues.push(`Every shot in clip ${n} needs an action.`);
      for (const id of shot.cast)
        if (!castIds.has(id)) issues.push(`Clip ${n} uses "${id}", who is not in the cast.`);
    }
    if (clip.onScreen) {
      if (kind.id === "offer-teaser")
        issues.push("An offer video keeps words off the footage; put them on the end card.");
      else if (words(clip.onScreen) > 6)
        issues.push(`Clip ${n}'s on-screen words must be 6 words or fewer.`);
      for (const number of unknownNumbers(clip.onScreen, ctx.knownFacts))
        issues.push(`Clip ${n} shows "${number}", which the brand never said.`);
    }
  });

  if (kind.ending === "end-card") {
    if (!sb.endCard?.headline) issues.push("An offer video needs the end card's exact headline.");
    for (const line of [sb.endCard?.headline ?? "", sb.endCard?.detail ?? ""])
      for (const number of unknownNumbers(line, ctx.knownFacts))
        issues.push(`The end card shows "${number}", which the brand never said.`);
  }

  const all = normal(JSON.stringify(sb));
  for (const name of ctx.competitors ?? []) {
    const n = normal(name);
    if (n.length >= 3 && new RegExp(`\\b${n.replace(/ /g, "\\s")}\\b`).test(all))
      issues.push(`Never name ${name}.`);
  }
  return [...new Set(issues)];
}

/** The storyboard as plain shot lines: the job's `concept`, captions and review read this. */
export function storyboardSummary(sb: VideoStoryboard, plan: ClipPlan): string {
  const lines = [sb.logline];
  sb.clips.forEach((clip, i) => {
    const offset = plan[i]?.start ?? 0;
    for (const shot of clip.shots)
      lines.push(
        `[${round(offset + shot.start)}–${round(offset + shot.end)}s] ${[shot.camera, shot.action].filter(Boolean).join(": ")}`,
      );
  });
  if (sb.endCard?.headline)
    lines.push(`End card: ${[sb.endCard.headline, sb.endCard.detail].filter(Boolean).join(" · ")}`);
  return lines.filter(Boolean).join("\n");
}

/** Never let a clip carry the marks of AI video. */
export const AI_VIDEO_TELLS =
  "Avoid the marks of AI video: faces, hands or products that change shape, extra or merging fingers, drifting or melting logos, garbled letters, objects that appear from nowhere, impossible camera moves, jump cuts inside a clip, simulated app screens, watermarks and stock-footage looks.";

export type ClipPromptOptions = {
  kind: VideoKindId;
  plan: ClipPlan;
  brandName: string;
  ratio: string;
  /** The clip starts from the last frame of the clip before (the first image). */
  chained: boolean;
  /** Clip 1 opens on the brand's finished post picture (the first image). */
  fromPicture?: boolean;
  /** A product photo is among the images. */
  productPhoto?: boolean;
  audio: boolean;
  /** Brand look, taste, platform and other blocks every clip carries. */
  extra?: readonly string[];
  /** The checker's reason, when this clip is being made again. */
  redoNote?: string;
};

/** The render prompt for one clip: the whole bible, then only this clip. */
export function clipPrompt(sb: VideoStoryboard, index: number, opts: ClipPromptOptions): string {
  const kind = videoKind(opts.kind);
  const clip = sb.clips[index];
  const seconds = opts.plan[index]?.seconds ?? 8;
  const total = opts.plan.reduce((sum, c) => sum + c.seconds, 0);
  const last = index === sb.clips.length - 1;
  const many = sb.clips.length > 1;
  const bible = [
    ...sb.bible.cast.map((member) => `- ${member.id}: ${member.look}`),
    sb.bible.product
      ? `- Product: ${sb.bible.product}${opts.productPhoto ? " (exactly as in the product photo)" : ""}`
      : "",
    sb.bible.setting ? `- Setting: ${sb.bible.setting}` : "",
    sb.bible.lighting ? `- Light: ${sb.bible.lighting}` : "",
    sb.bible.palette ? `- Colours: ${sb.bible.palette}` : "",
    sb.bible.camera ? `- Camera: ${sb.bible.camera}` : "",
  ].filter(Boolean);
  return [
    many
      ? `Clip ${index + 1} of ${sb.clips.length} from one ${total}-second ${kind.label.toLowerCase()} video for ${opts.brandName}. Make exactly ${seconds} seconds. Aspect ratio ${opts.ratio}.`
      : `A ${seconds}-second ${kind.label.toLowerCase()} video for ${opts.brandName}. Aspect ratio ${opts.ratio}.`,
    index > 0 && opts.chained
      ? "FIRST FRAME: the first image is the last frame of the clip before this one. Start on exactly that frame and carry straight on: the same people, product, place, light and camera position. Do not restart, re-introduce or repeat anything."
      : "",
    index === 0 && opts.fromPicture
      ? "SOURCE PICTURE: the first image is the brand's approved post. Open on exactly this picture as the first frame: the same composition, product, colours, people and any words or logo in it. Bring it to life; do not redesign it. Words and logos stay perfectly still."
      : "",
    `THE STORY: ${sb.logline}`,
    bible.length
      ? `KEEP IDENTICAL IN EVERY SHOT (the same in every clip of this video):\n${bible.join("\n")}`
      : "",
    index > 0 && sb.clips[index - 1]?.endsOn
      ? `The clip before ended on: ${sb.clips[index - 1].endsOn}`
      : "",
    [
      `THIS CLIP${many ? ` (${index + 1} of ${sb.clips.length})` : ""}:`,
      clip.opensOn ? `Opens on: ${clip.opensOn}` : "",
      ...clip.shots.map(
        (shot) =>
          `[${shot.start}–${shot.end}s] ${[shot.camera, shot.action].filter(Boolean).join(": ")}`,
      ),
      `Ends on: ${clip.endsOn}. The last half second is still, so ${last ? "the video ends cleanly" : "the next clip can continue from it"}.`,
    ]
      .filter(Boolean)
      .join("\n"),
    last && kind.ending === "hero-frame"
      ? "This is the end of the video: finish the action and settle on the final frame. Nothing is left mid-motion."
      : "",
    last && kind.ending === "end-card"
      ? "This is the end of the footage: settle on a calm frame with empty space. A card with the offer follows it."
      : "",
    !last ? "This clip is not the end: do not wrap up, fade out or show a final pose." : "",
    opts.audio
      ? `SOUND: ${clip.sound || "natural sound of the scene"}. No narration, no music with lyrics${index > 0 ? ", and keep the sound continuous with the clip before" : ""}.`
      : "No sound needed.",
    clip.onScreen
      ? `On-screen words, spelled exactly: "${clip.onScreen}". Large, high-contrast and away from the top and bottom edges. If they can't be spelled perfectly, show none.`
      : "No words, captions or logos drawn on screen.",
    `How this kind of video works:\n${kind.rules.map((rule) => `- ${rule}`).join("\n")}`,
    index === 0 && kind.id !== "living-picture"
      ? "The first second is the hook: open on motion already happening. No logo intro, no title card, no fade from black."
      : "",
    "Real physics, believable materials, motivated camera moves only.",
    AI_VIDEO_TELLS,
    opts.redoNote ? `FIX FROM THE LAST TRY: ${opts.redoNote}` : "",
    ...(opts.extra ?? []),
  ]
    .filter(Boolean)
    .join("\n\n");
}
