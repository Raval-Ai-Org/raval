# Mellox Billing v2: build brief for Claude Code

You are implementing Mellox AI's complete pricing, credits and plans system and taking it to a launch-ready state. The pricing itself is already decided and costed (see `docs/pricing/v2/`). Your job is to build it end to end in this codebase: data model, metering, enforcement, upgrade UX, Paddle billing, lifecycle, admin, monitoring and tests.

The owner is Zain (founder). He has given you full permission to change the codebase to ship this. Work autonomously. Stop only for the items marked **ASK ZAIN** or for anything irreversible against the real database or Paddle production.

---

## 0. How to work

1. Read, in this order: `CLAUDE.md`, this brief, `docs/pricing/v2/catalog.reference.ts.txt`, `docs/adr/0008-ai-metering-budgets-guardrails.md`, `docs/adr/0014-canonical-workspaces.md`, the header comments of `supabase/migrations/20260925090000_link_marketplace.sql` and `20260921090000_add_ai_usage_reservations.sql`, then `src/server/ai/task-models.ts`, `src/server/ai/budget.ts`, `src/server/plans.ts`, `src/server/links/credits.server.ts`, `src/server/billing/stripe.server.ts`, `src/server/route.ts`.
2. Start in plan mode. Use subagents for parallel, read-only mapping. At minimum map: every reader of `workspaces.plan`, `getPlanLimits`, `normalizePlanId`, `checkBudget` / `enforceBudget`, `monthlyImages` / `monthlyVideos`, `maxConcurrentRenders`, `geoMaxPages`, `maxConcurrentExperiments`, `monthlyPosts` / `social_usage_events`, every SocialAPI profile connect path, every call to `apply_credit_entry`, every user-triggered route that spends AI, and every UI entry point for the features in the catalog.
3. Write the plan to `docs/billing/PLAN.md` and a decision record `docs/adr/0027-account-billing-and-credits.md` (use the next free ADR number if 0027 is taken). The ADR records the decisions in section 3 plus anything you had to adapt.
4. Execute the phases in section 17 in order. Each phase ends with `npm run typecheck && npm run lint && npm test && npm run build && npm run db:verify` green and its own commit. Do not stop between phases for approval.
5. If this brief and the code disagree, the code's reality wins: adapt, keep the intent, and write down what you changed in the ADR.
6. Keep every existing safety system (budget ceilings, reservations, rate limits, guardrails, idempotency). Re-scope them to the billing account; do not delete them.
7. **Branch and deploy discipline.** Work on a branch `feat/billing-v2`. Pushes to `main` deploy automatically (see `amplify.yml`), so do not merge or push to `main` until phase 9 is green, and then **ASK ZAIN** before merging. Until then apply migrations only to a local or staging database, never production.

### Non-negotiable rules

- **Secrets:** never read, print, log or commit values from `.env`, `.env.local` or any secret store. Add new variable names to `.env.example` with placeholder values only.
- **Conventions in `CLAUDE.md` are enforced:** `defineRoute` / `defineCronRoute`, server functions via `createServerFn` + stubs, `server-only` boundaries, RLS on every table, idempotent migrations, paid AI only through the gateways, `emitAppEvent` for cross-component events, `AppModalShell` surfaces, `ds-*` tokens, icons from `@/components/icons`, pill buttons, `EmptyState` / `ErrorState` / `Skeleton`.
- **Landing page:** do not restyle `src/app/page.tsx`. Only replace the `PLANS` data, the JSON-LD offers and pricing copy so they match the catalog.
- **Money is server-side only.** The browser never sends a price, a credit amount, a plan limit or an account id that the server trusts. The browser names a catalog key; the server looks everything up.
- **Ledgers are append-only** and every movement is idempotent on a key derived from stable ids (never timestamps or attempt counters), exactly like `workspace_credit_ledger` today.
- **Holds fail closed.** A paid action whose hold did not succeed does not run. (Budget checks keep failing open as they do today; they are a circuit breaker, not the wallet.)

---

## 1. The outcome

When this is done:

- Credits belong to a **user's billing account**, not to a workspace. One owner, one wallet, shared across every brand (workspace) they own. Teammates spend the owner's wallet when they work in the owner's brands.
- Five plans (Free, Starter $49, Growth $149, Agency $449, Scale $1,199; annual = 2 months free) with the exact allowances, limits and features in the catalog.
- Four meters: **Mellox Credits** (non-video AI work), **Video Credits** (video only; general credits can never buy video), **Mellox Pro messages** (Claude Opus 5.5 chat allowance), **Mellox Flash messages** (fair-use counter).
- Every feature is **visible on every plan**. A locked feature shows a small lock; clicking it opens an upgrade modal that names the plan that unlocks it, the price, what else that plan adds, and a one-click upgrade or trial. The server enforces the same rules and answers `402` with a structured payload, which the client turns into the same modal.
- Every paid button shows its price (credits or VC). Charges happen **only on success** (hold, run, capture or release).
- Paddle handles subscriptions, trials, add-ons, credit packs, video packs, proration, invoices, tax, dunning and the customer portal.
- Upgrades apply immediately with proration; downgrades and cancellations apply at period end; a $9 pause plan replaces cancel; failed payments get a 7-day grace period.
- An admin console, a margin monitor, shadow mode for safe rollout, emails and in-app notifications, and full tests.

---

## 2. Source of truth

- `docs/pricing/v2/catalog.reference.ts.txt`: the full catalog (plans, features with upgrade copy, credit prices, video credit options, packs, add-ons, trial, signup grant, pause, founding offer, referral, grace period). **First step of phase 1: move it to `src/lib/billing/catalog.ts`** (rename, remove `.txt`, keep it browser-safe). It typechecks as-is under strict mode. Server-side env overrides go in a server module, never in the catalog.
- `docs/pricing/v2/Mellox_AI_Pricing_Model_v2.xlsx`: why each number is what it is (cost per action, margins, worst cases). Do not change a catalog number without a reason recorded in the ADR.

Quick reference (the catalog is authoritative):

| | Free | Starter | Growth | Agency | Scale |
|---|---|---|---|---|---|
| Price / month (annual per year) | $0 | $49 ($490) | $149 ($1,490) | $449 ($4,490) | $1,199 ($11,990) |
| Brands / seats | 1 / 1 | 1 / 2 | 3 / 5 | 10 / unlimited | 30 / unlimited |
| Credits a month | 100 once (signup) | 2,000 | 6,000 | 18,000 | 50,000 |
| Video Credits a month | 0 | 4 | 12 | 40 | 100 |
| Pro messages / Flash fair use | 0 / 30 | 30 / 800 | 150 / 2,000 | 400 / 5,000 | 1,200 / 12,000 |
| Tracked prompts (weekly) | 5 | 25 | 100 | 300 | 1,000 |
| Social profiles to connect | 0 | 1 | 3 | 10 | 30 |
| Safety ceiling daily / monthly | $1 / $2 | $4 / $27 | $10 / $80 | $30 / $234 | $83 / $662 |

---

## 3. Decisions already made (do not re-open them)

1. **Billing account per owner.** Table `billing_accounts`, one row per user (`owner_user_id` unique), created lazily and idempotently (on signup via trigger or on first need). Every workspace gets `billing_account_id` = its owner's account. Actions inside workspace W are charged to W's account, whoever clicks. A user who is only a member elsewhere still has their own (Free) account for brands they create.
2. **Who can do what with money.** Owner: everything (buy, change plan, cancel, set caps). Admin and editor: spend the wallet inside the brand. Viewer: cannot run any paid action, chat included (the UI offers "Ask for editor access"). Only the owner can purchase or change the plan; admins and editors see "Ask the owner" with a one-click **Request upgrade** that notifies the owner. Non-owners never receive the account id, the owner's user id, other brands' names or the full ledger; they see the owner's display name, balances and their own brand's history.
3. **Seats** = distinct admin and editor members across all of the account's brands, owner included, plus pending invites for those roles. Viewers do not count as seats (they cannot spend or edit). The client portal is not a seat.
4. **Brands** = the account's workspaces that are not deleted, not duplicates and not frozen.
5. **Meters and units** exactly as in the catalog: credits (1 = 1 credit), video (100 units = 1 VC, so 0.5 / 0.75 / 1.25 VC stay integers), pro_messages, flash_messages.
6. **Grants.** Every balance is made of grants with a source, an optional expiry and a restriction:
   - sources: `plan`, `rollover`, `trial`, `signup`, `pack`, `pack_bonus`, `addon`, `referral`, `promo`, `adjustment`, `migration`.
   - restriction `any` (paid money: packs, migrated paid balances, positive adjustments marked paid) or `ai_only` (plan, rollover, trial, signup, bonus, referral, promo).
   - **Backlink purchases may only consume `any` grants.** Included plan credits cannot buy backlinks (they would break the plan's margin).
   - Consumption order: soonest expiry first; among non-expiring grants, `ai_only` before `any` (so paid credits last longest).
7. **Charge on success.** hold (reserves from specific grants) then run then capture or release. A hold supports **several partial captures** (the backlink runner captures per line against one order hold) and ends with an explicit finalize that releases the remainder; a simple action captures once and finalizes in the same call. Holds carry a TTL chosen per action (text: 15 minutes; video: 3 hours; GEO agent run: 7 days, because it waits for a person's approval); the sweeper releases only expired holds whose job is not still live.
   - **Idempotency semantics:** replaying a key whose hold is `held` or `captured` returns the stored outcome and **never runs the action again** (the route answers 409 with the original result or status). A key whose hold was released cannot be reused; a genuine retry after a failure gets a new client key.
8. **Annual plans are granted monthly** (not 12 months up front). Unused plan credits and VC roll over once, capped at one month of allowance, expiring at the end of the next month. Monthly plans do not roll over.
9. **Plan changes.**
   - A change that raises the monthly-equivalent price is an **upgrade**: immediate and prorated. The allowance difference (new monthly allowance minus old, per meter) is granted at once but **prorated by the share of the current grant window that is left** (upgrading on day 29 of 30 grants about 1/30 of the difference). Features unlock immediately.
   - Monthly to annual counts as an upgrade; the new monthly grant window starts on the change date.
   - Everything else (lower plan, annual to monthly, or a lower plan on a shorter interval) is a **downgrade**: applied at period end; the current plan stays entitled until then.
   - **Add-ons:** adding one is immediate and prorated, and any allowance it carries (for example `extra_brand` credits and VC) is granted prorated by the window left. Removing one or lowering a quantity takes effect at period end with no refund of the current period. Add-ons that the new plan does not allow (for example `extra_seat` on Agency) are removed as part of the plan change.
   - Cancel: at period end, then Free. Pause: switch to the $9 pause plan (read-only brands, 10 weekly prompts, no AI allowances), resume any time, max 6 months. Monthly plans pause at once; annual plans schedule the pause for the end of the paid year.
10. **Payment failure:** status `past_due`, full access for 7 days with a banner, new monthly grants withheld until paid, then Free limits (data kept) until the invoice is paid.
11. **Paddle Billing is the payment provider** (merchant of record: handles global tax and invoices; Stripe cannot onboard a Pakistani company). `BILLING_PROVIDER=paddle`. The existing Stripe code stays compiling for history and replayed webhooks, but no new purchase goes through it.
12. **Free plan** gets 100 signup credits (`ai_only`, 30-day expiry) and may use Studio's WORKHORSE formats with them. Free Brand DNA runs on WORKHORSE, the full PREMIUM scan runs free of charge on the first upgrade.
13. **Budget ceilings stay** as a circuit breaker on metered provider spend, re-scoped from workspace to billing account (`acct:<id>`), using the catalog's `safety` values plus the USD value of packs spent this period.
14. **Rollout safety:** `BILLING_ENFORCEMENT=off|shadow|on` plus a per-account override column.
   - `off`: today's behaviour exactly. The legacy per-workspace budget limits and quotas stay in force; no feature gates, no credit charges.
   - `shadow`: gates and prices are computed and logged to `billing_shadow_events` (would-charge, would-block), nothing is charged or blocked, and the legacy budget limits stay in force.
   - `on`: gates, charges and account-scoped budgets apply.
   - The modes apply only to feature gates, `runMetered` charges and the switch of budget scope. The account ledger, grants, Paddle purchases and **backlink holds always run for real** in every mode (backlinks spend real provider money).
   - Default after deploy: `shadow`. Zain flips it to `on`.
15. **Existing users (grandfathering). ASK ZAIN** before phase 1's backfill runs in production. Default if he does not answer: every existing account whose brands or seats exceed Free gets a 30-day comp on the smallest plan that fits them, with an email explaining the new plans; at the end of the comp their extra brands freeze (never delete) unless they subscribe.
16. **Refunds never become free usage.** Balances may go negative only through a refund or chargeback clawback: the shortfall is recorded as `debt` on the meter, spending is blocked while there is debt, and the next grants pay it down first. Refunds for a subscription payment claw back what is left of that period's plan grants.
17. **Social publishing is limited by connected social profiles, not posts.** SocialAPI.ai bills Mellox per connected **profile** per month (1 profile = 1 brand with any number of its networks) in fixed tiers ($29 for 10, $109 for 50, $349 for 200 profiles), and posts are unlimited. So each plan limits `socialProfiles` (0 / 1 / 3 / 10 / 30, +1 per `extra_brand` add-on), one profile per brand, up to 13 networks per profile. Remove `monthlyPosts` as a plan limit and quota everywhere (keep `social_usage_events` for analytics and a fair-use rate limit against abuse, for example 100 posts per profile per day). Count a profile as used while the brand has an active SocialAPI profile; disconnecting frees it. Add a SocialAPI capacity check: alert admins at 80% of the current SocialAPI tier's profiles so Zain upgrades the tier before connects fail. If Zain's SocialAPI invoice turns out to bill per platform account instead, only the workbook input and the catalog limit change; the code counts profiles and networks separately so either unit can be enforced.
18. **Video providers for now: KIE for some models only.** KIE runs Veo 3.1 Fast and Lite (`standard`, `draft`) and Grok Imagine (`variation`), where its prices are verified in `src/lib/ugc/models.ts` and 2.6x to 3.9x cheaper. OpenRouter runs `premium` (Hailuo 3), `cinematic` (Hailuo 3), `long` (Seedance 2.0 Fast, cheaper on OpenRouter) and the Studio 6s clip; KIE prices for Gemini Omni and MiniMax H3 are unverified, so KIE is not used for them. Every KIE option falls back to OpenRouter (Veo for standard and draft; `variation` falls back to Veo 3.1 Lite 6s, never Grok on OpenRouter, which costs about $0.90). The split lives in the catalog (`VIDEO_OPTIONS[].provider` / `fallback`) and an env override `VIDEO_PROVIDER_<KEY>=kie|openrouter` so a provider can be switched without a deploy. The plans are costed so they still clear 60%+ typical margin if everything moves to OpenRouter.

---

## 4. What exists today and what changes

| Today | Change |
|---|---|
| `src/server/plans.ts`: starter/growth/agency, USD ceilings and quotas; unknown plan becomes starter | Replaced by `src/lib/billing/catalog.ts` + `src/server/billing/entitlements.server.ts`. Keep `plans.ts` as a thin compatibility shim over entitlements until every caller is migrated, then delete it. Unknown plan must resolve to **free**, never starter. |
| `src/server/ai/budget.ts`: per-workspace ceilings read from `workspaces.plan`, fail-open | In `on` mode the scope becomes the billing account, limits come from the catalog's `safety`, and image and video quotas are removed (the video meter and credits replace them). In `off` and `shadow` the legacy per-workspace limits stay exactly as today, so live users are not squeezed to Free ceilings before Paddle exists. Keep `degrade` for text and fail-open behaviour. |
| `ai_usage_events` / `record_ai_usage()` / `ai_usage_summary()` | Add `billing_account_id` and `charge_id` columns (filled from the workspace and the request scope). Add account-level rollups so budget checks and margin reports work per account. |
| `ai_usage_reservations` (UGC render holds against quotas) | Keep for concurrency limits. The money side moves to video-meter holds. The render id does not exist when the hold is taken, so the hold is keyed by the request's idempotency key (`ugc_render_req:{key}`) and linked to the render row once it is inserted; the reservation keeps its own `(source, source_id)` key. |
| `workspace_credit_ledger` / `workspace_credit_balances` / `apply_credit_entry` (backlinks) | Become history. New account-level ledger. `apply_credit_entry(p jsonb)` is rewritten as a wrapper that resolves the workspace's account and calls the account functions with the **same idempotency keys**, so the link order runner keeps working unchanged. The wrapper first checks whether the key already exists in `workspace_credit_ledger` (a Stripe `topup:` replay, or a `line:*:capture` from before the migration) and returns `replayed` instead of applying it twice. Line refunds return as `any` credits. `credits.server.ts` reads account balances (restricted to `any` grants for backlinks). |
| `src/server/billing/stripe.server.ts`, `/api/billing/checkout`, `/api/public/hooks/stripe`, `billing_customers`, `stripe_events` | Kept compiling. New Paddle modules and routes beside them. `/api/billing/checkout` is reworked for Paddle (account-level, owner-only). The old dollar top-up packs are replaced by the catalog's credit packs. |
| `UsagePanel.tsx` ("Plan & usage"), `AccountMenu.tsx` | Replaced by the new Plan & billing modal and a wallet pill in the top bar. |
| `src/app/page.tsx` PLANS ($9 / $29 / $79) | Data replaced with the catalog's plans (no restyle). |
| Market Brain scheduler: daily for every workspace | Weekly for the plan's brands; daily only with the `daily_market_brain` add-on. |
| GEO probes: part of scans only, flagged off | Add a real **tracked prompts** feature (section 11) with plan limits, weekly cadence, 3 engines, optional web search. |
| No email provider | Add Resend (optional; in-app notifications always work). |
| No admin area | Add `/admin` (section 13). |

---

## 5. Data model

One or more idempotent migrations (next timestamps after `20261001090000`). RLS on every table: members read their account's rows where noted, only `service_role` writes money tables, the owner reads everything on their own account.

**`billing_accounts`**
`id uuid pk`, `owner_user_id uuid unique not null`, `plan_id text not null default 'free'` (check in catalog ids + `'paused'`), `billing_interval text` (`month`/`year`/null), `status text not null default 'free'` (`free`, `trialing`, `active`, `past_due`, `paused`, `canceled`), `entitled_plan_id text` (what entitlements use; differs from `plan_id` during a scheduled downgrade), `downgrade_to text`, `downgrade_at timestamptz`, `trial_ends_at`, `trial_used boolean default false`, `current_period_start`, `current_period_end`, `grant_anchor timestamptz`, `next_grant_at timestamptz`, `grace_until timestamptz`, `cancel_at timestamptz`, `pause_started_at`, `resume_plan_id text`, `comped_plan_id text`, `comped_until timestamptz`, `pro_overage_mode text default 'credits'` (`credits`/`flash`), `enforcement_override text` (`off`/`shadow`/`on`/null), `provider text default 'paddle'`, `provider_customer_id text unique`, `provider_subscription_id text unique`, `founding boolean default false`, `referral_code text unique`, `referred_by_account_id uuid`, `created_at`, `updated_at`. Owner reads; server writes. Plan and status columns are server-managed (extend the existing `guard_workspace_columns` pattern).

**`workspaces`** add `billing_account_id uuid references billing_accounts` (backfilled, then `NOT NULL`), `frozen_at timestamptz`, `frozen_reason text`, `monthly_credit_cap bigint` (nullable; optional per-brand cap an owner can set so one client cannot drain the pool). **Add all four columns to `private.guard_workspace_columns()`** (browsers can update `workspaces` directly; without the guard, a member could point their own brand at someone else's wallet or clear a freeze). Only server paths change them. `private.create_workspace_for_user` sets `billing_account_id` from the creating user's account and enforces the brand limit (raise a typed error the service maps to `UpgradeRequiredError('extra_brand')`). Keep `workspaces.plan` synced from the account for backward compatibility until nothing reads it.

**Seat limits live in the database.** Admins can insert into `workspace_invites` straight from the browser (RLS allows it), so a server-side check alone is bypassable. Add triggers on `workspace_invites` insert and role update, and on `workspace_members` insert and role update (viewer to editor included), that count seats for the workspace's account under a per-account advisory lock and refuse over the limit with a clear error code the UI maps to the limit modal.

**`billing_subscription_items`**: `account_id`, `catalog_key` (plan key or add-on key), `quantity`, `provider_price_id`, `provider_item_id`, `status`, timestamps. Add-on quantities drive limits.

**`billing_price_map`**: `catalog_key`, `interval` (`month`/`year`/`one_time`), `environment` (`sandbox`/`production`), `provider_price_id`, `provider_product_id`, `amount_cents`, `active`. Filled by the sync script; read by checkout. Never hard-code price ids.

**`meter_grants`**: `id uuid`, `account_id`, `meter`, `source`, `restriction`, `amount bigint`, `remaining bigint` (check `>= 0`), `period_start`, `expires_at` (null = never), `workspace_id` (attribution only), `provider_ref text` (transaction or subscription id), `idempotency_key text`, `created_at`, unique `(account_id, idempotency_key)`.

**`meter_ledger`** (append-only; copy the trigger from `workspace_credit_ledger`): `id bigint identity`, `account_id`, `meter`, `kind` (`grant`, `hold`, `capture`, `release`, `expire`, `refund`, `clawback`, `adjustment`), `delta_available`, `delta_held`, `available_after`, `held_after`, `grant_id`, `hold_id`, `workspace_id`, `user_id`, `action text`, `charge_id uuid`, `reason text` (at most 300 chars), `actor uuid`, `idempotency_key`, `created_at`, unique `(account_id, idempotency_key)`. **No foreign keys to `auth.users` (or any row that can be deleted) on append-only tables:** an `ON DELETE SET NULL` is an UPDATE, which the append-only trigger refuses, so deleting a user would fail. Store user ids as plain uuids. (The same latent bug exists on `workspace_credit_ledger.actor`; fix it in this migration.)

**`meter_balances`**: `(account_id, meter)` pk, `available`, `held`, `available_any` (the part backlinks may use), `debt` (see decision 16), `updated_at`, check `available >= 0`, `held >= 0`, `debt >= 0`. Maintained in the same transaction as the ledger row.

**`checkout_intents`**: `id` (the nonce), `account_id`, `created_by`, `kind`, `catalog_key`, `interval`, `quantity`, `provider_price_id`, `expires_at`, `consumed_at`. Created by `POST /api/billing/checkout`; the webhook resolves the account from this server-side row and the server-created Paddle customer, never from browser-supplied `custom_data` alone. Also records `trial_used` at creation time so two tabs cannot start two trials.

**`brand_scan_allowances`**: the "first Brand DNA scan free" and "first Brand Kit analysis free" rights, keyed by `(account_id, normalized_domain, kind)`, so deleting and recreating a brand does not reset them.

**`meter_holds`**: `id uuid`, `account_id`, `meter`, `workspace_id`, `user_id`, `action`, `amount`, `state` (`held`/`captured`/`released`/`expired`), `expires_at`, `idempotency_key`, allocations `jsonb` (grant id and amount per grant), timestamps.

**`billing_charges`**: one row per captured charge: `id` (= `charge_id` in the request scope), `account_id`, `workspace_id`, `user_id`, `action`, `meter`, `amount`, `route`, `created_at`. Joined to `ai_usage_events.charge_id` for margins.

**`billing_events`**: provider webhook inbox, `id text pk` (Paddle event id), `type`, `occurred_at`, `account_id`, `payload jsonb`, `received_at`, `processed_at`, `error`. Replay protection like `stripe_events`.

**`billing_shadow_events`**: what shadow mode would have charged or blocked (`account_id`, `workspace_id`, `action`, `meter`, `amount`, `decision`, `reason`, `created_at`). Purged after 60 days.

**`allowance_usage`**: counters for included (non-money) allowances per account and grant window: `scans_used`, `extra_pages_scanned`, and anything else counted per month. (Posts are no longer a plan limit; see the social profiles decision below.)

**`upgrade_requests`**: `account_id`, `workspace_id`, `requested_by`, `feature`, `required_plan`, `message`, `status`, timestamps. **`referrals`**: `referrer_account_id`, `referred_account_id` unique, `status`, `rewarded_at`. **`account_notifications`** (if nothing suitable exists already): `account_id`, `user_id`, `kind`, `payload`, `read_at`.

**SQL functions** (all `SECURITY DEFINER` in `private`, each with a thin `public` wrapper granted only to `service_role` so `supabaseAdmin.rpc()` can call it, the same pattern as `public.create_workspace_for_user`, advisory lock per `(account_id, meter)`, idempotent on the key, returning `{ok, replayed, available, held, code?, reason?}` like `apply_credit_entry`):

- `private.ensure_billing_account(p_user uuid)`: create if missing, returns id.
- `private.meter_grant(p jsonb)`
- `private.meter_hold(p jsonb)`: allocates from grants in the consumption order, honours `restriction` (`p.require_any` for backlinks), the workspace's `monthly_credit_cap`, and returns `insufficient_balance` with `available` when short. Never partial.
- `private.meter_capture(p jsonb)`: captures up to the held amount, returns the unused part to the same grants.
- `private.meter_release(p jsonb)`
- `private.meter_expire_due()`: expires grants past `expires_at` (skips amounts currently allocated to live holds until those settle), writes `expire` rows.
- `private.meter_release_expired_holds()`
- `private.meter_rollover(p_account uuid, p_window_start timestamptz)`: annual rollover, capped at one month of allowance.
- `public.apply_credit_entry(p jsonb)`: compatibility wrapper for the link runner (maps `topup` to a `pack` grant with restriction `any`, `hold` to a hold with `require_any`, and so on, same keys).
- A read view or RPC `account_wallet(p_account uuid)` for the UI (balances by meter, next expiry, plan grant remaining).

Test these with the repo's existing database test approach (`@electric-sql/pglite` is already a dev dependency; follow any existing pattern before inventing one).

---

## 6. Server modules

All under `src/server/billing/` unless noted, `server-only`:

- `src/lib/billing/catalog.ts`: the moved catalog (browser-safe).
- `accounts.server.ts`: `accountForWorkspace(workspaceId)`, `accountForUser(userId)`, `ensureAccount(userId)`, cached briefly and invalidated on any billing change.
- `entitlements.server.ts`: resolves one object from catalog + account + add-ons + status + comps + frozen state:
  `{ accountId, ownerUserId, isOwner, role, plan, entitledPlan, interval, status, trial, period, features: Record<FeatureKey, { allowed, requiredPlan }>, limits: {...with add-ons applied}, usage: { brands, seats, trackedPrompts, scansUsed, competitors, openExperiments, rendersRunning }, meters: { credits, video, pro, flash } }`.
  Past-due beyond grace, paused and canceled accounts resolve to Free or pause limits. `comped_plan_id` wins while `comped_until` is in the future.
- `meters.server.ts`: typed wrappers over the SQL functions.
- `metered.server.ts`: the one way to run a paid user action:

```ts
// Example shape. Adapt names to the codebase.
const result = await runMetered(
  {
    workspaceId,              // verified by the route
    userId,
    action: "article_premium", // CreditAction, or { video: { ugcKey, seconds, resolution } }
    quantity: 1,              // e.g. findings in a GEO fix batch
    idempotencyKey: `studio_job:${job.id}`, // stable: job id, render id, or the client's Idempotency-Key header
  },
  async (charge) => {
    // charge.id is set in the request scope so every recordUsage() in here stores charge_id
    return generateArticle(...);
  },
);
```

  Order inside: entitlements, feature check (`UpgradeRequiredError`), role check (viewer cannot spend), frozen check, compute price from the catalog, hold (`InsufficientBalanceError` with meter, needed, available and purchase options), run, capture on success (optionally a smaller amount for partial work), release on failure or throw. In shadow mode it logs to `billing_shadow_events` and runs without holding. Returns remaining balances so the route can set `X-Billing-Balance` for the client cache.
- `errors.ts`: `UpgradeRequiredError { feature?, limit?, requiredPlan, currentPlan }`, `InsufficientBalanceError { meter, needed, available, options }`, `LimitReachedError { limit, used, max, requiredPlan? }`, `SpendNotAllowedError` (viewer), `BrandFrozenError`. Add them to `knownErrorResponse` in `src/server/route.ts` (the RPC route `src/app/api/rpc/[...fn]/route.ts` already uses it) as **HTTP 402** with JSON `{ code: "upgrade_required" | "insufficient_balance" | "limit_reached" | "spend_not_allowed" | "brand_frozen", ... }`. Never leak other accounts' data in these payloads.
- `limits.server.ts`: `assertWithinLimit(account, "trackedPrompts" | "competitors" | "brands" | "seats" | "experiments" | "renders" | "scans", delta)`.
- `paddle.server.ts`: the only file that reads Paddle secrets or talks to the Paddle API (use the official `@paddle/paddle-node-sdk`). Checkout data, subscription changes with preview, one-time charges, cancel, pause plan switch, customer portal sessions, webhook verification and parsing.
- `webhooks.server.ts`: event handlers (section 9).
- `grants.server.ts`: monthly grants, trial grants, rollover, expiry, idempotent keys like `plan:{account}:{meter}:{window_start}`.
- `notify.server.ts` + `src/server/notify/email.server.ts`: in-app notifications and email (Resend over `fetch`; the only file that reads `RESEND_API_KEY`; if unset, email is skipped and logged).
- `margins.server.ts`: margin rollups and alerts (section 13).
- API routes (all `defineRoute`, rate-limited with a `billing-*` tier): `GET /api/billing/entitlements?workspaceId=` (or none for the user's own account), `GET /api/billing/wallet`, `GET /api/billing/history`, `POST /api/billing/checkout`, `POST /api/billing/subscription/preview`, `POST /api/billing/subscription/change`, `POST /api/billing/subscription/cancel`, `POST /api/billing/subscription/pause`, `POST /api/billing/subscription/resume`, `POST /api/billing/portal`, `POST /api/billing/upgrade-requests`, `PATCH /api/billing/settings` (pro overage mode, per-brand caps, which brands get the Monday briefing), `POST /api/public/hooks/paddle` (a plain route handler like `/api/public/hooks/stripe`, not `defineRoute`, because Paddle is not a signed-in user: raw body, signature first), `POST /api/public/hooks/billing` (`defineCronRoute`: grants, expiry, hold sweeper, downgrades due, grace ends, reconciliation). Schedule the billing hook every 5 minutes in a migration, the same way `20260925090200_schedule_link_orders.sql` does.

---

## 7. Enforcement map

Wire `runMetered` (or a limit check) into every surface below. Find the real handlers; the route labels come from `task-models.ts`. Anything user-triggered and paid that is missing from this table must be added to it (mapped to the closest catalog action or listed in `INCLUDED_ROUTES`) and a test must fail on an unmapped route, the same way `task-models.test.ts` fails on an unregistered label.

| Surface | Gate | Charge |
|---|---|---|
| Studio jobs (`/api/studio/jobs`, runner) by format | `studio`; `premium_articles` for Opus articles | `post_set`, `image_post`, `carousel`, `ad_set`, `script`, `article_standard`, `article_premium` / `article_long` (by requested length), keyed `studio_job:{id}` |
| Regenerate a post (`content.regenerate`) | `studio` | `post_regenerate` |
| Ideas, prompt writer (`/api/studio/ideas`, `/api/studio/prompt`) | `studio` | `ideas` |
| `/api/social-multi`, `/api/ai-generate` | `studio` | `social_multi` |
| `/api/generate-image` | `studio` | `image_standard` / `image_premium` / `image_edit` |
| Campaign generation | `campaigns` | `campaign` |
| Brand DNA (`/api/brand-extract`) | none | first scan per brand free; re-scan `brand_dna_rescan`. Free plan runs on WORKHORSE; first upgrade triggers one free PREMIUM re-scan. |
| Brand Kit writing analysis | none | first run free; then `brand_voice_rerun` |
| `/api/file-extract` | none | `file_extract` |
| Chat (`/api/chat`) Flash | none | consume 1 `flash_messages`; after the cap, `flash_message_over_cap` (2 credits); if no credits, 402 |
| Chat Pro (`modelId` for `chat.pro`) | `pro_chat` | consume 1 `pro_messages`; when empty: `pro_overage_mode = credits` charges `pro_message` (25), `flash` answers on Flash with a visible notice |
| Coach briefing on demand / deep strategy | `market_brain` / `pro_chat` | `coach_briefing` / `coach_deep`. The scheduled Monday briefing is included. |
| Market Brain manual refresh (`/api/market/intelligence`, `/api/market/trends` outside the schedule) | `market_brain` | `market_brain_manual`. Scheduled weekly (or daily with add-on) refreshes are included. |
| Competitors: discovery, profile, intelligence report | `competitors` | `competitor_discovery`, `competitor_profile`, `competitor_intel`. Tracking count is a limit; sweeps are included. |
| Analytics insights on demand | `analytics_insights` | `insights_refresh` (auto insights included) |
| AI visibility site scan (`/api/geo/scans`) | none | included up to `scansPerMonth` at `geoMaxPages`; beyond that `site_scan_per_100_pages` per started 100 pages. Verification rescans after fixes are always free. |
| Tracked prompts (new) | none | count is a limit; scheduled checks included; "check now" beyond schedule costs `prompt_check_3_engines` |
| GEO fix proposal / batch | `geo_fix_proposals` | `geo_fix` x findings |
| Apply fix: WordPress / Webflow (`geo.cms.fix`) and single-finding GitHub PR | `geo_apply_fixes` | `geo_cms_fix` |
| GEO Engineer agent run, Fix-all batch PR | `geo_agent` | `geo_agent_run` (raise `GEO_AGENT_MAX_COST_USD` default to 3.00) |
| Proof Engine experiment create | `experiments` + `maxConcurrentExperiments` | `experiment` |
| UGC concepts (extract + concepts + notes) | `ugc` | `ugc_concepts` per product |
| UGC render (`/api/ugc/renders`) | `ugc` + `videoFeatureFor(key, resolution)` + `maxConcurrentRenders` | video meter, `videoUnitsFor(...)`, keyed `ugc_render:{id}`; release on failure through the existing webhook and sweeper paths |
| Studio video (`/api/generate-video`) | `ugc` | `STUDIO_VIDEO_UNITS` |
| Backlink orders | `backlinks` | existing hold/capture/refund through the wrapper; only `any` grants |
| Connect a social profile (SocialAPI) | `publishing` + `socialProfiles` limit | none (limit modal offers upgrade or `extra_brand`) |
| Social publish / schedule / retry | `publishing` | included, unlimited posts under a fair-use rate limit |
| Client portal, approvals, command center (`/agency`), white-label | features | none |
| Create workspace | `brands` limit | none (offer upgrade or the `extra_brand` add-on) |
| Invite / accept invite (admin or editor role) | `seats` limit | none (offer upgrade or `extra_seat`) |

Also:
- **Background and included work** (scheduled scans, tracked prompts, weekly Market Brain, Monday Coach briefing, competitor sweeps, auto insights, agents) never debits credits, is bounded by plan limits, and skips frozen brands and paused, past-grace or canceled accounts.
- **Budget ceilings** (`budget.ts`) now check `acct:<id>` with the catalog `safety` values. Keep `X-Usage-Warning`.
- **Idempotency from the browser:** paid buttons send an `Idempotency-Key` header (a UUID generated when the user clicks, reused on retry). The server derives the charge key from it plus the user and action.

---

## 8. Client experience

Make it feel generous and clear. Nothing disappears; everything explains itself.

- **`EntitlementsProvider` + `useEntitlements()`**: React Query keyed by account id (the workspace page's owner account, or the user's own account on `/projects`). Refresh after any 2xx that carries `X-Billing-Balance` (update the cache from the header, no refetch), on the app event `billing:changed`, and on window focus.
- **Wallet pill** in the top bar: `1,240 credits · 3.5 videos`. Turns amber at 80% used, red when empty. Click opens Plan & billing. In someone else's brand it reads "Using Acme Agency's plan".
- **`<FeatureGate feature="campaigns">`** wraps every entry point (sidebar items, buttons, tabs, menu items, command bar actions). Allowed: render normally. Locked: render the same control with a small lock icon and a tooltip ("Growth plan"), and on click open the upgrade modal instead of the action. Keep locked items in their normal place. Only operational feature flags (for example `FEATURE_FLAG_PROOF_ENGINE_ENABLED`) may still hide things.
- **`<CostChip action="article_premium" />`** on every paid button: "100 credits" or "1 VC", computed from the catalog. Hover shows what is included free.
- **Upgrade modal** (`AppModalShell`, opened by `open:upgrade` with `{ feature?, limit?, requiredPlan }`):
  - Headline with the feature's `label` and `pitch`.
  - The required plan card: price with a monthly/annual toggle (default annual, show "2 months free"), the plan's highlights, and "Also unlocks" from `featuresGained(current, required)`.
  - Primary CTA: new customers open Paddle checkout; existing subscribers see a proration preview ("You pay $83.40 today, then $149 a month") and confirm.
  - Secondary: "Start 14-day Growth trial" when the owner has never trialed; "Compare all plans".
  - Non-owners: "Only the account owner can upgrade" and a **Request upgrade** button (creates `upgrade_requests`, notifies the owner in-app and by email).
- **Out-of-balance modal** (on `insufficient_balance`): what the action costs, what is left, one-click packs for that meter (credit packs or video packs), "Upgrade for more every month" with the next plan's allowance, and when the next monthly grant arrives.
- **Limit modal** (on `limit_reached`): current usage vs limit, the add-on that lifts it (if one exists and is `availability: "launch"`) and the upgrade option.
- **Global handling:** extend `authedFetch` (and the server-function client) so any 402 with a known `code` emits the right app event. Individual components may still handle it inline.
- **Plan & billing modal** (replaces `UsagePanel`; reachable from AccountMenu, the wallet pill, `/billing` deep link that opens it, and email links):
  - Overview: plan, status, renewal date, meters with progress and next expiry, trial countdown, past-due banner with "Update payment method" (Paddle portal).
  - Plans: all five plans side by side, current marked, change plan (upgrade now, downgrade at period end with a clear note of what changes and which brands would freeze), switch interval, pause, cancel (offer pause first).
  - Packs and add-ons: credit packs, video packs, add-ons with quantities.
  - Usage: this month's charges by action and by brand, per-brand caps (owner), Pro overage setting, Monday briefing brand selection.
  - History: ledger in plain words ("Premium article, Acme brand, 100 credits"), grants and expiries.
  - Invoices: opens the Paddle customer portal.
- **Nudges:** at 80% and 100% of any meter, once per grant window: a toast plus an in-app notification plus an email. Smart nudge: if an account bought packs worth more than the price difference to the next plan in the last 60 days, suggest the upgrade with the real numbers.
- **Onboarding:** after the Brand DNA reveal (`SuccessMoment`), show a compact plan picker with the Growth trial as the default call to action and "Continue on Free" as a quiet link.
- **Frozen brands:** open read-only with a banner ("This brand is paused because your plan includes 3 brands. Upgrade or choose which brands stay active.").
- **Empty and error states** use `EmptyState` / `ErrorState`. All copy is short, human and specific. No dark patterns: cancel is two clicks, and the pause offer is shown once.
- **Accessibility:** modals trap focus, locks have accessible labels, run `axe-core` in the e2e tests.

---

## 9. Paddle integration

Verify every API name against the current Paddle Billing docs (developer.paddle.com) before coding; use `@paddle/paddle-node-sdk` on the server and `@paddle/paddle-js` in the browser.

- **Catalog sync script** `scripts/billing/paddle-sync.mjs` (`npm run billing:paddle-sync -- --env sandbox|production`): idempotently creates or updates products and prices for the 4 paid plans (month and year), the pause plan, every `availability: "launch"` add-on (monthly, quantity-enabled), every credit pack and video pack (one-time), and the `FOUNDING30` discount (30% off, 12 months, annual prices only, 50 redemptions). Writes ids into `billing_price_map`. Uses `custom_data.catalog_key` on every Paddle object so ids can be re-found. Dry-run by default; `--apply` to write. Never touches production without `--env production --apply`.
- **Checkout** (`POST /api/billing/checkout`, owner only): body `{ kind: "plan" | "pack" | "addon", key, interval?, quantity?, trial?, discountCode? }`. The server validates against the catalog and returns `{ priceId(s), customData: { account_id, nonce }, customerEmail, discountId? }`. The browser opens Paddle.js overlay checkout with those values. No credits or plan change happen from the browser callback; only the webhook grants.
  - An existing subscriber buying a pack uses a one-time charge on the subscription (charge immediately) instead of a new checkout, after an explicit confirm.
  - Add-ons are items on the same subscription (quantity), prorated immediately.
- **Change plan:** preview first (Paddle's subscription update preview), show the amount, then apply. Upgrade and monthly-to-annual: prorated immediately. Downgrade and annual-to-monthly: apply without immediate billing so the new price starts next period, and set `downgrade_to` / `downgrade_at = current_period_end` so entitlements stay on the current plan until then (confirm the right proration mode in the docs).
- **Cancel:** cancel at next billing period; set `cancel_at`. Show "Your plan ends on …", and offer pause.
- **Pause:** a plan change to the pause price; store `resume_plan_id`. Resume changes back.
- **Customer portal:** create a portal session for payment method, invoices and receipts.
- **Webhook** `POST /api/public/hooks/paddle`: read the raw body, verify the `Paddle-Signature` header with `PADDLE_WEBHOOK_SECRET` before parsing, insert into `billing_events`, process, mark processed. A duplicate id whose `processed_at` is set is already handled (answer 200); a duplicate whose `processed_at` is still null is **reprocessed** (the first attempt crashed). Answer 200 for events deliberately ignored. For `subscription.*` events only, guard against out-of-order delivery by re-fetching the subscription from Paddle and applying its current state; never skip `transaction.*` or `adjustment.*` events as stale.

| Event | Effect |
|---|---|
| `subscription.created` (branch on its status: `trialing` is handled like `subscription.trialing`, never as a paid month), `subscription.activated` | Link subscription to the account (via the `checkout_intents` nonce and the server-created Paddle customer, never `custom_data` alone; map what was bought by price id through `billing_price_map`; refuse and alert on a second active subscription for one account), set plan, interval, status `active`, period, items; grant the month's allowances; sync `workspaces.plan`; unfreeze brands that now fit; first upgrade from Free triggers the free PREMIUM Brand DNA re-scan; referral reward if eligible. |
| `subscription.trialing` | Status `trialing`, `trial_used = true`, trial grants (catalog `TRIAL`), `trial_ends_at`. |
| `subscription.updated` | A `scheduled_change` of `cancel` (for example from the customer portal) sets `cancel_at`. Plan, interval or items changed: apply upgrade (difference grant) or schedule downgrade; add-on quantity changes update limits and, for credit-bearing add-ons, grant or stop their allowance; renewal to a new billing period: set the period only; the month's grant is issued when the recurring transaction is **paid** (next row), straight away, so there is no gap with zero credits. |
| `subscription.past_due` | Status `past_due`, `grace_until = now + 7 days`, notify owner. |
| `transaction.completed` / `transaction.paid` | Recurring subscription payment: issue the new window's plan grants. Pack purchase: grant credits (`any`) plus bonus (`ai_only`) or video units, keyed `txn:{id}:{item}`. Renewal payment after past due: status `active`, release withheld grants. |
| `transaction.payment_failed` | Notify owner with a portal link. |
| `subscription.canceled` | At the effective time: plan `free`, status `canceled`, plan grants already expire at period end; freeze brands over the Free limit (owner chooses which stay). |
| `adjustment.created` / `adjustment.updated` (refund, chargeback) | Act only once the adjustment is approved (refunds start as `pending_approval`). Refunded pack: claw back that grant's credits, recording any already-spent part as `debt` (decision 16). Refunded subscription payment: claw back the unused part of that window's plan grants. Chargeback: restrict the account to Free, alert admins. |

- **Reconciliation:** the billing hook re-reads subscriptions from Paddle for accounts with an event error, a scheduled change due, or no event in 35 days while active, and repairs drift. Log every repair.
- **Sync script details:** `trial_period` lives on the price in Paddle, so create separate Growth trial prices (monthly and annual) for the trial checkout. Create **monthly and annual prices for every add-on** (all recurring items on a subscription must share its billing cycle; annual add-on = 10x monthly). `FOUNDING30` is a non-recurring discount on the annual plan prices only (catalog `FOUNDING_OFFER`).
- **Proration modes:** upgrade `prorated_immediately`; downgrade, add-on removal and quantity decreases `do_not_bill` applied so that the change bills from the next period (never `prorated_next_billing_period`, which credits the customer while they stay entitled). Reconciliation must respect `downgrade_to` and not "repair" a scheduled downgrade back. Verify every mode name against the current docs.
- **Environments:** `PADDLE_ENV=sandbox|production`. Sandbox everywhere except production.

---

## 10. Lifecycle rules

- **Signup:** create the billing account (trigger on `auth.users` insert or first server touch), grant `SIGNUP_GRANT`, generate a `referral_code`, attribute a referral from the `mellox_ref` cookie set by `/r/<code>`.
- **Monthly grants:** `next_grant_at` drives the billing hook. Monthly paid plans grant when a new billing period starts (after payment). Annual plans grant on each monthly anniversary inside the paid year, running rollover first. Free grants its Flash allowance monthly from the signup anniversary. Each grant window expires the previous window's plan grants for that meter. Keys include the window start, so re-running is a no-op.
- **Trial:** once per owner (`trial_used`), card required, Growth limits with trial-sized money allowances. On conversion the full Growth grant replaces the trial grants (expire the trial remainder). On trial cancel: Free.
- **Upgrade mid-month:** new monthly allowance minus old, per meter, granted now with the current window's expiry. Features unlock immediately.
- **Downgrade at period end:** at `downgrade_at`, entitlements switch. Over-limit handling, never destructive:
  - Brands over the limit: freeze the newest extras unless the owner picked which to keep (ask during the downgrade flow). Frozen brands are read-only, background work stops, data stays.
  - Seats over the limit: nobody is removed; no new admin or editor invites until under the limit.
  - Tracked prompts, competitors over the limit: pause the newest extras.
  - Open experiments: running ones finish, no new ones.
- **Past due:** 7 days full access, no new monthly grant; then Free limits until paid; on payment everything returns and the withheld grant is issued.
- **Pause:** brands read-only, 10 weekly prompts on 2 engines, no AI allowances; purchased packs are kept (they never expire) and work again on resume. Auto-resume reminder at month 5, auto-cancel after 6 months with notice.
- **Comps:** admin can set `comped_plan_id` until a date (for design partners). Comped accounts get grants like paying ones.
- **Account deletion:** keep the ledger (financial record), anonymise the owner reference as the existing deletion flow allows.
- **Workspace ownership transfer:** not supported in this release; block it with a clear message.

---

## 10b. Edge cases the implementation must handle

- **Streaming routes** (`/api/chat`, `/api/brand-extract`, `/api/generate-image` stream their responses): hold before the stream starts, capture when the stream **finishes**, not when the `Response` object is returned. If the client disconnects after the model produced output, still capture (the cost is spent); if it disconnects before any output, release. Send the new balance as the final stream event (headers are already sent), and have the client refetch the wallet on `billing:changed`. The RPC route cannot set headers either: its callers refetch.
- **Routes without a verified workspace** (`auth: "user"` routes such as `brand-extract`, `generate-image`, `ai-generate`, `social-multi`, `file-extract`): charge the workspace only when `x-workspace-id` was verified (`attributedWorkspaceId`); otherwise charge the caller's **own** account. `brand-extract` runs during onboarding before a workspace exists: the first scan per account and normalized domain is free through `brand_scan_allowances`; later scans cost `brand_dna_rescan`.
- **`/api/ai-generate`** is priced by what it does: normal size = `social_multi`; size `long` on WORKHORSE = `article_standard`; escalated to PREMIUM = `article_premium` and requires `premium_articles` (otherwise it would be a back door around the gate).
- **Chat is priced per message within a token band** (catalog `chatUnitsFor`): one Pro message uses one unit per started 20k input tokens after the gateway's history trimming, one Flash message per started 16k. Enforce a hard input cap per message as well, so a pasted 200k-character document cannot make one message cost dollars.
- **"Fix all"** charges `geo_fix` for each finding it proposes a fix for and needs `geo_agent` for the batch pull request. The GEO Engineer agent run is `geo_agent_run`. Never charge Fix-all as one flat run.
- **Recurring content schedules** (`schedule.*` jobs the user sets up, possibly hourly) are user-initiated spending, not included background work: charge each run in the cron worker (`post_set`, or `article_*` by length), keyed `schedule:{job_id}:{run_at}`, and when the balance is short, skip the run, pause the schedule and notify the owner.
- **GEO agent runs** wait for a person's approval: the hold uses the 7-day TTL, is captured when the pull request opens, and is released when the run is cancelled or fails.
- **Plan change while holds are live:** holds keep their allocations; a downgrade never cancels a running action; expiring grants skip amounts that live holds still reference.
- **Free-signup abuse:** require a verified email before any paid action; refuse disposable email domains for the signup grant; one signup grant and one trial per person (by owner and card fingerprint where Paddle exposes it); pause Free accounts' background work (weekly prompts, scans) after 30 days without a sign-in.

## 11. Included background work per plan (build and re-scope)

1. **Tracked prompts (new feature).** Table `geo_tracked_prompts` (`workspace_id`, `text`, `engines`, `cadence`, `paused_at`, `created_by`) and `geo_prompt_checks` (`prompt_id`, `engine`, `model`, `checked_at`, `mentioned`, `position`, `cited_urls`, `competitors_mentioned`, `answer_hash`, `cost_usd`). Suggestions generated from Brand DNA (the user accepts them; nothing is tracked without a person choosing it, like competitor discovery). Weekly checks by default, daily for prompts covered by the `daily_tracking_100` add-on. Engines per plan from the catalog: `perplexity/sonar`, `openai/gpt-5.6-luna` ("ChatGPT"), `google/gemini-3.8-flash` ("Gemini"), each asked separately. Reuse `src/lib/geo/probes.ts` (`detectMentions`, `extractCitations`). Add `GEO_PROBE_WEB_SEARCH=on|off` (default on) that enables OpenRouter web search for the Luna and Gemini probes, and label results honestly in the UI ("model answer with web search", not "what ChatGPT shows"). Set the Gemini probe's reasoning effort to low. Advance it from the **existing** geo-scans cron hook with leased jobs; do not add a cron job. UI inside the AI Visibility surface: prompt list, add or edit, per-prompt trend, share of voice vs tracked competitors, and a weekly summary. Limit = plan `trackedPrompts` + add-ons, pooled across the account's brands. Metered and budget-checked as background work.
2. **Site scans:** count per grant window; `geoMaxPages` from the plan; extra scans charge as in section 7.
3. **Market Brain:** weekly for up to `marketBrainWeeklyBrands` brands (+ `extra_brand` add-ons); daily only for brands with `daily_market_brain`. Change `market-brain-scheduler.server.ts` accordingly.
4. **Monday Coach briefing:** weekly for `coachWeeklyBriefings` brands (owner chooses; default the most active), delivered in-app and by email if configured.
5. **Competitors:** tracked count limit per plan (pooled), sweep frequency from `competitorSweepsPerWeek`.
6. **Social profiles, experiments, renders:** social profiles are a limit (decision 17); experiments and renders keep their existing counters and concurrency limits, now read from entitlements (`maxConcurrentRenders()` in `src/server/ugc/models.server.ts` takes the plan value; `UGC_MAX_CONCURRENT_RENDERS` stays as an optional global cap).

---

## 12. Model and cost fixes from the pricing review

- Free-plan Brand DNA and Brand Kit analysis run on WORKHORSE (add a plan-aware override when resolving the route plan; keep the registry the single place models are named).
- `GEO_AGENT_MAX_COST_USD` default 3.00 (Opus 5.5 at high effort outgrows 1.50).
- Video providers per decision 18: KIE for `standard`, `draft` and `variation`; OpenRouter for `premium`, `cinematic`, `long` and the Studio clip; OpenRouter fallback for every KIE option, with `variation` falling back to Veo 3.1 Lite 6s. Implement it in the existing routed provider (`src/server/ugc/providers/routed.server.ts`) from the catalog's `provider` / `fallback` fields. When KIE is unconfigured, everything runs on OpenRouter and the VC floor guard (`MAX_USD_PER_VC`) still protects margin. `variation` is 0.5 VC on both resolutions.
- The video router (`src/lib/ugc/router.ts`) must receive the plan's entitlements and never auto-pick a locked option (for example `premium` or `cinematic` for a Starter account). KIE's 768p is priced and gated like 720p. Price every render from the model registry cost of the provider it actually routes to, through `videoUnitsFor(..., providerCostUsd)`, show that figure on the Generate button (preview) and charge the same figure.
- Add a `studio.article.standard` route on WORKHORSE (medium) for the "Standard article" option (20 credits) and register it in `task-models.ts`.
- Alert when `openai/gpt-5.6-terra` answers more than 10% of WORKHORSE calls in a day (the fallback costs about 3x).
- Record OpenRouter `usage.cost` as the cost of record everywhere it is returned (already the rule in `pricing.ts`; make sure video and image paths follow it).

---

## 13. Admin, monitoring and notifications

- **Admin console** at `/admin` (server-side guard: `MELLOX_ADMIN_USER_IDS`, a comma-separated list of user ids; everything audited through `recordAudit`):
  - Search accounts by email, account id or workspace id.
  - Account page: plan, status, Paddle ids, period, balances by meter and by grant, holds, ledger, brands, members, this month's provider cost vs revenue, events.
  - Actions (reason required): grant or adjust any meter, comp a plan until a date, end a trial, resync from Paddle, replay a failed webhook, set the enforcement override, unfreeze a brand.
  - Reports: margin by action (credits charged vs provider cost via `charge_id`), cost to serve by plan vs the workbook's typical figures, top-cost accounts, shadow-mode report (would-charge and would-block by action and plan), webhook failures.
- **Margin monitor** (hourly rollup in the billing hook, table `billing_margin_daily`): alert to `ALERT_WEBHOOK_URL` when an action's 7-day margin drops below 65%, when an account's provider cost this month exceeds its monthly price, when the Terra fallback share passes 10%, when webhook processing errors appear, when connected social profiles pass 80% of `SOCIALAPI_TIER_PROFILES`, when KIE's fallback share to OpenRouter passes 15% in a day, or when the refund ceiling logic in `credits.server.ts` trips.
- **Notifications** (in-app always; email when `RESEND_API_KEY` is set; sender from `BILLING_EMAIL_FROM`): trial ending in 3 days, meter at 80% and 100%, payment failed, grace ending tomorrow, downgrade scheduled and applied, brand frozen, plan changed, upgrade request (to owner), referral reward, weekly Monday briefing. One email per kind per window; users can mute non-critical ones.

---

## 14. Migrating existing data

- Create a billing account for every distinct workspace owner; set `billing_account_id` on every workspace; then `NOT NULL`.
- Existing users were never charged for a subscription, so every account starts on **Free** with the signup grant, trial eligibility and the founding offer. **ASK ZAIN** for the list of accounts to comp (design partners); build the admin action so he can do it himself after launch.
- Move each workspace's backlink credit balance (bought through Stripe) into its owner's account as a `migration` grant with restriction `any`, keyed `migrate:ws:{workspace_id}`. Recreate live link-order holds as account holds with the **same** keys (`order:{id}:hold`) so the runner's later capture or release lands correctly. If that is too risky, make the migration refuse to run while any link order is in a non-terminal state, and say so in the ADR.
- Replace every reader of `workspaces.plan` with entitlements; keep the column synced until the last reader is gone.
- Backfill `ai_usage_events.billing_account_id` for the current month so budgets are continuous.

---

## 15. Testing and verification

- **Unit (vitest):** catalog invariants (plans ordered and monotonic where expected, every feature's `minPlan` valid, video options unique, `videoUnitsFor` never below cost, `annualMonthlyUsd`), route coverage (every `task-models.ts` route is in some action's `routes` or in `INCLUDED_ROUTES`), entitlements for every plan x status x comp x frozen case, `runMetered` (shadow, off, on; success, failure, partial capture, viewer, frozen), error-to-402 mapping, grant scheduling and rollover maths, proration difference grants.
- **Database:** grant, hold, partial captures and finalize, release, expire, debt; idempotent replays; concurrent holds cannot overspend (run many in parallel on a real Postgres, local Supabase or a disposable container, because PGlite has a single connection and cannot prove this); consumption order; `require_any` for backlinks; per-brand caps; append-only trigger; balances never negative; the `apply_credit_entry` wrapper with the link runner's key patterns.
- **Webhooks:** signature valid and invalid, duplicate event, out-of-order events, each event's effect, unknown catalog key, tampered `custom_data`.
- **Security:** RLS for every new table (a member of workspace A cannot read account B), IDOR on every billing route, prices and amounts never accepted from the browser, owner-only actions, admin guard.
- **E2E (Playwright):** Free user clicks a locked feature and sees the upgrade modal with the right plan; checkout opens (stub Paddle.js in tests); after a simulated webhook the feature unlocks without a reload; out-of-balance modal and one-click pack; wallet pill updates after an action; editor sees Request upgrade; frozen brand banner; `axe-core` passes on every billing modal.
- **Live, opt-in** `tests/live/billing.live.ts` behind `BILLING_LIVE=yes`: sandbox checkout creation, Paddle webhook simulation, grants arrive, subscription change preview.
- Then follow the "Verifying work" section of `CLAUDE.md`: apply migrations to the real database (dry-run first), exercise real paths on a dev server, and say plainly what could not be verified.

---

## 16. Environment variables (names only; add to `.env.example`)

`BILLING_PROVIDER=paddle`, `BILLING_ENFORCEMENT=shadow`, `PADDLE_ENV=sandbox`, `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`, `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN`, `NEXT_PUBLIC_PADDLE_ENV=sandbox`, `RESEND_API_KEY`, `BILLING_EMAIL_FROM`, `MELLOX_ADMIN_USER_IDS`, `GEO_PROBE_WEB_SEARCH=on`, `VIDEO_PROVIDER_<KEY>=kie|openrouter` (optional per-option override of decision 18), `SOCIALAPI_TIER_PROFILES=10` (profiles in Zain's current SocialAPI tier, for the capacity alert), `BILLING_LIVE` (tests only). Keep `STRIPE_*` documented as legacy. Existing `PLAN_*` overrides become `BILLING_OVERRIDE_<PLAN>_<FIELD>` read only on the server (optional; keep the catalog authoritative).

---

## 17. Phases and definition of done

Each phase: green checks, a commit, and a short note in `docs/billing/PLAN.md` of what landed.

1. **Foundation.** Move the catalog. Migrations for accounts, workspace link, grants, ledger, balances, holds, charges, events, price map, shadow events, counters. SQL functions and the `apply_credit_entry` wrapper. Backfill accounts and balances. `BILLING_ENFORCEMENT=off`. *Done when* every workspace has an account, the link order runner's tests pass through the wrapper, and database tests cover section 15.
2. **Engine.** `accounts`, `entitlements`, `meters`, `runMetered`, errors and 402 mapping, limits, grants (signup, monthly, rollover, expiry, hold sweeper), billing cron hook, `ai_usage_events` columns, account-scoped budgets, shadow logging, `GET /api/billing/entitlements` and wallet. *Done when* unit and database tests pass and shadow mode logs a correct would-charge for a Studio job end to end.
3. **Enforcement.** Wire every row of section 7 and section 10b, the coverage test, included-work limits, brand, seat and social-profile limits (and remove `monthlyPosts`), frozen brands, chat Pro and Flash allowances. *Done when* the coverage test passes and a manual pass over each surface in shadow and on modes behaves as specified.
4. **Experience.** Provider, wallet pill, FeatureGate on every entry point, CostChips, upgrade, out-of-balance and limit modals, Plan & billing modal, 402 handling in `authedFetch` and server-function stubs, nudges, onboarding plan picker, frozen banner, landing page PLANS data and JSON-LD. *Done when* the e2e tests in section 15 pass (with Paddle stubbed).
5. **Paddle.** Sync script, checkout, change plan with preview, packs, add-ons, portal, cancel, pause, resume, trial, founding discount, referral rewards, webhook, reconciliation. *Done when* the sandbox flow works end to end: buy Starter, upgrade to Growth with proration, buy a video pack, downgrade at period end (simulated), cancel, resume.
6. **Lifecycle and notifications.** Past-due grace, downgrades with freezing choice, cancel to Free, refunds and chargebacks, comps, all notifications and emails. *Done when* each rule in section 10 has a test.
7. **Included work and cost fixes.** Video provider split (decision 18) with fallbacks and plan-aware routing, tracked prompts feature, Market Brain weekly/daily, Monday briefing, competitor sweep cadence, section 12 fixes. *Done when* tracked prompts run on schedule within limits and the scheduler tests pass.
8. **Admin and monitoring.** Admin console, margin rollups and alerts, shadow report, webhook replay. *Done when* an admin can find an account, grant credits with a reason, see margins by action, and replay a failed event.
9. **Launch hardening.** Full suite, e2e, live sandbox run, concurrency test of holds, security review (RLS, IDOR, webhook, price tampering), performance check of entitlements (cache it; no N+1 on page load), update `CLAUDE.md` with a "Billing and credits" section in the same style as the others, write `docs/billing.md` (how it works) and a billing runbook in `docs/OPERATIONS-RUNBOOK.md` (webhook failure, refund, comp, stuck hold, enforcement rollback). Also add `/terms`, `/privacy` and `/refunds` pages if missing (Paddle's domain review requires them), clearly marked as drafts for legal review.

**Rollout order after merge** (write it in the runbook): deploy with `BILLING_ENFORCEMENT=shadow`; run 3 to 7 days and compare the shadow report with the workbook's typical usage; Paddle production approval; set enforcement `on` for Zain's own test account via the override; then `on` for everyone.

---

## 18. What only Zain can do (list these in your final report as a checklist)

1. Create the Paddle Billing account (sandbox first, then production), complete business verification and domain approval.
2. Create API keys, the client-side token, and a webhook destination pointing at `/api/public/hooks/paddle` subscribed to the events in section 9. Put the secrets in the deployment environment, never in chat or code.
3. Run `npm run billing:paddle-sync -- --env sandbox --apply`, then production.
4. Create a Resend account, verify the sending domain (SPF, DKIM), set `RESEND_API_KEY` and `BILLING_EMAIL_FROM`.
5. Set `MELLOX_ADMIN_USER_IDS`.
6. Rotate any API key that was ever pasted, shared or committed.
7. Review the draft legal pages with a lawyer, and confirm with Paddle during onboarding that selling credits usable for backlink placements is within their acceptable-use policy (if not, sell backlink balance through a separate route or keep it off Paddle).
8. Check the SocialAPI.ai invoice: the pricing page bills per connected profile (1 profile = 1 brand). If your account is billed per platform account, tell Claude Code to switch the limit unit (decision 17) and update the workbook input.
9. Upgrade the SocialAPI tier before the capacity alert fires (10 → 50 → 200 profiles).
10. Decide which existing accounts to comp and approve the grandfathering rule (decision 15).
11. Flip `BILLING_ENFORCEMENT` from `shadow` to `on` when the shadow report looks right.

---

## 19. Final report

When everything is done, reply with:

- What was built, by phase, with the main files.
- How to verify it locally and in the Paddle sandbox, step by step.
- Test results (counts) and what could not be verified and why.
- Every new environment variable and migration.
- The checklist from section 18.
- Anything you changed from this brief and why (also in the ADR).
- Known gaps or follow-ups, ranked by risk to revenue.
