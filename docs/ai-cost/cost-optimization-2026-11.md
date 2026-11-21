# AI cost optimization — November 2026

Status: first pass shipped on `feat/simpler-create` (uncommitted), 2026-11-12.
Nothing here has run against production data yet. **No savings have been
measured.** Every figure below that is not a code fact is labelled as a projection.

## 1. What Mellox already does (verified in code, not re-built)

Most of the "standard" cost techniques in the brief are already in place. I
checked the code paths, not the docs:

| Technique | Where | Verdict |
|---|---|---|
| Per-route model plans, cheapest model per task, fallbacks never pricier | `src/server/ai/task-models.ts` | In place (ADR-0026) |
| Exact response cache, tenant-scoped, Redis with in-process fallback | `src/server/cache/store.ts`, `chatCompletion` | In place. Off by default for creative work (correct: a fresh take is the product) |
| In-flight dedupe of identical concurrent calls (text and image) | `ai-gateway.server.ts` `dedupe`, `openrouter-image.server.ts` `inflight` | In place |
| Image result cache (2 h, tenant + prompt + refs + size) | `openrouter-image.server.ts` | In place |
| Anthropic prompt-cache breakpoint on the stable system prefix | `withPromptCache` | In place; Gemini/OpenAI cache implicitly on prefix |
| Metering from OpenRouter's own `usage.cost`, KIE `creditsConsumed` | `metering.ts`, `kie.server.ts` | In place |
| Budget ceilings, degrade instead of fail | `src/server/ai/budget.ts` | In place |
| KIE create never retried by the gateway | `createKieTask` | In place |
| Studio/UGC idempotency keys, leased jobs, no blind image restarts | `studio_jobs`, `ugc_renders`, `IMAGE_LOST_RESTARTS = 1` after a status check | In place |
| Composed (multi-clip) video retries only a *definite* refusal | `composition.server.ts` | In place |
| Storyboard before long/premium video spend; video QA before delivery | ADR-0041 | In place |
| Deterministic video where it fits (MotionMox = Remotion fork, FFmpeg recaps, site reels, code-drawn hook text and carousels) | ADR-0045, `clip-edit/`, `carousel-render` | In place |
| No paid work on page load; background spend gated by plan | Mellox Lean, `src/lib/background/gate.ts` | In place |
| Local open-source sidecar at $0, fail-open | `services/local-ai/` | In place |
| Observability | Helicone sink beside Postgres (ADR-0016) | In place |

Conclusion: the platform does not need a second gateway, a second cache or a
second tracing stack. The biggest gaps were **measurement** and one **double
billing path on video**.

## 2. What was wrong

1. **Spend could not be added up per piece.** `ai_usage_events` knew the
   route and workspace, but not which Studio job or UGC render a call
   belonged to (`run_id` is only set for agent runs). "Cost per accepted
   image/video" — the metric the brief calls most important — was not
   computable, nor was the cost of failed work.
2. **Prompt-cache effect was invisible.** OpenRouter returns
   `cached_tokens`, `cache_write_tokens` and `reasoning_tokens`; the gateway
   used them to estimate cost but never stored them. Whether prompt caching
   works on any route was unknowable.
3. **A timed-out KIE create could start several paid videos.** When
   `createTask` timed out or dropped its connection (outcome unknown: KIE may
   have accepted and will bill), the UGC engine treated it as retryable and
   submitted again after 30 s, up to 4 times. Each resubmission can be a new
   paid render while the orphan finishes unseen. Video is Mellox's most
   expensive unit, so this is the highest-value fix found.

## 3. What was built

### 3a. Workflow cost attribution
- `withWorkflow({ kind, id, stage, workspaceId }, fn)` in
  `src/server/request-context.ts`: every usage row recorded inside carries
  `workflow_kind`, `workflow_id`, `workflow_stage`. Keeps the caller's request
  id, user and billing scope.
- Studio: `executeJob` and `advanceStudioJob` run inside the job's workflow;
  `setStage` updates the stage, so spend splits into context / writing /
  image / poll….
- UGC: the engine's `advance` runs inside the render's workflow (stage =
  render status).
- Migration `20261112120000_ai_cost_attribution.sql`: new columns, index,
  `record_ai_usage` stores them (a malformed workflow id is dropped, never the
  row), daily rollup gains `cached_input_tokens`.

### 3b. Prompt-cache and reasoning tokens
- `usageTokens(usage)` in the gateway feeds every metering point (chat,
  streaming, tool loop). Rows now hold `cached_input_tokens`,
  `cache_write_tokens`, `reasoning_tokens`.

### 3c. Cost per accepted piece
- `admin_cost_per_output(days)` (service role only) and
  `GET /api/admin/usage/cost?days=` (`usage.read`): per Studio format and per
  video model — workflows, succeeded, failed, accepted (post approved,
  scheduled or published), revisions, total spend, spend on failed work,
  **cost per accepted piece (failures included)**; spend by stage; cached
  share of prompt tokens per route. No UI yet; the console can render it next.

### 3d. Video: adopt the orphan instead of paying twice
- The KIE callback URL now names the render, signed with
  `KIE_WEBHOOK_HMAC_KEY` (`signRenderRef`). KIE's own signature still has to
  verify the task id.
- On an unknown create outcome (not `definite`) with a callback in place, the
  render waits `UNKNOWN_SUBMIT_GRACE_MS` (8 min) instead of 30 s. If KIE's
  completion callback arrives for a task no render knows, the webhook adopts
  it (`engine.adopt`), and the engine then re-reads it from KIE like any
  other task. On the last attempt it waits, then fails and refunds rather than
  submitting a fifth time.
- Unchanged: definite refusals (rate limit, maintenance) keep the quick
  retry; with no callback configured (local dev) behaviour is as before;
  composed videos already handled this.
- Trade-off: a create that genuinely never reached KIE now waits up to 8 min
  before its retry. Timeouts on a 30 s create call are rare; a duplicate
  video costs far more than the wait.

### Tests
- `src/server/ai/metering.test.ts` — workflow and token fields, scope nesting.
- `src/server/ugc/engine.server.test.ts` — 7 new cases (grace, adoption,
  refusal to adopt, definite retry, no-callback retry, signed reference).
- `tests/db/ai-cost-attribution.test.ts` — PGlite: storage, malformed id,
  failed work charged to accepted pieces, customers refused.
- `npm run typecheck` clean; `npm run db:verify` replays all 158 migrations
  and re-applies cleanly; ESLint 0 errors on touched files; 28 test files in
  `src/server/{ai,ugc,studio,admin}` pass.

### Not verified
- The migration is **not applied** to the real database.
- KIE preserving a callback URL's query string is assumed from its docs, not
  observed. Check one live render's callback in the logs before relying on
  adoption; if the query is stripped, renders just fall back to a resubmit
  after the grace period (no worse than before, apart from the wait).
- No live provider call was made; no before/after quality run (nothing that
  changes output was touched, so none is owed for this pass).

## 4. Research: what fits Mellox and what doesn't

Shallow clones of LLMLingua and GPTCache were read in `H:\research` (outside
the repo, both MIT). The rest were judged against what Mellox already runs.

| Project | Verdict | Why |
|---|---|---|
| LLMLingua / LLMLingua-2 | **Not now; maybe later for scan extraction** | Deletes tokens with a 560M XLM-RoBERTa model (Python). Mellox's grounding rules (exact quoted copy, "claim nothing the facts don't state", figures checked by `withoutUnknownFacts`) are exactly what token deletion can break ("not", numbers, qualifiers). Only candidate: raw page text into Brand DNA / product extraction, where input is large and output is re-grounded. Would run in the existing local-ai sidecar. Decide after 3b shows which routes have large uncached inputs. |
| GPTCache (semantic cache) | **No** | Similar-but-different briefs must not get the same creative; brand facts per tenant make cross-request matches risky. The exact tenant-scoped cache already covers true repeats. |
| Redis | **Already used** | Shared cache and counters. Jobs use Postgres leases + SKIP LOCKED, which is correct for money-bearing work (durable, transactional). |
| LiteLLM | **No** | A second gateway in front of OpenRouter adds a hop and duplicates metering, fallbacks and budgets that exist. |
| Langfuse / OpenTelemetry | **No new stack** | Helicone + `ai_usage_events` already trace every call; 3a adds the missing workflow dimension. OTel can come later for latency, not cost. |
| Promptfoo | **Worth adding for prompt changes** | The right tool for the next step (prompt-prefix restructuring changes prompts). Use the existing `/…-lab` fixtures and live checks as datasets. |
| Remotion / FFmpeg | **Already used** | MotionMox and the clip-edit pipeline. |

## 5. Next steps, ranked by expected impact (projections, not measurements)

Run these **after** the migration is live and a week of attributed rows exists,
so each is justified by `admin_cost_per_output`, not guesswork.

1. **Read the report.** Find the top 3 routes/stages by spend and the
   cost-per-accepted gap between `cost_per_succeeded` and
   `cost_per_accepted` (pieces made but never used). That gap is usually the
   largest real saving and it is a product question (better first drafts,
   cheaper previews), not an infrastructure one.
2. **Prompt prefix stability** (projection: meaningful only where
   `cached_share` is low on high-spend routes). Today the Studio system prompt
   carries per-request rules (CTA, tone) mid-prompt, and a product block is
   prepended before the brand text, which ends the cacheable prefix early.
   Moving per-request lines below the brand block would let Gemini/OpenAI
   implicit caching (and an Anthropic breakpoint on the brand block for Opus
   routes) cover the brand context. Changes prompts, so gate it with a
   Promptfoo before/after run on the same models.
3. **Failed-spend hotspots.** `failed_cost_usd` and `error_call_cost_usd` by
   format/model show where preflight checks (storyboard issues, reference
   checks, safety wording) should move earlier, before paid steps.
4. **Scan-input compression** (LLMLingua-2 in the sidecar) only if the
   report shows extraction routes dominating input tokens.

## 6. Rollback

- Attribution: the columns are nullable/defaulted; old code ignores them.
  `record_ai_usage` can be restored from `20261002090200`.
- Video adoption: remove `callbackUrl: (row) => …` back to `kieCallbackUrl`
  and the engine falls back to the old 30 s retry (no callback naming a
  render, so `unknown` is never set).
