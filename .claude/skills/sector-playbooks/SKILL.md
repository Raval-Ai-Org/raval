---
name: sector-playbooks
description: Mellox's 86 business types (sectors) and their playbooks (what to show, honest proof, buyer doubts, clichés) and the 567-brief example library. Use when a post is off for a kind of business (a plumber, web agency, clinic, game studio), when adding or changing a sector, when a brief's "why it sells" line looks wrong, or when the sectors skill pack is being tuned or benchmarked.
---

# Sector playbooks (Round 9, pack `sectors`)

Decision record: `docs/adr/0053-creative-skill-packs.md`. Off unless
`FEATURE_FLAG_SKILLS_SECTORS_ENABLED=true` (or `_WS_<id>`).

## Where things live

- Research, with source and licence columns:
  `docs/studio/research-2026-11/sectors-*.md`. Never pasted into prompts.
- Browser-safe ids, kinds (product / service / hybrid / venue / digital) and
  match terms: `src/lib/studio/sectors/kinds.generated.ts`. Look-ups go
  through `sectorOf` in `kinds.ts`.
- Server-only playbooks: `src/server/studio/sectors/data.generated.ts`, read by
  `sectorPlaybook`, `sectorById` and `sectorLinesFor` in `select.server.ts`.
- Both generated files come from `node scripts/sectors/build-sectors.mjs`.
  Never hand-edit them. Ids are stored, so add, never rename.
- Example briefs: `evals/creative/briefs/g1..g6.json`, how to write them in
  `WRITING.md`, built by `scripts/briefs/build-briefs.mjs` into
  `src/server/studio/example-briefs.generated.ts`. The owner keeps all 567;
  never cut any without a yes.

## How it reaches a piece

`skillLinesFor` (`src/server/studio/skill-lines.server.ts`) picks at most
three short lines:

- the sector's facts;
- one "why it sells" mechanism from `mechanismLineFor`, matched on the same
  goal and format, skipping ids used recently;
- the brand's type voice.

`skillLinesBody` caps them at 450 characters. A brief is never pasted into a
prompt.

## Adding a sector

1. Add it to the research notes with sources.
2. Run the build script.
3. Run `sectors.server.test.ts` and `example-briefs.library.test.ts`. They
   check that every sector is complete, has at least 6 briefs across 3 goals
   and 3 formats, and has no fake-proof or brand names.
4. Check that the 20 bench brands still map to the same industry.
