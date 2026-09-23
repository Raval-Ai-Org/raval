// constants.ts — every Proof Engine threshold, named (ADR-0024 §6).
// Pure: safe in the browser. Changing a number here changes what the product
// is willing to claim; do it deliberately and update the tests.

export const CHANGE_TYPES = [
  "title",
  "meta_description",
  "h1",
  "intro",
  "faq",
  "cta_text",
] as const;
export type ChangeType = (typeof CHANGE_TYPES)[number];

export const METRICS = [
  "clicks",
  "impressions",
  "ctr",
  "sessions",
  "key_events",
  "revenue",
  "ai_referral_sessions",
] as const;
export type ExperimentMetric = (typeof METRICS)[number];

/** Metrics that come from Search Console (the rest come from GA4). */
export const GSC_METRICS: readonly ExperimentMetric[] = ["clicks", "impressions", "ctr"];

// ── Eligibility ──────────────────────────────────────────────────────────
/** Pages with Search Console data a group needs before it can be tested. */
export const MIN_PAGES = 30;
/** Complete days of pre-period data used for assignment, power and the baseline. */
export const PRE_PERIOD_DAYS = 56;
/** No single page may hold more than this share of the group's primary metric. */
export const MAX_PAGE_SHARE = 0.4;
/** Minimum detectable effect above which creation is blocked (at MDE_BLOCK_DAYS). */
export const MAX_MDE = 0.25;
/** Horizons the power estimate is reported for. */
export const MDE_HORIZONS_DAYS = [21, 28] as const;
export const MDE_BLOCK_DAYS = 28;
/** Random pair splits used to estimate pre-period noise for the power estimate. */
export const POWER_SPLITS = 200;

// ── Assignment ───────────────────────────────────────────────────────────
/** |ΣT − ΣC| / ΣC on the pre-period primary metric must be within this. */
export const BALANCE_TOLERANCE = 0.05;
/** Re-draws (seed + k) before assignment gives up. */
export const MAX_ASSIGNMENT_ATTEMPTS = 50;

// ── Duration and verdicts ────────────────────────────────────────────────
export const MIN_DURATION_DAYS = 21;
export const MAX_DURATION_DAYS = 42;
/** Days after live confirmation at which a verdict may be given. */
export const CHECKPOINT_DAYS = [21, 28, 35, 42] as const;
/**
 * Pocock-adjusted two-sided level per look for four looks, 5% overall.
 * Checking four times at 5% each would give false wins about 12% of the time.
 */
export const CHECKPOINT_ALPHA = 0.0182;
/** Two-sided z for CHECKPOINT_ALPHA (Φ⁻¹(1 − α/2)). */
export const Z_CHECKPOINT = 2.36;
/** z for 80% power. */
export const Z_POWER = 0.84;
/** z for the 95% interval shown to people. */
export const Z_95 = 1.96;

// ── Analysis ─────────────────────────────────────────────────────────────
/** Moving-block bootstrap block length (days) — respects weekly seasonality. */
export const BOOTSTRAP_BLOCK_DAYS = 7;
export const BOOTSTRAP_SAMPLES = 2_000;
/** Placebo (randomization) draws; all patterns are used when 2^pairs is smaller. */
export const PLACEBO_DRAWS = 1_000;
/** Average days per month, for monthly figures. */
export const DAYS_PER_MONTH = 30.4;

// ── Changes ──────────────────────────────────────────────────────────────
/**
 * Share of an experiment copy's words that must already appear in the site's
 * text, Brand DNA or the page's own search queries. Lower than the GEO fix
 * threshold (0.85) because new wording is the point; facts stay strict.
 */
export const EXPERIMENT_GROUNDING_THRESHOLD = 0.6;
/** Where experiment data files live in a connected repository. */
export const DATA_FILE_DIR = "mellox-experiments";

// ── Live check and contamination ─────────────────────────────────────────
/** Treatment and control pages fetched per live check. */
export const LIVE_CHECK_SAMPLE = 10;
/** Minutes between live checks while waiting for a deploy. */
export const LIVE_CHECK_INTERVAL_MINUTES = 15;
/** Days after merge the live check keeps trying. */
export const LIVE_CHECK_MAX_DAYS = 7;
/** Days between contamination checks of control pages. */
export const CONTAMINATION_INTERVAL_DAYS = 7;
/** Days a lost Search Console connection is tolerated before invalidation. */
export const ACCESS_LOST_INVALIDATE_DAYS = 7;
