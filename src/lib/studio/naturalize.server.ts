// naturalize.server.ts — the model-calling half of caption naturalization.
// Runs after humanizeOutput (em-dash cleanup) in runner.server.ts's
// executeJob, right before drafts are written. Gated by the pure heuristic
// in naturalize.ts: most captions never cross the cliché threshold and this
// never calls the model for them. When it does, the rewrite is only kept if
// it demonstrably improved (isBetterThanOriginal) AND preserved every fact
// the caption started with (checkPreservation) — otherwise the original
// ships untouched. A gateway failure of any kind falls back to the
// original the same way: this can only ever improve a caption, never break
// or block one.
import "server-only";
import { llmJson } from "@/lib/ai-gateway.server";
import type { SocialVariant } from "@/lib/studio/jobs";
import {
  checkPreservation,
  isBetterThanOriginal,
  needsNaturalization,
} from "@/lib/studio/naturalize";
import { finalizeVariant } from "@/lib/studio/prompts";

const REWRITE_SCHEMA = {
  type: "object",
  properties: { rewritten: { type: "string" } },
  required: ["rewritten"],
  additionalProperties: false,
} as const;

function buildSystemPrompt(brandName: string, brandText: string, styleText?: string) {
  return [
    `You polish one social media caption for ${brandName || "the brand"} so it reads like a person wrote it, not a template.`,
    "Remove generic AI-marketing phrasing, cliché openers ('unlock', 'elevate', 'in today's fast-paced world'), and robotic structure.",
    "Keep the brand's voice below. Keep every claim the caption already makes — add nothing new, remove no facts.",
    "Preserve EXACTLY, character for character: every URL, @mention, #hashtag, number, price, percentage, product name, and call to action already in the caption.",
    "Keep roughly the same length. Output ONLY the rewritten caption text — no preamble, no quotes, no markdown fences.",
    "",
    "Brand voice:",
    brandText || "(no brand profile on file — keep a neutral, confident marketing tone)",
    ...(styleText
      ? [
          "",
          "The brand's chosen writing style (the rewrite must still follow it exactly):",
          styleText,
        ]
      : []),
  ].join("\n");
}

export type BrandVoice = {
  brandName: string;
  brandText: string;
  /** Brand Kit writing style block, when the job follows a Style. */
  styleText?: string;
  /** Style phrases, hashtags and emoji a rewrite must not drop. */
  protectedTerms?: string[];
};

/** Every protected style term the original used must survive the rewrite. */
function keepsStyleTerms(
  original: string,
  rewritten: string,
  terms: string[] | undefined,
): boolean {
  if (!terms?.length) return true;
  const before = original.toLowerCase();
  const after = rewritten.toLowerCase();
  return terms.every((t) => {
    const term = t.toLowerCase();
    return !before.includes(term) || after.includes(term);
  });
}

/** Rewrites one variant's body if (and only if) it clears the cliché bar and the rewrite survives validation. */
export async function naturalizeVariant(
  variant: SocialVariant,
  brand: BrandVoice,
): Promise<SocialVariant> {
  if (!needsNaturalization(variant.body)) return variant;
  let rewritten: string;
  try {
    const result = await llmJson<{ rewritten: string }>({
      route: "studio.naturalize",
      system: buildSystemPrompt(brand.brandName, brand.brandText, brand.styleText),
      user: variant.body,
      fallback: { rewritten: variant.body },
      outputSchema: REWRITE_SCHEMA,
      maxTokens: 600,
    });
    rewritten = (result.rewritten ?? "").trim();
  } catch {
    return variant;
  }
  if (!rewritten) return variant;
  if (!isBetterThanOriginal(variant.body, rewritten)) return variant;
  if (!checkPreservation(variant.body, rewritten).ok) return variant;
  if (!keepsStyleTerms(variant.body, rewritten, brand.protectedTerms)) return variant;
  // Re-clamp to the platform's limits and re-normalize hashtags — a rewrite
  // can change length even though isBetterThanOriginal bounds how much.
  return finalizeVariant(variant.platform, {
    title: variant.title,
    body: rewritten,
    hashtags: variant.hashtags,
  });
}

export async function naturalizeVariants(
  variants: SocialVariant[] | undefined,
  brand: BrandVoice,
): Promise<SocialVariant[] | undefined> {
  if (!variants?.length) return variants;
  return Promise.all(variants.map((variant) => naturalizeVariant(variant, brand)));
}
