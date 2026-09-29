# Mellox AI: financial and pricing records (v2, updated 29 September 2026)

This folder is the complete, current record. It replaces everything from v1 (the Qwen / Sonnet / KIE model) and the earlier v2 drafts (`plans.proposed.v2.ts`, `credit-costs.v2.ts`), which you can delete.

## Files

| File | What it is |
|---|---|
| `Mellox_AI_Pricing_Report_v2.pdf` | The full written report: costs per task, video, credits, plans, feature matrix, add-ons, unit economics, retention, projection, break-even, Pakistan pricing, risks, calibration, sources. The live version is the Claude doc "Mellox AI: Pricing, Credits & Unit Economics". |
| `Mellox_AI_Pricing_Model_v2.xlsx` | The financial model. 19 tabs, 2,472 live formulas. Change any blue input and every tab updates. |
| `catalog.reference.ts.txt` | The pricing catalog as code: plans, features, credit prices, video credits, packs, add-ons, offers. It becomes `src/lib/billing/catalog.ts`. |
| `IMPLEMENTATION_BRIEF.md` | The full build spec for a coding agent (Claude Code, Codex or another). |
| `CLAUDE_CODE_PROMPT.md` | The single prompt for Claude Code: audits the earlier Codex work, then builds and finishes the system. |

## The system in one page

**Model stack (via OpenRouter):** PREMIUM Claude Opus 5.5, WORKHORSE Gemini 3.8 Flash, ECONOMY Gemini 3.1 Flash Lite. Video: KIE for Veo 3.1 Fast / Lite and Grok Imagine; OpenRouter for Hailuo 3, Seedance 2.0 Fast and as the fallback. Social posting: Post for Me API ($10 for 1,000 posts, unlimited accounts).

**Plans**

| | Free | Starter | Growth | Agency | Scale |
|---|---|---|---|---|---|
| Price a month | $0 | $49 | $149 | $449 | $1,199 |
| Annual (a year, 2 months free) | $0 | $490 | $1,490 | $4,490 | $11,990 |
| Brands / seats | 1 / 1 | 1 / 2 | 3 / 5 | 10 / unlimited | 30 / unlimited |
| Credits a month | 100 once | 2,000 | 6,000 | 18,000 | 50,000 |
| Video Credits a month | 0 | 4 | 12 | 40 | 100 |
| Pro / Flash messages | 0 / 30 | 30 / 800 | 150 / 2,000 | 400 / 5,000 | 1,200 / 12,000 |
| Social posts (never use credits) | Unlimited | Unlimited | Unlimited | Unlimited | Unlimited |
| Hidden fair-use cap, posts a month | 100 | 500 | 1,500 | 5,000 | 15,000 |
| Tracked prompts, weekly | 5 | 25 | 100 | 300 | 1,000 |
| Typical cost to serve | $0.92 | $11.93 | $37.47 | $115.94 | $351.55 |
| Gross margin, typical / worst | n/a | 67% / 43% | 67% / 44% | 67% / 45% | 63% / 42% |
| Gross margin on annual | n/a | 63% | 63% | 62% | 58% |

**Meters:** 1 credit = $0.01 (blended cost $0.0020, 80% margin). 1 Video Credit = one 8-second Standard video (cost $0.45 now, $0.81 if all on OpenRouter); general credits never buy video. Credits belong to the owner's billing account, shared across all their brands.

**Packs:** credits $25 / $100 / $250 / $500 (69-71% margin); video 10 / 30 / 100 VC for $29 / $79 / $249 (75-76%).

**Key unit costs:** Flash message $0.009, Pro message $0.048, Brand DNA scan $0.23, premium article $0.19, image post $0.066, tracked prompt (3 engines) $0.016, Standard video $0.30 on KIE ($0.84 on OpenRouter), social post $0.01 (Post for Me).

**Forecast (founders unpaid)**

| | Conservative | Base | Optimistic |
|---|---|---|---|
| Break-even month | 17 | 8 | 2 |
| Most cash needed | $4,876 | $524 | $40 |
| MRR at month 12 / 24 | $3,140 / $8,581 | $8,600 / $31,226 | $33,080 / $175,529 |
| Paying customers at month 24 | 88 | 259 | 1,051 |
| Profit over 24 months | $0.4k | $85.2k | $743.8k |

**Break-even:** about $61 contribution per paying customer a month. 5 customers cover launch costs; 40 also pay both founders (PKR 600,000); 133 covers a small team and marketing too.

**Fixed costs by stage:** $284 / $1,620 / $5,951 / $17,007 a month (launch / traction / growth / scale).

## Assumptions to re-check

- Reasoning-token budgets and tokens per task are estimates; recalibrate with the workbook's Calibrate (SQL) tab after two weeks of real traffic.
- KIE prices for Gemini Omni and MiniMax H3 are unverified (not used for now).
- Post for Me: only the $10 / 1,000-post tier is published; the model assumes $0.01 a post at every volume and one post per network. Confirm both with Post for Me.
- Churn, CAC and usage levels are assumptions until you have customers.
- USD/PKR 277.09; Pakistan sales tax on local sales needs a tax advisor.
