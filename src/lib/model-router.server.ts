// model-router.server.ts — picks the OpenRouter image model for a request.
// Recraft V4.1 (on test, 2026-11-19, $0.035 a picture) makes plain
// text-to-image pictures. It takes no quality, background or several
// references, so anything with a reference photo (carousel slides 2+, product
// photos, revisions) or a transparent design layer goes to GPT Image 2.5
// Flare, which is also Recraft's fallback. Rollback: IMAGE_MODEL_DEFAULT=
// openai/gpt-image-2.5-flare. Sunburst (about twice the
// price) is used only when a caller asks for "maximum" quality, or "high"
// quality with strict brand precision: today only the product cutout, where
// the real product's edges must survive (Mellox Lean). Prompt length and
// wording never upgrade a request: Studio prompts are long by design, and
// scoring them sent every wallet-paid picture to Sunburst. Scoring keeps
// benchmark results and failure history, and each tier falls back to the other.
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
  /** A design layer laid over real photos: needs a transparent background. */
  transparent?: boolean;
};

export type ImageModelPlan = {
  model: string;
  fallbacks: string[];
  reason: string;
  route: "recraft" | "flare" | "sunburst" | "flare-edit" | "sunburst-edit";
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
export const IMAGE_RECRAFT = "recraft/recraft-v4.1";

/** Recraft models take only prompt, aspect_ratio and n on the Images API. */
export function isRecraftModel(model: string): boolean {
  return /^recraft\//i.test(model);
}

const configured = (name: string, fallback: string) => process.env[name]?.trim() || fallback;

// Env: IMAGE_MODEL_DEFAULT (social images, quick edits), IMAGE_MODEL_PREMIUM
// (cinematic, text-heavy, brand-critical), IMAGE_MODEL_EDIT and
// IMAGE_MODEL_PREMIUM_EDIT. Each tier falls back to the other.
function catalog(): ModelCatalog {
  const defaultText = configured("IMAGE_MODEL_DEFAULT", IMAGE_RECRAFT);
  const premiumText = configured("IMAGE_MODEL_PREMIUM", IMAGE_SUNBURST);
  // Edits never default to the text model: Recraft takes no reference set.
  const defaultEdit = configured("IMAGE_MODEL_EDIT", IMAGE_FLARE);
  const premiumEdit = configured("IMAGE_MODEL_PREMIUM_EDIT", premiumText);
  return {
    defaultText,
    premiumText,
    fastText: defaultText,
    defaultEdit,
    premiumEdit,
    fallbackText: [defaultText, defaultEdit, premiumText],
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

/** The everyday tier only, even as a fallback (creation-point jobs). */
export function routeStandardImageModel(input: ImageRoutingInput): ImageModelPlan {
  const models = catalog();
  return routeImageModel({ ...input, availableModels: [models.defaultText, models.defaultEdit] });
}

/** Whether a request may use the premium model. Exported for tests. */
export function wantsPremiumImage(
  input: Pick<ImageRoutingInput, "requiredQuality" | "brandPrecision">,
): boolean {
  return (
    input.requiredQuality === "maximum" ||
    (input.requiredQuality === "high" && input.brandPrecision === "strict")
  );
}

export function routeImageModel(input: ImageRoutingInput): ImageModelPlan {
  const models = catalog();
  const reference = Boolean(
    input.hasReference ||
    input.referenceAssets?.length ||
    input.editing ||
    input.taskType === "reference" ||
    input.taskType === "editing" ||
    // Recraft can't draw a transparent layer: the edit tier (Flare) does.
    input.transparent,
  );
  const maximum = wantsPremiumImage(input);
  const fast =
    input.latency === "fast" || input.iteration === "variation" || input.taskType === "variation";
  let model: string;
  let reason: string;
  let route: ImageModelPlan["route"];

  if (reference && maximum) {
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
    // Premium falls back to Flare before Recraft: the closer match in quality.
    ...(reference
      ? models.fallbackEdit
      : maximum
        ? [models.defaultEdit, models.defaultText]
        : models.fallbackText),
    ...(reference ? [] : [maximum ? models.premiumText : models.fastText]),
  ]
    .filter((candidate, index, all) => candidate && all.indexOf(candidate) === index)
    // A reference or transparent job never lands on Recraft, even as a fallback.
    .filter((candidate) => !reference || !isRecraftModel(candidate));
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
        : isRecraftModel(selected)
          ? "recraft"
          : selected === models.defaultText || selected === models.defaultEdit
            ? "flare"
            : route,
  };
}
