# Data Model: Social Distribution Engine (SDE)

**Feature**: 001-social-sde | **Date**: 2026-07-26

---

## Entity Overview

The SDE uses 5 core entities that form the backbone of reliable, auditable social publishing:

1. **accounts** — Connected social identities with encrypted tokens
2. **posts** — Logical publish requests (fan out to N targets)
3. **post_targets** — Individual publish attempts per platform
4. **webhook_endpoints** — Workspace callback destinations
5. **delivery_log** — Append-only audit trail

---

## Entity: accounts

**Purpose**: Store connected social accounts with authorization lifecycle

```sql
CREATE TABLE accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  brand_id TEXT NOT NULL,
  platform TEXT NOT NULL,              -- 'x' | 'linkedin' | 'facebook' | 'dryrun'
  platform_account_id TEXT NOT NULL,   -- platform-side user/page id
  display_name TEXT NOT NULL,          -- e.g. "@elonmusk" or "Tesla Inc."
  access_token_enc BYTEA NOT NULL,     -- Fernet-encrypted
  refresh_token_enc BYTEA,             -- Fernet-encrypted (optional)
  token_expires_at TIMESTAMPTZ,        -- UTC
  scopes TEXT[] NOT NULL DEFAULT '{}', -- OAuth scopes granted
  status TEXT NOT NULL DEFAULT 'active', -- active | needs_reauth | disconnected
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, platform, platform_account_id)
);
CREATE INDEX idx_accounts_ws ON accounts (workspace_id, brand_id);
CREATE INDEX idx_accounts_expiring ON accounts (token_expires_at) WHERE status = 'active';
```

**Fields**:
- `workspace_id`: Workspace identifier (scoping key)
- `brand_id`: Brand/tenant identifier within workspace
- `platform`: Platform identifier (used for adapter lookup)
- `platform_account_id`: Platform-specific user/page/account ID
- `display_name`: Human-readable account name
- `access_token_enc`: Fernet-encrypted access token (never decrypted in logs)
- `refresh_token_enc`: Fernet-encrypted refresh token (nullable)
- `token_expires_at`: When the access token expires (proactive refresh trigger)
- `scopes`: OAuth scopes that were granted (for validation/audit)
- `status`: Lifecycle state (active → needs_reauth → disconnected)

**State Transitions**:
- `active` → `needs_reauth`: triggered by 401/403 during publish
- `needs_reauth` → `active`: user completes reauth OAuth flow
- any → `disconnected`: user explicitly disconnects account

---

## Entity: posts

**Purpose**: Logical publish request that may target multiple accounts/platforms

```sql
CREATE TABLE posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  brand_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,       -- RavalAI provides for dedup
  scheduled_at TIMESTAMPTZ NOT NULL,   -- = now() for immediate, future for scheduled
  status TEXT NOT NULL DEFAULT 'PENDING',
  -- PENDING | PARTIAL | COMPLETED | FAILED | CANCELLED
  -- Derived from post_targets (see rule below)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, idempotency_key)
);
CREATE INDEX idx_posts_due ON posts (scheduled_at) WHERE status = 'PENDING';
```

**Fields**:
- `workspace_id`: Scope to workspace
- `brand_id`: Scope to brand/tenant
- `idempotency_key`: RavalAI panel generates this; must be unique per workspace
- `scheduled_at`: Publish time (immediately now() or future)
- `status`: Derived from post_targets (not manually set)

**Status Derivation Rule** (run in same transaction as post_targets update):
```
IF all post_targets are PUBLISHED → post.status = COMPLETED
ELIF all post_targets are FAILED or CANCELLED → post.status = FAILED
ELIF any post_target is terminal (PUBLISHED/FAILED/CANCELLED) and at least one is not → post.status = PARTIAL
ELSE → post.status = PENDING
```

---

## Entity: post_targets

**Purpose**: Individual publish attempt against one platform account

```sql
CREATE TABLE post_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id),
  platform TEXT NOT NULL,              -- redundant for filtering, matches account.platform
  content JSONB NOT NULL,              -- {text, media[], link, first_comment, ...}
  status TEXT NOT NULL DEFAULT 'PENDING',
  -- PENDING | QUEUED | PUBLISHING | PUBLISHED | RETRYING | FAILED | CANCELLED
  attempt_count INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ,         -- NULL = not scheduled for retry
  last_error_code TEXT,                -- e.g. "RATE_LIMITED", "AUTH_INVALID"
  last_error_detail TEXT,              -- platform error message
  platform_post_id TEXT,               -- platform's post identifier
  platform_post_url TEXT,              -- public URL of published post
  published_at TIMESTAMPTZ,            -- when publish succeeded
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_targets_claim ON post_targets (status, next_attempt_at);
```

**Fields**:
- `post_id`: Link to logical post
- `account_id`: Which account to publish to
- `platform`: Platform identifier (must match account.platform)
- `content`: Platform-specific content structure (text, media[], link, first_comment, etc.)
- `status`: Detailed lifecycle state
- `attempt_count`: How many times we've tried to publish
- `next_attempt_at`: When to next retry (NULL if not retrying)
- `last_error_code`: Stable error identifier
- `last_error_detail`: Platform-provided error message
- `platform_post_id`: ID returned by platform after successful publish
- `platform_post_url`: URL for end-user to view (sent to RavalAI UI)

**State Transitions**:
- `PENDING` → `QUEUED`: claim query picks up due target
- `QUEUED` → `PUBLISHING`: worker begins execution
- `PUBLISHING` → `PUBLISHED`: success; write platform_post_id, platform_post_url, published_at
- `PUBLISHING` → `RETRYING`: transient error; set next_attempt_at
- `PUBLISHING` → `FAILED`: permanent error or max retries exceeded
- `RETRYING` → `QUEUED`: retry time arrived
- any → `CANCELLED`: user cancels via DELETE /jobs/{post_id}

---

## Entity: webhook_endpoints

**Purpose**: Where to send status callbacks for the workspace

```sql
CREATE TABLE webhook_endpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL UNIQUE,
  url TEXT NOT NULL,
  secret_enc BYTEA NOT NULL,           -- Fernet-encrypted HMAC secret
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Fields**:
- `workspace_id`: One webhook per workspace
- `url`: HTTPS endpoint for callbacks
- `secret_enc`: Fernet-encrypted secret for HMAC signing
- `active`: Can be disabled without deletion

**Lifecycle**:
- Created via `POST /webhooks/config`
- Secret can be rotated (overwrite via same POST)
- Can be disabled/deleted via DELETE endpoint

---

## Entity: delivery_log

**Purpose**: Append-only audit trail of every publish attempt

```sql
CREATE TABLE delivery_log (
  id BIGSERIAL PRIMARY KEY,
  target_id UUID NOT NULL,
  attempt INT NOT NULL,
  outcome TEXT NOT NULL,               -- success | retryable | fatal | rate_limited | auth
  http_status INT,
  error_code TEXT,
  detail TEXT,
  latency_ms INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Fields**:
- `target_id`: Which target this attempt relates to
- `attempt`: Attempt number (1, 2, 3, ...)
- `outcome`: Classification of result
- `http_status`: HTTP status from platform (nullable if network error)
- `error_code`: Stable error identifier
- `detail`: Platform error message
- `latency_ms`: How long the platform call took

**Why append-only**:
- Never update; only insert
- Enables full audit trail reconstruction
- Can reconstruct target state by reading all rows for that target
- Supports compliance and debugging

---

## Content Structure (post_targets.content)

The `content` column stores platform-specific content structures:

```jsonb
{
  "text": "string",
  "media": [
    {
      "type": "image" | "video",
      "url": "https://...",
      "alt": "string"
    }
  ],
  "link": "https://example.com",
  "first_comment": "string"
}
```

**Validation rules per platform** (enforced at ingestion):
- **X**: text ≤280 chars (URLs count as 23), ≤4 images or 1 video
- **LinkedIn**: text ≤3000 chars, ≤9 images or 1 video
- **Facebook**: text ≤63206 chars, images/video per Graph limits

---

## Migration Strategy

### Alembic Migrations

1. **001_initial_schema.py** — Create all 5 tables
2. **002_add_indexes.py** — Add performance indexes (done in step 1, but separate if needed)
3. Future migrations follow same pattern: one Alembic revision per schema change

**Never edit applied migrations**; always create new revisions.

---

## Relationships Diagram

```
accounts (1) ──→ (many) post_targets
                      ↓
posts (1) ──→ (many) post_targets
                      ↓
              delivery_log (1)

webhook_endpoints (1:1 per workspace)
```

---

## Concurrency Guarantees

### Double-Fire Prevention

The **claim query** uses `FOR UPDATE SKIP LOCKED` to atomically claim due targets:

```sql
WITH due AS (
  SELECT pt.id FROM post_targets pt
  JOIN posts p ON p.id = pt.post_id
  WHERE pt.status IN ('PENDING','RETRYING')
    AND p.status NOT IN ('CANCELLED')
    AND COALESCE(pt.next_attempt_at, p.scheduled_at) <= now()
  ORDER BY COALESCE(pt.next_attempt_at, p.scheduled_at)
  LIMIT 100
  FOR UPDATE SKIP LOCKED
)
UPDATE post_targets SET status = 'QUEUED', updated_at = now()
WHERE id IN (SELECT id FROM due)
RETURNING id;
```

**Why it works**:
- `SKIP LOCKED` means other workers skip rows already locked by concurrent transactions
- Each worker claims different rows
- Exactly 100 due rows total are claimed across all workers
- No duplicates

### Idempotency

Unique constraint on `(workspace_id, idempotency_key)` in `posts` table ensures:
- Same idempotency_key submitted twice returns existing post
- No duplicate posts created
- Handled at DB level, not application level

---

## Example Workflows

### Immediate Publish

1. POST `/publish` → `POST` row created with `scheduled_at = now()`
2. Beat ticks → claim query picks up due targets → status = QUEUED
3. Worker dequeues → status = PUBLISHING
4. Adapter publishes → status = PUBLISHED, platform_post_id/url set, delivery_log row written
5. Webhook sent: `post.published`

### Scheduled Publish + Restart

1. POST `/schedule` → `POST` row created with `scheduled_at = future`
2. Stack restarts → row still in DB with PENDING status
3. Beat ticks after scheduled time → claim query picks it up
4. Publishes normally (recovery is free)

### Transient Failure + Retry

1. Worker attempts publish → platform returns 503
2. `TransientError` caught → `post_targets.status = RETRYING`, `next_attempt_at = now + 60s`
3. delivery_log row written with outcome = "retryable"
4. 60s later, beat ticks → claim query picks it up → status = QUEUED → retry

### Auth Failure + Reauth

1. Worker attempts publish → platform returns 401
2. `AuthError` caught → `post_targets.status = FAILED`, `accounts.status = needs_reauth`
3. Webhook sent: `account.needs_reauth`
4. RavalAI frontend sees webhook, opens reconnect flow
5. User completes OAuth → `accounts.status = active`
6. New publish request succeeds

---

*Data model finalized: 2026-07-26*