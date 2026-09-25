// model-router.server.ts — picks the OpenRouter image model for a request:
// GPT Image 2.5 Flare for everyday social images and quick edits, Sunburst for
// premium, cinematic, text-heavy or brand-critical images and precise edits.
// Scoring keeps benchmark results and failure history, and each tier falls
// back to the other.
import "server-only";
export type ImageRoutingInput = {
  prompt: string;
  taskType?: "generation" | "editing" | "variation" | "reference";
  hasReference?: boolean;
  referenceAssets?: string[];
  editing?: boolean;
  brandPrecision?: "normal" | "strict";
  requiredQuality?: "standard" | "high" | "maximum";
  iteration?: "first" | "refinement" | "variation";
  latency?: "normal" | "fast";
  availableModels?: string[];
  failureHistory?: Record<string, number>;
  benchmarkScores?: Record<string, number>;
  cachedModels?: string[];
};

export type ImageModelPlan = {
  model: string;
  fallbacks: string[];
  reason: string;
  route: "flare" | "sunburst" | "flare-edit" | "sunburst-edit";
};

type ModelCatalog = {
  defaultText: string;
  premiumText: string;
  fastText: string;
  defaultEdit: string;
  premiumEdit: string;
  fallbackText: string[];
  fallbackEdit: string[];
};

export type ImageModelConfigStatus = {
  defaultConfigured: boolean;
  premiumConfigured: boolean;
  editConfigured: boolean;
  premiumEditConfigured: boolean;
  fallbackConfigured: boolean;
  configuredModels: string[];
};

// OpenRouter image models (Images API, POST /api/v1/images). Both generate and
// edit (with reference images), so the edit routes default to the same ids.
export const IMAGE_FLARE = "openai/gpt-image-2.5-flare";
export const IMAGE_SUNBURST = "openai/gpt-image-2.5-sunburst";

const configured = (name: string, fallback: string) => process.env[name]?.trim() || fallback;

// Env: IMAGE_MODEL_DEFAULT (social images, quick edits), IMAGE_MODEL_PREMIUM
// (cinematic, text-heavy, brand-critical), IMAGE_MODEL_EDIT and
// IMAGE_MODEL_PREMIUM_EDIT. Each tier falls back to the other.
function catalog(): ModelCatalog {
  const defaultText = configured("IMAGE_MODEL_DEFAULT", IMAGE_FLARE);
  const premiumText = configured("IMAGE_MODEL_PREMIUM", IMAGE_SUNBURST);
  const defaultEdit = configured("IMAGE_MODEL_EDIT", defaultText);
  const premiumEdit = configured("IMAGE_MODEL_PREMIUM_EDIT", premiumText);
  return {
    defaultText,
    premiumText,
    fastText: defaultText,
    defaultEdit,
    premiumEdit,
    fallbackText: [defaultText, premiumText],
    fallbackEdit: [defaultEdit, premiumEdit],
  };
}

export function getImageModelConfigStatus(): ImageModelConfigStatus {
  const models = catalog();
  const configuredModels = [
    models.defaultText,
    models.premiumText,
    models.defaultEdit,
    models.premiumEdit,
  ].filter(Boolean);
  return {
    defaultConfigured: Boolean(process.env.IMAGE_MODEL_DEFAULT?.trim()),
    premiumConfigured: Boolean(process.env.IMAGE_MODEL_PREMIUM?.trim()),
    editConfigured: Boolean(process.env.IMAGE_MODEL_EDIT?.trim()),
    premiumEditConfigured: Boolean(process.env.IMAGE_MODEL_PREMIUM_EDIT?.trim()),
    fallbackConfigured: true,
    configuredModels: [...new Set(configuredModels)],
  };
}

/** Prompt signals that the image must be premium (cinematic, text-heavy, brand-critical). */
const PREMIUM_SIGNALS = [
  "campaign",
  "product launch",
  "multiple subjects",
  "detailed",
  "cinematic",
  "editorial",
  "premium",
  "complex composition",
  "text-heavy",
  "headline",
  "infographic",
  "typography",
];

function complexity(prompt: string): number {
  const text = prompt.toLowerCase();
  let score = Math.min(4, Math.floor(prompt.length / 900));
  for (const signal of PREMIUM_SIGNALS) {
    if (text.includes(signal)) score += 1;
  }
  return score;
}

export function routeImageModel(input: ImageRoutingInput): ImageModelPlan {
  const models = catalog();
  const score = complexity(input.prompt);
  const reference = Boolean(
    input.hasReference ||
    input.referenceAssets?.length ||
    input.editing ||
    input.taskType === "reference" ||
    input.taskType === "editing",
  );
  const maximum =
    input.requiredQuality === "maximum" ||
    (input.requiredQuality === "high" && input.brandPrecision === "strict") ||
    score >= 4;
  const fast =
    input.latency === "fast" || input.iteration === "variation" || input.taskType === "variation";
  let model: string;
  let reason: string;
  let route: ImageModelPlan["route"];

  if (reference && (maximum || input.brandPrecision === "strict")) {
    model = models.premiumEdit;
    route = "sunburst-edit";
    reason = "precise or high-complexity reference edit";
  } else if (reference && fast) {
    model = models.defaultEdit;
    route = "flare-edit";
    reason = "fast reference edit or variation";
  } else if (reference) {
    model = models.defaultEdit;
    route = "flare-edit";
    reason = "reference or subject-consistency task";
  } else if (maximum) {
    model = models.premiumText;
    route = "sunburst";
    reason = "high-stakes or complex composition";
  } else {
    model = models.fastText;
    route = "flare";
    reason = "default social generation";
  }

  const candidates = [
    model,
    ...(reference ? models.fallbackEdit : models.fallbackText),
    input.brandPrecision === "strict" ? models.premiumText : models.fastText,
  ].filter((candidate, index, all) => candidate && all.indexOf(candidate) === index);
  const available = input.availableModels?.length ? new Set(input.availableModels) : null;
  const usable = candidates.filter((candidate) => !available || available.has(candidate));
  const failureHistory = input.failureHistory ?? {};
  const benchmarkScores = input.benchmarkScores ?? {};
  usable.sort((left, right) => {
    const leftScore = (benchmarkScores[left] ?? 0) - (failureHistory[left] ?? 0) * 15;
    const rightScore = (benchmarkScores[right] ?? 0) - (failureHistory[right] ?? 0) * 15;
    return rightScore - leftScore;
  });
  if (input.cachedModels?.some((candidate) => candidate === model))
    reason += "; cache-compatible route";
  if (input.brandPrecision === "strict") reason += "; strict brand precision";
  const selected = usable[0] ?? model;
  const fallbacks = usable
    .filter((candidate) => candidate !== selected)
    .filter((candidate, index, all) => candidate !== selected && all.indexOf(candidate) === index);
  return {
    model: selected,
    fallbacks,
    reason,
    route: reference
      ? selected === models.premiumEdit
        ? "sunburst-edit"
        : "flare-edit"
      : selected === models.premiumText
        ? "sunburst"
        : selected === models.defaultText
          ? "flare"
          : route,
  };
}
