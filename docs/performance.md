# Performance and scalability

The current design scales through workspace-scoped queries, database indexes,
server-side caching, rate limiting, asynchronous job rows, leases, and
provider-specific polling/webhooks. Long-running GEO scans, UGC renders,
analytics sync, and distribution delivery do not belong in a single blocking
browser request.

## Practical constraints

- Keep query keys workspace-specific and paginate/limit recent activity reads.
- Use claim functions and leases for competing workers.
- Preserve idempotency for retries and webhook duplicates.
- Cache eligible AI/image work and expose cache statistics through usage views.
- Use rate-limit tiers and AI budgets before provider calls.
- Keep provider calls behind abort signals and upstream error mapping.

The repository contains Redis and Trigger.dev integrations, but the audited code
does not prove that every environment uses them. TODO: establish target latency,
throughput, queue depth, concurrency, and availability budgets with operations.
