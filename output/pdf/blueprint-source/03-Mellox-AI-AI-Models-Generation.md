# Mellox AI - AI Models & Generation Systems

Snapshot: 2026-10-21 | commit 055c90977c2ccf15237e985b8a333e4b146e30be

## How to use this volume

This is volume 03 of six documents describing Mellox AI as represented in the local source snapshot on 21 October 2026. The owner confirmed that this repository is current, Railway is the hosting platform, codebase pricing should be used, and mellox.ai is the public website.


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

## Current model stack and authority

The main Next.js application routes text, vision and tool-use through OpenRouter. It does not need a direct Anthropic key merely because a route uses Claude. The three default text tiers are Claude Opus 5.5 (premium), Gemini 3.8 Flash (workhorse) and Gemini 3.1 Flash Lite (economy). Default premium fallback is workhorse; workhorse falls back to GPT-6.1 Sol; economy falls back to GPT-6 Luna.


Every paid text caller names a task route. task-models.ts maps that route to an ordered model list, reasoning effort, optional token ceiling, escalation and degraded plan. The 76 registry entries are reproduced later in this volume. Those are source defaults, not a production request log.


Current routing precedence is an explicit AI_MODEL_<ROUTE> or AI_EFFORT_<ROUTE> environment override, then an admin-controlled model_route_overrides snapshot, then the registry. Admin override models are filtered against known allowed model IDs. The snapshot normally refreshes on a fifteen-second cache and retains its previous answer on a failed read. Escalated routes can have a separate _ESCALATED model override. Production settings were not exported in this audit.


Implementation sources: src/server/ai/task-models.ts; src/server/platform/routing-overrides.server.ts; src/lib/ai-gateway.server.ts


| Tier / role | Default model ID | Default failover |

| --- | --- | --- |

| Premium | anthropic/claude-opus-5.5 | google/gemini-3.8-flash |

| Workhorse | google/gemini-3.8-flash | openai/gpt-6.1-sol |

| Economy | google/gemini-3.1-flash-lite | openai/gpt-6-luna |

| GEO probe default | perplexity/sonar | Separate engines are sampled, not a failover chain |

## Where each tier is used

Premium is assigned where the resulting interpretation, public content or code change has high consequence: Brand DNA extraction and visual analysis, Pro chat, premium articles, campaign generation, Coach, Market Brain, strategy, audience-group construction, GEO proposals and coding-agent stages, website blog design and experiment reasoning/integration.


Workhorse handles normal Flash chat, most Studio copy, calendar planning, scripts, ads, stories, carousel copy, regeneration, research classification, competitor profiles/discovery, Autopilot planning, analytics interpretation, audience synthesis/variants, UGC product/concept/notes and some CMS fixes. Economy handles repetitive or lightweight work such as search assistance, history summarization, competitor update classification, opportunity ranking, audience scoring/reaction and media moderation.


This is a task allocation policy, not evidence that the premium model is necessary for every one of these tasks. Rebuild the gateway and evaluation harness first, then use measured quality, latency and provider cost to justify model changes. Model selection must not bypass authorization, factual grounding or financial controls.


Implementation sources: src/server/ai/task-models.ts; evals


## Gateway request and streaming lifecycle

The text gateway resolves a task plan, checks feature and operational constraints, applies budgets and usage reservations, constructs the upstream request, calls OpenRouter and records usage/cost/outcome. Structured output and tools require compatible request parameters. The model returned by the provider, not just the requested first model, belongs in the usage record.


An ordered models array is a provider fallback policy for one request body. It does not mean all models are called. Tool loops need a stable conversation on the model that answered; signed/encrypted reasoning details must stay attached to the correct provider/model when replayed. A partially emitted completion that ends in an upstream error must not be represented as a complete successful artifact.


Streaming adds a financial boundary: the hold remains while the response is consumed. A successful delivered result captures the appropriate amount; failure or cancellation releases it where safe. After an ambiguous capture, cancellation must not undo a charge that may already have settled. Retrying with the same key is safer than an unrelated second charge.


Unknown text routes throw in development/test. In production they log a warning and use a workhorse default, so the route coverage test is important. A new feature should add its explicit registry entry and credit coverage before shipping.


Implementation sources: src/lib/ai-gateway.server.ts; src/lib/ai-gateway.tool-loop.server.ts; src/server/ai/metering.ts; src/server/billing/metered.server.ts; src/server/ai/task-models.test.ts


Flow: Feature names task route + verified workspace -> Load context -> resolve route overrides -> Check safety + plan + spend + hold -> Gateway -> ordered models -> provider response -> Validate structured output / grounding / completion -> Persist result -> capture or release -> usage event

## Prompt and knowledge architecture

The prompt is assembled from product-owned instructions and verified workspace context. Brand DNA supplies business identity; Brand Look supplies visual/writing/video preferences; confirmed Strategy supplies the approved marketing direction; Audience supplies sourced groups; Market and Competitors supply stored evidence; team Memory supplies explicit rules and preferences. Recent content and schedule reduce repetition. Research and external pages are data, not authority to alter the system's instructions.


Persistent memory is not the model training process. The application retrieves stored memory and adds an appropriate block to each request. Visual/video surfaces receive selected topics rather than all text instructions. Context caches are short lived and invalidated when knowledge changes. Chat history is stored separately and older turns can be summarized to control context size.


Current memory handling intentionally places approved team rules high in the prompt rather than fencing them as scraped evidence. Therefore only authorized writes through applyMemoryOps should reach that trusted memory store. Imported pages, tool outputs and user-editable audience content retain their untrusted-data boundaries.


A rebuild should version prompt templates, schema contracts, scoring rules and the context fingerprint used for a job. Store enough identifiers to reproduce the decision without retaining unnecessary sensitive raw prompts. The current pipeline has creative-brief, DNA and prompt metadata fields in media paths; universal prompt-version retention is an engineering recommendation, not a claim about every route.


Implementation sources: src/server/studio/context.server.ts; src/lib/ai/prompts; src/lib/studio/prompts.ts; src/server/memory/context.server.ts; src/lib/memory/decide.ts; src/server/strategy/context.server.ts


## Brand extraction and evidence-led strategy

Brand extraction combines website/business evidence and visual analysis, then asks the premium route for structured brand context. Search assistance uses the economy route. Scanned text must not inject instructions into future generators. Brand facts need review because a wrong DNA record can propagate into every later caption and strategy.


Strategy generation gathers sources from the four brains and validates the proposed references. A strategy may name only tracked competitors and collected market sources. The same grounding applies to user edits. Only confirmed strategy is consumed by generators. The first generation is included; a later rebuild is a paid action. The free first run must be idempotent rather than resettable by a second click.


Brain health is computed from stored completeness and activity. It should be explained as an operational readiness view. No model response, generated strategy or health score is proof of competitive superiority, product-market fit or guaranteed marketing performance.


Implementation sources: src/server/strategy; src/lib/strategy/ground.ts; src/server/brand-visuals; src/server/brain/overview.server.ts


## Studio generation and deterministic rendering

Studio does more than send a brief to a model. It loads brand-grounded context, chooses a content purpose and channel playbook, produces structured copy or a visual plan, renders supported layouts, reviews generated media, persists assets and creates drafts. Image quality review uses a short workhorse vision response. Brand visual review and memory conformance can hold output for a person instead of letting automation send it.


Article, social, carousel, Story, ad and script routes have different schemas, grounding and budgets. Premium article generation is distinct from the standard-article billing action; do not infer its execution model from the credit action's name alone. Where a route ceiling is absent in the registry appendix, the gateway or caller may set one.


Deterministic rendering matters for editable text, slide order and reliable brand composition. carousel-render and story-assets are separate from model inference. The same implementation pattern can combine AI-written content with predictable graphic layout without purchasing a fully generated image for every text-heavy panel.


Implementation sources: src/server/studio/runner.server.ts; src/server/studio/carousel-render.server.tsx; src/server/studio/story-assets.server.tsx; src/server/studio/image-review.server.ts; src/lib/studio/viral.ts


## Image routing and persistence

Image generation uses the dedicated OpenRouter image client. The fast default is openai/gpt-image-2.5-flare and the precision default is openai/gpt-image-2.5-sunburst. Default/premium generation and editing each have environment overrides. The router considers prompt complexity, text/brand precision, requested quality, reference/edit mode, iteration and latency preference. Client-side fallback selects another compatible image model when required; this is separate from the text gateway's models array.


The current client enforces up to four reference assets and a twenty-megabyte returned-image ceiling. It uses per-tenant cache and in-flight deduplication, image budgets and usage metering. Its image timeout is 150 seconds; normal generated-image cache TTL is two hours and parked Studio task results have a thirty-minute TTL. These are source defaults and can change with code.


The image-size mapping deserves a product caveat: Studio's 1024x1280 request is a 4:5 intent, but current provider mapping requests 3:4 as the closest supported portrait ratio. Square, landscape and vertical sizes have their own mapping. A rebuild must either make the UI reflect the provider dimensions or explicitly crop/compose the required delivery format; do not claim native 4:5 output from this adapter.


Published media must use the canonical asset path after validation rather than a temporary upstream URL. Image prompt safety and reference-image safety precede generation. Metadata finalization has separate runtime dependencies and must not block asset ownership validation.


Implementation sources: src/lib/model-router.server.ts; src/lib/openrouter-image.server.ts; src/server/assets/image-metadata.server.ts; src/server/assets/storage.server.ts


## Video providers, routing and capabilities

The current UGC catalog has six creative keys: standard, draft, premium, long, cinematic and variation. Per-option provider defaults are KIE for standard/draft/variation and OpenRouter for premium/long/cinematic. Global VIDEO_PROVIDER and per-option VIDEO_PROVIDER_<KEY> controls exist; actual routed request/provider fields are authoritative. Studio also has an explicit OpenRouter default video path.


Fallback is constrained to definite provider refusal: depleted provider balance, missing/invalid configuration or unavailable model. Validation errors and rate limits do not justify paying a different provider automatically. A timeout or dropped submission may already have created a paid render; status recovery stays attached to the accepting or possibly accepting provider. Completed job checks and download use the stored provider.


The current variation fallback is six-second Veo Lite on OpenRouter, not Grok Imagine Video. Grok appears in external listings and older records, but the current app deliberately substitutes this cheaper fallback. Premium's KIE Gemini Omni and Cinematic's KIE MiniMax pricing comments are unverified placeholders; do not use them as current invoice facts or default activated routes.


Implementation sources: src/lib/ugc/models.ts; src/server/ugc/models.server.ts; src/server/ugc/providers/routed.server.ts; src/lib/billing/catalog.ts


### standard - Standard

Realistic creators with lip-synced speech and your product in the shot. The best value for UGC ads.


| Provider | Model | Native lengths | Resolution | Media constraints |

| --- | --- | --- | --- | --- |

| kie | veo-3-1 / veo3_fast | 4 / 6 / 8 s | 720p / 1080p | audio True; dialogue True; references; max 3 |

| openrouter | google/veo-3.1-fast | 4 / 6 / 8 s | 720p / 1080p | audio True; dialogue True; first_frame; max 1 |

### draft - Draft

Quick, low-cost drafts to test hooks and concepts before a final render.


| Provider | Model | Native lengths | Resolution | Media constraints |

| --- | --- | --- | --- | --- |

| kie | veo-3-1 / veo3_lite | 4 / 6 / 8 s | 720p / 1080p | audio True; dialogue True; references; max 3 |

| openrouter | google/veo-3.1-lite | 4 / 6 / 8 s | 720p / 1080p | audio True; dialogue True; first_frame; max 1 |

### premium - Premium

The most realistic people and product shots, for hero ads.


| Provider | Model | Native lengths | Resolution | Media constraints |

| --- | --- | --- | --- | --- |

| kie | google/gemini-omni-flash-1-1 | 4 / 6 / 8 / 10 s | 720p / 1080p | audio True; dialogue True; references; max 7 |

| openrouter | minimax/hailuo-3 | 5 / 6 / 7 / 8 / 9 / 10 / 11 / 12 / 13 / 14 / 15 s | 2k | audio True; dialogue True; references; max 4 |

### long - Long take

Takes up to 15 seconds, square video, and up to 9 product photos for accurate packaging.


| Provider | Model | Native lengths | Resolution | Media constraints |

| --- | --- | --- | --- | --- |

| kie | bytedance/seedance-2-fast | 4 / 5 / 6 / 7 / 8 / 9 / 10 / 11 / 12 / 13 / 14 / 15 s | 480p / 720p | audio True; dialogue True; references; max 9 |

| openrouter | bytedance/seedance-2.0-fast | 4 / 5 / 6 / 7 / 8 / 9 / 10 / 11 / 12 / 13 / 14 / 15 s | 480p / 720p | audio True; dialogue True; first_frame; max 1 |

### cinematic - Cinematic

Controlled camera moves and multi-shot storytelling.


| Provider | Model | Native lengths | Resolution | Media constraints |

| --- | --- | --- | --- | --- |

| kie | minimax-h3/reference-to-video | 4 / 5 / 6 / 7 / 8 / 9 / 10 / 11 / 12 / 13 / 14 / 15 s | 768p / 2k | audio True; dialogue True; references; max 9 |

| openrouter | minimax/hailuo-3 | 5 / 6 / 7 / 8 / 9 / 10 / 11 / 12 / 13 / 14 / 15 s | 2k | audio True; dialogue True; references; max 4 |

### variation - Quick variation

Fast, low-cost animation of a product photo for creative variations.


| Provider | Model | Native lengths | Resolution | Media constraints |

| --- | --- | --- | --- | --- |

| kie | grok-imagine/image-to-video | 5 / 10 s | 480p / 720p | audio False; dialogue False; first_frame; max 1 |

| openrouter | google/veo-3.1-lite | 6 s | 720p / 1080p | audio True; dialogue True; first_frame; max 1 |

## Longer-video composition and cost

The app offers a ten-second default and output lengths up to sixty seconds. planVideoSegments balances the requested duration across native-sized clips, asks providers for valid native lengths, and trims unavoidable padding during assembly. A twenty-second output using a maximum eight-second model, for example, is split into three target sections of seven, seven and six seconds and rendered at supported lengths.


The composition store persists each accepted task before the next submit. Revisions and leases coordinate concurrent polling. An interrupted submission is failed rather than silently resubmitted as a new paid task. Each finished clip passes video safety review before FFmpeg assembly. A deploy without the video_compositions migration or FFmpeg cannot reliably deliver this longer-output path.


Studio's quote is ceil(seconds / 10) x 200 integer video units, where 100 units equals one Video Credit. Thus a default ten-second Studio output quotes 2 VC, thirty seconds 6 VC and sixty seconds 12 VC. UGC quotes use videoUnitsFor with option, duration, resolution and provider cost; they are not universally the Studio formula. General credits never substitute for video balance.


For quality assurance, review cross-clip face, product packaging, clothing, voice, lighting, pacing, dialogue completion and CTA placement. Prompt continuity instructions help but do not prove seamless identity. Composition is an implemented orchestration layer, not a separate video foundation model.


Implementation sources: src/lib/ugc/duration.ts; src/server/ugc/providers/composition.server.ts; src/server/ugc/providers/assemble.server.ts; supabase/migrations/20261021090000_video_compositions.sql


## Audience and Autopilot model boundaries

Audience group construction uses premium text; scoring and reactions use economy; synthesis and variants use workhorse. Models propose descriptions and judgments, while pure code computes numerical dimensions and aggregation. Exact content and group fingerprints prevent stale scores. Simulations must remain labeled predictions and later real outcomes belong in a separate measured field.


Autopilot planning uses workhorse, signal/opportunity classification uses economy, and the confirmed workspace strategy uses premium. The planner points at numbered stored sources, and pure grounding resolves those pointers. Unknown numeric claims are removed from the brief before a writer sees them. Every piece receives the brand facts and audience context without inventing a source.


The worker uses normal Studio pricing and the program's weekly budgets. Included planning does not make every created piece free. Fully automatic behavior must pass the same readiness, safety, approval-mode and content-quality rules. Untrusted market signals must not turn into arbitrary tool instructions.


Implementation sources: src/server/audience; src/lib/audience; src/lib/autopilot/brief.ts; src/server/autopilot/engine.ts


## GEO probes, proposals and coding agent

Default GEO probe engines are perplexity/sonar, openai/gpt-6-luna and google/gemini-3.8-flash. They are asked separately. The geo.probe registry entry is not the entire multi-engine policy; geoProbeModels and tracked-prompt services determine which engines run. Scan probes require explicit enablement, budgets and cache policy. Tracked-prompt plan allowances are a separate product flow.


Proposals and batch fixes use premium models; supported CMS fixes normally use workhorse and can escalate after validation or grounding rejection. Engineer stages use premium investigation at high effort, implementation at medium, and review at high. These stages can propose work only inside a verified repository/host relationship and approved patch boundary.


Scoring and finding resolution are deterministic. A model cannot directly assign an improved site score or mark its own patch verified. Compare the newly fetched target against the rule evidence, including related-page context for comparison rules. An inconclusive verification is not a pass.


Implementation sources: src/server/ai/task-models.ts; src/server/geo; src/server/fns/tracked-prompts.ts; src/lib/geo/score.ts


## Spend controls, observability and evaluation

Separate commercial balance from operating spend. Billing holds/capture/release implement customer allowances. AI usage reservations and provider cost events constrain actual service expense. Cache hits, provider errors, retries and fallback models must remain visible so a cheap catalog action cannot hide an expensive repeated provider path.


The provider's reported usage.cost is preferred for metering. If absent, the code estimates from token usage and model unit prices, then uses flat estimates for unsupported unit reporting. Estimates can be overridden through AI_PRICE variables. Reasoning output, caching, web-search fees, retries and long outputs can change the real bill; invoice reconciliation remains necessary.


The repository uses Vitest, Playwright and live suites, with Promptfoo configuration for competitor intelligence, campaign generation and security. Run focused gateway/route/metering tests, schema and grounding checks, and adversarial context cases before adopting a replacement model. This documentation job did not execute the application tests or make paid evaluation calls.


Recommended evaluation gates are factual grounding, brand-rule adherence, schema validity, unsafe-content refusal, source freshness, tool permission boundaries, duplicate-charge behavior, median/tail latency and cost per accepted result. Record the evaluated model/provider, prompt version and sample set; a model name alone is not a reproducible quality decision.


Implementation sources: src/server/ai/pricing.ts; src/server/ai/budget.ts; src/server/ai/metering.ts; src/server/billing/metered.server.ts; evals; src/server/observability


## Complete task-model registry

Each entry below is the unmodified source default extracted with no environment or database overrides. An absent ceiling/temperature is unspecified here; inspect the caller/gateway. Degraded plans are spend-ceiling behavior, while escalation applies only when the caller uses the documented condition. Primary plus fallbacks are ordered.


### brand-extract

Models: anthropic/claude-opus-5.5 -> google/gemini-3.8-flash
Reasoning: medium | maxTokens: 12000 | temperature: caller/gateway


Degraded: google/gemini-3.8-flash -> openai/gpt-6.1-sol; effort medium


### brand-extract.search

Models: google/gemini-3.1-flash-lite -> openai/gpt-6-luna
Reasoning: low | maxTokens: caller/gateway | temperature: caller/gateway


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort low


### brand-visuals.analyze

Models: anthropic/claude-opus-5.5 -> google/gemini-3.8-flash
Reasoning: medium | maxTokens: 6000 | temperature: caller/gateway


Degraded: google/gemini-3.8-flash -> openai/gpt-6.1-sol; effort medium


### memory-extract

Models: google/gemini-3.8-flash -> openai/gpt-6.1-sol
Reasoning: low | maxTokens: caller/gateway | temperature: caller/gateway


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort low


### file-extract

Models: google/gemini-3.1-flash-lite -> openai/gpt-6-luna
Reasoning: low | maxTokens: caller/gateway | temperature: caller/gateway


Escalation: the first read came back thin (THIN_TEXT_CHARS) -> google/gemini-3.8-flash -> openai/gpt-6.1-sol; effort low


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort low


### chat

Models: google/gemini-3.8-flash -> openai/gpt-6.1-sol
Reasoning: low | maxTokens: 6000 | temperature: caller/gateway


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort low


### chat.pro

Models: anthropic/claude-opus-5.5 -> google/gemini-3.8-flash
Reasoning: low | maxTokens: 8000 | temperature: caller/gateway


Escalation: chat-intent classifies the turn as strategy/analysis -> anthropic/claude-opus-5.5 -> google/gemini-3.8-flash; effort medium


Degraded: google/gemini-3.8-flash -> openai/gpt-6.1-sol; effort low


### chat.research

Models: google/gemini-3.8-flash -> openai/gpt-6.1-sol
Reasoning: medium | maxTokens: caller/gateway | temperature: caller/gateway


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort medium


### chat.history-summary

Models: google/gemini-3.1-flash-lite -> openai/gpt-6-luna
Reasoning: low | maxTokens: caller/gateway | temperature: caller/gateway


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort low


### clarify

Models: google/gemini-3.8-flash -> openai/gpt-6.1-sol
Reasoning: low | maxTokens: caller/gateway | temperature: caller/gateway


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort low


### content.regenerate

Models: google/gemini-3.8-flash -> openai/gpt-6.1-sol
Reasoning: medium | maxTokens: caller/gateway | temperature: caller/gateway


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort medium


### content.generateBatch

Models: google/gemini-3.8-flash -> openai/gpt-6.1-sol
Reasoning: medium | maxTokens: caller/gateway | temperature: caller/gateway


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort medium


### content.generateNextPost

Models: google/gemini-3.8-flash -> openai/gpt-6.1-sol
Reasoning: medium | maxTokens: caller/gateway | temperature: caller/gateway


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort medium


### content.planCalendar

Models: google/gemini-3.8-flash -> openai/gpt-6.1-sol
Reasoning: medium | maxTokens: caller/gateway | temperature: caller/gateway


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort medium


### social.multi

Models: google/gemini-3.8-flash -> openai/gpt-6.1-sol
Reasoning: medium | maxTokens: caller/gateway | temperature: caller/gateway


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort medium


### ai-generate

Models: google/gemini-3.8-flash -> openai/gpt-6.1-sol
Reasoning: medium | maxTokens: caller/gateway | temperature: caller/gateway


Escalation: long-form output over ~1,500 words -> anthropic/claude-opus-5.5 -> google/gemini-3.8-flash; effort medium


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort medium


### ai-generate.*

Models: google/gemini-3.8-flash -> openai/gpt-6.1-sol
Reasoning: medium | maxTokens: caller/gateway | temperature: caller/gateway


Escalation: long-form output over ~1,500 words -> anthropic/claude-opus-5.5 -> google/gemini-3.8-flash; effort medium


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort medium


### studio.article

Models: anthropic/claude-opus-5.5 -> google/gemini-3.8-flash
Reasoning: medium | maxTokens: caller/gateway | temperature: caller/gateway


Degraded: google/gemini-3.8-flash -> openai/gpt-6.1-sol; effort medium


### studio.social

Models: google/gemini-3.8-flash -> openai/gpt-6.1-sol
Reasoning: medium | maxTokens: caller/gateway | temperature: caller/gateway


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort medium


### studio.carousel

Models: google/gemini-3.8-flash -> openai/gpt-6.1-sol
Reasoning: medium | maxTokens: caller/gateway | temperature: caller/gateway


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort medium


### studio.story

Models: google/gemini-3.8-flash -> openai/gpt-6.1-sol
Reasoning: medium | maxTokens: caller/gateway | temperature: caller/gateway


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort medium


### studio.script

Models: google/gemini-3.8-flash -> openai/gpt-6.1-sol
Reasoning: medium | maxTokens: caller/gateway | temperature: caller/gateway


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort medium


### studio.ad

Models: google/gemini-3.8-flash -> openai/gpt-6.1-sol
Reasoning: medium | maxTokens: caller/gateway | temperature: caller/gateway


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort medium


### studio.upload-captions

Models: google/gemini-3.8-flash -> openai/gpt-6.1-sol
Reasoning: medium | maxTokens: caller/gateway | temperature: caller/gateway


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort medium


### studio.captions

Models: google/gemini-3.8-flash -> openai/gpt-6.1-sol
Reasoning: medium | maxTokens: caller/gateway | temperature: caller/gateway


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort medium


### studio.naturalize

Models: google/gemini-3.8-flash -> openai/gpt-6.1-sol
Reasoning: low | maxTokens: caller/gateway | temperature: caller/gateway


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort low


### studio.ideas

Models: google/gemini-3.8-flash -> openai/gpt-6.1-sol
Reasoning: low | maxTokens: caller/gateway | temperature: 0.9


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort low


### studio.prompt

Models: google/gemini-3.8-flash -> openai/gpt-6.1-sol
Reasoning: low | maxTokens: caller/gateway | temperature: caller/gateway


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort low


### studio.research

Models: google/gemini-3.8-flash -> openai/gpt-6.1-sol
Reasoning: medium | maxTokens: caller/gateway | temperature: caller/gateway


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort medium


### studio.trends

Models: google/gemini-3.8-flash -> openai/gpt-6.1-sol
Reasoning: low | maxTokens: caller/gateway | temperature: caller/gateway


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort low


### studio.image.review

Models: google/gemini-3.8-flash -> openai/gpt-6.1-sol
Reasoning: low | maxTokens: 350 | temperature: caller/gateway


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort low


### brand-visuals.review

Models: google/gemini-3.8-flash -> openai/gpt-6.1-sol
Reasoning: low | maxTokens: 700 | temperature: caller/gateway


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort low


### campaign-generation

Models: anthropic/claude-opus-5.5 -> google/gemini-3.8-flash
Reasoning: low | maxTokens: caller/gateway | temperature: caller/gateway


Degraded: google/gemini-3.8-flash -> openai/gpt-6.1-sol; effort low


### schedule.*

Models: google/gemini-3.8-flash -> openai/gpt-6.1-sol
Reasoning: medium | maxTokens: caller/gateway | temperature: caller/gateway


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort medium


### coach

Models: anthropic/claude-opus-5.5 -> google/gemini-3.8-flash
Reasoning: low | maxTokens: caller/gateway | temperature: caller/gateway


Escalation: deep strategy, isComplexStrategy or forced premium -> anthropic/claude-opus-5.5 -> google/gemini-3.8-flash; effort high


Degraded: google/gemini-3.8-flash -> openai/gpt-6.1-sol; effort low


### coach.briefing

Models: anthropic/claude-opus-5.5 -> google/gemini-3.8-flash
Reasoning: low | maxTokens: 8000 | temperature: caller/gateway


Escalation: deep strategy, isComplexStrategy or forced premium -> anthropic/claude-opus-5.5 -> google/gemini-3.8-flash; effort high


Degraded: google/gemini-3.8-flash -> openai/gpt-6.1-sol; effort low


### coach.research

Models: google/gemini-3.8-flash -> openai/gpt-6.1-sol
Reasoning: low | maxTokens: caller/gateway | temperature: caller/gateway


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort low


### coach.trends

Models: google/gemini-3.8-flash -> openai/gpt-6.1-sol
Reasoning: low | maxTokens: caller/gateway | temperature: caller/gateway


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort low


### market-intelligence

Models: anthropic/claude-opus-5.5 -> google/gemini-3.8-flash
Reasoning: medium | maxTokens: 10000 | temperature: caller/gateway


Degraded: google/gemini-3.8-flash -> openai/gpt-6.1-sol; effort medium


### analytics/insights

Models: google/gemini-3.8-flash -> openai/gpt-6.1-sol
Reasoning: medium | maxTokens: caller/gateway | temperature: caller/gateway


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort medium


### analytics/insights-auto

Models: google/gemini-3.8-flash -> openai/gpt-6.1-sol
Reasoning: low | maxTokens: caller/gateway | temperature: caller/gateway


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort low


### agent.content-fit

Models: google/gemini-3.8-flash -> openai/gpt-6.1-sol
Reasoning: low | maxTokens: caller/gateway | temperature: caller/gateway


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort low


### agent.distribution-reliability

Models: google/gemini-3.1-flash-lite -> openai/gpt-6-luna
Reasoning: low | maxTokens: caller/gateway | temperature: caller/gateway


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort low


### competitors.discovery

Models: google/gemini-3.8-flash -> openai/gpt-6.1-sol
Reasoning: low | maxTokens: caller/gateway | temperature: caller/gateway


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort low


### competitors.profile

Models: google/gemini-3.8-flash -> openai/gpt-6.1-sol
Reasoning: low | maxTokens: caller/gateway | temperature: caller/gateway


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort low


### competitors.updates

Models: google/gemini-3.1-flash-lite -> openai/gpt-6-luna
Reasoning: low | maxTokens: caller/gateway | temperature: caller/gateway


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort low


### autopilot.plan

Models: google/gemini-3.8-flash -> openai/gpt-6.1-sol
Reasoning: medium | maxTokens: caller/gateway | temperature: caller/gateway


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort medium


### autopilot.strategy

Models: google/gemini-3.8-flash -> openai/gpt-6.1-sol
Reasoning: low | maxTokens: caller/gateway | temperature: caller/gateway


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort low


### strategy.generate

Models: anthropic/claude-opus-5.5 -> google/gemini-3.8-flash
Reasoning: medium | maxTokens: 12000 | temperature: caller/gateway


Degraded: google/gemini-3.8-flash -> openai/gpt-6.1-sol; effort medium


### autopilot.opportunities

Models: google/gemini-3.1-flash-lite -> openai/gpt-6-luna
Reasoning: low | maxTokens: caller/gateway | temperature: caller/gateway


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort low


### competitor-intel

Models: google/gemini-3.8-flash -> openai/gpt-6.1-sol
Reasoning: medium | maxTokens: caller/gateway | temperature: caller/gateway


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort medium


### audience.twins

Models: anthropic/claude-opus-5.5 -> google/gemini-3.8-flash
Reasoning: low | maxTokens: 6000 | temperature: caller/gateway


Degraded: google/gemini-3.8-flash -> openai/gpt-6.1-sol; effort low


### audience.score

Models: google/gemini-3.1-flash-lite -> openai/gpt-6-luna
Reasoning: low | maxTokens: 1200 | temperature: caller/gateway


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort low


### audience.react

Models: google/gemini-3.1-flash-lite -> openai/gpt-6-luna
Reasoning: low | maxTokens: 2400 | temperature: 0.8


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort low


### audience.synthesize

Models: google/gemini-3.8-flash -> openai/gpt-6.1-sol
Reasoning: low | maxTokens: 2400 | temperature: caller/gateway


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort low


### audience.variants

Models: google/gemini-3.8-flash -> openai/gpt-6.1-sol
Reasoning: medium | maxTokens: 3000 | temperature: 0.9


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort medium


### geo.probe

Models: perplexity/sonar
Reasoning: provider/default | maxTokens: caller/gateway | temperature: caller/gateway


### geo.fix.propose

Models: anthropic/claude-opus-5.5 -> google/gemini-3.8-flash
Reasoning: medium | maxTokens: 16000 | temperature: caller/gateway


Degraded: google/gemini-3.8-flash -> openai/gpt-6.1-sol; effort medium


### geo.fix.batch

Models: anthropic/claude-opus-5.5 -> google/gemini-3.8-flash
Reasoning: medium | maxTokens: 16000 | temperature: caller/gateway


Degraded: google/gemini-3.8-flash -> openai/gpt-6.1-sol; effort medium


### geo.cms.fix

Models: google/gemini-3.8-flash -> openai/gpt-6.1-sol
Reasoning: medium | maxTokens: caller/gateway | temperature: caller/gateway


Escalation: validation or grounding rejected the first output -> anthropic/claude-opus-5.5 -> google/gemini-3.8-flash; effort medium


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort medium


### geo.agent.investigate

Models: anthropic/claude-opus-5.5 -> google/gemini-3.8-flash
Reasoning: high | maxTokens: 12000 | temperature: caller/gateway


Degraded: google/gemini-3.8-flash -> openai/gpt-6.1-sol; effort medium


### geo.agent.implement

Models: anthropic/claude-opus-5.5 -> google/gemini-3.8-flash
Reasoning: medium | maxTokens: 16000 | temperature: caller/gateway


Degraded: google/gemini-3.8-flash -> openai/gpt-6.1-sol; effort medium


### geo.agent.review

Models: anthropic/claude-opus-5.5 -> google/gemini-3.8-flash
Reasoning: high | maxTokens: 8000 | temperature: caller/gateway


Degraded: google/gemini-3.8-flash -> openai/gpt-6.1-sol; effort medium


### articles.blog-design

Models: anthropic/claude-opus-5.5 -> google/gemini-3.8-flash
Reasoning: low | maxTokens: 4000 | temperature: caller/gateway


Degraded: google/gemini-3.8-flash -> openai/gpt-6.1-sol; effort low


### experiments.hypotheses

Models: anthropic/claude-opus-5.5 -> google/gemini-3.8-flash
Reasoning: low | maxTokens: caller/gateway | temperature: caller/gateway


Degraded: google/gemini-3.8-flash -> openai/gpt-6.1-sol; effort low


### experiments.values

Models: google/gemini-3.8-flash -> openai/gpt-6.1-sol
Reasoning: medium | maxTokens: caller/gateway | temperature: caller/gateway


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort medium


### experiments.integration

Models: anthropic/claude-opus-5.5 -> google/gemini-3.8-flash
Reasoning: medium | maxTokens: 16000 | temperature: caller/gateway


Degraded: google/gemini-3.8-flash -> openai/gpt-6.1-sol; effort medium


### links-topical-fit

Models: google/gemini-3.1-flash-lite -> openai/gpt-6-luna
Reasoning: low | maxTokens: caller/gateway | temperature: caller/gateway


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort low


### links-relevance-pick

Models: google/gemini-3.8-flash -> openai/gpt-6.1-sol
Reasoning: low | maxTokens: caller/gateway | temperature: caller/gateway


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort low


### links-profile

Models: google/gemini-3.8-flash -> openai/gpt-6.1-sol
Reasoning: low | maxTokens: caller/gateway | temperature: caller/gateway


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort low


### links-article-brief

Models: google/gemini-3.8-flash -> openai/gpt-6.1-sol
Reasoning: medium | maxTokens: caller/gateway | temperature: caller/gateway


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort medium


### ugc.product.extract

Models: google/gemini-3.8-flash -> openai/gpt-6.1-sol
Reasoning: low | maxTokens: caller/gateway | temperature: caller/gateway


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort low


### ugc.concepts

Models: google/gemini-3.8-flash -> openai/gpt-6.1-sol
Reasoning: medium | maxTokens: caller/gateway | temperature: caller/gateway


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort medium


### ugc.notes

Models: google/gemini-3.8-flash -> openai/gpt-6.1-sol
Reasoning: low | maxTokens: caller/gateway | temperature: caller/gateway


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort low


### guardrails.image-moderation

Models: google/gemini-3.1-flash-lite -> openai/gpt-6-luna
Reasoning: low | maxTokens: caller/gateway | temperature: caller/gateway


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort low


### guardrails.media-safety

Models: google/gemini-3.1-flash-lite -> openai/gpt-6-luna
Reasoning: low | maxTokens: caller/gateway | temperature: caller/gateway


Degraded: google/gemini-3.1-flash-lite -> openai/gpt-6-luna; effort low


Implementation sources: src/server/ai/task-models.ts


## Prompt-source index

This is the source inventory of prompt-directory files. Additional prompts are built inline in owning feature modules; this list is not a claim that every literal prompt is centralized.


| Prompt source |

| --- |

| src/app/api/studio/prompt/route.ts |

| src/lib/ai/prompts/assemble.ts |

| src/lib/ai/prompts/fragments.ts |

| src/lib/ai/prompts/index.ts |

| src/lib/ai/prompts/library.ts |

Implementation sources: src/lib/ai/prompts; src/lib/studio/prompts.ts


## Current external model checks

The following official pages were reachable on 21 October 2026. This confirms the listings and the quoted text prices, not successful inference with Mellox production credentials. Image token prices are not fixed per-image costs. Video listings are not a fresh validation of every request parameter or KIE price.


[Claude Opus 5.5](https://openrouter.ai/anthropic/claude-opus-5.5) - $4 input / $20 output per million tokens.

[Gemini 3.8 Flash](https://openrouter.ai/google/gemini-3.8-flash) - $0.75 input / $3.75 output per million tokens.

[Gemini 3.1 Flash Lite](https://openrouter.ai/google/gemini-3.1-flash-lite) - $0.25 input / $1.50 output per million tokens.

[GPT-6.1 Sol](https://openrouter.ai/openai/gpt-6.1-sol) - $2 input / $10 output per million tokens.

[GPT-6 Luna](https://openrouter.ai/openai/gpt-6-luna) - $0.10 input / $0.50 output per million tokens.

[Image Flare](https://openrouter.ai/openai/gpt-image-2.5-flare) - Current model listing; dedicated image-generation/editing path.

[Image Sunburst](https://openrouter.ai/openai/gpt-image-2.5-sunburst) - Current model listing; precision image path.

[Veo Fast](https://openrouter.ai/google/veo-3.1-fast) - Current listing reachable; capability table above is code-derived.

[MiniMax H3](https://openrouter.ai/minimax/hailuo-3) - Current listing reachable; capability table above is code-derived.

[Seedance Fast](https://openrouter.ai/bytedance/seedance-2.0-fast) - Current listing reachable; capability table above is code-derived.

## Source ledger and verification limits

Repository-relative paths below identify the owning implementation. The companion source folder includes an extracted inventory and SHA-256 hashes for source files and migrations. The inventory is a static extraction, not a database dump or a successful production test. Generated database types describe their checked-in state; migrations define actual SQL constraints, defaults and policies.


The Mellox connector failed with an internal error. The public site could not be fetched by the web tool or local network, and browser initialization was unavailable. Consequently public-site rendering, deployed commit, enabled credentials, vendor approvals, production schema, invoices, real usage and exact Railway service topology were not independently inspected. The local marketing implementation was used as a secondary source. No live provider generation or publication was triggered.


| Source | SHA-256 prefix |

| --- | --- |

| src/server/ai/task-models.ts | e905dc027bcc6d2b |

| src/server/platform/routing-overrides.server.ts | 64efb98109da4141 |

| src/lib/ai-gateway.server.ts | 45c14a06dd6557bf |

| evals | directory reference |

| src/lib/ai-gateway.tool-loop.server.ts | 6493897711303b30 |

| src/server/ai/metering.ts | 2803cfb711700f8d |

| src/server/billing/metered.server.ts | 6d6a7679b8a904c1 |

| src/server/ai/task-models.test.ts | 8658e3aa8e9ae610 |

| src/server/studio/context.server.ts | efc1746320dea5e0 |

| src/lib/ai/prompts | directory reference |

| src/lib/studio/prompts.ts | 43731ebbd2208324 |

| src/server/memory/context.server.ts | 7d1023e24b5158d8 |

| src/lib/memory/decide.ts | 8d4bf31e78196576 |

| src/server/strategy/context.server.ts | c63c7123f91c1269 |

| src/server/strategy | directory reference |

| src/lib/strategy/ground.ts | 187a3ff2d8f7bfba |

| src/server/brand-visuals | directory reference |

| src/server/brain/overview.server.ts | 10742147975d5054 |

| src/server/studio/runner.server.ts | cbee09d7f87b6aa2 |

| src/server/studio/carousel-render.server.tsx | 5fb829fa36156309 |

| src/server/studio/story-assets.server.tsx | b2cc0ce7254c91f1 |

| src/server/studio/image-review.server.ts | d1c1d21bb119ef66 |

| src/lib/studio/viral.ts | c4b73d0092aee9b5 |

| src/lib/model-router.server.ts | 4c27a7b0f199930b |

| src/lib/openrouter-image.server.ts | 84d3de04136c7acc |

| src/server/assets/image-metadata.server.ts | 7055f4adb9dedee7 |

| src/server/assets/storage.server.ts | 5f20083ebbddc447 |

| src/lib/ugc/models.ts | 6d1c68c9c5d44b38 |

| src/server/ugc/models.server.ts | c1669c204dca1cfe |

| src/server/ugc/providers/routed.server.ts | 042c0785447c2538 |

| src/lib/billing/catalog.ts | eb845ac041f58b84 |

| src/lib/ugc/duration.ts | 6ad312021cd6c5d5 |

| src/server/ugc/providers/composition.server.ts | 4b92cd5607c286fb |

| src/server/ugc/providers/assemble.server.ts | b7903e3b13f6a114 |

| supabase/migrations/20261021090000_video_compositions.sql | d2c16d0b4eea8af7 |

| src/server/audience | directory reference |

| src/lib/audience | directory reference |

| src/lib/autopilot/brief.ts | a4cddf5b91c14dd9 |

| src/server/autopilot/engine.ts | c4137cb92e95a790 |

| src/server/geo | directory reference |

| src/server/fns/tracked-prompts.ts | 88b2714f26e26c59 |

| src/lib/geo/score.ts | fb15eea103344041 |

| src/server/ai/pricing.ts | 600df82c7ddb0ca4 |

| src/server/ai/budget.ts | ffc34d5805231819 |

| src/server/observability | directory reference |