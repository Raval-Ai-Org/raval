// gate.ts — whether a background job may spend for a workspace, and how often
// (pure, Mellox Lean).
//
// Background work (Market Brain, competitor sweeps, community refresh) used
// to run for every workspace on a fixed rhythm, forever: daily Market Brain
// although the plan sells it weekly, competitor sweeps on every plan, and
// nothing ever stopped for a frozen, paused or abandoned account. One rule
// now decides, from the account's plan and a real person's last activity:
//   - frozen or paused accounts, and plans that don't include the work, get
//     nothing; the job looks again in a week;
//   - a workspace nobody has used for INACTIVE_DAYS gets nothing until a
//     person comes back (a cron job's own calls never count as activity);
//   - otherwise the work runs as often as the plan sells it.
// A failed read of the account is never a reason to spend: the job waits.

export const DAY_MS = 24 * 60 * 60 * 1000;
/** A workspace with no person's activity for this long is left alone. */
export const INACTIVE_DAYS = 14;
/** How long a skipped job waits before it looks again. */
export const SKIP_RETRY_MS = 7 * DAY_MS;

export type BackgroundAccount = {
  plan: string;
  frozen: boolean;
  paused: boolean;
  limits: {
    marketBrainWeeklyBrands: number;
    competitorSweepsPerWeek: number;
    /** How many competitors the plan tracks. */
    competitors: number;
  };
  /** The latest thing a person (not a cron job) did in the workspace. */
  lastActiveAt: string | null;
};

export type GateDecision =
  { run: true; intervalMs: number } | { run: false; retryMs: number; reason: GateReason };

export type GateReason = "unknown_account" | "frozen" | "paused" | "not_in_plan" | "inactive";

function blocked(account: BackgroundAccount | null, now: number): GateReason | null {
  if (!account) return "unknown_account";
  if (account.frozen) return "frozen";
  if (account.paused) return "paused";
  const last = account.lastActiveAt ? new Date(account.lastActiveAt).getTime() : NaN;
  if (!Number.isFinite(last) || now - last > INACTIVE_DAYS * DAY_MS) return "inactive";
  return null;
}

/** Market Brain re-collection: weekly, only on plans that include it. */
export function marketBrainGate(account: BackgroundAccount | null, now = Date.now()): GateDecision {
  const reason = blocked(account, now);
  if (reason) return { run: false, retryMs: SKIP_RETRY_MS, reason };
  if ((account!.limits.marketBrainWeeklyBrands ?? 0) <= 0)
    return { run: false, retryMs: SKIP_RETRY_MS, reason: "not_in_plan" };
  return { run: true, intervalMs: 7 * DAY_MS };
}

/**
 * A tracked competitor's next sweep: never sooner than the plan's sweeps per
 * week allow (1 a week → 7 days, 2 → 3.5 days), and nothing for a plan with none.
 */
export function competitorSweepGate(
  account: BackgroundAccount | null,
  now = Date.now(),
): GateDecision {
  const reason = blocked(account, now);
  if (reason) return { run: false, retryMs: SKIP_RETRY_MS, reason };
  const perWeek = account!.limits.competitorSweepsPerWeek ?? 0;
  if (perWeek <= 0) return { run: false, retryMs: SKIP_RETRY_MS, reason: "not_in_plan" };
  return { run: true, intervalMs: Math.round((7 * DAY_MS) / perWeek) };
}

/** Plans whose community feed refreshes by itself (weekly); others refresh on a click. */
const COMMUNITY_AUTO_PLANS = new Set(["growth", "agency", "scale"]);

/** Community refresh: weekly on Growth and up; "Look now" is always a click. */
export function communityGate(account: BackgroundAccount | null, now = Date.now()): GateDecision {
  const reason = blocked(account, now);
  if (reason) return { run: false, retryMs: SKIP_RETRY_MS, reason };
  if (!COMMUNITY_AUTO_PLANS.has(account!.plan))
    return { run: false, retryMs: SKIP_RETRY_MS, reason: "not_in_plan" };
  return { run: true, intervalMs: 7 * DAY_MS };
}

/** The later of two due times: a plan's floor never shortens a longer back-off. */
export function laterOf(isoA: string, intervalFromNowMs: number, now = Date.now()): string {
  const a = new Date(isoA).getTime();
  const b = now + intervalFromNowMs;
  return new Date(Math.max(Number.isFinite(a) ? a : 0, b)).toISOString();
}
