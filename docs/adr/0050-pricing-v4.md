# ADR-0050: Pricing v4 — one credit, three plans, no Free plan

Status: accepted, 15 November 2026. Supersedes the plan, video-credit and
creation-point parts of ADR-0027.

## Context

Billing had six meters a person could see (credits, creation points, flex
credits, free videos, premium videos, Pro/Flash messages). A $49 Starter's
2,000 credits made about 66 image posts and 2 videos; nobody could say what a
plan bought, and margins were thin on real costs.

## Decision

- **No Free plan.** `free` stays only as the stored "no active plan" state
  (`hasActivePlan`). Without a plan the app shows the plan picker and cannot be
  closed (`BillingPanel requirePlan` in `AppShell`, enforcement `on`); data stays
  readable, nothing spends. Projects and onboarding are not locked.
- **One credit = one image post; text work is included.** `UNITS_PER_CREDIT = 30`:
  the `credits` meter keeps its integer units and shows them ÷ 30, so old balances
  convert exactly and the append-only ledger is untouched. Prices are defined with
  `cr(n)` in `CREDIT_ACTIONS`. A 0-credit action runs with no hold but still needs an
  active plan, an unfrozen brand and the feature (`assertIncluded`).
- **Plans:** Starter $49 ($39/mo yearly) 150 credits, 1 brand / 2 seats; Growth
  $149 ($119) 500 credits, 3 / 5; Agency $399 ($319) 1,500 credits, 10 / unlimited.
  Enterprise (`scale`) is "Talk to us"; existing Scale accounts keep their terms.
  Unused plan credits roll over one month on every plan, capped at one month.
- **Video is priced per second in credits** (`VIDEO_CREDITS_PER_SECOND`): Draft 1.5,
  Standard 3, Long 4, Premium 5, Cinematic 6, 2K ×2, floored at the provider cost ÷
  `MAX_USD_PER_CREDIT` ($0.085). Leftover video / premium-video / creation balances
  still spend until they run out; new windows grant none.
- **Top-ups** 50 / 200 / 600 credits for $15 / $49 / $129, valid 12 months. Packs
  sold before v4 stay readable only for fulfilment (`LEGACY_CREDIT_PACKS`,
  `creditPackFor`), never for sale.
- **Grants** use keys `credits_v4:…`; a window already granted under older keys is
  never granted again (`grantPlanWindow` replay guard). No signup grant; the trial is
  7 days of Growth with 30 credits.

## Margins (pessimistic costs, `plan-economics.ts`, enforced by its test)

| Plan | Typical month / year | Heavy month / year | Stress month / year |
|---|---|---|---|
| Starter | 57% / 48% | 43% / 31% | 22% / 3% |
| Growth | 58% / 49% | 42% / 29% | 27% / 10% |
| Agency | 55% / 46% | 38% / 25% | 28% / 12% |

The test fails if typical-yearly drops under 45% or heavy-monthly under 30%, or if
any action's planned cost is over $0.085 a credit. The provider circuit breaker
(`creationProviderLimits`, 60% of the monthly price) bounds the stress case.

## Consequences

- Studio always pays with credits (`paymentSource: "credits"`); the "Pay with"
  control is gone. A creation-point request with no active window falls back to credits.
- `billing_studio_jobs` allows a 0-amount link without a hold
  (migration `20261115120000_pricing_v4.sql`).
- A Studio job whose only delivered part was included returns its whole hold
  (a zero capture is refused by `meter_capture`).
- Autopilot's weekly cap is still stored in units and shown in credits; videos keep
  their own weekly count cap.
