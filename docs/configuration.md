# Environment and configuration reference

Values are intentionally omitted. Use `.env.example`, `src/server/env.ts`, and
team-managed secret storage for values. `npm run setup` creates/checks a local
environment without making credentials part of the repository.

## Core

`APP_URL`, `NEXT_PUBLIC_APP_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `OPENROUTER_API_KEY`, `CRON_SECRET`.
Production validation is implemented in `src/server/env.ts`.

## Providers and features

- AI: `ANTHROPIC_API_KEY`, `AI_USER_DAILY_USD`, `AI_TEXT_ROUTE_*`, `HELICONE_*`.
- Media/intelligence: `KIE_*`, `UGC_*`, `TAVILY_*`, `PEXELS_API_KEY`, `UNSPLASH_ACCESS_KEY`, `FIRECRAWL_*`.
- GEO: `FEATURE_FLAG_GEO_*`, `GEO_*`.
- Distribution: `DISTRIBUTION_PROVIDER`, `FEATURE_FLAG_SDR_ENABLED`, `SDR_*`, `FEATURE_FLAG_SOCIALAPI_ENABLED`, `SOCIALAPI_*`.
- Connectors: `GITHUB_*`, `GOOGLE_ANALYTICS_*`, `GOOGLE_TOKEN_ENCRYPTION_KEY`.
- Client portal: `SHARE_LINK_ENCRYPTION_KEY` (base64 32 bytes) keeps share links
  stable; without it "Copy link" issues a new link and the old one stops working.
- Operations: `REDIS_URL`, `SENTRY_DSN`, `ALERT_WEBHOOK_URL`, `AGENTS_DISABLED`, `LOG_LEVEL`.

`src/server/env.ts` is more authoritative than this summary. A missing optional
key disables or degrades a feature; production-required keys fail validation.
Never copy values, sample tokens, private keys, or real callback secrets into
this document.

## Video Routing

UGC Studio sends `model=auto` by default. The server router selects the best
enabled path for the brief, references, motion, dialogue, platform, and cost:
Seedance for standard social work, Veo for premium realistic human/audio work,
Kling for complex cinematic motion, and Grok for explicit rapid variations.

Provider model IDs are server-only and can be overridden without a code deploy
with `KIE_UGC_MODEL_<MODEL_KEY>`, for example
`KIE_UGC_MODEL_KLING_3` or `KIE_UGC_MODEL_GROK_IMAGINE`. Availability is
controlled with `UGC_MODEL_<MODEL_KEY>_ENABLED`; prices can be overridden with
`UGC_PRICE_<MODEL_KEY>_<RESOLUTION>_CREDITS`. `UGC_DEFAULT_MODEL` remains the
fallback catalog default, while automatic routing is the Studio default.
