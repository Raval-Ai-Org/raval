// What each clip of a Studio video is for, by kind and by length. Pure and
// browser-safe. An 8-second video is one idea that loops; 16 seconds is a
// hook and a payoff; 24 seconds and more is a full arc with B-roll between
// the hero shots. The storyboard prompt gives the model one role per clip, so
// a longer video is a different video, not the short one stretched.

import type { VideoKindId } from "./kinds";

/** Four beats per kind: open, develop, deepen, close. Fewer clips use fewer beats. */
type Beats = { open: string; develop: string; deepen: string; close: string; single: string };

const BEATS: Record<Exclude<VideoKindId, "motion-post" | "motion-graphics">, Beats> = {
  "living-picture": {
    single: "The post itself coming alive with one gentle motion, settling back on the post.",
    open: "The post itself, exactly as it is, coming alive with one gentle motion.",
    develop: "A slow move in to one detail of the same picture.",
    deepen: "Light or a slow drift moving across the picture.",
    close: "Back to the whole post, still and held.",
  },
  "product-motion": {
    single:
      "Open mid-move on the product's most striking detail, travel to the whole product and settle on the hero frame.",
    open: "The hook: a striking detail of the product already moving, then the whole product revealed.",
    develop:
      "B-roll from its world: a macro of its texture or material, an ingredient or part, light reacting to it.",
    deepen: "The product in its place of use, one new angle it has not shown yet.",
    close: "The hero frame: the product centred, still, matching the opening picture.",
  },
  "product-demo": {
    single:
      "Open on the most satisfying moment of use, show the one feature that matters, end on the product at rest.",
    open: "The hook: the most satisfying moment of use, already happening.",
    develop: "The first feature, shown working, close and steady.",
    deepen: "The next feature or the result of using it, shown working.",
    close: "The product at rest, label to camera, held.",
  },
  "product-showcase": {
    single: "A reveal of the product, one detail up close, then the hero frame held.",
    open: "The hook: the product revealed from shadow or from behind something.",
    develop: "A macro slide along its most beautiful detail or texture.",
    deepen: "The product in a hand or in use.",
    close: "The hero frame: centred, lit, still and held.",
  },
  "brand-story": {
    single: "One moment, one turn: the small problem, the brand helps, the calm payoff.",
    open: "The relatable moment or small problem, already happening.",
    develop: "The moment the brand comes in, used the way a real customer would.",
    deepen: "The difference it makes, shown, not said.",
    close: "The payoff: a calm, resolved frame held for a second.",
  },
  "how-it-works": {
    single: "One second of the finished result, then the one key step, then the result held.",
    open: "One second of the finished result as the hook, then step one.",
    develop: "The middle steps, one action each.",
    deepen: "The last step.",
    close: "The finished result, held still.",
  },
  "before-after": {
    single: "The before for one beat, one motivated move, the after held.",
    open: "The before, shown briefly and honestly, and the change beginning.",
    develop: "The change finishing in one motivated move.",
    deepen: "A closer look at the after.",
    close: "The after, held still.",
  },
  "mood-broll": {
    single: "Three or four moments of the brand's world in one light, ending still.",
    open: "A wide, atmospheric moment that sets the place and light.",
    develop: "Rich close details: texture, light, movement.",
    deepen: "A small human or product moment, faceless.",
    close: "A quiet brand moment, still.",
  },
  "offer-teaser": {
    single: "Fast, desirable shots of what the offer is for, ending on a calm empty frame.",
    open: "The hook: the most desirable shot of what the offer is for.",
    develop: "Two or three quick angles of it in use.",
    deepen: "One more reason to want it, shown.",
    close: "A calm frame with empty space for the offer card.",
  },
  "broll-hook": {
    single:
      "Three or four short B-roll shots of the brand's world, the most striking one first, ending on the hero shot.",
    open: "The most striking shot first, while the words land: something already moving.",
    develop: "B-roll that builds the feeling: textures, details, light.",
    deepen: "The brand's world: its place, hands at work, the product in use.",
    close: "The hero shot of the product or place, calm and held so the line can be read again.",
  },
};

/** One role per clip, in order. */
export function clipRoles(kind: VideoKindId, clips: number): string[] {
  if (kind === "motion-post" || kind === "motion-graphics") return [];
  const beats = BEATS[kind];
  if (clips <= 1) return [beats.single];
  if (clips === 2) return [beats.open, beats.close];
  if (clips === 3) return [beats.open, beats.develop, beats.close];
  return [
    beats.open,
    beats.develop,
    beats.deepen,
    beats.close,
    ...Array(clips - 4).fill(beats.deepen),
  ].slice(0, clips);
}

/** What a video of this length can be, said once to the planner. */
export function lengthNote(totalSeconds: number): string {
  if (totalSeconds <= 10)
    return "This is a short loop: one idea, one hero, no setup. The last frame meets the first so it replays without a seam.";
  if (totalSeconds <= 20)
    return "This is a hook and a payoff: no slow middle. Every shot earns the next one.";
  return "This is a full short ad: a hook, a middle that changes angle or place every 2 to 3 seconds with B-roll between hero shots, and a clear payoff. Nothing repeats.";
}

/** The clip-by-clip plan as prompt lines. */
export function structureText(kind: VideoKindId, seconds: readonly number[]): string {
  const roles = clipRoles(kind, seconds.length);
  return roles.map((role, i) => `Clip ${i + 1} (${seconds[i]}s): ${role}`).join("\n");
}
