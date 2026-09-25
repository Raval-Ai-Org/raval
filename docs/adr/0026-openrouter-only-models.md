# ADR-0026: OpenRouter-only models, routed per task

- **Status:** Accepted (2026-09-25). Video stays on KIE until the switch below.
- **Supersedes:** the Anthropic gateway, the `AI_TEXT_ROUTE_*` text routing
  (`model-gateway.server.ts`, `text-routes.server.ts`) and KIE images.

## Decision

1. **No Anthropic API.** Nothing calls `api.anthropic.com` or reads
   `ANTHROPIC_API_KEY`. Claude is used through OpenRouter as
   `anthropic/claude-opus-5.5`.
2. **OpenRouter is the provider for all text, vision, tool use and images.**
   One text gateway (`src/lib/ai-gateway.server.ts` + the tool loop in
   `ai-gateway.tool-loop.server.ts`) and one image client
   (`src/lib/openrouter-image.server.ts`).
3. **Every task names a route, never a model.** `src/server/ai/task-models.ts`
   maps each metering `route` label to a plan: `models` (primary + fallbacks,
   sent as OpenRouter `models`), `reasoning.effort`, a token ceiling, an
   optional escalation rule and a degraded plan. A test fails when a `route:`
   label in `src/` has no entry. Overrides without a deploy:
   `AI_MODEL_<ROUTE_KEY>` and `AI_EFFORT_<ROUTE_KEY>`.
4. **Video runs behind a provider interface** (`src/server/ugc/providers/`):
   KIE now (`VIDEO_PROVIDER=kie`, the owner's choice until they replace it),
   OpenRouter built and live-tested, with automatic fallback from KIE to
   OpenRouter on a *definite* refusal only.

## Why these tiers

| Tier | Model | Used for | Why |
| --- | --- | --- | --- |
| PREMIUM | `anthropic/claude-opus-5.5` | Brand DNA, writing voice, articles that go live, GEO fixes and the coding agent, campaign/coach strategy, market intelligence, experiment hypotheses | Work everything else builds on, or that ships to a customer's site; worth the price ($4/$20 per 1M). |
| WORKHORSE | `google/gemini-3.8-flash` | Chat, content generation, Studio, vision reads, competitor profiles, UGC scripts | Strong enough for day-to-day generation at a fraction of the cost ($0.75/$3.75). |
| ECONOMY | `google/gemini-3.1-flash-lite` | High-volume classification: file extraction, history summaries, competitor updates, backlink fit, image moderation | Cheapest reasoning model that honours JSON schemas ($0.25/$1.50). |

Fallbacks: Premium → Workhorse; Workhorse → `openai/gpt-5.6-terra`;
Economy → `openai/gpt-5.6-luna`. Past a workspace's spend ceiling every tier
steps down one (Premium → Workhorse → Economy).

## Phase 0 findings (verified 2026-09-25)

Against `GET /api/v1/models`, `/api/v1/videos/models`, `/api/v1/images/models`
and the OpenRouter and KIE docs, plus live calls with the real key.

- **All text slugs in the brief exist as written** and support `reasoning`,
  `tools`, `response_format` and `structured_outputs`; all accept image input
  except Perplexity Sonar (text + image, no reasoning).
- **`reasoning` is mandatory** on Opus 5.5 and Gemini 3.8 Flash
  (`reasoning.mandatory: true`), so the gateway always sends an effort and
  never `enabled: false`. Supported efforts: Opus `low…max`, Gemini Flash
  `low/medium/high`, Flash-Lite adds `minimal`.
- **GPT-5.6 Terra/Luna do not accept `temperature`.** With
  `require_parameters: true` (sent for JSON schemas and tools) a temperature
  would exclude them as fallbacks, so strict calls omit it.
- **`data_collection: "deny"`** leaves at least one endpoint for every tier
  (confirmed live).
- **`models` fallback** uses one request body for all models, so a Premium
  call's fallback runs at the Premium plan's effort, not "high" as the brief
  suggested. The tool loop fails over on its first turn only, then stays on
  the model that answered, so reasoning is only replayed to the model that
  produced it.
- **`reasoning_details`** come back signed (Opus: `reasoning.text` +
  signature; Gemini: `reasoning.encrypted`) and replay correctly across turns
  when sent back unchanged (live three-turn loop on both).
- **Prompt caching:** `cache_control` on content parts works for Opus through
  OpenRouter (live: 1,989 cached tokens on turn 2). Gemini caches implicitly.
- **Mid-answer failures** come back as HTTP 200 with partial content and
  `finish_reason: "error"`. The gateway meters them as errors, never returns
  the partial text, and retries once (found live: a truncated product
  extraction).
- **Images are a separate API.** `openai/gpt-image-2.5-flare` and
  `-sunburst` are not chat models; they're on `POST /api/v1/images`
  (synchronous, base64 `b64_json`, `usage.cost`, `input_references` up to 16,
  aspect ratios 1:1/3:2/2:3/4:3/3:4/16:9/9:16/21:9 — **no 4:5**, so Studio's
  4:5 renders as 3:4). The Images API has no `models` fallback array or
  `data_collection` field, so fallback is client-side.
- **Video** (`POST /api/v1/videos` → poll `GET /videos/{id}` →
  `GET /videos/{id}/content` with the API key; webhook
  `X-OpenRouter-Signature: t=…,v1=hex(HMAC-SHA256("t,rawBody"))`). All
  catalog slugs exist: `google/veo-3.1-fast` / `-lite` (4/6/8 s, 16:9 and 9:16,
  first/last frame), `minimax/hailuo-3` (5–15 s, 2K only, references billed
  per image), `bytedance/seedance-2.0-fast` (4–15 s, 480p/720p),
  `x-ai/grok-imagine-video-1.5` (1–15 s, no audio). **Frames must be JPEG or
  PNG** (found live); other formats are converted with `sharp` before submit.
- **KIE:** Gemini Omni 1.1 Flash takes a string duration (4/6/8/10), 16:9 or
  9:16, 360p–4k, up to 7 quota units (1 per image), and `first_frame_url` can't
  be combined with references. MiniMax H3 has separate text-, image- and
  reference-to-video ids, 4–15 s, `768P`/`2K`, up to 9 reference images.
  **KIE credit prices for Gemini Omni and MiniMax H3 were not confirmed**; the
  defaults are placeholders marked in `.env.example`.
- KIE now accepts 6-second Veo reference renders (it used to reject them).

## Gotchas enforced in code

- `tool_choice` is always `"auto"` (Opus rejects forced tools). `runTool`
  and memory extraction ask for the tool in the prompt instead.
- Tool-loop conversations are append-only; assistant turns (including
  `reasoning_details`) go back byte-for-byte. Old Anthropic-format GEO agent
  checkpoints are detected and that stage restarts rather than replaying them.
- Reasoning never reaches users: `reasoning.exclude` outside the tool loop,
  and reasoning deltas are stripped from chat streams.
- The answering model is logged and metered, because Opus 5.5 can be served
  silently by an older Claude model and `models` can fail over.
- Grounding (`fixes/grounding.ts`, competitor grounding, untrusted-source
  wrapping) is unchanged; only the model behind it moved.

## Video fallback rule

A job moves from KIE to OpenRouter only when KIE **definitely** refused it
for a reason another provider fixes: out of credits, auth/configuration, or
model unavailable. A validation refusal or rate limit stays on KIE. A timeout
or dropped connection is an unknown outcome — KIE may be rendering it — so
it's retried on KIE and never submitted elsewhere. The render row records the
provider and model that accepted the job (`provider`, `provider_model`, no
migration needed); checks, downloads, webhooks and metering follow it.

## Dropping KIE (the whole checklist)

1. Set `VIDEO_PROVIDER=openrouter` (and `VIDEO_PROVIDER_FALLBACK=none`, or
   remove it).
2. Delete `src/server/ugc/providers/kie.server.ts`,
   `src/lib/kie-gateway.server.ts` and `src/app/api/public/hooks/kie/route.ts`
   (plus `verifyKieCallback`/`signKieCallback` in
   `src/server/ugc/webhook.server.ts`).
3. Remove `kie` from `PROVIDERS` in `providers/routed.server.ts` and the `kie`
   specs in `src/lib/ugc/models.ts`.
4. Remove the env vars: `KIE_API_KEY`, `KIE_WEBHOOK_HMAC_KEY`,
   `KIE_USD_PER_CREDIT`, `UGC_PRICE_*_CREDITS`.
5. `npm run typecheck && npm test`, then run
   `tests/live/openrouter-models.live.ts` with `VIDEO_LIVE_OPENROUTER=yes`.

Renders already running on KIE at the switch keep `provider = "kie"` and are
checked there until they settle, so do step 2 after they finish (at most 30
minutes, `RENDER_TIMEOUT_MS`).

## Known risks

- **Very new models.** Opus 5.5 and Gemini 3.8 Flash were released weeks
  ago; quality regressions or slug changes are possible. Every model is one
  env var away (`AI_MODEL_<ROUTE>`, `IMAGE_MODEL_*`).
- **Silent rerouting.** A fallback or a safeguard can answer with a different
  model; it's logged (`[ai-gateway] answered by a different model`) and
  metered under the model that answered.
- **Unverified KIE prices** for Gemini Omni and MiniMax H3 (see above). The
  provider's own reported cost is what's captured; the estimate only sizes
  the allowance hold.
- **Studio images run after the response** (`after()`), parking the result in
  the shared cache. Multi-instance deployments need `REDIS_URL` so any
  instance's poll can see it; without it a render that finished on another
  instance times out after 10 minutes and the next fallback is tried.
- **Veo audio refusals.** During live checks Google's Veo refused to generate
  audio for some Gemini-written UGC scripts on KIE ("unable to generate audio
  for this request"). That's content-dependent at Google and costs nothing,
  but it is a user-visible failure worth watching.
