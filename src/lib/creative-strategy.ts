import type { PlatformId } from "./social-platforms";
import type { ImgSize } from "./post-image";
import type { CreativeBrief } from "./creative-brief";

export type CreativeObjective =
  | "awareness"
  | "education"
  | "trust"
  | "conversion"
  | "engagement"
  | "product-launch"
  | "retargeting"
  | "retention";

export type CreativeFormat =
  | "product-focused"
  | "human-lifestyle"
  | "editorial"
  | "educational-visual"
  | "data-statistic"
  | "before-after"
  | "problem-solution"
  | "quote-testimonial"
  | "founder-led"
  | "comparison"
  | "storytelling"
  | "minimal-typography"
  | "cinematic-campaign"
  | "ugc-style"
  | "abstract-metaphorical"
  | "meme-style";

export type BrandStrategySignals = {
  brandName?: string | null;
  industry?: string | null;
  audience?: string | null;
  voice?: string | null;
  values?: string | null;
  products?: string | null;
  doRules?: string | null;
  dontRules?: string | null;
  positioning?: string | null;
  uniqueValueProp?: string | null;
  colors?: Array<{ name?: string; hex: string }>;
};

export type CreativeStrategy = {
  version: "1";
  objective: CreativeObjective;
  audience: string;
  funnel: CreativeBrief["funnel"];
  audiencePainOrDesire: string;
  coreMessage: string;
  hook: string;
  emotionalDirection: string;
  creativeAngle: string;
  visualConcept: string;
  visualMetaphor?: string;
  proofOrTrustElement?: string;
  ctaStrategy: "none" | "soft" | "direct";
  platformRole: string;
  successCriteria: string[];
  format: CreativeFormat;
  diversityKey: string;
};

function includesAny(text: string, signals: string[]) {
  return signals.some((signal) => text.includes(signal));
}

function inferObjective(text: string, brief: CreativeBrief): CreativeObjective {
  if (includesAny(text, ["retarget", "still thinking", "come back", "reminder"]))
    return "retargeting";
  if (includesAny(text, ["launch", "new product", "introducing", "now available"]))
    return "product-launch";
  if (includesAny(text, ["testimonial", "customer said", "case study", "results", "trusted"]))
    return "trust";
  if (includesAny(text, ["comment", "tell us", "vote", "question", "your take"]))
    return "engagement";
  if (includesAny(text, ["how", "guide", "learn", "steps", "mistake", "explainer"]))
    return "education";
  if (includesAny(text, ["buy", "book", "demo", "trial", "pricing", "offer", "sale", "apply"]))
    return "conversion";
  if (brief.objective === "retention") return "retention";
  return brief.objective === "consideration" ? "education" : "awareness";
}

function chooseFormat(
  objective: CreativeObjective,
  text: string,
  platform?: PlatformId | null,
): CreativeFormat {
  if (includesAny(text, ["before", "after", "transformation"])) return "before-after";
  if (includesAny(text, ["versus", "compare", "difference"])) return "comparison";
  if (includesAny(text, ["quote", "testimonial", "customer said"])) return "quote-testimonial";
  if (includesAny(text, ["founder", "from the founder", "my story"])) return "founder-led";
  if (objective === "product-launch" || objective === "conversion") return "product-focused";
  if (objective === "education") return "educational-visual";
  if (objective === "trust") return "editorial";
  if (objective === "engagement")
    return platform === "twitter" || platform === "threads" ? "meme-style" : "storytelling";
  if (objective === "retargeting") return "problem-solution";
  return objective === "awareness" ? "abstract-metaphorical" : "human-lifestyle";
}

function strategyForObjective(objective: CreativeObjective) {
  switch (objective) {
    case "education":
      return {
        emotion: "clear, capable, reassuring",
        angle: "make one useful idea instantly understandable",
        cta: "soft" as const,
        success: "The audience can explain the takeaway after one glance.",
      };
    case "trust":
      return {
        emotion: "credible, calm, specific",
        angle: "show evidence and provenance rather than generic polish",
        cta: "soft" as const,
        success: "The creative gives a reason to believe.",
      };
    case "conversion":
      return {
        emotion: "desirable, confident, friction-aware",
        angle: "make the value tangible and quietly answer the biggest objection",
        cta: "direct" as const,
        success: "The value and next step are unmistakable without invented claims.",
      };
    case "engagement":
      return {
        emotion: "curious, playful, participatory",
        angle: "create an open loop that invites a response",
        cta: "soft" as const,
        success: "The audience has a natural reason to react or comment.",
      };
    case "product-launch":
      return {
        emotion: "fresh, distinctive, premium",
        angle: "make the new thing the hero and communicate why it is different",
        cta: "direct" as const,
        success: "The product is recognizable and differentiated at thumbnail size.",
      };
    case "retargeting":
      return {
        emotion: "reassuring, resolved, credible",
        angle: "remove hesitation with proof, clarity, or a low-friction next step",
        cta: "direct" as const,
        success: "The strongest objection is answered without pressure.",
      };
    case "retention":
      return {
        emotion: "warm, recognized, community-minded",
        angle: "reward belonging and make the existing customer feel seen",
        cta: "none" as const,
        success: "The creative strengthens the relationship rather than selling again.",
      };
    default:
      return {
        emotion: "arresting, memorable, brand-distinctive",
        angle: "create a pattern break that communicates the promise at a glance",
        cta: "none" as const,
        success: "The image is memorable without depending on dense text.",
      };
  }
}

export function deriveCreativeStrategy(args: {
  body: string;
  brief: CreativeBrief;
  brand?: BrandStrategySignals | null;
  platform?: PlatformId | null;
  size: ImgSize;
  variation?: number;
}): CreativeStrategy {
  const body = args.body.trim();
  const text = body.toLowerCase();
  const objective = inferObjective(text, args.brief);
  const objectivePlan = strategyForObjective(objective);
  const format = chooseFormat(objective, text, args.platform);
  const hook =
    body
      .split(/\n+/)
      .find((line) => line.trim())
      ?.trim()
      .slice(0, 180) || "the brand promise";
  const audience = args.brand?.audience?.trim() || args.brief.audience;
  const product = args.brand?.products?.trim() || "the offer";
  const variation = args.variation ?? 0;
  const concepts = [
    `A ${format} built around ${product}, with one clear focal subject and a ${objectivePlan.emotion} tone.`,
    `A ${format} that turns the audience's tension into a visible scene, with ${objectivePlan.emotion} visual storytelling.`,
    `A ${format} with an unexpected point of view, using brand cues to make the message feel ownable rather than generic.`,
  ];
  const visualConcept = concepts[variation % concepts.length];
  const platformRole = args.platform
    ? `${args.platform}-native: prioritize mobile thumbnail recognition, native pacing, and its crop/safe areas`
    : "social-native: earn attention quickly while preserving the master concept";
  const visualMetaphor =
    objective === "awareness" || objective === "engagement"
      ? "Use one concrete visual metaphor for the promise; avoid decorative abstraction without meaning."
      : undefined;
  const proofOrTrustElement = ["trust", "retargeting", "conversion"].includes(objective)
    ? "Use only supplied proof, product detail, or customer context; never invent metrics or endorsements."
    : undefined;
  const successCriteria = [
    objectivePlan.success,
    "Brand identity is recognizable from palette, tone, and visual grammar without relying on a logo.",
    `The ${format} remains legible in ${args.size} and survives the platform safe area.`,
  ];
  return {
    version: "1",
    objective,
    audience,
    funnel: args.brief.funnel,
    audiencePainOrDesire:
      objective === "retention"
        ? "belonging and recognition"
        : "a relevant problem or desired outcome",
    coreMessage: hook,
    hook,
    emotionalDirection: objectivePlan.emotion,
    creativeAngle: objectivePlan.angle,
    visualConcept,
    visualMetaphor,
    proofOrTrustElement,
    ctaStrategy: objectivePlan.cta,
    platformRole,
    successCriteria,
    format,
    diversityKey: `${format}|${objectivePlan.emotion}|${variation % 3}`,
  };
}

export function strategyPromptLines(strategy: CreativeStrategy): string[] {
  return [
    "CREATIVE STRATEGY — solve the marketing problem before rendering:",
    `• Objective: ${strategy.objective}`,
    `• Audience: ${strategy.audience}`,
    `• Funnel: ${strategy.funnel}`,
    `• Audience pain/desire: ${strategy.audiencePainOrDesire}`,
    `• Core message: ${strategy.coreMessage}`,
    `• Emotional direction: ${strategy.emotionalDirection}`,
    `• Creative angle: ${strategy.creativeAngle}`,
    `• Format: ${strategy.format}`,
    `• Visual concept: ${strategy.visualConcept}`,
    strategy.visualMetaphor && `• Visual metaphor: ${strategy.visualMetaphor}`,
    strategy.proofOrTrustElement && `• Proof/trust: ${strategy.proofOrTrustElement}`,
    `• CTA strategy: ${strategy.ctaStrategy}`,
    `• Platform role: ${strategy.platformRole}`,
    `• Success criteria: ${strategy.successCriteria.join(" | ")}`,
  ].filter((line): line is string => Boolean(line));
}

export function diversitySignature(strategy: CreativeStrategy): string {
  return `${strategy.format}:${strategy.diversityKey}:${strategy.visualConcept}`.toLowerCase();
}

export function hasMeaningfulDiversity(strategies: CreativeStrategy[]): boolean {
  return new Set(strategies.map(diversitySignature)).size === strategies.length;
}
