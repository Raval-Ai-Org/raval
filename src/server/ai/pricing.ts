// pricing.ts — estimated provider cost per call, in USD.
//
// Order of authority when metering a call:
//   1. a cost the provider returns itself (OpenRouter `usage.cost`,
//      DataForSEO `cost`) — exact, always preferred;
//   2. this table × the provider-reported token usage;
//   3. a flat per-unit estimate (KIE images/videos).
// Every figure can be overridden with an env var, so a price change is a
// config change, not a deploy: AI_PRICE_<MODEL_KEY>_IN / _OUT (USD per 1M
// tokens) or AI_PRICE_<KEY>_UNIT (USD per unit), where MODEL_KEY is the model
// id upper-cased with non-alphanumerics replaced by "_".
import "server-only";

type TokenPrice = { inPerM: number; outPerM: number };

// USD per 1M tokens. Anthropic: first-party API list prices. OpenRouter:
// list prices at time of writing — OpenRouter's own usage.cost overrides these.
const TOKEN_PRICES: Record<string, TokenPrice> = {
  "claude-opus-5": { inPerM: 5, outPerM: 25 },
  "claude-sonnet-5": { inPerM: 2, outPerM: 10 },
  "claude-haiku-4-5": { inPerM: 1, outPerM: 5 },
  "qwen/qwen3-max": { inPerM: 1.2, outPerM: 6 },
  "google/gemini-2.5-pro": { inPerM: 1.25, outPerM: 10 },
  "google/gemini-2.5-flash": { inPerM: 0.3, outPerM: 2.5 },
  "google/gemini-2.5-flash-lite": { inPerM: 0.1, outPerM: 0.4 },
};

// Conservative fallback for an unknown text model: better to over-count spend
// against a budget than to let an unpriced model run free.
const UNKNOWN_TEXT_PRICE: TokenPrice = { inPerM: 5, outPerM: 25 };

// USD per generated unit (estimates; provider invoices are authoritative).
const UNIT_PRICES: Record<string, number> = {
  "kie:image": 0.04,
  "kie:image:premium": 0.08,
  "kie:video": 1.5,
  "dataforseo:task": 0.002,
};

function envKey(id: string): string {
  return id.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

function envNumber(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export function tokenPrice(model: string): TokenPrice {
  const base = TOKEN_PRICES[model] ?? UNKNOWN_TEXT_PRICE;
  const key = envKey(model);
  return {
    inPerM: envNumber(`AI_PRICE_${key}_IN`) ?? base.inPerM,
    outPerM: envNumber(`AI_PRICE_${key}_OUT`) ?? base.outPerM,
  };
}

/** Estimated USD for a text call from token usage. Cache reads bill at ~0.1×. */
export function estimateTextCost(
  model: string,
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number },
): number {
  const p = tokenPrice(model);
  const cachedRead = usage.cacheReadTokens ?? 0;
  const cachedWrite = usage.cacheWriteTokens ?? 0;
  const cost =
    (usage.inputTokens * p.inPerM +
      cachedRead * p.inPerM * 0.1 +
      cachedWrite * p.inPerM * 1.25 +
      usage.outputTokens * p.outPerM) /
    1_000_000;
  return round6(cost);
}

export function unitPrice(key: keyof typeof UNIT_PRICES | string): number {
  return envNumber(`AI_PRICE_${envKey(key)}_UNIT`) ?? UNIT_PRICES[key] ?? 0;
}

export function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

/** Characters → tokens, for providers that report no usage (≈4 chars/token). */
export function approxTokens(chars: number): number {
  return Math.ceil(chars / 4);
}
