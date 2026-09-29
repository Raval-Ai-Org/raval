# Billing v2 progress

Last update: 30 September 2026. Source of truth for prices: `src/lib/billing/catalog.ts`
(matches `docs/pricing/v2/` as of 29 September: Post for Me, unlimited posts on every plan).

## How it works

- **One wallet per owner**, shared by all their brands: credits, videos, Pro messages,
  chat messages. Charged only when an action works; failed work is released.
- **`BILLING_ENFORCEMENT`** = `off` / `shadow` / `on`, plus a per-account override in
  `/admin`. Local `.env.local` is now `on`; set the same on the deployment when ready.
- **Payments:** Stripe later. Until then **Upgrade now** sends a request (emailed to
  `BILLING_ADMIN_EMAILS`); an admin confirms payment and activates the plan or pack at
  `/admin`. Manual plans are comps until a date, so grants and the fall back to Free
  reuse the normal paths.

## Done

- Catalog, account wallet, all billing migrations applied to the connected database.
- Charges for every paid action, including background jobs (`billing_async_links`,
  `src/server/billing/async-charges.server.ts`): GEO Engineer runs (800, when a fix is
  ready to review), Fix all (150 per finding actually fixed), competitor reports and
  profiles, Brand Kit voice re-analysis (first analysis free). The billing cron settles
  anything the workers miss; the expiry sweeper never releases an unsettled job hold.
- Plan limits: brands, seats, competitors, experiments, site scans, tracked prompts;
  feature gates on every paid surface. Next post generation now needs editor.
- **Launch grace month** (migration `20261002092400`): 6 existing accounts over the
  Free limits got a free month (4 Growth, 2 Scale) until 29 October, with a notice.
- **Notices and email** (`notify.server.ts`, `src/server/notify/email.server.ts`):
  80% / 100% balance, teammate upgrade requests, purchase requests to admins, plan
  activated, free month ending in 3 days, referral rewards. In-app list in Plan &
  billing, unread dot on the balance pill. Email via Resend when `RESEND_API_KEY` and
  `BILLING_EMAIL_FROM` are set.
- **Referrals:** `/r/<code>` link, attribution at sign-in, both sides rewarded 14 days
  after the friend's first payment (1,000 credits + 2 videos, max 20 a year).
- **Tracked prompts:** AI Visibility → Prompts. Weekly checks on the plan's engines
  from the geo-scans cron, pooled limit, suggestions from Brand DNA, "Check now"
  (8 credits), per-engine mention and position, 6-week trend.
- UI: balance pill, Plan & billing (overview, plans, top up, prices, history),
  upgrade screen, admin console, lock badges, price chips.

## Remaining

1. **Stripe** when you are ready: keys, `npm run billing:stripe-sync -- --apply`,
   webhook to `/api/public/hooks/stripe`.
2. Set on the deployment: `BILLING_ENFORCEMENT=on`, `BILLING_ADMIN_USER_IDS`,
   `BILLING_ADMIN_EMAILS`, `RESEND_API_KEY`, `BILLING_EMAIL_FROM`.
3. Web search for ChatGPT/Gemini prompt checks is off (`GEO_PROBE_WEB_SEARCH`); turn on
   only after confirming OpenRouter `:online` pricing is metered correctly.
4. Not verified: signed-in UI flows, real email sending, live paid probe answers, a
   real PostgreSQL concurrency test of holds. GEO agent retries are not charged.
