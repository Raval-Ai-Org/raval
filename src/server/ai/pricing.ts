// pricing.ts — estimated provider cost per call, in USD.
//
// Order of authority when metering a call:
//   1. a cost the provider returns itself (OpenRouter `usage.cost`) — exact,
//      always preferred;
//   2. this table × the provider-reported token usage;
//   3. a flat per-unit estimate (images/videos without a reported cost).
// Every figure can be overridden with an env var, so a price change is a
// config change, not a deploy: AI_PRICE_<MODEL_KEY>_IN / _OUT (USD per 1M
// tokens) or AI_PRICE_<KEY>_UNIT (USD per unit), where MODEL_KEY is the model
// id upper-cased with non-alphanumerics replaced by "_".
import "server-only";

type TokenPrice = { inPerM: number; outPerM: number };

// USD per 1M tokens: OpenRouter list prices confirmed from /api/v1/models on
// 2026-09-25. OpenRouter's own usage.cost is always preferred over these.
const TOKEN_PRICES: Record<string, TokenPrice> = {
  "anthropic/claude-opus-5.5": { inPerM: 4, outPerM: 20 },
  "google/gemini-3.8-flash": { inPerM: 0.75, outPerM: 3.75 },
  "google/gemini-3.1-flash-lite": { inPerM: 0.25, outPerM: 1.5 },
  "openai/gpt-5.6-terra": { inPerM: 2, outPerM: 12 },
  "openai/gpt-5.6-luna": { inPerM: 0.2, outPerM: 1.2 },
  "perplexity/sonar": { inPerM: 1, outPerM: 1 },
};

// Conservative fallback for an unknown text model: better to over-count spend
// against a budget than to let an unpriced model run free.
const UNKNOWN_TEXT_PRICE: TokenPrice = { inPerM: 5, outPerM: 25 };

// USD per generated unit (estimates; provider invoices are authoritative).
// Images and OpenRouter videos meter from the provider's usage.cost; these are
// only the fallback when a response carries none.
const UNIT_PRICES: Record<string, number> = {
  "openrouter:image": 0.04,
  "openrouter:image:premium": 0.08,
  "openrouter:video": 1.5,
  // Tavily bills per API credit: 1 for a basic search, 2 for an advanced one,
  // and 1 per 5 extracted URLs. These are the per-credit list rates converted
  // to per-call, so a plan change is AI_PRICE_TAVILY_SEARCH_UNIT, not a deploy.
  "tavily:search": 0.008,
  "tavily:search:advanced": 0.016,
  "tavily:extract": 0.0016,
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
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  },
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
