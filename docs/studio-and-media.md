# Studio and media generation

Studio exposes ideas, prompts, jobs, content, assets, and media workflows through
`src/components/app/StudioRail.tsx`, `src/server/studio`, and `/api/studio`.
Long-running work is represented by `studio_jobs` and advanced through the job
hooks rather than assumed to finish in the initial request.

Image and video generation routes use server-side gateways. KIE configuration,
model routing, webhook verification, polling, concurrency, and credits are
implemented in the KIE/UGC server modules. UGC projects, references, concepts,
notes, renders, downloads, cancellations, and post drafts are separate routes
under `/api/ugc`.

Media provider credentials are server-only. Asset persistence and library reads
are workspace-scoped. Provider availability is feature-flagged and health
surfaces report degraded configuration rather than pretending generation is
available.

TODO: add an exact model and output-format table from the active KIE route
configuration; model names and quotas are deployment configuration, not stable
product behavior.
