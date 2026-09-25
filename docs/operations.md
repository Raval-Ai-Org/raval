# Operations and observability

Health endpoints are `/api/health` and `/api/health/ready`. The health response
reports build identity and configured capability status without returning
secrets. Cron/public hooks use `CRON_SECRET` or provider signature validation
and write heartbeat/operational state where configured.

The operations model for Mellox AI is built around observability of the product's
real runtime behavior: usage, jobs, webhooks, provider calls, and feature flags.
These signals are important because the product is not just a UI; it is a
workspace-scoped system that can fail in provisioning, API availability, auth,
execution, or downstream integration paths.

Logs and monitoring code live under `src/server/observability`; Sentry,
Helicone, alert webhooks, and Redis are optional integrations. AI usage,
reservations, rate limits, guardrail events, audit logs, webhook events, and
job heartbeats are persisted for operational diagnosis.

## Incident first response

1. Check `/api/health` and `/api/health/ready`.
2. Inspect deployment commit and server logs without printing env values.
3. Check feature flags, provider status, rate/budget exhaustion, and job leases.
4. Confirm workspace scope and RLS before using any service-role investigation.
5. Pause the affected feature flag or provider path if needed.
6. Reconcile pending jobs/webhooks idempotently; never manually mark a GEO finding resolved.
7. Rotate a credential through secret management if exposure is suspected.

See [troubleshooting](troubleshooting.md), [OPERATIONS-RUNBOOK](OPERATIONS-RUNBOOK.md),
and [MONITORING](MONITORING.md). TODO: define formal SLOs and escalation owners.
