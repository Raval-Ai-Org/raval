# Audience

Decision record: [ADR-0031](adr/0031-audience-intelligence.md). Audience is shown in
Brain → Audience ([docs/brain.md](brain.md)).

Audience answers three questions for a workspace: who is this content for, how
are they likely to react before it goes out, and what really happened after.

## What a person sees

| Where                                                          | What                                                                                                                                                       |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sidebar → **Brain** → Audience (`/w/<id>/app/brain?s=audience`) | Groups with the source of every statement, what real results show, how close past scores were, recent checks. Edit, add, remove, "Refresh from Brand DNA". |
| Studio editor                                                  | A score chip beside "Version N" and an **Audience** section: Predict, why, Improve, Ask your audience, Compare versions, Use this version.                 |
| Content calendar                                               | Score chip in the list; the same Audience section in the entry editor.                                                                                     |
| Video ad concepts                                              | "Test with your audience" ranks the ideas before a video is made.                                                                                          |
| Analytics → Content                                            | Expected against real, once one real result exists.                                                                                                        |
| Autopilot                                                      | Measured learnings join the next weekly plan.                                                                                                              |
| Chat                                                           | "Open Audience" button; the audience block is part of the brand context.                                                                                   |
| MCP                                                            | `get_audience`, `list_predictions`, `predict_content`.                                                                                                     |

## Code map

- Pure core, unit-tested: `src/lib/audience/`
  - `contracts.ts` shapes; `twins.ts` groups, merging, prompt block;
    `score.ts` dimensions, free checks, confidence; `panel.ts` panel split,
    aggregation, ranking; `calibration.ts` outcomes and learning;
    `subject.ts` what is scored for a saved piece; `prompts.ts`.
- Server: `src/server/audience/`
  - `engine.ts` (store-agnostic worker and quick score, tested against
    `store.memory.ts`), `store.server.ts`, `simulate.server.ts` (the only model
    calls for reactions), `twins.server.ts`, `learn.server.ts`,
    `context.server.ts` (block for generators), `service.server.ts`.
- RPC `src/server/fns/audience.ts`, stubs `src/lib/audience.functions.ts`.
- UI `src/components/app/audience/` (`AudienceScreen` is presentational;
  `/audience-lab` renders it with sample data in development).
- Migration `supabase/migrations/20261010090000_audience_intelligence.sql`.

## Rules

- **Nothing writes to `content_items`.** A score never changes or approves a
  piece.
- **The model proposes, pure code decides** every number.
- **A score is for exact text.** `subject_hash` + `twins_fingerprint` +
  `score_version` is the cache key; the UI only shows a score that still
  matches the saved row. Bump `SCORE_VERSION` when scores stop being comparable.
- **A person's statement is never overwritten.** Rebuilds and learning only
  change what a person did not write. A removed group is not brought back.
- **Every statement keeps its source**, and a guess is labelled a guess.
- **Model calls only through `AudiencePorts`.** Group text and the piece are
  user-editable, so both are wrapped as untrusted data.
- **Charged runs settle from their own status.** A repeat click joins the
  running run before any charge is taken.
- **No cron job.** The `run-schedules` hook calls `runDueAudience` and
  `collectOutcomesIfDue`; a click continues in `after()`.
- **Learning thresholds** are constants at the top of `calibration.ts`. Do not
  lower them to make the page look fuller.

## Flags and environment

```
FEATURE_FLAG_AUDIENCE_ENABLED=              # on unless "false"; _WS_<id> per workspace
FEATURE_FLAG_AUDIENCE_AUTO_SCORE_ENABLED=   # the score that follows a generation
AI_MODEL_AUDIENCE_SCORE= AI_MODEL_AUDIENCE_REACT= AI_MODEL_AUDIENCE_SYNTHESIZE=
AI_MODEL_AUDIENCE_VARIANTS= AI_MODEL_AUDIENCE_TWINS=
```

Off means the sidebar entry and every editor section are hidden, RPCs answer
404, the worker leaves runs alone and generators get no audience block.

## Checks

```bash
npx vitest run src/lib/audience src/server/audience tests/db/audience.test.ts
npx vitest run --config vitest.live.config.ts tests/live/audience.live.ts
```

The live check uses fixed model answers unless `AUDIENCE_LIVE_AI=yes`.
