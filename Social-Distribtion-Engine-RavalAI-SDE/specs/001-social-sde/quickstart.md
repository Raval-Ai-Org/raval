# Quickstart: Social Distribution Engine (SDE)

**Feature**: 001-social-sde | **Date**: 2026-07-26

---

## What is the SDE?

The Social Distribution Engine is a backend service that takes approved posts from RavalAI's content panel and publishes them to social platforms (X, LinkedIn, Facebook) on schedule or immediately. It handles:

- Durable job scheduling and execution
- Platform adapter abstraction (easy to add new platforms)
- Token lifecycle management (refresh, reauth)
- Failure classification and retry logic
- Webhook callbacks for status updates
- Full auditability (delivery logs)

---

## Quick Start (5 minutes)

### Prerequisites

- Docker + Docker Compose v2
- Python 3.12+ (for local development)
- uv package manager
- Git

### 1. Clone and Setup

```bash
git clone <repo-url> raval-sde
cd raval-sde

# Install dependencies
uv sync

# Create .env from template
cp .env.example .env
```

### 2. Start the Stack

```bash
docker compose up
```

This starts:

- **api**: FastAPI server on localhost:8000
- **worker**: Celery worker for background jobs
- **beat**: Celery beat for scheduled tasks
- **postgres**: PostgreSQL database
- **redis**: Redis message broker

Wait for all services to report healthy.

### 3. Run Migrations

```bash
docker compose exec api alembic upgrade head
```

### 4. Test the API

```bash
# Health check
curl http://localhost:8000/api/v1/healthz

# Expected response:
# {"api":"ok","db":"ok","redis":"ok","beat_last_tick":"..."}
```

### 5. Publish Your First Post (DryRun Mode)

```bash
curl -X POST http://localhost:8000/api/v1/publish \
  -H "Authorization: Bearer test_token" \
  -H "X-Signature: $(echo -n '{...}' | openssl dgst -sha256 -hmac 'test_secret' -hex | cut -d' ' -f2)" \
  -H "X-Timestamp: $(date +%s)" \
  -H "Content-Type: application/json" \
  -d '{
    "workspace_id": "ws_test",
    "brand_id": "br_test",
    "idempotency_key": "post_001",
    "scheduled_at": "2026-07-26T21:00:00Z",
    "timezone": "UTC",
    "targets": [
      {
        "account_id": "dryrun_account_uuid",
        "platform": "dryrun",
        "content": {
          "text": "Hello world!",
          "media": []
        }
      }
    ]
  }'
```

### 6. Check Job Status

```bash
curl http://localhost:8000/api/v1/jobs/post_uuid \
  -H "Authorization: Bearer test_token"
```

You'll see:

- Job status (PENDING, COMPLETED, FAILED)
- Target statuses
- Platform URLs if published
- Full event timeline

---

## Key Concepts

### Workspaces

Each workspace is isolated. All requests include `workspace_id`:

```json
{
  "workspace_id": "ws_raval_prod",
  "brand_id": "br_tesla",
  ...
}
```

### Posts vs Targets

- **Post**: One logical publish request (e.g., "announce new feature")
- **Target**: One attempt to publish to one platform account

One post can have multiple targets:

```json
{
  "workspace_id": "ws_1",
  "targets": [
    { "account_id": "x_account_1", "platform": "x", "content": {...} },
    { "account_id": "linkedin_account_1", "platform": "linkedin", "content": {...} },
    { "account_id": "fb_page_1", "platform": "facebook", "content": {...} }
  ]
}
```

### Idempotency

Submit the same `idempotency_key` twice → get the same post back (no duplicate):

```bash
# First request
POST /publish with idempotency_key="post_abc" → 201 created

# Second request (same key)
POST /publish with idempotency_key="post_abc" → 200 OK (existing post)
```

### Scheduling

Immediate publish:

```json
{ "scheduled_at": "2026-07-26T21:00:00Z" } // now or past
```

Scheduled publish:

```json
{ "scheduled_at": "2026-07-26T14:00:00Z", "timezone": "America/New_York" } // future
```

The system will publish at exactly that time, even if your service is down.

### Failure Handling

Failures are classified:

| Class     | Example                                       | SDE Behavior                              |
| --------- | --------------------------------------------- | ----------------------------------------- |
| Retryable | 429 (rate limit), 503 (server error)          | Retry with backoff                        |
| Auth      | 401 (token expired), 403 (scope insufficient) | Mark account `needs_reauth`, webhook sent |
| Fatal     | 400 (bad content), policy violation           | Mark target FAILED, webhook sent          |

---

## Testing Without Real Platforms

Use the **DryRun adapter** to test everything without calling Twitter, LinkedIn, or Facebook.

### DryRun Success

```json
{
  "platform": "dryrun",
  "content": { "text": "Normal post" }
}
```

Result: PUBLISHED in ~200ms

### DryRun Rate Limit

```json
{
  "platform": "dryrun",
  "content": { "text": "FORCE_429" }
}
```

Result: RETRYING with retry_after

### DryRun Auth Failure

```json
{
  "platform": "dryrun",
  "content": { "text": "FORCE_401" }
}
```

Result: FAILED, account marked `needs_reauth`

### DryRun Server Error

```json
{
  "platform": "dryrun",
  "content": { "text": "FORCE_500" }
}
```

Result: RETRYING with exponential backoff

---

## Connecting Real Accounts (Optional)

To connect a real X, LinkedIn, or Facebook account:

### 1. Get OAuth Start URL

```bash
curl http://localhost:8000/api/v1/oauth/x/start?workspace_id=ws_1&brand_id=br_1&redirect_after=https://app.raval.it/accounts
```

Response: 302 redirect to X OAuth consent

### 2. User Completes Consent

Browser redirects back to `/oauth/x/callback?code=...&state=...`

SDE stores encrypted token, sends webhook: `account.connected`

### 3. Account Ready

```bash
curl http://localhost:8000/api/v1/accounts?workspace_id=ws_1
```

Response:

```json
[
  {
    "id": "account_uuid",
    "platform": "x",
    "display_name": "@myaccount",
    "status": "active",
    "token_expires_at": "2026-07-27T21:00:00Z"
  }
]
```

---

## Webhook Configuration

Register where SDE should send status updates:

```bash
curl -X POST http://localhost:8000/api/v1/webhooks/config \
  -H "Authorization: Bearer test_token" \
  -H "Content-Type: application/json" \
  -d '{
    "workspace_id": "ws_1",
    "url": "https://app.raval.it/sde-webhook",
    "secret": "webhook_secret_key"
  }'
```

Now SDE sends signed events:

```json
{
  "event": "post.published",
  "timestamp": "2026-07-26T21:00:04Z",
  "workspace_id": "ws_1",
  "post_id": "post_uuid",
  "target_id": "target_uuid",
  "platform": "x",
  "platform_post_url": "https://twitter.com/account/status/123456"
}
```

---

## Operational Commands

### Health Check

```bash
curl http://localhost:8000/api/v1/healthz
```

### View Metrics

```bash
curl http://localhost:8000/api/v1/metrics
```

Prometheus-format output with:

- Posts published by platform
- Posts failed by error code
- Queue depth
- Beat last tick time

### View Logs

```bash
docker compose logs -f api
docker compose logs -f worker
```

### Inspect Celery

```bash
docker compose exec worker celery inspect active
docker compose exec worker celery inspect registered
```

Or open Flower (Celery web UI):

```
http://localhost:5555
Login: admin / change-me
```

---

## Stop and Cleanup

```bash
# Stop all services
docker compose down

# Wipe database (fresh start)
docker compose down -v
```

---

## Troubleshooting

### "Connection refused" to API

Wait 10 seconds for services to start. Check:

```bash
docker compose ps
```

All should show `healthy`.

### "401 Unauthorized"

Check that you're sending:

- `Authorization: Bearer <SDE_API_TOKEN>` header
- `X-Signature` header with valid HMAC
- `X-Timestamp` header (not older than 300 seconds)

### "Post not publishing"

1. Check job status: `GET /jobs/{post_id}`
2. Check logs: `docker compose logs worker`
3. If using real platform, verify account is connected: `GET /accounts`
4. If account status is `needs_reauth`, complete OAuth flow again

---

## Next Steps

1. Read **INTEGRATION.md** for integration with RavalAI backend
2. Read **runbook.md** for operational procedures
3. Review **contracts/openapi.yaml** for full API spec
4. Try the **demo script**: `./demo/run-demo.sh`

---

_Quickstart guide: 2026-07-26_
