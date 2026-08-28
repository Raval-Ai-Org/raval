# ADR-0002: Split Scheduling — Content Generation vs Distribution Timing

- **Status:** Accepted
- **Date:** 2026-08-08
- **Feature:** 001-sdr-integration
- **Context:** RavalAI already has a content-generation scheduler (`scheduled_jobs` + pg_cron) that produces drafts on a schedule. The SDR has its own Celery-beat scheduler that claims and publishes due targets at an absolute UTC instant. Spec US3/FR-008 requires "schedule an approved post for a future date/time and have it published automatically, without the user being present." If both systems "scheduled" the same social post, two schedulers could race and double-publish, or diverge on what fires when.

## Decision

Keep the two schedulers **separate and non-overlapping**:

- **RavalAI** owns content *generation* timing only (`scheduled_jobs` + pg_cron, unchanged, untouched).
- **The SDR** owns distribution *timing* via `POST /api/v1/schedule` with an absolute UTC instant; its Celery beat claims due targets and publishes.
- `content_items.scheduled_at` remains the display source of truth in the Studio; the SDR receives an ISO-8601 UTC instant on the wire (FR-025 — local accept/render, absolute instant storage, UTC on wire).
- A scheduled item's publish/schedule action is idempotent (schedule idempotency key `schedule:{item}:{platform}:{account}:{revision}`); reschedule = cancel-old + schedule-new.

## Consequences

### Positive

- **No double-post risk**: exactly one distribution scheduler owns the fire time (SC-004 — on-time delivery ≥99% while healthy).
- **No changes to generation**: RavalAI's existing scheduled-content production is untouched (SC-007 non-regression).
- **Timezone-safe by construction**: storage + wire are absolute instants; only the UI renders local time.
- **Queue-first**: the SDR worker publishes even when the user is offline; cancel-before-fire and terminal status both flow back via webhooks.

### Negative

- Two schedulers to reason about when debugging a missed post (mitigated: `content_publications` + webhook trail is the single delivery-truth surface).
- The Studio must keep two mental models — "generation schedule" vs "distribution schedule" (UI already distinguishes them; cancel affordance lives on distribution).
- Scheduling requires a reachable SDR at submit time (degraded-mode flag fallback keeps the platform non-regressing).

## Alternatives Considered

- **Double-scheduling social posts through both systems**: two schedulers = double-post risk — **rejected**.
- **Moving generation scheduling into the SDR**: couples content production to the distribution service, blurs ownership, larger change — **rejected**.
- **SDR-only scheduling with no RavalAI generation schedule**: does not cover the existing content-production use case — **rejected**.

## References

- Feature Spec: `specs/001-sdr-integration/spec.md` (US3, FR-008, FR-009, FR-025)
- Implementation Plan: `specs/001-sdr-integration/plan.md` (decision D4)
- Data Model: `specs/001-sdr-integration/data-model.md`
- Evaluator Evidence: `history/prompts/social-distribution-engine/010-sdr-integration-plan-second-pass.plan.prompt.md`
