// image-funds.server.ts — is there OpenRouter money to draw a picture right now?
//
// OpenRouter holds each picture's worst-case cost before drawing it, so a low
// account balance refuses every picture with a 402 in about a second (the
// 2026-11-19 failures: $1.21 left, every Studio image refused twice, then
// failed with "not available"). Each of those jobs had already paid for its
// writer step and kept the person waiting ~40 s for nothing.
//
// Two signals, both kept in the shared cache so every server agrees:
//   - a real 402 from the image API pauses new pictures for PAUSE_SECONDS;
//   - the live balance (GET /api/v1/credits, free), read at most once a
//     minute, below IMAGE_MIN_BALANCE_USD.
// Every check fails open: a cache or balance-read failure never blocks a
// picture, it only loses the early warning.
import "server-only";
import { cache } from "@/server/cache/store";
import { log } from "@/server/observability/logger";
import { OPENROUTER_BASE } from "@/lib/ai-gateway.server";

const PAUSE_KEY = "openrouter:image-funds:paused";
const BALANCE_KEY = "openrouter:image-funds:balance";
const PAUSE_SECONDS = 5 * 60;
const BALANCE_SECONDS = 60;
/** Below this, a high-quality picture's hold is refused (seen at $1.21). */
const DEFAULT_MIN_BALANCE_USD = 1.5;

export const PICTURES_PAUSED =
  "Making pictures is paused on our side for a few minutes. Nothing was charged and your brief is saved — please try again shortly.";

function minBalance(): number {
  const raw = Number(process.env.OPENROUTER_IMAGE_MIN_BALANCE_USD);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_MIN_BALANCE_USD;
}

/** Remember a 402 from the image API so the next pictures aren't sent into it. */
export async function markImageFundsOut(): Promise<void> {
  try {
    const already = await cache.get(PAUSE_KEY);
    await cache.set(PAUSE_KEY, { at: new Date().toISOString() }, PAUSE_SECONDS);
    // Drop the cached balance so the next check reads the real one.
    await cache.del(BALANCE_KEY);
    if (!already)
      log.error("openrouter.image.funds_out", {
        message:
          "OpenRouter refused a picture for credits. Top up at openrouter.ai/settings/credits.",
        pausedMinutes: PAUSE_SECONDS / 60,
      });
  } catch {
    /* an optimisation only */
  }
}

/** Tests and a top-up: lift the pause. */
export async function clearImageFundsPause(): Promise<void> {
  await cache.del(PAUSE_KEY).catch(() => {});
  await cache.del(BALANCE_KEY).catch(() => {});
}

async function liveBalance(): Promise<number | null> {
  try {
    const hit = await cache.get<{ usd: number | null }>(BALANCE_KEY);
    if (hit) return hit.usd;
  } catch {
    /* read it live */
  }
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) return null;
  let usd: number | null = null;
  try {
    const res = await fetch(`${OPENROUTER_BASE}/credits`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });
    if (res.ok) {
      const json = (await res.json()) as {
        data?: { total_credits?: number; total_usage?: number };
      };
      const left = Number(json.data?.total_credits) - Number(json.data?.total_usage);
      usd = Number.isFinite(left) ? left : null;
    }
  } catch {
    usd = null;
  }
  await cache.set(BALANCE_KEY, { usd }, BALANCE_SECONDS).catch(() => {});
  return usd;
}

/**
 * True when a new picture would certainly be refused for credits: a 402 in the
 * last few minutes, or a live balance under the floor. Never throws.
 */
export async function imageFundsPaused(): Promise<boolean> {
  try {
    if (await cache.get(PAUSE_KEY)) {
      // A top-up lifts the pause at once instead of after five minutes.
      const usd = await liveBalance();
      if (usd !== null && usd >= minBalance()) {
        await cache.del(PAUSE_KEY).catch(() => {});
        return false;
      }
      return true;
    }
    const usd = await liveBalance();
    if (usd !== null && usd < minBalance()) {
      log.warn("openrouter.image.funds_low", { balanceUsd: Math.round(usd * 100) / 100 });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
