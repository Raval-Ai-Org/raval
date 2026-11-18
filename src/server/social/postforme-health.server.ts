// postforme-health.server.ts — is Post for Me usable right now?
//
// Post for Me is the first choice for every social network it serves. When it
// says no for a reason a retry can't fix (the key refused, the subscription
// ended, the plan used up), new connections go to the backup connection until
// it answers again. The pause lives in the shared cache so every server agrees;
// a cache outage only means "assume it works".
import "server-only";
import { cache } from "@/server/cache/store";
import { isPostForMeConfigured } from "@/lib/feature-flags";

const KEY = "postforme:circuit";
const PAUSE_SECONDS = 30 * 60;

/** HTTP statuses that mean the account, not the request, is the problem. */
const ACCOUNT_STATUSES = new Set([401, 402, 403]);

function statusOf(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

/** Why Post for Me is paused, or null when it can be used. Never throws. */
export async function postForMeDownReason(): Promise<string | null> {
  if (!isPostForMeConfigured()) return "not_configured";
  try {
    const hit = await cache.get<{ code: string }>(KEY);
    return hit?.code ?? null;
  } catch {
    return null;
  }
}

/** True when Post for Me should take new connections and posts. */
export async function postForMeUsable(): Promise<boolean> {
  return (await postForMeDownReason()) === null;
}

/** Record a failure; only account-level refusals pause it. Never throws. */
export async function notePostForMeFailure(error: unknown): Promise<void> {
  const status = statusOf(error);
  if (status === null || !ACCOUNT_STATUSES.has(status)) return;
  try {
    const already = await cache.get(KEY);
    await cache.set(
      KEY,
      { code: status === 402 ? "plan" : "auth", at: new Date().toISOString() },
      PAUSE_SECONDS,
    );
    if (!already) console.warn(`[postforme] paused ${PAUSE_SECONDS / 60} min after ${status}`);
  } catch {
    /* an optimisation only */
  }
}

/** Lift the pause once Post for Me answers again (a connect or list worked). */
export async function notePostForMeOk(): Promise<void> {
  try {
    await cache.del(KEY);
  } catch {
    /* an optimisation only */
  }
}
