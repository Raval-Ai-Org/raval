# Credits and monthly customer value: review and proposed redesign

Date: 27 October 2026. Status: proposal, not a pricing change or deployment.

## Decision

Keep the $49 subscription, but design its creation allowance around a useful month of finished content. Recommend piloting 200 creation points: one point for a text post set or a post using an unchanged uploaded photo, two for a standard AI image post, and three for a template carousel using at most one generated background. Include three short caption revisions per creation. Keep video and premium/research work explicitly priced and separate from the protected creation allowance.

These are alternative uses of the same allowance, not separate cumulative entitlements: up to 200 text post sets, 100 standard image post sets, or 66 qualifying carousels. Publishing one creation to multiple supported platforms does not consume another creation allowance. Additional new media, substantial new briefs and premium options have an explicit quote.

This improves the ordinary-image allowance from about 66 to 100 and makes normal caption iteration included. It also protects a customer's content allowance from unrelated research spending. It does not promise unlimited generations, guaranteed aesthetic satisfaction, or a month of premium video.

## What the current system actually implements

The checked-in catalog grants Starter 2,000 general credits, four Video Credits, 30 Pro message units and 800 Flash message units. These are distinct pools. Provider dollars do not automatically determine general credit deductions. An action's fixed catalog price determines its debit, while provider usage is recorded separately.

| Action                                             | General credits per action | Capacity from 2,000 credits alone |
| -------------------------------------------------- | -------------------------: | --------------------------------: |
| Text social post set, up to three platforms        |                         12 |                               166 |
| Standard AI image post, copy included              |                         30 |                                66 |
| Carousel                                           |                         30 |                                66 |
| Video script                                       |                         10 |                               200 |
| Short caption revision in the local safety changes |                          4 |                     500 revisions |

Each row assumes the entire pool goes to that action. Retakes, writing assistance and other paid tools reduce these counts. These are generation counts, not measured counts of accepted or published work.

If an account gets only four or five usable posts after spending the whole general pool, the catalog alone does not explain it. Reconcile its captures and open holds, jobs, revisions, other actions and provider events. The customer's reported $1.50 / 1,000 credits is not independently verified here and may omit KIE, another provider key, background work or a different time window.

The earlier local safety changes address unintended suggestion charges, duplicate retries, media regeneration during caption edits, cancellation and stale holds. Those changes did not alter plan allowances or the core action menu.

## The original economic assumption

Sources: `v2/Mellox_AI_Pricing_Model_v2.xlsx`, its cached values and formulas; `v2/README.md`; the current catalog and execution code.

The workbook explicitly targets an 80% text/research margin and 75% image margin against credit face value (`Inputs!B33:B34`). Its blended provider cost is $0.00203415565868036 per general credit (`Inputs!B37`, linked to `Credit Menu!K40`). This implies:

- 1,000 credits: approximately $2.03 of provider work at the assumed mix.
- 2,000 credits: approximately $4.07 of provider work.
- The customer's reported ratio would imply approximately $3 for all 2,000, if that same workload mix continued.

The workbook's Starter typical cost to serve is $11.93 (`Plans!D54`) across creation, video, chat, tracking, publishing, onboarding and background services. Its all-allowances-spent scenario is $23.96 (`Plans!D55`). It assumes only 50% use of general credits, 60% use of Video Credits and 40% use of Pro allowance in the typical case (`Inputs!B21:B23`).

The approximately 67% typical margin (`Plans!D61`) is remaining contribution after the workbook's service costs and payment/FX/tax deductions. It is not a promise to spend 60% of subscription revenue on OpenRouter and KIE. It is also not net profit after all business operating expenses.

If the founder instead chooses a 60% AI-provider budget, $49 x 60% = $29.40. That leaves $19.60 before payment fees and all other costs. The present credit allowance is not derived by allocating that $29.40 to general generation.

## Additional mismatches and limitations

1. **Video allowance is especially restrictive in Studio.** `studioVideoUnits` charges two Video Credits per started ten-second band. Four included VC therefore cover two ten-second Studio videos, one fifteen- or twenty-second video, and no thirty-second Studio video without a top-up. Other UGC options have different model-specific quotes. This needs a unified model/duration/resolution quote, rather than a single flat Studio rate.
2. **Article price and execution disagree.** `studioChargeFor` chooses `article_standard` (20 credits) for a non-long article, while `buildArticlePrompt` uses `studio.article`, routed to PREMIUM. The catalog's standard expected cost is $0.031 versus $0.193 for premium. That is a cost assumption mismatch, not evidence of excessive customer debits. Introduce an actual standard route and an explicitly selected premium option, or recost the existing option without silently increasing current charges.
3. **Carousel costs depend on rendering mode.** The workbook costs a carousel with one cover/background image. The runner can also generate individual slide artwork. A single constant expected cost cannot describe both. Separate template/one-background and full-artwork carousels in the quote and cost model.
4. **Credit face-value margin is not subscription cash margin.** The current `billing_margin_report` compares general-credit face value with attributed provider events over 14 days. It excludes video charges and is not an account-level monthly subscription profit report. Use cash revenue recognized for the period, every provider, included background work and payment costs for that report.
5. **The financial workbook is an estimate.** Token volumes, retries, fallback mix and background utilization are assumed. Several model routes have changed since it was prepared. Its all-allowances-spent scenario still uses blended expected unit costs; it is not a validated maximum-cost or percentile stress test.
6. **Metering is not an invoice reconciliation.** Usage recording is best-effort. Reconcile provider totals and missing attribution before relying on the dashboard to set permanent allowances. Account-wide KIE/OpenRouter spending cannot be attributed to one customer without matching scope and period.

## Alternatives

| Design                                                                              | Benefit                                       | Limitation                                                                             | Recommendation                                                 |
| ----------------------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Increase 2,000 to 4,000 credits                                                     | Quick, roughly doubles menu capacity          | Leaves unrelated tools competing with creation and still charges normal iteration      | Temporary pilot option                                         |
| Debit actual provider cost plus a markup                                            | Closely follows cost                          | Customers cannot predict the number of posts; long context and fallbacks change prices | Use internally for costing, not as the main customer allowance |
| Protected creation points, included caption edits, separately quoted expensive work | Clear monthly value and predictable iteration | Requires a versioned allowance policy and validated unit costs                         | Preferred design                                               |

Do not redenominate 2,000 credits to 20,000 and multiply every action price by ten. That changes display numbers without increasing useful output. Do not increase grants tenfold at unchanged prices without a full-use cost test.

For context, increasing only the current general grant while keeping the other workbook allowances and costs unchanged gives these indicative all-allowances-spent results:

| General grant | Estimated general provider work | Total service costs | Contribution after existing workbook deductions |
| ------------- | ------------------------------: | ------------------: | ----------------------------------------------: |
| 2,000         |                           $4.07 |              $23.96 |                                           42.8% |
| 4,000         |                           $8.14 |              $28.02 |                                           34.5% |
| 6,000         |                          $12.20 |              $32.09 |                                           26.2% |
| 10,000        |                          $20.34 |              $40.23 |                                            9.6% |

Method: remove existing full-credit cost `Plans!D51`, add new grant x `Inputs!B37`, then subtract the unchanged `Plans!D58:D59` deductions from $49. These are estimates with unchanged mix and no new free revisions, not forecasts or newly verified provider prices. Annual billing needs its own lower-revenue scenario.

## Proposed $49 creation package and economics

| Customer activity                                                                    |                                           Proposed creation points |
| ------------------------------------------------------------------------------------ | -----------------------------------------------------------------: |
| Text post set or caption using an unchanged supplied photo                           |                                                                  1 |
| Standard AI image post, copy included                                                |                                                                  2 |
| Template carousel, bounded slide count and one generated background                  |                                                                  3 |
| Up to three short caption revisions to that creation                                 |                                                           Included |
| Manual edits, uploads, viewing, approval and scheduling                              |                                                           Included |
| A genuinely new image take, full-artwork carousel, article, campaign or premium task |         Separate visible quote derived from the validated workload |
| Video render                                                                         | Separate video quote, never a debit from protected creation points |

One possible month is 60 image posts + 20 text post sets + 10 template carousels = 170 points, leaving 30 points for additional creations. This is 90 distinct creations, before platform variants. Saved revisions do not multiply the number of finished creations shown as customer value.

Illustrative test: 100 standard image posts x $0.06616241545 (workbook `Credit Menu!C6`) plus 300 short caption revisions x $0.008 (current revision expected cost) = approximately $9.02 of creation-provider work.

Replacing the old general-credit workload with that full content use gives:

- With other services at workbook typical use: approximately $18.91 total service cost and 53.1% contribution after the workbook's deductions.
- With other allowances at the workbook's all-spent use: approximately $28.90 total service cost and 32.7% contribution after the same deductions.

This deliberately offers more customer value at a lower projected margin than the old typical 67% target. The $28.90 includes services beyond OpenRouter/KIE, but its small gap below $29.40 is not adequate protection against unmeasured fallback, multi-image or retry costs. This is a pilot hypothesis, not a launch guarantee. If measured costs are materially higher, bound expensive media options or recost them before publishing the package. Do not quietly reduce quality or stop promised included work behind a hidden dollar cap.

For video, first make quotes identical across Studio and UGC using the actual routed model, length and resolution. Then decide and publish a standard-video allowance with example clip counts or seconds. Do not promise 100 images and 100 generated videos for $49 on the strength of cheap text-token costs.

## Implementation and validation plan

1. **Reconcile the incident.** Join each captured debit or hold to a job/action and its provider calls for the same customer and time window. Report delivered work, failed/cancelled work, duplicates and unused reservations separately. Correct verified erroneous charges once through the existing adjustment flow.
2. **Measure complete jobs.** Report provider cost, customer debit, model, media count, retries, fallback, accepted output and published creation per request. Report account-month service costs separately from face-value action margins. Include unattributed events and invoice reconciliation differences.
3. **Resolve execution/pricing mismatches.** Split standard/premium articles, bound carousel rendering classes, and unify video quotes. Reprice from whole-job costs, including research, safety, image review, composition and repair. A system-caused retry never incurs another customer debit.
4. **Simulate the proposed package.** Measure median and 95th-percentile complete-job costs from representative workloads, including uploads, Urdu/English copy, multiple platforms, carousels, provider fallback, full allowance use and annual revenue. Give expensive long-form revisions their own bounded policy. Validate the highest feasible cost mix, not only the average mix.
5. **Ship a versioned pilot.** Protect creation points from research and premium chat. Show remaining approximate creations and separate video capacity. Retain the existing hold/capture/release and request idempotency systems. Charge at creation success, with subsequent included revisions tracked against the creation, not charged again. Failed generation returns the allowance; subjective dislike alone does not allow unlimited free new images.
6. **Preserve existing balances.** Version the plan policy and grants. Preserve purchased wallet credit value and historic ledger entries. Grant incident compensation and a clearly identified pilot allowance through new idempotent entries. Do not reset wallets, rewrite prices on old jobs or silently reduce existing paid entitlements. Define top-up conversion and rollover explicitly before switching customers.
7. **Accept the release only with evidence.** In a $49 test account, complete the stated monthly content examples with their included edits. Browsing, uploading, approval and internal retries must not consume creation points. Confirm pause/cancel, failure recovery, overage consent and annual economics. Review results after one complete billing cycle before broad rollout.

## External pricing checks

Checked 27 October 2026:

- OpenRouter lists a 5.5% Standard credit-purchase fee (8% Business), charged on purchase rather than as another per-request fee: https://openrouter.ai/pricing . Include the applicable effective acquisition fee once when comparing invoice dollars with usage, not twice if estimates already contain it.
- KIE documents approximately $0.005 per KIE credit and different per-model billing units: https://kie.ai/pricing . A KIE credit is not a Mellox credit or Video Credit.
- Paddle public standard pricing is at https://www.paddle.com/pricing . Use the actual contracted processor terms and net revenue in the production forecast. Workbook FX/tax assumptions were used only to reproduce its calculations and were not independently validated here.

No customer account, provider invoice, production ledger, subscription price, allowance or workbook was changed during this review.
