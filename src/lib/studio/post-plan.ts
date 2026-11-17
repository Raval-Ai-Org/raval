// post-plan.ts — one writer plans a single picture post the way a senior
// designer would brief it (ADR-0051). Pure.
//
// Before this, a post's picture prompt was about 13 code-built blocks (layout
// scene, craft rules, category rules, deliverable, Brand DNA dump, QA lists…)
// that ran past the image model's 10,000-character cut, contradicted each
// other and buried the person's brief. Stories, made from a short coherent
// prompt, looked far better. Now the writer reads the brief FIRST, decides the
// words and the picture together, and writes the picture's art direction as
// one coherent paragraph (`concept`). Code then adds only short hard rules
// (exact words, brand look, type, margins, logo, final check) in
// `postImagePrompt` (src/server/studio/visual-prompts.server.ts).
import { sellsPhysicalProduct } from "./art-direction";
import { briefReadLines, readBrief, type BriefRead } from "./brief-read";
import { HEADLINE_MAX_WORDS } from "./brief-fit";
import { briefVisualIdea, pictureJobFor } from "./brief-visual";
import { capBlock } from "./caps";
import { deliverableById } from "./creative-knowledge";
import {
  PLATFORM_FEEL,
  offeredPostStyles,
  postStyleMenu,
  stylePlatform,
  type PostStyle,
} from "./post-styles";
import {
  VisualBriefSchema,
  refineSections,
  sections,
  sourceSection,
  styleSection,
  type BuildArgs,
  type BuiltPrompt,
  type Section,
} from "./prompts";
import type { z } from "zod";

/** What every great social picture shares; the writer checks its plan against it. */
export const POST_CRAFT: readonly string[] = [
  "One message, said by the headline in plain words. Someone scrolling understands what the post is about in one second.",
  "One focal subject that carries the message, big and clear at thumbnail size. Everything else supports it or is left out.",
  "A clear reading order: the headline first, the supporting visual second, the small details last.",
  "Words sit on a calm area of the picture (a clean background, a solid band, open sky, a plain wall), never over busy detail and never hidden behind the subject.",
  "The brand's own colours and type character, generous margins, lots of breathing room. Premium means simple.",
  "Real, specific and believable: real materials and light, the brand's real world. Nothing invented: no fake logos, app screens, prices, ratings, names, figures or people's quotes.",
  "Never generic AI imagery: no random gradient blobs, floating 3D icons, glowing orbs, stock smiles, people pointing at laptops, or clip-art.",
  "It looks like a real post a strong brand published this year, not an AI ad stunt: no surreal scale tricks, giant floating objects, miniature worlds, portals, sculptures made of the headline or visual metaphors, unless the brief itself asks for one.",
];

/** The native post styles offered for this post (post-styles.ts), best first. */
export function postStylesFor(args: BuildArgs, read: BriefRead): PostStyle[] {
  return offeredPostStyles({
    read,
    platform: args.controls.platforms?.[0],
    physicalProduct: sellsPhysicalProduct(args.ctx.brandText),
    recent: args.ctx.recent.map((r) => r.artDirection),
    refine: !!args.refine,
    seed: `${args.ctx.brandName}:${args.intent.brief}`,
  });
}

/** The latest words this brand put on pictures, so the next ones are new. */
function recentHeadlines(args: BuildArgs): string {
  return args.ctx.recent
    .map((r) => r.hook || r.title)
    .filter(Boolean)
    .slice(0, 6)
    .map((h) => `- ${h}`)
    .join("\n");
}

export function buildPostPlanPrompt(
  args: BuildArgs,
): BuiltPrompt<z.infer<typeof VisualBriefSchema>> {
  const read = args.briefRead ?? readBrief(args.intent.brief);
  const deliverable = deliverableById(read.deliverable);
  const job = pictureJobFor({
    deliverable: read.deliverable,
    goal: args.intent.goal,
    productAsked: read.productAsked,
  });
  const campaign = args.controls.campaign?.trim();
  const system = [
    "You are Mellox, a senior art director and copywriter at a top social agency. You plan ONE social media picture post and write the brief an image model will render it from, the way the best designers brief a render: one clear idea, described concretely and coherently.",
    "",
    "THE BRIEF IS THE POST. Read 'The brief' first. The post is about exactly what the person asked for: the same subject, the same purpose, their facts and their exact words. A hiring post stays about the role, a greeting stays a greeting, an event post says what, when and where. Never turn it into a product ad, a myth-buster, a contrarian take or anything they did not ask for. Brand context only helps you say it well.",
    "",
    "Return these fields:",
    "`strategy`: one line, written first: who it is for · the one thing they should take away · what they should do next.",
    `\`onImageText\`: the headline set on the picture, 2 to ${HEADLINE_MAX_WORDS} words. It says the brief's point plainly and memorably${read.deliverable === "hiring" ? " (the role or the invitation to join)" : read.deliverable === "event" ? " (the event's name or promise)" : read.deliverable === "greeting" ? " (the greeting itself)" : ""}. Use the person's exact words when they gave some. Only facts from the brief or the brand: never an invented figure, price, date or claim. Not the caption's first line. Empty only when the picture must carry no words.`,
    `\`onImageLines\`: 0 to 3 supporting lines that the brief makes worth showing (a date and place, how to apply, the offer's condition, the roles), each starting with its role: \`eyebrow: \` (2-4 word label${campaign ? `, the campaign "${campaign.slice(0, 40)}"` : ""}), \`body: \` (one short sentence, 14 words at most), \`item: \` (2-4 words, only things the brief lists) or \`button: \` (2-4 words, the action). Use an empty list when the headline says it all. Never fill lines with general brand description.`,
    "`postStyle`: the id of the one style from 'Post styles' that serves this brief best on this platform (the first is usually right). Write the words and the picture for that style: a style that carries no supporting lines gets none.",
    "`concept`: the picture's full art direction, written straight to the image model as one coherent paragraph of 120 to 280 words, built on the chosen post style. Say, concretely: what kind of post it is and its feel; the focal subject and how much of the frame it fills; the setting or background; the composition, including exactly where the headline and each supporting line sit (for example 'headline in heavy condensed caps across the top third on the plain sand background'); the colours by the brand's hex values; the type character (from the brand's fonts); the light; the finish. A photo style describes a real, believable photograph of the brand's real world (the product in use, the place, the craft, the people); a design style describes a clean, well-made graphic. Refer to the words as 'the headline' and 'the supporting line': their exact text is added after your paragraph, so do not repeat it. No camera jargon lists, no lists of adjectives.",
    "`title`: a short internal title. `altText`: what the finished picture shows, for accessibility.",
    "",
    "What a great post does (check your plan against it before you answer):",
    ...POST_CRAFT.map((rule) => `- ${rule}`),
    "",
    "Plain everyday words, the brand's voice, no em dashes, no clichés ('elevate', 'unlock', 'game-changer', 'seamless').",
    "Return STRICT JSON only, no markdown fences.",
    'Schema: {"title": string, "strategy": string, "postStyle": string, "onImageText": string, "onImageLines": string[], "concept": string, "altText": string}',
  ].join("\n");

  const style = styleSection(args.ctx, "image");
  const user: Section[] = [
    { label: "The brief (this is the post; never change its subject)", body: args.intent.brief },
    { label: "What the brief asks for", body: briefReadLines(read).join("\n") },
    {
      label: "This picture's job",
      body: `${job.scene}\nThe headline is ${job.headline}.${deliverable && read.deliverable !== "brand-moment" ? `\nReading order: ${deliverable.readingOrder}.\nNever invent: ${deliverable.neverInvent}.` : ""}`,
    },
    {
      label: "Picture the brief describes (build on it)",
      body: briefVisualIdea(args.intent.brief, "image") || null,
    },
    sourceSection(args.source, "image"),
    {
      label: "Brand (facts and voice; use only what helps this post)",
      body: capBlock(
        args.ctx.visualBrandText || args.ctx.brandText || `Brand: ${args.ctx.brandName}`,
        3600,
      ),
    },
    {
      label: style.label,
      body: typeof style.body === "string" ? capBlock(style.body, 1800) : null,
    },
    {
      label: "The brand's saved visual direction",
      body:
        capBlock(args.ctx.visualTaste?.rules ?? args.ctx.visualFeedbackRules ?? "", 1200) || null,
    },
    {
      label: "Goal",
      body: args.intent.goal
        ? `The person's goal is ${args.intent.goal}; serve it through the brief's own message.`
        : null,
    },
    campaign
      ? { label: "Campaign", body: `This post is part of the campaign "${campaign.slice(0, 80)}".` }
      : { label: "Campaign", body: null },
    {
      label: "Platform",
      body: PLATFORM_FEEL[stylePlatform(args.controls.platforms?.[0])],
    },
    {
      label: "Post styles (pick one id; best fit first)",
      body: postStyleMenu(postStylesFor(args, read)),
    },
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
    maxTokens: 1500,
    temperature: args.refine ? 0.5 : 0.8,
  };
}
