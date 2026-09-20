// Runtime configuration of the UGC model registry: which models are enabled,
// what a render costs, and how much plan allowance it uses. Every number is an
// env override on top of src/lib/ugc/models.ts, so pricing and availability
// change without a deploy:
//
//   UGC_MODEL_<KEY>_ENABLED=false            hide a model (KEY: VEO_3_1_FAST, …)
//   UGC_PRICE_<KEY>_<RES>_CREDITS=65         Kie credits per video/second at a resolution
//   UGC_VIDEO_UNITS_<KEY>=2                  monthly video quota units per render
//   KIE_USD_PER_CREDIT=0.005                 Kie credit → USD
//   UGC_DEFAULT_MODEL=seedance-2
//   UGC_MAX_CONCURRENT_RENDERS=3             live renders per workspace
//   KIE_UGC_MODEL_KLING_3=kling-3.0/video    server-side KIE id override
import "server-only";
import {
  DEFAULT_UGC_MODEL,
  durationsFor,
  isUgcModelKey,
  renderCredits,
  UGC_MODELS,
  UGC_MODEL_KEYS,
  type UgcModel,
  type UgcModelKey,
  type UgcResolution,
} from "@/lib/ugc/models";
import type { ModelView } from "@/lib/ugc/schemas";

const envKey = (id: string) => id.toUpperCase().replace(/[^A-Z0-9]+/g, "_");

function envNumber(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function envBool(name: string): boolean | undefined {
  const raw = (process.env[name] ?? "").trim().toLowerCase();
  if (["true", "1", "yes"].includes(raw)) return true;
  if (["false", "0", "no"].includes(raw)) return false;
  return undefined;
}

export function kieUsdPerCredit(): number {
  return envNumber("KIE_USD_PER_CREDIT") ?? 0.005;
}

/** Provider ids stay configurable without exposing them to the browser. */
export function providerModelId(model: UgcModel): string {
  return process.env[`KIE_UGC_MODEL_${envKey(model.key)}`]?.trim() || model.providerModel;
}

export function maxConcurrentRenders(): number {
  return Math.max(1, Math.round(envNumber("UGC_MAX_CONCURRENT_RENDERS") ?? 3));
}

export function isModelEnabled(key: UgcModelKey): boolean {
  return envBool(`UGC_MODEL_${envKey(key)}_ENABLED`) ?? UGC_MODELS[key].enabledByDefault;
}

export function enabledModels(): UgcModel[] {
  return UGC_MODEL_KEYS.filter(isModelEnabled).map((k) => UGC_MODELS[k]);
}

export function defaultModelKey(): UgcModelKey {
  const configured = process.env.UGC_DEFAULT_MODEL?.trim();
  if (isUgcModelKey(configured) && isModelEnabled(configured)) return configured;
  if (isModelEnabled(DEFAULT_UGC_MODEL)) return DEFAULT_UGC_MODEL;
  return enabledModels()[0]?.key ?? DEFAULT_UGC_MODEL;
}

/** The registry price table with env overrides applied. */
export function effectivePricing(model: UgcModel): UgcModel["pricing"] {
  const credits: Partial<Record<UgcResolution, number>> = {};
  for (const res of model.resolutions) {
    const override = envNumber(`UGC_PRICE_${envKey(model.key)}_${envKey(res)}_CREDITS`);
    const base = model.pricing.credits[res];
    const value = override ?? base;
    if (value != null) credits[res] = value;
  }
  return { unit: model.pricing.unit, credits };
}

export function videoUnits(model: UgcModel): number {
  return Math.max(1, Math.round(envNumber(`UGC_VIDEO_UNITS_${envKey(model.key)}`) ?? 1));
}

export type RenderEstimate = { credits: number; usd: number; units: number };

/** Server-authoritative cost of a render. Throws when the resolution has no price. */
export function estimateRender(
  model: UgcModel,
  resolution: UgcResolution,
  durationSec: number,
): RenderEstimate {
  const credits = renderCredits(effectivePricing(model), resolution, durationSec);
  if (credits == null) throw new Error(`No price configured for ${model.key} at ${resolution}`);
  return {
    credits,
    usd: Math.round(credits * kieUsdPerCredit() * 1_000_000) / 1_000_000,
    units: videoUnits(model),
  };
}

export function toModelView(model: UgcModel): ModelView {
  const pricing = effectivePricing(model);
  const usd: Record<string, number> = {};
  for (const [res, credits] of Object.entries(pricing.credits)) {
    usd[res] = Math.round((credits ?? 0) * kieUsdPerCredit() * 10_000) / 10_000;
  }
  return {
    key: model.key,
    displayName: model.displayName,
    tier: model.tier,
    description: model.description,
    durations: model.durations,
    imageDurations: model.images ? durationsFor(model, true) : null,
    aspectRatios: model.aspectRatios,
    resolutions: model.resolutions,
    defaultResolution: model.defaultResolution,
    nativeAudio: model.nativeAudio,
    images: model.images ? { mode: model.images.mode, max: model.images.max } : null,
    pricing: { unit: pricing.unit, usd },
    videoUnits: videoUnits(model),
  };
}
