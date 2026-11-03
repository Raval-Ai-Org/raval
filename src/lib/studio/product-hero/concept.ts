// Each product poster's own idea and words (ADR-0040). Pure.
//
// Code decides the staging, colour mood, light and set (stagings.ts,
// variety.ts); a model then writes this poster's scene idea inside them and a
// fresh headline, seeing what the brand's latest posters already said. The
// model proposes, `groundConcept` decides: a scene with people, words or
// figures loses that sentence, and a headline or support line that claims
// anything the product's facts don't say, or repeats a recent headline, is
// dropped (the copy writer's line or the stored facts are used instead).
import type { HeroProduct } from "./plan";
import type { Staging } from "./stagings";
import { lightById, setById, type HeroLook, type Occasion, type Topic } from "./variety";

export type ConceptInput = {
  brandName: string;
  product: HeroProduct;
  staging: Staging;
  look: Pick<HeroLook, "palette" | "light" | "set">;
  occasion: Occasion | null;
  /** What this poster is about. */
  topic?: Topic | null;
  texture: string | null;
  ingredients: readonly string[];
  benefits: readonly string[];
  brief: string;
  /** The post's caption, so the headline belongs to the same post. */
  caption?: string | null;
  /** The copy writer's on-image line, a starting point only. */
  draftHeadline?: string | null;
  /** Words the person asked for: kept exactly, the model writes no headline. */
  fixedHeadline?: string | null;
  audience?: string | null;
  voice?: string | null;
  allowText: boolean;
  /** The brand's latest product posters, newest first. */
  recent: readonly Partial<HeroLook>[];
};

export type HeroConcept = {
  scene: string | null;
  headline: string | null;
  support: string | null;
};

const clip = (text: string | null | undefined, n: number) =>
  (text ?? "").replace(/\s+/g, " ").trim().slice(0, n);

export function conceptMessages(input: ConceptInput): { system: string; user: string } {
  const light = lightById(input.look.light);
  const set = setById(input.staging.id, input.look.set);
  const used = input.recent
    .slice(0, 6)
    .map((r) =>
      [
        r.topic && `topic: ${r.topic}`,
        r.concept && `idea: ${clip(r.concept, 220)}`,
        r.headline && `headline: "${clip(r.headline, 90)}"`,
      ]
        .filter(Boolean)
        .join(" | "),
    )
    .filter(Boolean);
  const writes = input.allowText && !input.fixedHeadline;
  const system = [
    "You are the art director and copywriter of one premium product poster for a brand's social feed. Code has already chosen the topic, layout, colours, light and set; you write this poster's own scene idea inside them and, when asked, its headline.",
    "Every poster is about something new, but it is always the same brand: keep the brand's colours, type, finish and taste exactly as they are. Different topic and idea, same look.",
    "Rules for the scene:",
    "- One vivid, specific idea a photographer could shoot, 2–4 sentences, inside the given staging, that shows this poster's topic. Make it clearly different from every earlier idea listed.",
    "- Only these may appear: the product, its own formula, the ingredients its facts name, the set, light and shadow, and the occasion's touches. No people, hands, faces or animals; no other products; no words, logos or signs in the scene; no figures.",
    "- Never change the product itself: its shape, colours and label stay exactly as they are.",
    writes
      ? "Rules for the words:\n- headlines: three different options, best first, each 2–8 words for this post's reader, about this poster's topic, specific to the brief and the product, in the brand's voice and in the caption's language. Each opens with a different word, and none opens with the same word as an earlier headline or sounds close to one. No figure, award, promise, comparison or claim the product's facts don't state.\n- support: one short sentence (at most 16 words) built only from the product's facts, or an empty string."
      : 'Leave "headlines" empty and "support" as an empty string.',
    'Return JSON only: {"scene": string, "headlines": string[], "support": string}.',
  ].join("\n");
  const user = [
    `Brand: ${clip(input.brandName, 80)}`,
    `Product: ${clip(input.product.name, 80)}${input.product.category ? ` (${clip(input.product.category, 60)})` : ""}`,
    input.product.description ? `What it is: ${clip(input.product.description, 500)}` : "",
    input.benefits.length ? `What it does (its own words): ${input.benefits.join("; ")}` : "",
    input.texture ? `Its formula: ${input.texture}` : "",
    input.ingredients.length ? `Ingredients its facts name: ${input.ingredients.join(", ")}` : "",
    input.audience ? `Who it is for: ${clip(input.audience, 240)}` : "",
    input.voice ? `Brand voice: ${clip(input.voice, 240)}` : "",
    "",
    `The brief: ${clip(input.brief, 600) || "a product post"}`,
    input.caption ? `The caption: ${clip(input.caption, 500)}` : "",
    input.fixedHeadline ? `The headline is fixed: "${clip(input.fixedHeadline, 120)}"` : "",
    input.draftHeadline && writes
      ? `The copy writer's line (improve or replace it): "${clip(input.draftHeadline, 120)}"`
      : "",
    "",
    input.topic ? `This poster's topic: ${input.topic.direction}.` : "",
    `Staging "${input.staging.name}": ${input.staging.scene(`the ${clip(input.product.name, 60)}`, input.texture, input.ingredients)}`,
    `Colours: the brand's own (${input.look.palette === "tint" ? "a light tint of the pack's colour" : input.look.palette}). Light: ${light?.text ?? "the staging's own"}. Set: ${set?.text ?? "the staging's own"}.`,
    input.occasion
      ? `Occasion: ${input.occasion.mood}. Its touches (the only extras allowed): ${input.occasion.touches}.`
      : "",
    "",
    used.length
      ? `Earlier posters of this brand (newest first) — do something different:\n${used.map((u) => `- ${u}`).join("\n")}`
      : "This is the brand's first poster of this kind.",
  ]
    .filter((line) => line !== "")
    .join("\n");
  return { system, user };
}

const SCENE_REFUSED =
  /["“”]|\d|\b(?:text|words?|letters?|lettering|logo|caption|headline|slogan|tagline|signs?|signage|person|people|woman|women|man|men|hands?|fingers?|faces?|model|girl|boy|child|children|baby|animals?|dog|cat)\b/i;

/** Words a poster may only say when the product's facts say them too. */
const CLAIMS =
  /#\s?1|\bno\.?\s?1\b|\bnumber one\b|\b(?:best(?:-selling)?|clinically|proven|guarantee\w*|dermatologist\w*|award\w*|certified|organic|vegan|cruelty[- ]free|free from|miracle|cures?|cured|heals?|instant\w*|permanent\w*|overnight|forever|world'?s|only)\b/gi;

const tokens = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );

/** Two headlines say nearly the same thing. */
export function nearRepeat(a: string, b: string): boolean {
  const x = tokens(a);
  const y = tokens(b);
  if (!x.size || !y.size) return a.trim().toLowerCase() === b.trim().toLowerCase();
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / (x.size + y.size - shared) >= 0.6;
}

const OPENING_SKIP = new Set(["a", "an", "the", "your", "our", "for", "meet", "this", "it", "its"]);

/** The first word that carries meaning ("Pure gel clarity" → "pure"). */
function openingWord(text: string): string | null {
  return (
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .find((w) => w && !OPENING_SKIP.has(w)) ?? null
  );
}

/** A headline that opens like one of the latest few reads as a repeat in the feed. */
export function sameOpening(a: string, b: string): boolean {
  const x = openingWord(a);
  return !!x && x === openingWord(b);
}

/** Every figure and claim word in `text` is in the facts. */
export function staysWithinFacts(text: string, facts: string): boolean {
  const known = facts.toLowerCase();
  for (const figure of text.match(/\d+(?:[.,]\d+)?/g) ?? [])
    if (!known.includes(figure)) return false;
  if (/%/.test(text) && !known.includes("%")) return false;
  for (const claim of text.match(CLAIMS) ?? [])
    if (!known.includes(claim.toLowerCase())) return false;
  return true;
}

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

export function groundConcept(
  raw: unknown,
  opts: { facts: string; recentHeadlines: readonly string[]; allowText: boolean },
): HeroConcept {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const text = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
  const sentences = (text(r.scene).match(/[^.!?]+[.!?]*/g) ?? [])
    .map((s) => s.trim())
    .filter((s) => s && !SCENE_REFUSED.test(s));
  const scene = sentences.join(" ").split(/\s+/).slice(0, 90).join(" ");
  const options = [...(Array.isArray(r.headlines) ? r.headlines : []), r.headline]
    .map((h) => text(h).replace(/^["“]|["”]$/g, ""))
    .filter(Boolean);
  const latest = opts.recentHeadlines.slice(0, 4);
  const headline =
    options.find(
      (h) =>
        wordCount(h) >= 2 &&
        wordCount(h) <= 9 &&
        !/["“”]/.test(h) &&
        staysWithinFacts(h, opts.facts) &&
        !opts.recentHeadlines.some((recent) => nearRepeat(recent, h)) &&
        !latest.some((recent) => sameOpening(recent, h)),
    ) ?? "";
  const support = text(r.support);
  const headlineOk = opts.allowText && !!headline;
  const supportOk =
    opts.allowText &&
    wordCount(support) >= 3 &&
    wordCount(support) <= 18 &&
    !/["“”]/.test(support) &&
    staysWithinFacts(support, opts.facts);
  return {
    scene: wordCount(scene) >= 8 ? scene : null,
    headline: headlineOk ? headline : null,
    support: supportOk ? support : null,
  };
}

/** Words the person wrote in quotes in the brief: set exactly, never rewritten. */
export function quotedHeadline(brief: string): string | null {
  const match = brief.match(/["“]([^"“”]{2,80})["”]/);
  return match ? match[1].trim() : null;
}
