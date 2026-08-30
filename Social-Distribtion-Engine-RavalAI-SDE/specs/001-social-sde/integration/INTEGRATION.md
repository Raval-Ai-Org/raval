# RavalAI Social Distribution Engine — Integration Guide

## Overview

The RavalAI SDE (Social Distribution Engine) is a REST API that publishes content to multiple social media platforms. It handles content validation, platform-specific formatting, scheduling, retries with exponential backoff, and webhook callbacks.

**Base URL**: `https://api.raval.it.com/api/v1` (production) or `http://localhost:8000/api/v1` (development)

**Auth**: Bearer token in `Authorization` header.

---

## Quick Start

```bash
# 1. Health check
curl http://localhost:8000/healthz

# 2. Publish immediately
curl -X POST http://localhost:8000/api/v1/publish \
  -H "Authorization: Bearer $SDE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "idempotency_key": "my-unique-key-1",
    "targets": [
      {
        "account_id": "acc_xyz123",
        "content": {"text": "Hello from RavalAI!"}
      }
    ]
  }'

# 3. Check job status
curl http://localhost:8000/api/v1/jobs/{job_id} \
  -H "Authorization: Bearer $SDE_API_TOKEN"
```

---

## Authentication

All API requests require a Bearer token:

```
Authorization: Bearer <your-api-token>
```

The token is configured via the `SDE_API_TOKEN` environment variable (min 16 characters).

---

## Endpoints

### `POST /api/v1/publish` — Publish immediately

**Request**:

```json
{
  "idempotency_key": "unique-string-1-128-chars",
  "scheduled_at": null,
  "targets": [
    {
      "account_id": "acc_123",
      "content": {
        "text": "Hello world!",
        "media_urls": ["https://example.com/image.jpg"],
        "metadata": { "tags": ["tech"] }
      }
    }
  ]
}
```

**Response (201)**:

```json
{
  "job_id": "uuid-...",
  "status": "published",
  "targets": [{ "target_id": "...", "status": "published", "platform_post_id": "dryrun_abc123" }]
}
```

**Validation rules per platform**:

| Platform  | Max Text | Max Media | Supported Media   |
| --------- | -------- | --------- | ----------------- |
| Twitter/X | 280      | 4         | image, video, gif |
| LinkedIn  | 3,000    | 1         | image, video      |
| Facebook  | 63,206   | 20        | image, video      |
| DryRun    | 63,206   | 20        | any (simulated)   |

### `POST /api/v1/schedule` — Schedule for later

Same as publish, but requires `scheduled_at` (ISO 8601 UTC, max 1 year ahead).

### `GET /api/v1/jobs/{job_id}` — Get job details

Returns full post with targets, delivery status, and timeline.

### `GET /api/v1/jobs` — List jobs

Query params: `?status=published&limit=10&offset=0`

### `DELETE /api/v1/jobs/{job_id}` — Cancel pending job

204 on success. Only cancellable if status is `pending`.

### `GET /healthz` — Health check

```json
{ "status": "healthy", "database": true, "redis": true, "workers": true }
```

### Account Management

```bash
# List connected accounts
GET /api/v1/accounts

# Get account details
GET /api/v1/accounts/{id}

# Disconnect account
DELETE /api/v1/accounts/{id}

# Start OAuth flow
GET /api/v1/oauth/{platform}/start
# Returns: {"authorization_url": "https://...", "state_token": "..."}

# OAuth callback (handled automatically)
GET /api/v1/oauth/{platform}/callback?code=...&state=...
```

### Webhook Management

```bash
# Register webhook
POST /api/v1/webhooks/config
{"url": "https://my-app.com/webhooks/sde", "secret": "my-secret"}

# List webhooks
GET /api/v1/webhooks/config

# Disable webhook
DELETE /api/v1/webhooks/config/{webhook_id}
```

---

## Webhook Events

Webhooks are POSTed to your registered URL with HMAC-SHA256 signatures.

**Headers**:

- `X-Signature-256`: HMAC-SHA256 hex signature
- `X-Event-Type`: Event type string

**Verification** (Python):

```python
import hmac, hashlib

def verify_webhook(body, signature, secret):
    expected = hmac.new(
        secret.encode(), body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(f"sha256={expected}", signature)
```

**Events**:

- `post.published` — Post published successfully
- `post.failed` — Post failed after retries exhausted
- `post.scheduled` — Post scheduled for future
- `post.cancelled` — Post cancelled by user

---

## Error Handling

**Status codes**:

- 200/201: Success
- 400: Bad request (validation)
- 401: Unauthorized (invalid token)
- 404: Not found
- 409: Conflict (duplicate idempotency key)
- 422: Validation error (field-level details)
- 429: Rate limited
- 500: Internal server error

Error response format:

```json
{
  "error_code": "VALIDATION_ERROR",
  "detail": "Validation failed: targets.0.text: text too long",
  "request_id": "abc-123",
  "timestamp": "2026-07-27T00:00:00Z"
}
```

---

## Rate Limits & Idempotency

- **Idempotency**: Use the `idempotency_key` field. Same key = same job. Prevents duplicates.
- **Retries**: Transient errors retry with exponential backoff (60s → 300s → 900s → 1800s → 3600s).
- **Auth errors** (401): Never retried. Check your token.
- **Rate limits** (429): Retried with `Retry-After` header value.

---

## Testing Locally

```bash
# Start stack
docker-compose up -d

# Check health
curl http://localhost:8000/healthz

# Run tests
pytest tests/ -v

# Using DryRun mode (no real API calls)
DryRun adapter simulates success or failure via magic strings:
- "FORCE_429" → Rate limit error (retryable)
- "FORCE_401" → Auth error (not retryable)
- "FORCE_500" → Server error (retryable)
- "FORCE_FATAL" → Validation error (not retryable)
```

---

## Python SDK

```python
from sde_client import SDEClient

client = SDEClient(base_url="http://localhost:8000", api_token="your-token")

# Publish
job = client.publish(
    idempotency_key="my-key",
    targets=[{"account_id": "acc_1", "content": {"text": "Hello!"}}]
)

# Schedule
job = client.schedule(
    idempotency_key="my-key",
    scheduled_at="2026-07-28T10:00:00Z",
    targets=[...]
)

# Get job status
job = client.get_job(job_id)

# List jobs
jobs = client.list_jobs(status="published")

# Cancel job
client.cancel_job(job_id)
```
