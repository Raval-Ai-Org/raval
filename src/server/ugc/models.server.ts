// Runtime configuration of the video model registry: which provider runs
// renders, which models are enabled, what a render costs, and how much plan
// allowance it uses. Every number is an env override on top of
// src/lib/ugc/models.ts, so pricing and availability change without a deploy:
//
//   VIDEO_PROVIDER=kie|openrouter            primary provider (default kie)
//   VIDEO_PROVIDER_FALLBACK=openrouter|none  used when KIE definitively refuses
//   UGC_MODEL_<KEY>_ENABLED=false            hide a model (KEY: STANDARD, DRAFT, …)
//   UGC_PRICE_<KEY>_<RES>_USD=0.12           OpenRouter USD per video/second at a resolution
//   UGC_PRICE_<KEY>_<RES>_CREDITS=65         Kie credits per video/second (DEPRECATED with KIE)
//   UGC_VIDEO_UNITS_<KEY>=2                  monthly video quota units per render
//   KIE_USD_PER_CREDIT=0.005                 Kie credit → USD (DEPRECATED with KIE)
//   UGC_DEFAULT_MODEL=standard
//   UGC_MAX_CONCURRENT_RENDERS=3             live renders per workspace
import "server-only";
import {
  DEFAULT_UGC_MODEL,
  durationsFor,
  isUgcModelKey,
  renderPrice,
  resolveUgcModel,
  specFor,
  UGC_MODEL_KEYS,
  type AnyUgcModelKey,
  type UgcModel,
  type UgcModelKey,
  type UgcPricing,
  type UgcResolution,
  type VideoProviderId,
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

/** The provider that runs new renders. */
export function videoProvider(): VideoProviderId {
  return (process.env.VIDEO_PROVIDER ?? "").trim().toLowerCase() === "openrouter"
    ? "openrouter"
    : "kie";
}

/** Where a render goes when the primary refuses it outright (null: nowhere). */
export function videoFallbackProvider(): VideoProviderId | null {
  const raw = (process.env.VIDEO_PROVIDER_FALLBACK ?? "openrouter").trim().toLowerCase();
  if (["", "none", "off", "false"].includes(raw)) return null;
  const fallback: VideoProviderId = raw === "kie" ? "kie" : "openrouter";
  return fallback === videoProvider() ? null : fallback;
}

export function kieUsdPerCredit(): number {
  return envNumber("KIE_USD_PER_CREDIT") ?? 0.005;
}

/** The model as the configured primary provider runs it (falls back to any provider it has). */
export function activeModel(key: AnyUgcModelKey, provider = videoProvider()): UgcModel {
  const model = resolveUgcModel(key, provider);
  return specFor(model, provider) ?? model;
}

export function maxConcurrentRenders(): number {
  return Math.max(1, Math.round(envNumber("UGC_MAX_CONCURRENT_RENDERS") ?? 3));
}

export function isModelEnabled(key: UgcModelKey): boolean {
  return envBool(`UGC_MODEL_${envKey(key)}_ENABLED`) ?? resolveUgcModel(key).enabledByDefault;
}

/** Models offered for new renders, viewed for the primary provider. */
export function enabledModels(): UgcModel[] {
  return UGC_MODEL_KEYS.filter(isModelEnabled).map((k) => activeModel(k));
}

export function defaultModelKey(): UgcModelKey {
  const configured = process.env.UGC_DEFAULT_MODEL?.trim();
  if (isUgcModelKey(configured) && isModelEnabled(configured)) return configured;
  if (isModelEnabled(DEFAULT_UGC_MODEL)) return DEFAULT_UGC_MODEL;
  return (enabledModels()[0]?.key as UgcModelKey | undefined) ?? DEFAULT_UGC_MODEL;
}

/** The price table with env overrides applied, in the table's own currency. */
export function effectivePricing(model: UgcModel): UgcPricing {
  const amounts: Partial<Record<UgcResolution, number>> = {};
  const suffix = model.pricing.currency === "credits" ? "CREDITS" : "USD";
  for (const res of model.resolutions) {
    const override = envNumber(`UGC_PRICE_${envKey(String(model.key))}_${envKey(res)}_${suffix}`);
    const value = override ?? model.pricing.amounts[res];
    if (value != null) amounts[res] = value;
  }
  return { ...model.pricing, amounts } as UgcPricing;
}

function toUsd(pricing: UgcPricing, amount: number): number {
  const usd = pricing.currency === "credits" ? amount * kieUsdPerCredit() : amount;
  return Math.round(usd * 1_000_000) / 1_000_000;
}

export function videoUnits(model: UgcModel): number {
  return Math.max(1, Math.round(envNumber(`UGC_VIDEO_UNITS_${envKey(String(model.key))}`) ?? 1));
}

export type RenderEstimate = { credits: number | null; usd: number; units: number };

/** Server-authoritative cost of a render. Throws when the resolution has no price. */
export function estimateRender(
  model: UgcModel,
  resolution: UgcResolution,
  durationSec: number,
): RenderEstimate {
  const pricing = effectivePricing(model);
  const amount = renderPrice(pricing, resolution, durationSec);
  if (amount == null) throw new Error(`No price configured for ${model.key} at ${resolution}`);
  return {
    credits: pricing.currency === "credits" ? amount : null,
    usd: toUsd(pricing, amount),
    units: videoUnits(model),
  };
}

export function toModelView(model: UgcModel): ModelView {
  const pricing = effectivePricing(model);
  const usd: Record<string, number> = {};
  for (const [res, amount] of Object.entries(pricing.amounts)) {
    usd[res] = Math.round(toUsd(pricing, amount ?? 0) * 10_000) / 10_000;
  }
  return {
    key: String(model.key),
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
