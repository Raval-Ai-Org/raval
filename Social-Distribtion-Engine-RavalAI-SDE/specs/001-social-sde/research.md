# Research: Social Distribution Engine (SDE)

**Feature**: 001-social-sde | **Date**: 2026-07-26

---

## Decision: Queue-First Execution Model

**What was chosen**: Celery + Redis as task queue; no external API calls from HTTP handlers

**Rationale**:

- External API calls from request handlers block the connection, risk timeout, and cannot recover from worker restart
- Queue-first design ensures every publish attempt is durable and recoverable
- Workers are stateless and replaceable; state lives in PostgreSQL
- Idempotency keys prevent double-work on retries

**Alternatives considered**:

- Direct HTTP publish → Rejected: blocks request, no durability guarantee
- In-memory queue → Rejected: loses all jobs on process/worker restart
- External message bus (RabbitMQ, SQS) → Rejected: adds deployment complexity, Redis is sufficient for this scale

---

## Decision: PostgreSQL as Single Source of Truth

**What was chosen**: PostgreSQL as the only durable store for job state, tokens, and audit logs

**Rationale**:

- Celery result backend adds another failure surface and monitoring complexity
- Using PostgreSQL as sole durable store simplifies recovery — any job state can be reconstructed from DB
- Same transaction can update target status AND write delivery_log atomically
- JSONB columns handle flexible content structures

**Alternatives considered**:

- Redis as source of truth → Rejected: not durable enough (AOF can still lose)
- Celery result backend → Rejected: adds dependency, still need DB for idempotency guarantees

---

## Decision: Registry-Based Adapter Dispatch

**What was chosen**: Adapter registry pattern with `ADAPTER_REGISTRY` dict; services import only the registry

**Rationale**:

- Services must never import concrete adapters to maintain isolation
- Registry lookup enables new platform addition without touching core publishing logic
- One file per platform + one registry line = new platform
- Easy to mock in tests via registry override

**Alternatives considered**:

- Factory pattern → Rejected: still requires importing all adapter classes
- Dynamic import → Rejected: adds runtime complexity, harder to test
- Direct import → Rejected: violates adapter isolation principle

---

## Decision: Fernet for Token Encryption at Rest

**What was chosen**: cryptography library Fernet (AES-128-CBC with HMAC)

**Rationale**:

- Symmetric encryption at application layer protects tokens at rest in database
- Key managed via environment variable, simple to rotate
- No external dependencies (cryptography is standard library)
- Verified implementation, not custom crypto

**Alternatives considered**:

- Database-level encryption → Rejected: tied to specific DB, less portable
- AWS KMS / HashiCorp Vault → Rejected: Phase C complexity, adds external dependency
- Custom AES → Rejected: rolling your own crypto is dangerous

---

## Decision: Exponential Backoff with Jitter

**What was chosen**: Fixed sequence: 60s → 300s → 900s → 1800s → 3600s (+/-10% jitter)

**Rationale**:

- Standard exponential backoff prevents thundering herd
- Jitter (±10%) prevents synchronized retries across multiple workers
- Max 5 attempts before permanent failure aligns with industry practice
- Cap at 1 hour balances user experience with platform rate limits

**Alternatives considered**:

- Linear backoff → Rejected: too aggressive on early retries
- Exponential without cap → Rejected: user waits too long for final failure
- Fixed delay → Rejected: doesn't respect platform rate limit recovery

---

## Decision: HMAC-SHA256 for Webhook Signing

**What was chosen**: HMAC-SHA256 with secret per workspace, included as `X-SDE-Signature` header

**Rationale**:

- Proven, well-understood scheme
- Per-workspace secrets enable isolation
- Included in request body for signature verification
- Simple to implement, no external dependencies

**Alternatives considered**:

- JWT → Rejected: overkill for this use case
- AWS Signature V4 → Rejected: too complex
- Plain SHA256 → Rejected: no key separation

---

## Decision: Request Timestamp + Signature for API Auth

**What was chosen**: Bearer token + HMAC signature + timestamp validation (reject if |now - ts| > 300s)

**Rationale**:

- Bearer token provides workspace identity
- HMAC signature ensures request body wasn't tampered with
- Timestamp prevents replay attacks within 5-minute window
- Simple, auditable, no session management needed

**Alternatives considered**:

- JWT tokens → Rejected: adds complexity, short-lived tokens need refresh logic
- API key only → Rejected: no replay protection
- OAuth 2.0 → Rejected: overkill for service-to-service auth

---

## Decision: DryRun Adapter for Staging

**What was chosen**: DryRun adapter with magic string simulation for all failure modes

**Rationale**:

- Full integration testing without calling real platform APIs
- Enables fast development without waiting for platform approvals
- Simulates: success, rate limit, auth failure, server error, fatal content error
- Must be first-class to ensure delivery timeline doesn't block on external approvals

**Alternatives considered**:

- Mock objects in tests → Rejected: doesn't test full pipeline
- Record/replay → Rejected: brittle, hard to maintain
- Test accounts → Rejected: rate limits, can get banned

---

## Best Practices Research

### Celery + Redis Best Practices

- `task_acks_late = True` ensures tasks requeue on worker death
- `worker_prefetch_multiplier = 1` prevents worker starvation
- `task_reclaim_on_worker_lost = True` ensures tasks return to queue
- Use `retry()` method, not manual re-queue
- Store task ID for cancellation support

### PostgreSQL + Async Best Practices

- Use `asyncpg` driver for async API handlers
- Use `psycopg` sync driver for Celery workers (no async in tasks)
- Separate engine instances to avoid connection pool conflicts
- Use `alembic` for migrations, never modify applied migrations

### Platform API Notes (July 2026 - verify before coding)

**X (Twitter)**:

- OAuth 2.0 PKCE
- Scopes: `tweet.read tweet.write users.read offline.access`
- POST `/2/tweets`
- Media via v1.1 chunked upload → `media_ids`
- Tokens expire 2h → refresh flow mandatory

**LinkedIn**:

- OAuth 2.0
- Scopes: `w_member_social openid profile` (member) / Community Management API (org pages)
- POST `/rest/posts` with `LinkedIn-Version` header
- Images via `POST /rest/images?action=initializeUpload` → PUT binary → URN reference
- Tokens ~60 days

**Facebook Pages**:

- User token → `GET /me/accounts` → page token
- POST `/{page_id}/feed` (text/link) or `/{page_id}/photos`
- Exchange for long-lived tokens (~60 days)

---

## Risk Assessment

| Risk                          | Likelihood | Impact | Mitigation                                                            |
| ----------------------------- | ---------- | ------ | --------------------------------------------------------------------- |
| Platform API changes          | Medium     | High   | Adapters isolated; version pins in headers; verify docs before coding |
| Token expiry mid-schedule     | Medium     | High   | Proactive refresh 24h before expiry                                   |
| Meta/LinkedIn approval delays | High       | Medium | DryRun mode for full testing; live smoke deferred                     |
| X API pricing changes         | Medium     | Medium | `ENABLE_X=false` default; business decision at launch                 |
| Webhook delivery failures     | Low        | Medium | Retry queue with exponential backoff (30s/2m/10m/1h/6h)               |

---

_Research completed: 2026-07-26_
