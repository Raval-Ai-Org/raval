// The plan comparison table on /pricing (pricing v4, ADR-0050). Numbers come from src/lib/billing/catalog.ts
// (plans, limits and each feature's `minPlan`), so this table can never promise more than the product gives.
// Rows are grouped by the five feature groups the plan cards and the upgrade screen use.
import {
  PLANS,
  annualMonthlyUsd,
  creditsOf,
  planAllows,
  type FeatureKey,
  type PaidPlanId,
} from "@/lib/billing/catalog";
import { planOutcomes } from "@/lib/billing/plan-economics";

export type Cell = string | boolean;
export type MatrixRow = { label: string; values: Cell[] };
export type MatrixGroup = { title: string; rows: MatrixRow[] };

const COLUMNS: PaidPlanId[] = ["starter", "growth", "agency", "scale"];
const n = (value: number) => Math.round(value).toLocaleString("en-US");

// Yearly is the headline price; Enterprise is quoted.
export const MATRIX_COLUMNS = COLUMNS.map((id) => ({
  name: PLANS[id].label,
  price: id === "scale" ? "Talk to us" : `$${n(annualMonthlyUsd(id))} /mo yearly`,
  ...(id === "growth" ? { highlight: true } : {}),
}));

const each = (value: (plan: PaidPlanId) => Cell): Cell[] => COLUMNS.map(value);
const has = (feature: FeatureKey): Cell[] => each((plan) => planAllows(plan, feature));
const plus = (plan: PaidPlanId, value: string) => (plan === "scale" ? `${value}+` : value);

export const MATRIX: MatrixGroup[] = [
  {
    title: "Create",
    rows: [
      {
        label: "Credits every month (1 credit = 1 image post)",
        values: each((plan) => plus(plan, n(creditsOf(PLANS[plan].allowances.credits)))),
      },
      {
        label: "10-second videos, if spent on video",
        values: each((plan) => plus(plan, `≈ ${n(planOutcomes(plan).videos)}`)),
      },
      {
        label: "Text posts, captions, scripts, standard articles",
        values: each(() => "Unlimited"),
      },
      { label: "Image posts, carousels, Stories and ads", values: has("studio") },
      { label: "Premium GEO-grounded articles", values: has("premium_articles") },
      { label: "Creator (UGC) video ads", values: has("ugc") },
      { label: "Premium, Long-take and Cinematic video, 1080p", values: has("video_cinematic") },
      {
        label: "Videos rendering at the same time",
        values: each((plan) => n(PLANS[plan].limits.maxConcurrentRenders)),
      },
    ],
  },
  {
    title: "Autopilot",
    rows: [
      { label: "Autopilot plans, writes and schedules", values: has("autopilot") },
      { label: "Campaign plans and the content calendar", values: has("campaigns") },
      { label: "Publishing to every social network", values: each(() => "Unlimited") },
    ],
  },
  {
    title: "Brain",
    rows: [
      { label: "Brand DNA, products, audience and strategy", values: each(() => true) },
      {
        label: "Competitors tracked",
        values: each((plan) => n(PLANS[plan].limits.competitors)),
      },
      {
        label: "Market Brain, weekly",
        values: each((plan) => {
          const brands = PLANS[plan].limits.marketBrainWeeklyBrands;
          return `${n(brands)} ${brands === 1 ? "brand" : "brands"}`;
        }),
      },
      {
        label: "Mellox Pro chat messages",
        values: each((plan) => n(PLANS[plan].allowances.proMessages)),
      },
      { label: "Mellox Flash chat", values: each(() => "Unlimited, fair use") },
    ],
  },
  {
    title: "Grow",
    rows: [
      {
        label: "Tracked AI questions, checked weekly on 3 engines",
        values: each((plan) => n(PLANS[plan].limits.trackedPrompts)),
      },
      {
        label: "Site scans per month (max pages)",
        values: each(
          (plan) => `${n(PLANS[plan].limits.scansPerMonth)} (${n(PLANS[plan].limits.geoMaxPages)})`,
        ),
      },
      { label: "GEO fix proposals", values: has("geo_fix_proposals") },
      { label: "One-click fixes, WordPress and Webflow", values: has("geo_apply_fixes") },
      { label: "GEO Engineer and Fix all", values: has("geo_agent") },
      { label: "Proof Engine experiments", values: has("experiments") },
      { label: "GA4 and Search Console insights", values: has("analytics_insights") },
    ],
  },
  {
    title: "Team",
    rows: [
      {
        label: "Brand workspaces",
        values: each((plan) => plus(plan, n(PLANS[plan].brands))),
      },
      {
        label: "Seats",
        values: each((plan) => {
          const seats = PLANS[plan].seats;
          return seats === null ? "Unlimited" : n(seats);
        }),
      },
      { label: "Approval workflows", values: has("approvals") },
      { label: "Client portal and share links", values: has("client_portal") },
      { label: "Agency command center", values: has("command_center") },
      { label: "White-label client reports", values: has("white_label") },
      {
        label: "SSO and API access",
        values: each((plan) => (plan === "scale" ? "Coming soon" : false)),
      },
      { label: "Unused credits roll over", values: each(() => "1 month") },
      { label: "Support", values: each((plan) => PLANS[plan].support) },
    ],
  },
];
