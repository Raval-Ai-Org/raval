// How Mellox plans a short video ad, and how it brings an existing post's
// picture to life. Pure and browser-safe: the video brief (prompts.ts), the
// render prompt (runner.server.ts) and the review panel all read it. Add a
// rule here, never in one prompt only.

/** The craft every generated video follows, written as rules a director can shoot. */
export const VIDEO_AD_RULES: readonly string[] = [
  "The first second is the hook: open on motion already happening with the product, the person or the payoff in frame. No logo intro, no title card, no fade in from black.",
  "One message and one hero subject per video. Show the product or service by the first third and hold it long enough to read.",
  "It must work with the sound off: the story is clear from the pictures alone, and any words on screen are large, high-contrast and away from the top and bottom edges where the app's buttons sit.",
  "Keep it moving: a new shot, angle or reveal every 1.5 to 3 seconds. Nothing stands still for longer than 3 seconds except the final hold.",
  "Motivated camera moves only: push in, slow orbit, parallax, macro slide, a reveal from behind something. Real physics, believable materials and light that stays consistent between shots.",
  "End on a clean hero frame held for about a second, with room for the brand and the next step. That frame should also work as the cover picture, and where it fits it loops back into the opening.",
];

/** What a platform's viewers expect from a short video. */
export function platformVideoNote(platforms: readonly string[]): string {
  const notes: string[] = [];
  if (platforms.some((p) => p === "tiktok" || p === "instagram"))
    notes.push(
      "TikTok and Reels: vertical, quick and human; it should feel shot for the feed, not like a TV ad.",
    );
  if (platforms.includes("youtube"))
    notes.push("YouTube Shorts: a clear payoff by the middle, so people don't swipe away.");
  if (platforms.includes("facebook"))
    notes.push("Facebook: show the product plainly early; many people watch without sound.");
  if (platforms.includes("linkedin"))
    notes.push("LinkedIn: calm, credible and useful; no hype or fast flashing cuts.");
  return notes.join(" ");
}

export type VideoBeat = { start: number; end: number; role: string; direction: string };

const round = (n: number) => Math.round(n * 10) / 10;

/**
 * The beats of a short ad, scaled to its length: hook, show, why it matters,
 * payoff. A 4-5 second clip has no room for a separate "why" beat.
 */
export function videoBeats(durationSec: number): VideoBeat[] {
  const d = Math.max(4, Math.min(60, durationSec));
  const hook = round(Math.min(2, Math.max(1, d * 0.15)));
  const end = round(Math.min(3, Math.max(1, d * 0.2)));
  if (d <= 5)
    return [
      {
        start: 0,
        end: hook,
        role: "hook",
        direction: "Open mid-motion on the most striking moment.",
      },
      {
        start: hook,
        end: d,
        role: "payoff",
        direction: "Settle on the hero frame of the product and hold it.",
      },
    ];
  const show = round(hook + (d - hook - end) * 0.55);
  return [
    {
      start: 0,
      end: hook,
      role: "hook",
      direction: "Open mid-motion on the most striking moment.",
    },
    {
      start: hook,
      end: show,
      role: "show",
      direction: "Show the product or service clearly, in use or up close.",
    },
    {
      start: show,
      end: round(d - end),
      role: "why",
      direction: "One detail or result that shows why it is worth having.",
    },
    {
      start: round(d - end),
      end: d,
      role: "payoff",
      direction: "End on the clean hero frame, held, with room for the brand and the next step.",
    },
  ];
}

export function videoBeatsText(durationSec: number): string {
  return videoBeats(durationSec)
    .map((b) => `[${b.start}–${b.end}s] ${b.role}: ${b.direction}`)
    .join("\n");
}

/** Studio pieces whose finished picture can be turned into a video. */
const ANIMATABLE = new Set(["image", "social", "ad", "story"]);

export function canAnimatePiece(type: string): boolean {
  return ANIMATABLE.has(type);
}

/**
 * The video ratio for a picture: square stays square on models that allow it,
 * a landscape picture stays landscape, everything else is vertical.
 */
export function videoRatioForImage(ratio: string | undefined): "9:16" | "1:1" | "16:9" {
  if (ratio === "16:9" || ratio === "4:3") return "16:9";
  if (ratio === "1:1") return "1:1";
  return "9:16";
}

/** The brief a "Make a video" click starts with. */
export function animateBrief(piece: { type: string; title?: string | null }): string {
  const what =
    piece.type === "ad" ? "ad" : piece.type === "story" ? "Story picture" : "post picture";
  const title = piece.title?.trim() ? ` "${piece.title.trim().slice(0, 100)}"` : "";
  return `Turn my ${what}${title} into a short video ad. Bring the same picture to life and keep the product, colours and words exactly as they are.`;
}

/** Sent to the renderer when the video starts from an existing post's picture. */
export function animateImageDirection(durationSec: number): string {
  return [
    "SOURCE PICTURE: the first image is the brand's approved post. Open on exactly this picture as the first frame: the same composition, product, colours, people, and any words or logo already in it. Bring it to life; do not redesign it.",
    "Pick one or two motions that suit the picture: a slow push in, gentle parallax between foreground and background, a light sweep or glint across the product, natural motion in the scene (steam, fabric, water, leaves, hair, a pour). A product turns only if its unseen side is never shown.",
    "Words, logos and packaging text in the picture stay perfectly still and readable. Never re-letter, morph, blur or add text.",
    durationSec > 6
      ? "After the opening, move into one or two connected shots in the same world (a closer detail, the product in use) and come back to the original framing for the last second."
      : "Stay in the picture's own framing the whole time.",
    "Finish on a held frame close to the original picture, so the video works as the moving version of the post.",
  ].join("\n");
}
