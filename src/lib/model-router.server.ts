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

const configured = (name: string, fallback: string) => process.env[name]?.trim() || fallback;

function configuredList(name: string, fallback: string[]): string[] {
  const value = process.env[name]?.trim();
  return value
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : fallback;
}

function catalog(): ModelCatalog {
  const defaultText = configured("KIE_IMAGE_MODEL_DEFAULT", "gpt-image-2-5-flare-text-to-image");
  const premiumText = configured("KIE_IMAGE_MODEL_PREMIUM", "gpt-image-2-5-sunburst-text-to-image");
  const fastText = configured("KIE_IMAGE_MODEL_FAST", defaultText);
  const defaultEdit = configured("KIE_IMAGE_MODEL_EDIT", "gpt-image-2-5-flare-image-to-image");
  const premiumEdit = configured(
    "KIE_IMAGE_MODEL_PREMIUM_EDIT",
    "gpt-image-2-5-sunburst-image-to-image",
  );
  return {
    defaultText,
    premiumText,
    fastText,
    defaultEdit,
    premiumEdit,
    fallbackText: configuredList("KIE_IMAGE_MODEL_FALLBACKS", [defaultText, premiumText]),
    fallbackEdit: configuredList("KIE_IMAGE_MODEL_EDIT_FALLBACKS", [defaultEdit, premiumEdit]),
  };
}

export function getImageModelConfigStatus(): ImageModelConfigStatus {
  const models = catalog();
  const configuredModels = [
    models.defaultText,
    models.premiumText,
    models.fastText,
    models.defaultEdit,
    models.premiumEdit,
    ...models.fallbackText,
    ...models.fallbackEdit,
  ].filter(Boolean);
  return {
    defaultConfigured: Boolean(process.env.KIE_IMAGE_MODEL_DEFAULT?.trim()),
    premiumConfigured: Boolean(process.env.KIE_IMAGE_MODEL_PREMIUM?.trim()),
    editConfigured: Boolean(process.env.KIE_IMAGE_MODEL_EDIT?.trim()),
    premiumEditConfigured: Boolean(process.env.KIE_IMAGE_MODEL_PREMIUM_EDIT?.trim()),
    fallbackConfigured: Boolean(
      process.env.KIE_IMAGE_MODEL_FALLBACKS?.trim() ||
      process.env.KIE_IMAGE_MODEL_EDIT_FALLBACKS?.trim(),
    ),
    configuredModels: [...new Set(configuredModels)],
  };
}

function complexity(prompt: string): number {
  const text = prompt.toLowerCase();
  let score = Math.min(4, Math.floor(prompt.length / 900));
  for (const signal of [
    "campaign",
    "product launch",
    "multiple subjects",
    "detailed",
    "cinematic",
    "editorial",
    "premium",
    "complex composition",
  ]) {
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
  const maximum = input.requiredQuality === "maximum" || score >= 4;
  const fast =
    input.latency === "fast" || input.iteration === "variation" || input.taskType === "variation";
  let model: string;
  let reason: string;
  let route: ImageModelPlan["route"];

  if (reference && maximum) {
    model = models.premiumEdit;
    route = "sunburst-edit";
    reason = "reference-preserving, high-complexity edit";
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
    route:
      selected === models.premiumEdit
        ? "sunburst-edit"
        : selected === models.defaultEdit
          ? "flare-edit"
          : selected === models.premiumText
            ? "sunburst"
            : route,
  };
}
