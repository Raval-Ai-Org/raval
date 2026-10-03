# ADR 0030: Stories in the existing content pipeline

## Decision

Represent Stories as `content_items.kind = 'story'`. Keep their ordered media in the existing Studio asset path and record placement and per-frame provider results on `content_publications`. Plan recurring Stories as actions in the existing Autopilot program. Publish and reconcile them through the existing Post for Me adapter and schedule worker.

## Reasons

Approval, workspace authorization, rate limits, leases, audit events, usage accounting, calendar visibility, and multi-account publishing already belong to these systems. Reusing them gives Stories the same operational guarantees as other content. Post for Me publishes each media item at the Stories placement separately, so per-frame results are necessary for accurate status and retry.

## Consequences

The schema gains `content_publications.placement`, `content_publications.frames`, and `autopilot_programs.stories`. Instagram and Facebook are the only Story destinations. The user interface must state unsupported native stickers clearly. Story metrics are sampled while available and retained after expiry. Existing connected accounts need `feeds` permission for metrics.

See [Stories](../stories.md) for operations and provider references.
