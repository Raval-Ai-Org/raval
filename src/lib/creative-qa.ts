import type { CreativeStrategy } from "./creative-strategy";
import type { ImgSize } from "./post-image";

export type CreativeQaCode =
  | "WEAK_HOOK"
  | "POOR_COMPOSITION"
  | "BRAND_MISMATCH"
  | "TEXT_UNREADABLE"
  | "GENERIC_CONCEPT"
  | "WRONG_AUDIENCE"
  | "WRONG_FUNNEL"
  | "PLATFORM_CROP"
  | "LOW_PRODUCT_FOCUS";

export type CreativeQaResult = {
  passed: boolean;
  scores: {
    marketingEffectiveness: number;
    brandConsistency: number;
    visualQuality: number;
    composition: number;
    messageClarity: number;
    platformSuitability: number;
    textReadability: number;
    originality: number;
    technicalCorrectness: number;
  };
  issues: Array<{ code: CreativeQaCode; severity: "warning" | "error"; reason: string }>;
  attempt: number;
};

export function evaluateCreativePreflight(args: {
  strategy: CreativeStrategy;
  prompt: string;
  size: ImgSize;
  brandPresent: boolean;
  attempt: number;
}): CreativeQaResult {
  const { strategy, prompt } = args;
  const issues: CreativeQaResult["issues"] = [];
  const lower = prompt.toLowerCase();
  if (strategy.hook.length < 8)
    issues.push({
      code: "WEAK_HOOK",
      severity: "warning",
      reason: "The strategy has too little message signal to anchor a distinct concept.",
    });
  if (!args.brandPresent)
    issues.push({
      code: "BRAND_MISMATCH",
      severity: "warning",
      reason: "No Brand DNA was available; use restrained defaults and require approval.",
    });
  if (
    strategy.format === "product-focused" &&
    !lower.includes("product") &&
    !lower.includes("offer")
  )
    issues.push({
      code: "LOW_PRODUCT_FOCUS",
      severity: "error",
      reason: "A product-led strategy is missing an explicit product or offer anchor.",
    });
  if (args.size === "1024x1792" && !lower.includes("safe zone") && !lower.includes("ui chrome"))
    issues.push({
      code: "PLATFORM_CROP",
      severity: "error",
      reason: "Portrait output lacks explicit platform chrome and crop-safe guidance.",
    });
  if (strategy.format === "abstract-metaphorical" && !strategy.visualMetaphor)
    issues.push({
      code: "GENERIC_CONCEPT",
      severity: "warning",
      reason: "Abstract treatment has no defined metaphor tied to the message.",
    });
  if (lower.includes("text") && !lower.includes("short") && !lower.includes("deterministic"))
    issues.push({
      code: "TEXT_UNREADABLE",
      severity: "warning",
      reason: "Text instructions do not constrain amount or preserve exact copy deterministically.",
    });
  const base = issues.some((issue) => issue.severity === "error") ? 62 : issues.length ? 78 : 92;
  const scores = {
    marketingEffectiveness: Math.max(
      0,
      base - (strategy.ctaStrategy === "direct" && strategy.objective === "retention" ? 12 : 0),
    ),
    brandConsistency: args.brandPresent ? 90 : 68,
    visualQuality: 84,
    composition: issues.some((issue) => issue.code === "PLATFORM_CROP") ? 58 : 86,
    messageClarity: strategy.coreMessage.length >= 8 ? 88 : 58,
    platformSuitability: issues.some((issue) => issue.code === "PLATFORM_CROP") ? 55 : 86,
    textReadability: issues.some((issue) => issue.code === "TEXT_UNREADABLE") ? 52 : 90,
    originality: strategy.format === "abstract-metaphorical" ? 90 : 80,
    technicalCorrectness: issues.some((issue) => issue.severity === "error") ? 58 : 92,
  };
  return {
    passed: !issues.some((issue) => issue.severity === "error"),
    scores,
    issues,
    attempt: args.attempt,
  };
}

export function refinementInstructions(qa: CreativeQaResult): string[] {
  return qa.issues.map((issue) => {
    switch (issue.code) {
      case "POOR_COMPOSITION":
      case "PLATFORM_CROP":
        return "REFINE COMPOSITION: pull the focal subject inward, increase negative space, and obey every platform safe-area instruction.";
      case "BRAND_MISMATCH":
        return "REFINE BRAND: prioritize mandatory Brand DNA colors, identity rules, and supplied assets over inferred aesthetics.";
      case "GENERIC_CONCEPT":
        return "REFINE CONCEPT: replace the generic treatment with a concrete, ownable metaphor tied to the core message.";
      case "LOW_PRODUCT_FOCUS":
        return "REFINE PRODUCT FOCUS: make the supplied product or offer the unmistakable hero without inventing claims.";
      case "TEXT_UNREADABLE":
        return "REFINE TEXT: remove generated copy; reserve exact headlines, URLs, prices, CTAs, and legal text for deterministic composition.";
      default:
        return `REFINE ${issue.code}: ${issue.reason}`;
    }
  });
}
