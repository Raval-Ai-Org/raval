# Model Usage Audit

**Updated:** 2026-09-26 (OpenRouter-only migration, [ADR-0026](docs/adr/0026-openrouter-only-models.md))
**Source of truth:** [src/server/ai/task-models.ts](src/server/ai/task-models.ts) — this table is generated from it.

## Summary

| What | Provider | Where |
| --- | --- | --- |
| All text, vision and tool use | OpenRouter (`/api/v1/chat/completions`) | [src/lib/ai-gateway.server.ts](src/lib/ai-gateway.server.ts), [src/lib/ai-gateway.tool-loop.server.ts](src/lib/ai-gateway.tool-loop.server.ts) |
| Image generation and editing | OpenRouter Images API (`/api/v1/images`) | [src/lib/openrouter-image.server.ts](src/lib/openrouter-image.server.ts), routing [src/lib/model-router.server.ts](src/lib/model-router.server.ts) |
| Video (UGC, Studio, `/api/generate-video`) | **KIE** (`VIDEO_PROVIDER=kie`), OpenRouter `/api/v1/videos` as fallback | [src/server/ugc/providers/](src/server/ugc/providers/) |

The Anthropic API is not used anywhere: no code reads `ANTHROPIC_API_KEY` or calls `api.anthropic.com`. Claude runs as `anthropic/claude-opus-5.5` through OpenRouter.

### Tiers

| Tier | Model | Fallback | Degraded (past spend ceiling) | Price in / out per 1M |
| --- | --- | --- | --- | --- |
| PREMIUM | `anthropic/claude-opus-5.5` | `google/gemini-3.8-flash` | `google/gemini-3.8-flash` | $4 / $20 |
| WORKHORSE | `google/gemini-3.8-flash` | `openai/gpt-5.6-terra` | `google/gemini-3.1-flash-lite` | $0.75 / $3.75 |
| ECONOMY | `google/gemini-3.1-flash-lite` | `openai/gpt-5.6-luna` | (stays) | $0.25 / $1.50 |

Metering uses OpenRouter's `usage.cost` and records the model that actually answered; the prices above are the fallback estimate in [src/server/ai/pricing.ts](src/server/ai/pricing.ts).

## Every text route

Effort is OpenRouter `reasoning.effort`. "Max tokens" is the plan's floor for the total ceiling (reasoning + answer); calls without one get the answer size plus reasoning headroom (low 2k, medium 6k, high 12k).

| Route | Model | Effort | Fallbacks | Degraded | Max tokens | Escalation |
| --- | --- | --- | --- | --- | --- | --- |
| `agent.content-fit` | `google/gemini-3.8-flash` | low | `openai/gpt-5.6-terra` | `google/gemini-3.1-flash-lite` |  |  |
| `agent.distribution-reliability` | `google/gemini-3.1-flash-lite` | low | `openai/gpt-5.6-luna` | `google/gemini-3.1-flash-lite` |  |  |
| `ai-generate` | `google/gemini-3.8-flash` | medium | `openai/gpt-5.6-terra` | `google/gemini-3.1-flash-lite` |  | long-form output over ~1,500 words → anthropic/claude-opus-5.5 (medium) |
| `ai-generate.*` | `google/gemini-3.8-flash` | medium | `openai/gpt-5.6-terra` | `google/gemini-3.1-flash-lite` |  | long-form output over ~1,500 words → anthropic/claude-opus-5.5 (medium) |
| `analytics/insights` | `google/gemini-3.8-flash` | medium | `openai/gpt-5.6-terra` | `google/gemini-3.1-flash-lite` |  |  |
| `analytics/insights-auto` | `google/gemini-3.8-flash` | low | `openai/gpt-5.6-terra` | `google/gemini-3.1-flash-lite` |  |  |
| `brand-extract` | `anthropic/claude-opus-5.5` | medium | `google/gemini-3.8-flash` | `google/gemini-3.8-flash` | 12000 |  |
| `brand-extract.search` | `google/gemini-3.1-flash-lite` | low | `openai/gpt-5.6-luna` | `google/gemini-3.1-flash-lite` |  |  |
| `brand-kit/analyze-visual` | `google/gemini-3.8-flash` | medium | `openai/gpt-5.6-terra` | `google/gemini-3.1-flash-lite` |  |  |
| `brand-kit/analyze-writing` | `anthropic/claude-opus-5.5` | low | `google/gemini-3.8-flash` | `google/gemini-3.8-flash` |  |  |
| `brand-kit/describe` | `google/gemini-3.8-flash` | medium | `openai/gpt-5.6-terra` | `google/gemini-3.1-flash-lite` |  |  |
| `campaign-generation` | `anthropic/claude-opus-5.5` | low | `google/gemini-3.8-flash` | `google/gemini-3.8-flash` |  |  |
| `chat` | `google/gemini-3.8-flash` | low | `openai/gpt-5.6-terra` | `google/gemini-3.1-flash-lite` | 6000 |  |
| `chat.history-summary` | `google/gemini-3.1-flash-lite` | low | `openai/gpt-5.6-luna` | `google/gemini-3.1-flash-lite` |  |  |
| `chat.pro` | `anthropic/claude-opus-5.5` | low | `google/gemini-3.8-flash` | `google/gemini-3.8-flash` | 8000 | chat-intent classifies the turn as strategy/analysis → anthropic/claude-opus-5.5 (medium) |
| `chat.research` | `google/gemini-3.8-flash` | medium | `openai/gpt-5.6-terra` | `google/gemini-3.1-flash-lite` |  |  |
| `clarify` | `google/gemini-3.8-flash` | low | `openai/gpt-5.6-terra` | `google/gemini-3.1-flash-lite` |  |  |
| `coach` | `anthropic/claude-opus-5.5` | low | `google/gemini-3.8-flash` | `google/gemini-3.8-flash` |  | deep strategy, isComplexStrategy or forced premium → anthropic/claude-opus-5.5 (high) |
| `coach.briefing` | `anthropic/claude-opus-5.5` | low | `google/gemini-3.8-flash` | `google/gemini-3.8-flash` | 8000 | deep strategy, isComplexStrategy or forced premium → anthropic/claude-opus-5.5 (high) |
| `coach.research` | `google/gemini-3.8-flash` | low | `openai/gpt-5.6-terra` | `google/gemini-3.1-flash-lite` |  |  |
| `coach.trends` | `google/gemini-3.8-flash` | low | `openai/gpt-5.6-terra` | `google/gemini-3.1-flash-lite` |  |  |
| `competitor-intel` | `google/gemini-3.8-flash` | medium | `openai/gpt-5.6-terra` | `google/gemini-3.1-flash-lite` |  |  |
| `competitors.discovery` | `google/gemini-3.8-flash` | low | `openai/gpt-5.6-terra` | `google/gemini-3.1-flash-lite` |  |  |
| `competitors.profile` | `google/gemini-3.8-flash` | low | `openai/gpt-5.6-terra` | `google/gemini-3.1-flash-lite` |  |  |
| `competitors.updates` | `google/gemini-3.1-flash-lite` | low | `openai/gpt-5.6-luna` | `google/gemini-3.1-flash-lite` |  |  |
| `content.generateBatch` | `google/gemini-3.8-flash` | medium | `openai/gpt-5.6-terra` | `google/gemini-3.1-flash-lite` |  |  |
| `content.generateNextPost` | `google/gemini-3.8-flash` | medium | `openai/gpt-5.6-terra` | `google/gemini-3.1-flash-lite` |  |  |
| `content.regenerate` | `google/gemini-3.8-flash` | medium | `openai/gpt-5.6-terra` | `google/gemini-3.1-flash-lite` |  |  |
| `experiments.hypotheses` | `anthropic/claude-opus-5.5` | low | `google/gemini-3.8-flash` | `google/gemini-3.8-flash` |  |  |
| `experiments.integration` | `anthropic/claude-opus-5.5` | medium | `google/gemini-3.8-flash` | `google/gemini-3.8-flash` | 16000 |  |
| `experiments.values` | `google/gemini-3.8-flash` | medium | `openai/gpt-5.6-terra` | `google/gemini-3.1-flash-lite` |  |  |
| `file-extract` | `google/gemini-3.1-flash-lite` | low | `openai/gpt-5.6-luna` | `google/gemini-3.1-flash-lite` |  | the first read came back thin (THIN_TEXT_CHARS) → google/gemini-3.8-flash (low) |
| `geo.agent.implement` | `anthropic/claude-opus-5.5` | medium | `google/gemini-3.8-flash` | `google/gemini-3.8-flash` | 16000 |  |
| `geo.agent.investigate` | `anthropic/claude-opus-5.5` | high | `google/gemini-3.8-flash` | `google/gemini-3.8-flash` | 12000 |  |
| `geo.agent.review` | `anthropic/claude-opus-5.5` | high | `google/gemini-3.8-flash` | `google/gemini-3.8-flash` | 8000 |  |
| `geo.cms.fix` | `google/gemini-3.8-flash` | medium | `openai/gpt-5.6-terra` | `google/gemini-3.1-flash-lite` |  | validation or grounding rejected the first output → anthropic/claude-opus-5.5 (medium) |
| `geo.fix.batch` | `anthropic/claude-opus-5.5` | medium | `google/gemini-3.8-flash` | `google/gemini-3.8-flash` | 16000 |  |
| `geo.fix.propose` | `anthropic/claude-opus-5.5` | medium | `google/gemini-3.8-flash` | `google/gemini-3.8-flash` | 16000 |  |
| `geo.probe` | `perplexity/sonar` | provider default | none (each engine asked separately) | — |  |  |
| `guardrails.image-moderation` | `google/gemini-3.1-flash-lite` | low | `openai/gpt-5.6-luna` | `google/gemini-3.1-flash-lite` |  |  |
| `links-article-brief` | `google/gemini-3.8-flash` | medium | `openai/gpt-5.6-terra` | `google/gemini-3.1-flash-lite` |  |  |
| `links-profile` | `google/gemini-3.8-flash` | low | `openai/gpt-5.6-terra` | `google/gemini-3.1-flash-lite` |  |  |
| `links-relevance-pick` | `google/gemini-3.8-flash` | low | `openai/gpt-5.6-terra` | `google/gemini-3.1-flash-lite` |  |  |
| `links-topical-fit` | `google/gemini-3.1-flash-lite` | low | `openai/gpt-5.6-luna` | `google/gemini-3.1-flash-lite` |  |  |
| `market-intelligence` | `anthropic/claude-opus-5.5` | medium | `google/gemini-3.8-flash` | `google/gemini-3.8-flash` | 10000 |  |
| `memory-extract` | `google/gemini-3.8-flash` | low | `openai/gpt-5.6-terra` | `google/gemini-3.1-flash-lite` |  |  |
| `schedule.*` | `google/gemini-3.8-flash` | medium | `openai/gpt-5.6-terra` | `google/gemini-3.1-flash-lite` |  |  |
| `social.multi` | `google/gemini-3.8-flash` | medium | `openai/gpt-5.6-terra` | `google/gemini-3.1-flash-lite` |  |  |
| `studio.ad` | `google/gemini-3.8-flash` | medium | `openai/gpt-5.6-terra` | `google/gemini-3.1-flash-lite` |  |  |
| `studio.article` | `anthropic/claude-opus-5.5` | medium | `google/gemini-3.8-flash` | `google/gemini-3.8-flash` |  |  |
| `studio.captions` | `google/gemini-3.8-flash` | medium | `openai/gpt-5.6-terra` | `google/gemini-3.1-flash-lite` |  |  |
| `studio.carousel` | `google/gemini-3.8-flash` | medium | `openai/gpt-5.6-terra` | `google/gemini-3.1-flash-lite` |  |  |
| `studio.ideas` | `google/gemini-3.8-flash` | low | `openai/gpt-5.6-terra` | `google/gemini-3.1-flash-lite` |  |  |
| `studio.naturalize` | `google/gemini-3.8-flash` | low | `openai/gpt-5.6-terra` | `google/gemini-3.1-flash-lite` |  |  |
| `studio.prompt` | `google/gemini-3.8-flash` | low | `openai/gpt-5.6-terra` | `google/gemini-3.1-flash-lite` |  |  |
| `studio.research` | `google/gemini-3.8-flash` | medium | `openai/gpt-5.6-terra` | `google/gemini-3.1-flash-lite` |  |  |
| `studio.script` | `google/gemini-3.8-flash` | medium | `openai/gpt-5.6-terra` | `google/gemini-3.1-flash-lite` |  |  |
| `studio.social` | `google/gemini-3.8-flash` | medium | `openai/gpt-5.6-terra` | `google/gemini-3.1-flash-lite` |  |  |
| `ugc.concepts` | `google/gemini-3.8-flash` | medium | `openai/gpt-5.6-terra` | `google/gemini-3.1-flash-lite` |  |  |
| `ugc.notes` | `google/gemini-3.8-flash` | low | `openai/gpt-5.6-terra` | `google/gemini-3.1-flash-lite` |  |  |
| `ugc.product.extract` | `google/gemini-3.8-flash` | low | `openai/gpt-5.6-terra` | `google/gemini-3.1-flash-lite` |  |  |

`chat` is the "Mellox Flash" picker choice (default) and `chat.pro` is "Mellox Pro". `geo.probe` models are asked **separately** (they mirror real answer engines): default `perplexity/sonar`, `openai/gpt-5.6-luna`, `google/gemini-3.8-flash` (`GEO_PROBE_MODELS`).

Web-search and scope labels that are not model calls (`geo.scan`, `geo.citation-probe`, `competitors.discovery.resolve`, `competitors.resolve-name`, `competitors.advance`, `market-brain.scheduled`, `ugc/renders:create`, `cron.*`, `agent.*`, RPC scope labels) are listed in `NON_MODEL_ROUTES`.

## Images

| Use | Model | Fallback | Env |
| --- | --- | --- | --- |
| Default social images, quick edits | `openai/gpt-image-2.5-flare` | Sunburst | `IMAGE_MODEL_DEFAULT`, `IMAGE_MODEL_EDIT` |
| Premium, cinematic, text-heavy, brand-critical, precise edits | `openai/gpt-image-2.5-sunburst` | Flare | `IMAGE_MODEL_PREMIUM`, `IMAGE_MODEL_PREMIUM_EDIT` |

Up to 4 reference images. Aspect ratios 1:1, 16:9, 9:16; Studio's 4:5 renders as 3:4 (the models don't offer 4:5).

## Video catalog

| Key | Purpose | KIE (active) | OpenRouter (fallback / next week) |
| --- | --- | --- | --- |
| `standard` (default) | Talking-creator UGC with lip-synced dialogue | `veo-3-1` `veo3_fast` | `google/veo-3.1-fast` |
| `draft` | Cheap hook/concept drafts | `veo-3-1` `veo3_lite` | `google/veo-3.1-lite` |
| `premium` | Hero ads, highest realism (also Studio and `/api/generate-video`) | `google/gemini-omni-flash-1-1` | `minimax/hailuo-3` |
| `long` | 8–15 s takes, up to 9 product photos | `bytedance/seedance-2-fast` | `bytedance/seedance-2.0-fast` |
| `cinematic` | Controlled camera, multi-shot | `minimax-h3/reference-to-video` (`text-to-video` without photos) | `minimax/hailuo-3` |
| `variation` | Fast, cheap image animation | `grok-imagine/image-to-video` | `x-ai/grok-imagine-video-1.5` |

Old keys (`veo-3-1-fast`, `veo-3-1-quality`, `veo-3-1-lite`, `seedance-2`, `seedance-2-fast`, `kling-3`, `grok-imagine`) are read-only aliases for history rows. Kling 3 is no longer used for new jobs.
