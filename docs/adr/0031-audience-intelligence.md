# ADR-0031: Audience — who content is for, how it is likely to land, and what really happened

- Status: Accepted
- Date: 2026-10-05
- Builds on: ADR-0014 (canonical workspaces), ADR-0022 (web intelligence and
  competitors), ADR-0023 (Market Brain), ADR-0026 (OpenRouter-only models),
  ADR-0027 (billing and credits), ADR-0028 (Autopilot), ADR-0029 (MCP)

## Context

Mellox knew the brand, made content and published it. Nothing between "made"
and "published" asked whether the audience would care, and nothing compared a
post's real result with what was expected of it.

- Audience data was free text in Brand DNA (`audience`, `customer.personas[]`).
  Prompts only ever received persona names.
- There was no score, no simulated reaction and no comparison of versions.
- `content_publications.metrics` is an overwritten snapshot; nothing froze a
  result or compared it with an expectation.

## Decision

One loop on top of the existing systems, with no second generator, publisher or
approval path:

**Brand → Audience → Generate → Predict → Compare → Improve → Publish → Measure → Learn**

### 1. Audience groups with a source on every statement

`audience_twins` holds one row per group ("twin" in code, "group" in the UI;
"persona" was already used twice). Each trait carries where it came from:
`user`, `brand_dna`, `website`, `market`, `competitor`, `measured`, `assumed`.
A guess is stored and shown as a guess. A person's statement is never
overwritten; a rebuild only changes what a person did not write.

Groups are seeded from Brand DNA with no model call the first time a score is
asked for, so the feature works with no setup. "Refresh from Brand DNA" makes
one premium call over stored Brand DNA, Market Brain and competitor profiles.
It never searches the web.

### 2. No outside simulation engine

Checked: OASIS (camel-ai) is Apache-2.0 and usable; MiroFish is AGPL-3.0 and
was not used; "OpenPersonaSimulation" could not be found as a verifiable
project. OASIS runs an open-ended number of model calls per simulation and
needs a Python service, which conflicts with the cost ceiling and adds
infrastructure. The simulation is written against the existing OpenRouter
gateway behind one interface (`AudiencePorts`, implemented in
`src/server/audience/simulate.server.ts`). An outside engine would replace that
file and nothing else. No new dependency, service or cron job was added.

### 3. Cost is bounded by construction

| Action            | Model calls                                                                         | Price                  |
| ----------------- | ----------------------------------------------------------------------------------- | ---------------------- |
| Mellox Score      | free checks + 1 economy call for up to 6 pieces, cached per exact text and audience | included, rate-limited |
| Ask your audience | 1 economy call per group (max 5) + 1 workhorse summary                              | `audience_pulse`       |
| Compare versions  | 1 workhorse call writes 3 versions, 1 economy call per group judges all of them     | `audience_tournament`  |
| Refresh groups    | 1 premium call                                                                      | included, rate-limited |

Prices live only in `src/lib/billing/catalog.ts`. Charged runs use
`beginAsyncCharge` → `link("audience_run", id)` and settle from the run's own
status: captured on `succeeded`, released on `failed` or `cancelled`.

### 4. The model proposes, pure code decides

Every number is computed in `src/lib/audience/`: the overall score from five
dimensions, free checks that can only lower a dimension, the panel split,
ranking, "too close to call", confidence, calibration and learned patterns.

### 5. Honest by construction

- A score belongs to the exact text it scored (`subject_hash`) and the audience
  that answered (`twins_fingerprint`). Edited text has no score until it is
  checked again.
- Confidence is earned: "high" only from this workspace's own measured posts.
  A comparison of versions is never more than "fairly sure".
- Simulated people are always labelled as simulated.
- A result is frozen once, seven days after delivery, only if the metrics were
  read after those seven days and at least 100 people saw the post.
- "Actual" is the post's place among the workspace's own posts on that
  platform, and needs eight of them.
- Nothing is corrected from fewer than eight predicted/actual pairs, the
  correction is shrunk (`n / (n + 20)`) and capped at 15 points.
- A learned pattern needs two posts on each side and a clear gap.

### 6. It never changes a piece

Nothing in Audience writes to `content_items`, so scoring can never un-approve
content. "Improve" calls the Studio editor's existing rewrite; "Use this
version" puts text into the editor as an unsaved edit, so the normal save and
approval rules apply.

## Cut from the first version

- Scores on Studio ideas (a number on something not yet written would be fake).
- A chat tool that spends by itself. Chat gets an "Open Audience" button and
  the audience block as context.
- Blocking Autopilot's automatic approval on an uncalibrated score.
- Learning per group: social networks return no per-segment data, so learning
  is per workspace.
- Scores for articles and Stories.

## Consequences

- Six tables, one claim RPC and one new `billing_async_links` kind
  (`20261010090000_audience_intelligence.sql`).
- Every generator that reads `loadStudioContext` (Studio, ideas, calendar,
  Autopilot strategy and plans) and chat now receive a compact audience block.
- The existing `run-schedules` hook advances leftover runs and collects
  outcomes; no cron job was added.
- Flags: `FEATURE_FLAG_AUDIENCE_ENABLED` (per workspace `_WS_<id>`), and
  `FEATURE_FLAG_AUDIENCE_AUTO_SCORE_ENABLED` for the one unrequested model call.
