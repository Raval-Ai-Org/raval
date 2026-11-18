// post-plan.ts — the director (ADR-0051 round 3). Pure.
//
// A picture post is planned the way Claude plans one when it calls the image
// model itself: one strong writer reads the brief, decides the words and the
// picture together, and writes the finished image prompt as plain prose
// (`concept`). Code adds only the exact words, the canvas and the logo corner
// (`postImagePrompt`, src/server/studio/visual-prompts.server.ts). No post-style
// recipes, layout menus, type tables or rule checklists reach the image model:
// a side-by-side test on the same model (2026-11-17) showed those layers made
// every post a template and changed the person's words.
import { briefReadLines, readBrief } from "./brief-read";
import { HEADLINE_MAX_WORDS } from "./brief-fit";
import { capBlock } from "./caps";
import { PLATFORM_FEEL, stylePlatform } from "./post-styles";
import {
  VisualBriefSchema,
  refineSections,
  sections,
  sourceSection,
  type BuildArgs,
  type BuiltPrompt,
  type Section,
} from "./prompts";
import type { z } from "zod";

/** How the director writes the image prompt; shared with carousels. */
export const DIRECTOR_CRAFT: readonly string[] = [
  "Think first about what this brand's best real posts on this platform look like today: native to the feed, simple, confident, believable. Not an ad stunt, not a template, not a surreal concept or visual metaphor.",
  "Pick the one format that fits the brief best (a real photo with a short headline over a calm area, a bold type post on the brand colour, a clean announcement, a product photo on a simple set) and commit to it.",
  "A photograph must look like a real photograph of the brand's real world: real materials, natural light, true colour, never a 3D render or plastic CGI.",
  "Words sit on a calm area (a plain wall, a solid band, open space), large enough to read on a phone. Fewer words read better: no labels, bullets or buttons unless the brief needs them.",
  "Never name another brand, product or equipment maker, and never draw an invented logo, label text, price, rating or quote.",
];

/**
 * The brand has a design of its own that its posts follow (Custom picture
 * style: a style bible learned from its site or posts, or saved Inspo
 * references while styles are on auto). Then the brand's world decides the
 * medium, not the director's default of "a real photo".
 */
export function followsOwnDesign(args: BuildArgs): boolean {
  const custom = args.ctx.style?.pictureStyles?.ids?.[0] === "custom";
  const bible = !!args.ctx.visualTaste?.direction?.bible;
  const auto = args.ctx.style?.pictureStyles?.auto !== false;
  return custom || (bible && auto);
}

/** The brand's own look as short guidance for the director (never orders to the image model). */
export function lookGuidance(args: BuildArgs): string | null {
  const rules = (args.ctx.visualTaste?.rules ?? args.ctx.visualFeedbackRules ?? "").trim();
  const own = args.ctx.style?.ownDesign?.trim();
  if (followsOwnDesign(args)) {
    // The brand's own design is the post's style: give the director the room
    // to describe it (world, recurring figure, type), not a 700-character tail.
    const text = [own ? `The brand's own design: ${own}` : "", rules].filter(Boolean).join("\n");
    return text ? capBlock(text, 1500) : null;
  }
  return rules ? capBlock(rules, 700) : null;
}

/** The director's craft rules, with the brand's own world first when it has one. */
export function directorCraft(args: BuildArgs): readonly string[] {
  if (!followsOwnDesign(args)) return DIRECTOR_CRAFT;
  return [
    "This brand has its own custom design (see 'The brand's own look'): make the post in that world, the medium, rendering, characters, objects, type and layout its website and posts use (an anime or painted world stays painted, a retro or space-themed brand stays retro or in space). It overrides the format suggestions below; a real photograph only when the brand's own design is photographic.",
    "Use the brand's recurring figure or signature elements when the idea suits them, always the same design, and compose the picture freshly for this brief. Never trace an example or copy its words.",
    ...DIRECTOR_CRAFT.filter((rule) => !rule.startsWith("A photograph must look")),
  ];
}

/** The latest words this brand put on pictures, so the next ones are new. */
function recentHeadlines(args: BuildArgs): string {
  return args.ctx.recent
    .map((r) => r.hook || r.title)
    .filter(Boolean)
    .slice(0, 5)
    .map((h) => `- ${h}`)
    .join("\n");
}

export function buildPostPlanPrompt(
  args: BuildArgs,
): BuiltPrompt<z.infer<typeof VisualBriefSchema>> {
  const read = args.briefRead ?? readBrief(args.intent.brief);
  const campaign = args.controls.campaign?.trim();
  const platform = stylePlatform(args.controls.platforms?.[0]);
  const system = [
    "You are the creative director for a brand's social media feed. A person asked for one post. You write the single image prompt a top designer would hand to an image model (GPT Image) to make the finished post, typography included, plus the words on it.",
    "",
    "The post is about exactly what the brief says: the same subject, the same purpose, the person's facts and exact words. Never turn it into a product ad or anything they did not ask for. Use only facts the brief or the brand gives; never invent a figure, date, price, offer, contact method or claim.",
    "",
    ...directorCraft(args).map((rule) => `- ${rule}`),
    "",
    "Return these fields:",
    `\`onImageText\`: the headline, 2 to ${HEADLINE_MAX_WORDS} words, plain and strong; the person's own words when they gave some. Empty only when the picture must carry no words.`,
    "`onImageLines`: 0 to 2 short supporting lines, only when the brief has details worth showing (a date and place, how to apply, the offer's condition). Each line is the exact words, 10 words at most. Never a slogan, a generic call to action or brand description.",
    "`concept`: the image prompt, 120 to 260 words of plain, concrete prose describing the finished post: the format; the subject or scene; the composition and how much of the frame the subject fills; exactly where the headline and lines sit and how they are set (type character, weight, size relationship, colour by hex); the palette from the brand's hex colours; the light; the finish. Refer to the words as 'the headline' and 'the line': their exact text is added after your prompt, so do not repeat it. No lists, no rule checklists.",
    "`strategy`: one line: who it is for and the one thing they should take away. `title`: a short internal title. `altText`: what the finished picture shows.",
    "",
    "Plain everyday words in the brand's voice, no em dashes, no clichés ('elevate', 'unlock', 'game-changer').",
    "Return STRICT JSON only, no markdown fences.",
    'Schema: {"title": string, "strategy": string, "onImageText": string, "onImageLines": string[], "concept": string, "altText": string}',
  ].join("\n");

  const user: Section[] = [
    { label: "The brief (this is the post; never change its subject)", body: args.intent.brief },
    { label: "Facts in the brief", body: briefReadLines(read).join("\n") },
    sourceSection(args.source, "image"),
    {
      label: "Brand (facts, colours, fonts and voice)",
      body: capBlock(
        args.ctx.visualBrandText || args.ctx.brandText || `Brand: ${args.ctx.brandName}`,
        2400,
      ),
    },
    {
      label: followsOwnDesign(args)
        ? "The brand's own look (its custom design: make the post in it; the brief decides what it says)"
        : "The brand's own look (a guide; the brief and a clean, native post come first)",
      body: lookGuidance(args),
    },
    campaign
      ? { label: "Campaign", body: `This post is part of the campaign "${campaign.slice(0, 80)}".` }
      : { label: "Campaign", body: null },
    { label: "Platform", body: `${PLATFORM_FEEL[platform]}` },
    {
      label: "Headlines this brand used lately (write a new one; the subject may be the same)",
      body: args.refine ? null : recentHeadlines(args) || null,
    },
    ...refineSections(args.refine, args.current),
  ];
  return {
    route: "studio.image.brief",
    system,
    user: sections(user),
    schema: VisualBriefSchema,
    maxTokens: 3000,
    temperature: args.refine ? 0.5 : 0.8,
  };
}
