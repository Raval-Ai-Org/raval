# Full Codebase Model Usage Audit

**Repository:** Raval AI Codebase  
**Audit date:** 2026-09-11  
**Scope:** Next.js application, Social Distribution Engine, scripts, tests, configuration, deployment files, generated artifacts, and documentation.

## Executive Summary

The repository contains **9 concrete runtime model IDs** across three providers:

- **OpenRouter:** Qwen 3 Max and Gemini 2.5 Pro
- **Anthropic:** Claude Sonnet 5 and Claude Opus 5
- **KIE:** four image models and Veo 3.1 video

The Python Social Distribution Engine contains **no ML inference or model SDKs**. Its model terminology refers to ORM and API data models.

## Runtime Model Inventory

| Model ID                                | Provider   | Purpose                                                                  | Runtime classification       |
| --------------------------------------- | ---------- | ------------------------------------------------------------------------ | ---------------------------- |
| `qwen/qwen3-max`                        | OpenRouter | General chat, content generation, JSON generation, and tool calling      | Primary chat model           |
| `google/gemini-2.5-pro`                 | OpenRouter | Structured extraction, image/vision understanding, and memory extraction | Primary extraction model     |
| `claude-sonnet-5`                       | Anthropic  | Brand DNA extraction and normal Marketing Coach generation               | Default Claude model         |
| `claude-opus-5`                         | Anthropic  | Deep strategy and complex Marketing Coach analysis                       | Conditional premium model    |
| `gpt-image-2-5-flare-text-to-image`     | KIE        | Normal/default image generation                                          | Default and fast image model |
| `gpt-image-2-5-sunburst-text-to-image`  | KIE        | High-quality or complex image generation                                 | Premium image model          |
| `gpt-image-2-5-flare-image-to-image`    | KIE        | Reference-image editing and variations                                   | Default edit model           |
| `gpt-image-2-5-sunburst-image-to-image` | KIE        | High-quality reference-image editing                                     | Premium edit model           |
| `veo-3-1`                               | KIE        | Video generation                                                         | Configurable video model     |

## OpenRouter Models

### Qwen 3 Max

**Model ID:** `qwen/qwen3-max`  
**Gateway:** OpenRouter `https://openrouter.ai/api/v1/chat/completions`  
**Definition:** [src/lib/ai-gateway.server.ts](src/lib/ai-gateway.server.ts#L1-L35)

Used by:

- `/api/chat` for streaming assistant chat
- `/api/ai-generate` for SEO, content, advertising, social, CRM, competitor, analytics, and freeform generation
- `/api/social-multi` for multi-platform post variants
- `/api/clarify` for structured tool calls
- `runJsonPrompt`
- Content, scheduling, and insight server functions

Routing defaults to Qwen unless extraction is explicitly selected. Internal callers can technically provide arbitrary model strings through `ChatOptions.model`.

Parameters and controls:

- Non-streaming default cap: 800 tokens
- Absolute chat cap: 1,200 tokens
- Streaming timeout: 90 seconds
- Optional temperature, JSON response format, tools, and tool choice
- 30-minute in-memory response cache for eligible requests
- Retry handling for transport failures

### Gemini 2.5 Pro

**Model ID:** `google/gemini-2.5-pro`  
**Provider:** OpenRouter, not the direct Google Generative AI SDK.

Used by:

- [src/app/api/file-extract/route.ts](src/app/api/file-extract/route.ts#L19-L30) for image/vision extraction
- [src/app/api/memory-extract/route.ts](src/app/api/memory-extract/route.ts#L128-L168) for structured memory extraction and tool calling
- Any `runJsonPrompt` call marked `extraction: true`

Extraction configuration:

- Default output: 2,400 tokens
- Maximum output: 4,096 tokens
- Input cap: 60,000 characters
- Default temperature: `0.2`
- JSON response format where applicable
- Tool calling supported

## Anthropic Models

### Claude Sonnet 5

**Model ID:** `claude-sonnet-5`  
**Provider:** Anthropic Messages API  
**Gateway:** [src/lib/anthropic-gateway.server.ts](src/lib/anthropic-gateway.server.ts#L1-L230)

Used by:

- [src/lib/brand-extract.server.ts](src/lib/brand-extract.server.ts#L422-L438) for Brand DNA extraction
- [src/server/fns/coach.ts](src/server/fns/coach.ts#L330-L340) for normal Marketing Coach briefings

Sonnet is the default model for `brand-dna`, `marketing-coach`, and default Claude calls.

Brand extraction uses up to 2,800 output tokens and retries once after an interruption.

### Claude Opus 5

**Model ID:** `claude-opus-5`  
**Provider:** Anthropic

Selected when:

- `kind === "deep-strategy"`
- `isComplexStrategy === true`
- `forceOpus === true`

Used by:

- [src/lib/market-intelligence.server.ts](src/lib/market-intelligence.server.ts#L411-L440) for market intelligence analysis
- Complex Marketing Coach requests

Market intelligence configuration:

- 16,000-token output ceiling
- Medium adaptive reasoning effort
- 65-second timeout
- One retry
- Structured JSON schema output

## KIE Image Models

The catalog and routing logic are defined in [src/lib/model-router.server.ts](src/lib/model-router.server.ts#L56-L190).

### Text-to-image

- `gpt-image-2-5-flare-text-to-image`
- `gpt-image-2-5-sunburst-text-to-image`

Used by `/api/generate-image` through [src/lib/kie-gateway.server.ts](src/lib/kie-gateway.server.ts#L299-L388).

Routing behavior:

- Normal social generation: Flare
- Complex, premium, cinematic, editorial, or maximum-quality prompts: Sunburst
- `KIE_IMAGE_MODEL_FAST` can override the fast/default route
- Available-model filtering, benchmark scores, failure history, and cached-model hints can alter selection

### Image-to-image

- `gpt-image-2-5-flare-image-to-image`
- `gpt-image-2-5-sunburst-image-to-image`

Used when:

- A reference image exists
- Editing is requested
- The task type is `reference`, `editing`, or `variation`

Fallback configuration:

- `KIE_IMAGE_MODEL_FALLBACKS`
- `KIE_IMAGE_MODEL_EDIT_FALLBACKS`

Image generation attempts up to three candidate models. Candidates are ordered using benchmark scores minus failure penalties.

Image parameters include:

- Prompt
- `1:1`, `16:9`, or `9:16` aspect ratio
- `1K` resolution
- Up to four HTTPS reference assets
- In-memory caching
- Polling until task completion
- Fallback retry across image models

## KIE Video Model

**Model ID:** `veo-3-1`  
**Provider:** KIE  
**Route:** `/api/generate-video` -> `videoGeneration` in [src/lib/kie-gateway.server.ts](src/lib/kie-gateway.server.ts#L399-L484)

Configuration:

- Environment variable: `KIE_VIDEO_MODEL`
- Default: `veo-3-1`
- Durations: 4, 6, or 8 seconds
- Resolutions: 480P, 720P, or 1080P
- Audio enabled by default
- Aspect ratio selection
- Seed support
- NSFW checker enabled

There is no video-model fallback chain.

## Model Switching and Fallbacks

### Claude

- Sonnet is the normal model.
- Opus is selected for deep strategy, complex strategy, or forced premium mode.
- Brand extraction retries the same selected model once.
- Market intelligence uses one provider retry for transient failures.
- No automatic Sonnet-to-Opus failure fallback exists.

### OpenRouter

- Qwen is the default chat model.
- Gemini is forced for extraction.
- No automatic Qwen-to-Gemini or Gemini-to-Qwen failure fallback exists.
- Internal callers can supply arbitrary model strings through `ChatOptions.model`.

### KIE

- Image generation has explicit fallback models.
- Selection considers task type, prompt complexity, quality, latency, available models, benchmark scores, failure history, and cache compatibility.
- Video generation has only one configured model.

## UI Model Aliases

The UI exposes:

- `ravi-flash`
- `ravi-pro`

These are defined in [src/components/app/ChatPanel.tsx](src/components/app/ChatPanel.tsx#L208-L211), but no corresponding backend model-routing implementation was found. They appear to be product aliases/UI state rather than actual model IDs. Backend chat continues to route to `qwen/qwen3-max`.

## Configured and Unused Providers

### Active provider integrations

- OpenRouter
- Anthropic
- KIE
- DataForSEO, for search/trend data rather than ML inference
- Pexels and Unsplash, for media assets rather than ML inference

### Provider names without active model calls

- OpenAI: crawler/user-agent descriptions, branding, and generated build residue; no active OpenAI SDK/API model call found
- Google: Gemini is accessed through OpenRouter; no direct Google Generative AI SDK call found
- Perplexity, ChatGPT, Claude, and Gemini: product copy, crawler analysis, or SEO references
- DeepSeek: historical agent metadata only

No runtime integrations were found for Cohere, Groq, Mistral, Llama, Bedrock, Vertex AI, Hugging Face, Ollama, Replicate, Stability AI, ElevenLabs, AssemblyAI, Deepgram, Voyage, or Jina.

## Tests and Mocks

Model-specific tests cover:

- Claude model selection and response handling
- OpenRouter gateway behavior
- KIE image routing and video generation
- Fallback and failure-history routing
- Market intelligence mocks using `test-model`
- Metadata fixtures containing `claude-opus-5`

These are test references, not additional production models.

## Documentation and Historical References

The Social Distribution Engine history contains agent-generation metadata such as:

- `claude-opus-4-8`
- `Claude Opus 5`
- `claude-opus`
- `opencode-deepseek-v4-flash-free`
- `claude-code-auto`

These are documentation/history metadata only, not application runtime models.

Generated `.next` artifacts contain stale historical identifiers such as:

- `openai/gpt-5.4-image-2`
- `gpt-image-2-text-to-image`

They are absent from current `src`, ignored by `.gitignore`, and should be classified as generated build residue rather than live configuration.

## Python Social Distribution Engine

The `Social-Distribtion-Engine-RavalAI-SDE` project has:

- No OpenAI, Anthropic, Gemini, Hugging Face, PyTorch, TensorFlow, ONNX, LangChain, or model-serving dependencies
- No inference endpoints
- No embeddings, reranking, OCR, speech, moderation, or classifier code
- Platform adapters for LinkedIn, X/Twitter, Facebook, Instagram, and DryRun only

Its “model” terminology refers to SQLAlchemy/Pydantic data models.

## Security Finding

The local `.env` contains active provider and infrastructure credentials, including AI API keys. Credential values are intentionally omitted from this report. Rotate the OpenRouter, Anthropic, KIE, Supabase, SDR, Meta, Google, and DataForSEO credentials immediately if they have been exposed or shared.

## Audit Status

- Repository scan: completed
- Runtime model tracing: completed
- Configuration and environment tracing: completed
- Test, mock, documentation, CI/CD, and generated-artifact classification: completed
- Files modified by audit: this report only
