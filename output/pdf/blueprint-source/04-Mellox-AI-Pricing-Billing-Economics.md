# Mellox AI - Pricing, Billing & Economics

Snapshot: 2026-10-21 | commit 055c90977c2ccf15237e985b8a333e4b146e30be

## How to use this volume

This is volume 04 of six documents describing Mellox AI as represented in the local source snapshot on 21 October 2026. The owner confirmed that this repository is current, Railway is the hosting platform, codebase pricing should be used, and mellox.ai is the public website.


**Evidence labels:** Implemented means source exists and is mapped here; it does not prove that a production migration, credential, permission or feature switch is enabled. Owner-confirmed identifies facts supplied by the owner. External-verified identifies official web information checked on the snapshot date. Recommended identifies a rebuild or operating procedure. Unverified identifies missing deployment or commercial evidence.


Runtime code, migrations and current configuration outrank older guides. Model and price tables describe defaults unless explicitly stated otherwise. They are a dated reference, not a promise that vendors will retain them. No credentials or customer records are included.


| Volume | Read it for |

| --- | --- |

| 01 Product & workflows | Feature behavior, journeys, approvals and module ownership |

| 02 Architecture & engineering | Frontend, backend, integrations, APIs and implementation patterns |

| 03 AI models & generation | Every task-model route, images, video, context and evaluations |

| 04 Pricing & billing | Plans, feature gates, all action prices, wallets and economics |

| 05 Railway & operations | Deployment, configuration, jobs, security, recovery and diagnostics |

| 06 Rebuild & data reference | Build order, acceptance criteria, full typed schema and migration index |

### Contents

## What the prices mean

The owner asked this series to use the current codebase pricing. The canonical commercial catalog is src/lib/billing/catalog.ts. Its USD subscription, action, pack and offer values are reproduced here. These are implemented catalog definitions, not proof that every price is synchronized to Stripe, that every promotion is currently active, or that production has no account-specific override.


Mellox has several different units. General credits buy AI/content actions; Video Credits buy video; Pro and Flash messages have their own allowance counters; social publishing has fair-use counts rather than general-credit charges. A separate link-placement purchase subsystem also uses credit terminology and payment code. Do not mix those ledgers.


One general credit has a one-cent catalog face value. It is not a guaranteed one-cent provider cost or cash-equivalent balance. One Video Credit is stored as 100 integer video units, allowing quarter or half units without floating-point money. The current owner billing account shares balances across that owner's brands. Workspace roles still constrain spending.


Implementation sources: src/lib/billing/catalog.ts; src/server/billing/accounts.server.ts; src/server/billing/meters.server.ts; src/server/links/credits.server.ts


## Subscription prices and monthly allowances

| Plan | Monthly USD | Annual USD | Brands / seats | Credits / VC | Pro / Flash |

| --- | --- | --- | --- | --- | --- |

| Free | $0 | $0 | 1 / 1 | 0 / 0 | 0 / 30 |

| Starter | $49 | $490 | 1 / 2 | 2,000 / 4 | 30 / 800 |

| Growth | $149 | $1,490 | 3 / 5 | 6,000 / 12 | 150 / 2,000 |

| Agency | $449 | $4,490 | 10 / unlimited | 18,000 / 40 | 400 / 5,000 |

| Scale | $1,199 | $11,990 | 30 / unlimited | 50,000 / 100 | 1,200 / 12,000 |

Annual prices are the whole-year charge, equal to ten monthly payments. Annual plans still receive monthly grants. Free receives no recurring general-credit grant; the separate signup grant supplies 100 trial credits once. Seats count distinct owner/admin/editor users across the account brands; the catalog describes viewers as free. Unlimited seats does not waive workspace membership checks.


Paid annual plans have one-month rollover handling with a cap of one month of allowance, as defined in the catalog and grant logic. Monthly grant expiry, source restrictions and purchased pack treatment must follow server/SQL rules, not a simplified UI balance.


Implementation sources: src/lib/billing/catalog.ts; src/server/billing/grants.server.ts; src/server/billing/seat-count.server.ts


## Operational limits by plan

### Free

| Limit | Catalog value |

| --- | --- |

| trackedPrompts | 5 |

| engines | chatgpt, gemini |

| promptCadence | weekly |

| scansPerMonth | 1 |

| geoMaxPages | 25 |

| competitors | 0 |

| competitorSweepsPerWeek | 0 |

| marketBrainWeeklyBrands | 0 |

| coachWeeklyBriefings | 0 |

| postsFairUse | 100 |

| maxConcurrentExperiments | 0 |

| maxConcurrentRenders | 0 |

Spend safety defaults: $1 per day / $3 per month. Support copy: Community.


### Starter

| Limit | Catalog value |

| --- | --- |

| trackedPrompts | 25 |

| engines | perplexity, chatgpt, gemini |

| promptCadence | weekly |

| scansPerMonth | 4 |

| geoMaxPages | 50 |

| competitors | 3 |

| competitorSweepsPerWeek | 1 |

| marketBrainWeeklyBrands | 1 |

| coachWeeklyBriefings | 1 |

| postsFairUse | 500 |

| maxConcurrentExperiments | 1 |

| maxConcurrentRenders | 1 |

Spend safety defaults: $4 per day / $30 per month. Support copy: Email.


### Growth

| Limit | Catalog value |

| --- | --- |

| trackedPrompts | 100 |

| engines | perplexity, chatgpt, gemini |

| promptCadence | weekly |

| scansPerMonth | 10 |

| geoMaxPages | 150 |

| competitors | 10 |

| competitorSweepsPerWeek | 2 |

| marketBrainWeeklyBrands | 3 |

| coachWeeklyBriefings | 1 |

| postsFairUse | 1500 |

| maxConcurrentExperiments | 3 |

| maxConcurrentRenders | 2 |

Spend safety defaults: $12 per day / $91 per month. Support copy: Email, 24 h.


### Agency

| Limit | Catalog value |

| --- | --- |

| trackedPrompts | 300 |

| engines | perplexity, chatgpt, gemini |

| promptCadence | weekly |

| scansPerMonth | 30 |

| geoMaxPages | 300 |

| competitors | 30 |

| competitorSweepsPerWeek | 2 |

| marketBrainWeeklyBrands | 10 |

| coachWeeklyBriefings | 3 |

| postsFairUse | 5000 |

| maxConcurrentExperiments | 15 |

| maxConcurrentRenders | 4 |

Spend safety defaults: $34 per day / $269 per month. Support copy: Priority + onboarding call.


### Scale

| Limit | Catalog value |

| --- | --- |

| trackedPrompts | 1000 |

| engines | perplexity, chatgpt, gemini |

| promptCadence | weekly |

| scansPerMonth | 90 |

| geoMaxPages | 500 |

| competitors | 90 |

| competitorSweepsPerWeek | 2 |

| marketBrainWeeklyBrands | 30 |

| coachWeeklyBriefings | 10 |

| postsFairUse | 15000 |

| maxConcurrentExperiments | 50 |

| maxConcurrentRenders | 8 |

Spend safety defaults: $96 per day / $767 per month. Support copy: Dedicated manager.


Publishing is marketed as unlimited and consumes no AI credits, but postsFairUse remains an abuse-control cap. Each destination-network post counts separately, and Story frames have provider-post implications. These are internal operating limits; they must not be confused with a bank of AI credits. Concurrent-render limits and available video tiers still depend on plan and runtime configuration.


Implementation sources: src/lib/billing/catalog.ts; src/server/billing/limits.server.ts


## Feature entitlement matrix

| Capability | Minimum plan | Availability |

| --- | --- | --- |

| Studio | free | launch |

| Premium articles | starter | launch |

| Mellox Pro chat | starter | launch |

| UGC video ads | starter | launch |

| 1080p video | growth | launch |

| Premium and Long-take video | growth | launch |

| Cinematic video | agency | launch |

| Campaign plans | growth | launch |

| Approval workflows | growth | launch |

| GEO fix proposals | starter | launch |

| One-click fixes | growth | launch |

| GEO Engineer and Fix all | growth | launch |

| Proof Engine experiments | starter | launch |

| Competitor tracking | starter | launch |

| Market Brain | starter | launch |

| Audience | starter | launch |

| GA4 and Search Console insights | starter | launch |

| Publishing | free | launch |

| Backlink marketplace | growth | launch |

| Client portal | growth | launch |

| Agency command center | agency | launch |

| Autopilot | growth | launch |

| White-label | agency | launch |

| SSO and API access | scale | later |

Catalog later entries must remain coming soon. planAllows is rank comparison, while isFeatureAvailable handles launch availability; consumers must use the appropriate server entitlement path rather than assume rank alone means shipped. Scale tagline/support copy does not establish a signed SLA or implemented SSO.


Implementation sources: src/lib/billing/catalog.ts; src/server/billing/feature.server.ts; src/server/billing/entitlements.server.ts


## Complete general-credit action price list

Provider-cost figures in the following table are catalog estimates. They are not current invoices, do not include all overhead, and can differ after retries, premium routing, long inputs, search, or provider changes. Face value is credits / 100 USD; the customer usually receives credits inside a subscription.


| Action / unit | Credits | Estimated provider USD | Feature gate |

| --- | --- | --- | --- |

| Social post set; up to 3 platforms; post_set | 12 | $0.023 | studio |

| Regenerate a post; per post; post_regenerate | 4 | $0.008 | studio |

| Image post; copy + image; image_post | 30 | $0.066 | studio |

| Carousel; per carousel; carousel | 30 | $0.060 | studio |

| Story; up to 7 frames; story | 20 | $0.040 | studio |

| Ad set; copy variants + image; ad_set | 30 | $0.058 | studio |

| Standard article; ~1,200 words; article_standard | 20 | $0.031 | studio |

| Premium article; ~1,200 words; article_premium | 100 | $0.193 | premium_articles |

| Long-form article; ~2,500 words; article_long | 140 | $0.273 | premium_articles |

| Video script; per script; script | 10 | $0.021 | studio |

| Content ideas; per batch; ideas | 7 | $0.014 | studio |

| Multi-platform variants; 5 platforms; social_multi | 10 | $0.019 | studio |

| Standard image; per image; image_standard | 15 | $0.037 | studio |

| Premium image; per image; image_premium | 40 | $0.086 | studio |

| Image edit; up to 2 references; image_edit | 20 | $0.050 | studio |

| Campaign plan; per plan; campaign | 55 | $0.107 | campaigns |

| Brand DNA re-scan; first scan per brand is free; brand_dna_rescan | 125 | $0.234 | none |

| File or image reading; per file; file_extract | 4 | $0.008 | none |

| Coach briefing on demand; per briefing; coach_briefing | 100 | $0.196 | market_brain |

| Deep strategy; per run; coach_deep | 200 | $0.375 | pro_chat |

| Strategy rebuild; first strategy per brand is free; strategy_rebuild | 200 | $0.375 | none |

| Market Brain refresh; outside the weekly schedule; market_brain_manual | 125 | $0.243 | market_brain |

| Competitor discovery; per run; competitor_discovery | 25 | $0.051 | competitors |

| Competitor profile; per competitor; competitor_profile | 15 | $0.031 | competitors |

| Competitor intelligence report; per report; competitor_intel | 30 | $0.057 | competitors |

| Analytics insights; per refresh; insights_refresh | 8 | $0.017 | analytics_insights |

| Audience check; per post; audience_pulse | 6 | $0.012 | audience |

| Compare versions; per comparison; audience_tournament | 12 | $0.024 | audience |

| Extra site scan; per 100 pages; site_scan_per_100_pages | 35 | $0.070 | none |

| Extra prompt check; 3 engines; prompt_check_3_engines | 8 | $0.016 | none |

| GEO fix proposal; per finding; geo_fix | 150 | $0.286 | geo_fix_proposals |

| One-click fix; per fix; geo_cms_fix | 55 | $0.107 | geo_apply_fixes |

| GEO Engineer run; per run; geo_agent_run | 800 | $1.600 | geo_agent |

| Proof Engine experiment; per experiment; experiment | 70 | $0.144 | experiments |

| UGC concept pack; per product; ugc_concepts | 25 | $0.051 | ugc |

| Mellox Pro message; after the monthly allowance; pro_message | 25 | $0.048 | pro_chat |

| Mellox Flash message; after the fair-use cap; flash_message_over_cap | 2 | $0.009 | none |

Implementation sources: src/lib/billing/catalog.ts


### Included route work

The catalog explicitly includes these internal routes instead of charging a standalone general-credit action. Included does not remove operational provider spend. Parent jobs or message counters can still charge their overall action.


chat.research, chat.history-summary, clarify, memory-extract, studio.naturalize, studio.research, studio.trends, studio.image.review, brand-visuals.review, analytics/insights-auto, agent.content-fit, agent.distribution-reliability, competitors.updates, autopilot.plan, autopilot.strategy, autopilot.opportunities, audience.twins, audience.score, links-topical-fit, links-relevance-pick, links-profile, links-article-brief, guardrails.image-moderation, guardrails.media-safety, articles.blog-design


## Video credits, native quotes and output lengths

A Video Credit is not a general credit. Current video options use integer videoUnits and product feature gates. The tables below reproduce catalog reference options; the provider model registry separately determines valid native resolution/duration and references. For example premium's catalog label is not permission to request a resolution unsupported by the selected upstream provider.


videoUnitsFor prices a UGC request from its option, seconds, resolution band and estimated provider cost. The result is at least the catalog match or a cost-based floor. It rounds to quarter-VC steps, with a minimum of 0.25 VC. USD_PER_VC_REFERENCE is $0.844, and MAX_USD_PER_VC is $1.01. These are code guard parameters, not an advertised sale price or measured average cost.


For an exact option, the cost floor in integer units is max(1, ceil(cost / 1.01 x 4)) x 25. For an unmatched option, the proportional quote uses max(1, ceil(cost / .844 x 4)) x 25 and still respects the floor. The routed provider's actual capabilities and reference-image costs matter.


Studio's default ten-second video uses an explicit two-VC quote and scales by ten-second blocks: ceil(seconds / 10) x 200 units. A sixty-second Studio output therefore quotes 12 VC. It may require multiple provider clips and FFmpeg assembly; it is not equivalent to a single eight-second Standard UGC option.


Implementation sources: src/lib/billing/catalog.ts; src/lib/ugc/duration.ts; src/server/ugc/models.server.ts; src/server/billing/ugc-async.server.ts; src/server/billing/studio-async.server.ts


| Catalog option | VC | Primary / fallback | Gate |

| --- | --- | --- | --- |

| Draft 8s 720p | 0.5 | kie; openrouter google/veo-3.1-lite | ugc |

| Draft 8s 1080p | 0.75 | kie; openrouter google/veo-3.1-lite | video_1080p |

| Standard 8s 720p | 1 | kie; openrouter google/veo-3.1-fast | ugc |

| Standard 8s 1080p | 1.25 | kie; openrouter google/veo-3.1-fast | video_1080p |

| Premium 8s | 1.5 | openrouter; none | video_premium |

| Premium 10s | 2 | openrouter; none | video_premium |

| Cinematic 10s | 2 | openrouter; none | video_cinematic |

| Long take 12s 720p | 1.5 | openrouter; none | video_premium |

| Long take 15s 720p | 2 | openrouter; none | video_premium |

| Long take 15s 480p | 1 | openrouter; none | video_premium |

| Quick variation 6s 720p | 0.5 | kie; openrouter google/veo-3.1-lite 6s | ugc |

| Quick variation 6s 480p | 0.5 | kie; openrouter google/veo-3.1-lite 6s | ugc |

## Credit packs, video packs and add-ons

| General pack | USD | Base + bonus | Total |

| --- | --- | --- | --- |

| credits_25 | 25 | 2,500 + 0 | 2,500 |

| credits_100 | 100 | 10,000 + 500 | 10,500 |

| credits_250 | 250 | 25,000 + 2,500 | 27,500 |

| credits_500 | 500 | 50,000 + 7,500 | 57,500 |

| Video pack | USD | Video Credits |

| --- | --- | --- |

| video_10 | 29 | 10.0 |

| video_30 | 79 | 30.0 |

| video_100 | 249 | 100.0 |

| Add-on | USD / month | Plans / status | Adds |

| --- | --- | --- | --- |

| Extra brand | 39 | growth, agency, scale; launch | brands=1; trackedPrompts=30; credits=1500; videoUnits=300; marketBrainWeeklyBrands=1 |

| +100 tracked prompts | 39 | starter, growth, agency, scale; launch | trackedPrompts=100 |

| Daily tracking, per 100 prompts | 149 | growth, agency, scale; later | dailyTrackedPrompts=100 |

| Daily Market Brain, per brand | 29 | starter, growth, agency, scale; later | marketBrainDailyBrands=1 |

| +200 Mellox Pro messages | 29 | starter, growth, agency, scale; launch | proMessages=200 |

| Extra seat | 15 | starter, growth; launch | seats=1 |

| Google AI Overviews, per 100 prompts | 15 | starter, growth, agency, scale; later | aiOverviewPrompts=100 |

| White-label domain | 49 | agency, scale; later | custom domain entitlement |

Implementation sources: src/lib/billing/catalog.ts


## Signup, trial, referrals and retention offers

### Signup Grant

| Parameter | Catalog value |

| --- | --- |

| credits | 100 |

| restriction | ai_only |

| expiresInDays | 30 |

### Trial

| Parameter | Catalog value |

| --- | --- |

| plan | growth |

| days | 14 |

| credits | 500 |

| videoUnits | 200 |

| proMessages | 20 |

| flashMessages | 500 |

| oncePerOwner | True |

### Pause

| Parameter | Catalog value |

| --- | --- |

| usdPerMonth | 9 |

| trackedPrompts | 10 |

| engines | chatgpt, gemini |

| maxMonths | 6 |

| annualPausesAtTermEnd | True |

### Founding Offer

| Parameter | Catalog value |

| --- | --- |

| code | FOUNDING30 |

| percentOff | 30 |

| appliesTo | first_annual_payment |

| maxRedemptions | 50 |

| intervals | year |

### Referral

| Parameter | Catalog value |

| --- | --- |

| credits | 1000 |

| videoUnits | 200 |

| restriction | ai_only |

| expiresInDays | 90 |

| maxRewardsPerYear | 20 |

| rewardAfterDays | 14 |

These records describe the offer rules. Checkout eligibility, one-time use, funding source restrictions, expiry, annual-term handling and duplicate-grant prevention are enforced by the billing services. The referral worker checks qualifying payment and the waiting period, then grants both eligible sides with deterministic keys. No claim is made that a marketing campaign or Stripe coupon is currently activated.


SOFT_LIMIT_RATIO is 0.8; PAST_DUE_GRACE_DAYS is 7. Past-due and pause behavior must be implemented through account state and entitlements, including brands that become read-only beyond a reduced allowance. Retain work rather than destroy it simply because a subscription changed.


Implementation sources: src/lib/billing/catalog.ts; src/server/billing/lifecycle.server.ts; src/server/billing/referrals.server.ts


## Financial lifecycle and idempotency

A paid action resolves the acting user's role, owner billing account, current plan/add-ons/overrides and effective enforcement mode. Viewer restrictions remain even in billing maintenance or shadow mode. It checks frozen brands and feature eligibility before acquiring a hold. The hold is keyed by the caller, action and idempotency key.


Success captures all or the supported partial amount; definitive failure releases unused balance. Async Studio and UGC jobs preserve the hold across polls and reconcile it from final job status. A retry of an accepted or finished charge does not create a second independent hold. A dropped HTTP response must not become a free path or a double charge.


The enforcement modes are off, shadow and on. Current global default is on in production and off outside production when no explicit BILLING_ENFORCEMENT is supplied. Shadow records decisions without applying ordinary charging. Production must not silently become unlimited because the schema or an entitlement query is missing; readiness has an explicit unavailable response when required.


Account subscription purchase processing uses Stripe price mappings and signed webhook handling. A return to the success page alone is not proof of payment. Grants, subscription windows, refunds/clawbacks and manual activations need durable, replay-safe records. There is separate Stripe code for link purchase packs; its customer/credit mapping is not the owner-account subscription system.


Implementation sources: src/server/billing/mode.server.ts; src/server/billing/metered.server.ts; src/server/billing/meters.server.ts; src/server/billing/async-charges.server.ts; src/server/billing/stripe-account.server.ts; src/server/billing/stripe.server.ts; src/app/api/public/hooks/stripe/route.ts


Flow: Request + verified role + owner account -> Resolve plan / availability / restrictions -> Hold balance with stable replay key -> Execute or advance durable job -> Capture success / partial success OR release failure -> Webhook / worker reconciliation -> append-only financial evidence

## Provider cost model and verified text rates

| Model | Code input / 1M | Code output / 1M | Current check |

| --- | --- | --- | --- |

| anthropic/claude-opus-5.5 | $4 | $20 | Official listing checked |

| google/gemini-3.8-flash | $0.75 | $3.75 | Official listing checked |

| google/gemini-3.1-flash-lite | $0.25 | $1.5 | Official listing checked |

| openai/gpt-6.1-sol | $2 | $10 | Official listing checked |

| openai/gpt-6-luna | $0.1 | $0.5 | Official listing checked |

| openai/gpt-5.6-terra | $2 | $12 | Estimate retained; not independently refreshed |

| openai/gpt-5.6-luna | $0.2 | $1.2 | Estimate retained; not independently refreshed |

| perplexity/sonar | $1 | $1 | Estimate retained; not independently refreshed |

The main five text prices match the OpenRouter listings checked on 21 October 2026. Historical GPT-5.6 entries remain in code for historical usage/explicit overrides; they are not current default routes. For unknown text models the cost estimator uses $5 input / $25 output per million tokens as a conservative fallback. Provider-reported cost wins when available.


Fallback estimation formula: (inputTokens x inputRate + cachedReadTokens x inputRate x 0.1 + cachedWriteTokens x inputRate x 1.25 + outputTokens x outputRate) / 1,000,000. This is the implementation formula; upstream caching behavior and invoice definitions can differ. Avoid counting the same cached tokens twice when constructing the usage object.


| Unit estimate | USD |

| --- | --- |

| openrouter:image | $0.04 |

| openrouter:image:premium | $0.08 |

| openrouter:video | $1.5 |

| tavily:search | $0.008 |

| tavily:search:advanced | $0.016 |

| tavily:extract | $0.0016 |

Implementation sources: src/server/ai/pricing.ts


[OpenRouter Opus](https://openrouter.ai/anthropic/claude-opus-5.5) - Checked 21 October 2026: $4 / $20 per million text tokens.

[OpenRouter Gemini Flash](https://openrouter.ai/google/gemini-3.8-flash) - Checked: $0.75 / $3.75 per million text tokens.

[OpenRouter Flash Lite](https://openrouter.ai/google/gemini-3.1-flash-lite) - Checked: $0.25 / $1.50 per million text tokens.

[OpenRouter Sol](https://openrouter.ai/openai/gpt-6.1-sol) - Checked: $2 / $10 per million text tokens.

[OpenRouter Luna](https://openrouter.ai/openai/gpt-6-luna) - Checked: $0.10 / $0.50 per million text tokens.

## Video provider estimate table

| Option | Provider | Model | Source price estimate |

| --- | --- | --- | --- |

| standard | kie | veo-3-1 | 720p: 60; 1080p: 65 credits / video |

| standard | openrouter | google/veo-3.1-fast | 720p: 0.1; 1080p: 0.12 usd / second |

| draft | kie | veo-3-1 | 720p: 30; 1080p: 35 credits / video |

| draft | openrouter | google/veo-3.1-lite | 720p: 0.05; 1080p: 0.08 usd / second |

| premium | kie | google/gemini-omni-flash-1-1 | 720p: 120; 1080p: 160 credits / video |

| premium | openrouter | minimax/hailuo-3 | 2k: 0.13 usd / second |

| long | kie | bytedance/seedance-2-fast | 480p: 11.7; 720p: 24.8 credits / second |

| long | openrouter | bytedance/seedance-2.0-fast | 480p: 0.04; 720p: 0.091 usd / second |

| cinematic | kie | minimax-h3/reference-to-video | 768p: 20; 2k: 40 credits / second |

| cinematic | openrouter | minimax/hailuo-3 | 2k: 0.13 usd / second |

| variation | kie | grok-imagine/image-to-video | 480p: 12; 720p: 24 credits / video |

| variation | openrouter | google/veo-3.1-lite | 720p: 0.05; 1080p: 0.08 usd / second |

KIE conversion default is $0.005 per KIE credit. KIE premium/cinematic placeholder rates are explicitly unverified in source comments. OpenRouter video prices above are code defaults, not a newly verified full rate card. Reference-image fees, provider padding, multi-clip composition, retries and gateway charges can increase cost. Always reconcile completed-task cost and the vendor invoice.


Implementation sources: src/lib/ugc/models.ts; src/server/ugc/models.server.ts


## Unit economics without invented production numbers

No current invoices or measured usage distributions were supplied, so a defensible actual gross margin, fixed monthly operating total or break-even forecast cannot be calculated. Older workbook forecasts are historical assumptions and are not carried forward as current business facts.


The scenario below illustrates arithmetic from current allowances. It assumes every included general credit is consumed at $0.002 provider cost, every VC costs $0.844, each Pro message costs $0.048 and each Flash message $0.009. Those are planning assumptions, not observed average costs. The scenario excludes included research/scans, publishing, infrastructure, payment fees, support, refunds, taxes and free users. It is therefore a variable-AI-cost sensitivity view, not business gross margin.


General-credit usage cannot be valued at face value to compute cash revenue: credits already included in a subscription create no extra cash when spent. Likewise unused allowances, paid packs and promotional restricted grants have different economics. Use actual allocated subscription revenue and task-level accepted-result cost for a measured contribution report.


| Plan | Illustrative AI cost | Monthly remainder % | Annual-month remainder % |

| --- | --- | --- | --- |

| Starter | $16.02 | 67.3% | 60.8% |

| Growth | $47.33 | 68.2% | 61.9% |

| Agency | $133.96 | 70.2% | 64.2% |

| Scale | $350.00 | 70.8% | 65.0% |

### Measured operating model to maintain

- Capture by task: provider/model, input/output/reasoning/cache usage, reported USD cost, search/extract calls, render seconds, retry count, outcome and accepted result.

- Reconcile monthly: Railway compute/network, Supabase DB/auth/backups, R2 capacity/operations, Redis, AI invoices, social provider tier, research providers, email, monitoring and Stripe fees.

- Allocate account-level included work across brands, and record free/promotional consumption separately from paid recurring customers.

- Compute contribution = recognized revenue - attributable variable costs; compute operating result only after fixed costs.

- Re-price the expensive tail: long video, large crawls, deep Pro/agent runs and repeated failed renders. Do not derive these from one average token price.

[Post for Me pricing](https://www.postforme.dev/pricing) - Checked 21 October 2026: $10/month entry tier for up to 1,000 successful posts; unlimited accounts. Higher-volume pricing requires confirmation. A universal $0.01/post rate is an assumption, not a verified contract at every volume.

## Billing acceptance checks

- Repeated generation request, duplicate webhook and repeated capture settle only once.

- Provider failure before acceptance releases the correct hold; ambiguous submission does not spawn an unrelated second task.

- Partial success captures the supported partial amount and returns the rest.

- Plan downgrade preserves work, constrains excess brands/limits and does not reassign the billing owner.

- Monthly and annual plans receive grants on the correct windows; expiry and rollover consume the correct source buckets.

- Refund/clawback is idempotent and cannot manufacture a spendable negative/duplicate grant.

- Coming-soon add-ons cannot enter checkout as working products; required price mappings are present before sale.

- Viewer and unauthorized workspace requests cannot spend even with billing mode off or shadow.

Implementation sources: src/server/billing; tests/db; src/lib/billing/catalog.test.ts


## Source ledger and verification limits

Repository-relative paths below identify the owning implementation. The companion source folder includes an extracted inventory and SHA-256 hashes for source files and migrations. The inventory is a static extraction, not a database dump or a successful production test. Generated database types describe their checked-in state; migrations define actual SQL constraints, defaults and policies.


The Mellox connector failed with an internal error. The public site could not be fetched by the web tool or local network, and browser initialization was unavailable. Consequently public-site rendering, deployed commit, enabled credentials, vendor approvals, production schema, invoices, real usage and exact Railway service topology were not independently inspected. The local marketing implementation was used as a secondary source. No live provider generation or publication was triggered.


| Source | SHA-256 prefix |

| --- | --- |

| src/lib/billing/catalog.ts | eb845ac041f58b84 |

| src/server/billing/accounts.server.ts | 52c43ecb846a66ea |

| src/server/billing/meters.server.ts | 5623c61b78bcc508 |

| src/server/links/credits.server.ts | 10b518a680bddc90 |

| src/server/billing/grants.server.ts | d2eefa5bd5668ebc |

| src/server/billing/seat-count.server.ts | e803c96b677eedb2 |

| src/server/billing/limits.server.ts | cc6af4bb0231749b |

| src/server/billing/feature.server.ts | e4aa80dad830fc76 |

| src/server/billing/entitlements.server.ts | 0fc108d036ac5343 |

| src/lib/ugc/duration.ts | 6ad312021cd6c5d5 |

| src/server/ugc/models.server.ts | c1669c204dca1cfe |

| src/server/billing/ugc-async.server.ts | 687ecbb7c2909d94 |

| src/server/billing/studio-async.server.ts | e136150cda496ceb |

| src/server/billing/lifecycle.server.ts | 19b69b7a0ba774a1 |

| src/server/billing/referrals.server.ts | b582867af7e2c877 |

| src/server/billing/mode.server.ts | a2462d4f2d8db609 |

| src/server/billing/metered.server.ts | 6d6a7679b8a904c1 |

| src/server/billing/async-charges.server.ts | 880d966338350edc |

| src/server/billing/stripe-account.server.ts | 777df0b1e3e1bff7 |

| src/server/billing/stripe.server.ts | e7256f848d31ea58 |

| src/app/api/public/hooks/stripe/route.ts | 615c04f78a9a4873 |

| src/server/ai/pricing.ts | 600df82c7ddb0ca4 |

| src/lib/ugc/models.ts | 6d1c68c9c5d44b38 |

| src/server/billing | directory reference |

| tests/db | directory reference |

| src/lib/billing/catalog.test.ts | 910f257a7fab082b |