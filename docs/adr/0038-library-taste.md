# ADR-0038: Library hearts — Mellox learns what the brand loves

- **Status:** accepted
- **Date:** 2026-10-29
- **Builds on:** ADR-0037 (Inspo), ADR-0033 (memory)

## Context

The Library cropped every picture to a fixed 4:3 or 4:5 box, so 9:16, 4:5
and 16:9 posts lost their edges. There was no way to say "more like this":
`LibraryAsset.isFavorite` was never stored, and `brand_visual_feedback` is
per Studio job and about references.

## Decision

**The Library shows every piece at its true shape.** A masonry grid
(`src/lib/library-grid.ts`, pure; `src/components/app/library/`) places tiles
in the shortest column, two to five columns by container width. A tile takes
the post's stored ratio (`meta.aspect_ratio`), else the picture's measured
shape, and the picture is `object-contain`. Round hover buttons: Love,
Download, Share, More (Open in Studio, Make more like this, Copy caption,
Less like this). A "New" badge marks pieces made since this browser last
opened the Library. Tabs: All · Posts · Media · Loved.

**One reaction per piece per brand** (`content_reactions`, unique on
`(workspace_id, subject_key)`; a post's subject is its `group_id`, a
stand-alone picture its asset id). Hearts are shared by the team, like
memory. `love` or `less`; removing a reaction deletes the row.

**The server copies everything it learns from stored rows.** `setReaction`
(`src/server/taste/service.server.ts`, RPC `src/server/fns/taste.ts`, editor
only) re-reads the post and its Studio job against the verified workspace and
stores `traitsOf` (`src/lib/taste/traits.ts`): format, platform, aim, hook,
angle, ad format, layout, colourway, motif, carousel structure, Story theme,
ratio. Only stored ids that match a strict pattern are kept. Nothing the
browser sends becomes a trait.

**Honest thresholds** (`src/lib/taste/learn.ts`): a value is liked only with
two loves and more loves than lesses, avoided only with two lesses and at
least as many lesses as loves, over the newest 200 reactions. Before that
the Library says how many more hearts it needs; nothing is guessed. Chips use
the existing label maps, and a value with no label is never shown.

**Generators read taste only through `tasteContextFor` / `tasteBlockFor`
(`src/server/taste/context.server.ts`) or `ctx.taste`** from
`loadStudioContext`, with the verified workspace id. The prompt block lists
what was loved and what to steer away from, and two loved captions lead the
voice samples. Pickers (hook style, angle, ad format, carousel structure and
design, Story theme, art-direction menu) take an optional lean through
`applyLean` (`src/lib/taste/bias.ts`): avoided values are dropped and liked
ones win on two of three seeds, after each picker's own rules (fit, no
recent repeat). The list is never emptied. Autopilot pieces are Studio jobs,
so they follow it too.

**Loved pictures feed Inspo.** A love adds the post's picture once as a
`brand_visual_sources` row (kind `library`, purpose `inspiration`, label
"Loved in Library") only when the asset has no reference yet; a full board
skips quietly. Unloving, "Less like this" or "Start over" removes only the
reference the heart created.

Flag `FEATURE_FLAG_TASTE_ENABLED` (with `_WS_<id>`), on unless `false`. Off:
no hearts or taste strip, RPCs answer 404, no prompt block, no lean.

## Consequences

- One new table, readable by members, written by the service role after the
  role check. Deleting a post or asset removes its reaction.
- Taste is cached with the 60-second Studio snapshot; a reaction clears it.
- `/studio-lab?scene=library` renders the Library with sample hearts
  (`tests/integration/library-taste.spec.ts`).
