# Self-hosted integrations (Firecrawl, Mastra, Helicone, Trigger.dev)

Part of the six-project integration initiative (Firecrawl, Mastra, Helicone,
Promptfoo, Trigger.dev, and a TypeScript-native "LiteLLM"-style unified text
gateway). See `docs/adr/0015-unified-text-gateway.md` onward for the
per-phase design decisions.

Everything here is **optional**. Mellox boots and every existing feature
works with none of it configured. Helicone is a fire-and-forget sink, while
Firecrawl and Trigger.dev are additive paths with inline fallbacks where the
feature supports them; none is a hard dependency.

## Why a sibling checkout, not a vendored copy

Firecrawl, Helicone and Trigger.dev are themselves substantial multi-service
open-source projects that maintain and evolve their own Docker Compose
definitions. Copying those definitions into this repository would create a
second copy that silently drifts out of date. Instead,
`docker-compose.integrations.yml` here only pulls the well-known, versioned
datastores each project depends on (Postgres, ClickHouse, Redis, MinIO,
Mailhog, SearXNG) as images, and builds each project's own application
services from a **sibling checkout** next to this repository:

```
Raval Ai/
├── Raval Ai Codebase/        (this repo)
│   ├── docker-compose.yml
│   └── docker-compose.integrations.yml
└── helicone/                 (sibling checkout, not tracked by this repo)
```

## Helicone (LLM observability)

1. Clone Helicone next to this repository and follow its own self-host setup
   once, to generate `../helicone/.env` (its Postgres/ClickHouse/MinIO
   credentials and any secrets its own setup script generates):

   ```bash
   git clone https://github.com/Helicone/helicone.git ../helicone
   ```

   Check [Helicone's current self-host docs](https://docs.helicone.ai/getting-started/self-host)
   for that checkout's exact `.env` requirements and Jawn/Web Dockerfile
   paths — these can change between releases, and
   `docker-compose.integrations.yml`'s `helicone-jawn`/`helicone-web` build
   paths assume the layout current as of this writing.

2. Add to this repo's own `.env` (never committed):

   ```bash
   HELICONE_CLICKHOUSE_PASSWORD=<choose a password>
   HELICONE_POSTGRES_PASSWORD=<choose a password>
   HELICONE_MINIO_ROOT_USER=<choose a user>
   HELICONE_MINIO_ROOT_PASSWORD=<choose a password>
   ```

3. Bring the integration stack up alongside the core app:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.integrations.yml up -d
   ```

4. In this repo's `.env`, point Mellox at the running Jawn service and create
   an API key from the Helicone web dashboard (`http://localhost:3010`):

   ```bash
   HELICONE_BASE_URL=http://localhost:8585
   HELICONE_API_KEY=<key from the Helicone dashboard>
   ```

5. Restart the app. Every AI call already routed through
   `src/server/ai/metering.ts`'s `recordUsage()` (OpenRouter, Anthropic, KIE,
   DataForSEO) now also logs to Helicone — token counts, estimated cost,
   latency, status and provider — with full request/response bodies included
   only if `HELICONE_LOG_PROMPTS=true` is also set. Stop the Helicone
   containers (or unset `HELICONE_BASE_URL`) at any time; nothing else
   changes.

## Verifying it's working

```bash
curl -s http://localhost:8585/healthcheck   # Jawn is up
```

Then trigger any AI call in the app (e.g. the chat) and check the Helicone
web dashboard for a new request. If nothing appears, check
`docker compose -f docker-compose.yml -f docker-compose.integrations.yml logs helicone-jawn`
and confirm `HELICONE_BASE_URL`/`HELICONE_API_KEY` are set in the app's own
`.env` (not just Helicone's).

## Firecrawl (scrape, crawl, map, search)

Clone the official Firecrawl repository beside this checkout. The integration
Compose file builds its API from that checkout and does not vendor or fork it:

```bash
git clone https://github.com/mendableai/firecrawl.git ../firecrawl
docker compose -f docker-compose.yml -f docker-compose.integrations.yml up -d firecrawl
```

Set these values in this repository's untracked `.env`:

```bash
FIRECRAWL_BASE_URL=http://localhost:3002
FIRECRAWL_API_KEY=
FIRECRAWL_TIMEOUT_MS=30000
FIRECRAWL_MAX_RETRIES=2
```

The server gateway validates every user URL with `assertPublicUrl`, exposes
only markdown/links operations, applies bounded timeout/retry handling, and
meters each operation. Search and Brand DNA callers retain their existing
safe fallback when Firecrawl is disabled or unavailable. Verify the checkout's
current Docker prerequisites and API port before upgrading it; the official
repository can change its Dockerfile layout.

```bash
curl -fsS http://localhost:3002/health
```

## Trigger.dev (additive background tasks)

Trigger.dev is used only for new additive workflows. Existing GEO scans, cron
jobs, KIE polling, scheduled posts, and agent workers remain on their current
lease/cron implementations. Configure the app and CLI separately:

```bash
TRIGGER_API_URL=http://localhost:8030
TRIGGER_SECRET_KEY=<server-secret>
TRIGGER_PROJECT_REF=<project-ref>
npx trigger.dev dev
```

The CLI reads `trigger.config.ts` and registers `src/trigger/*`. Deploy with
`npx trigger.dev deploy` after authenticating the CLI. Task payloads include
the run and workspace ids, use stable idempotency keys, retry transient work,
and persist terminal status. If enqueueing fails, competitor intelligence
falls back to the existing inline path instead of leaving a run stuck.

## Promptfoo evaluations

Promptfoo providers call the production server functions, never provider SDKs
directly. Evaluations require an opt-in `ANTHROPIC_API_KEY`; they are not part
of the no-credential unit test suite and secrets must be supplied through the
environment or CI secret store, never YAML fixtures.

```bash
npm run eval
```

This runs campaign generation, competitor intelligence grounding, and prompt
injection resistance checks. CI skips this live-model job when its dedicated
secret is absent; typecheck, lint, unit tests, build, migration replay, and
secret scanning remain credential-free gates.
