---
name: studio-design-recipes
description: Mellox's library of proven post designs (picture layouts, ad layouts, ways to put words on a person's own photo, opening lines) learned from studied real posts. Use when making, debugging or improving how Studio designs a post, ad, carousel cover or photo design; when a person asks for a post "like" a style (minimal, equation, event poster, menu card, headline band on my photo); or when adding what was learned from new reference posts.
---

# Studio design recipes

Mellox keeps every design it has learned as **data in pure modules**, never
in a single prompt. Code picks the recipe; the model only draws it. Source
notes: `docs/studio/reference-study-2026-10.md` (rounds 1–6).

## Where each kind of recipe lives

| Recipe | Module | Picked by | Stored as |
| --- | --- | --- | --- |
| Picture layout (how a generated picture is staged) | `src/lib/studio/art-direction.ts` `ARCHETYPES` | `pickArchetype` (format, brand energy, deliverable `prefer`) | `meta.art_direction` |
| Kind of asset (offer, event, mix-up, quote…) | `src/lib/studio/creative-knowledge.ts` `DELIVERABLES` | `detectDeliverable` from the piece's words | — |
| Ad layout (a finished designed ad) | `src/lib/studio/ad-formats.ts` `AD_FORMATS` | `pickAdFormat` (person's choice, objective, goal) | `controls.adFormat` |
| Words on a person's own photo | `src/lib/studio/photo-design/overlays.ts` `PHOTO_OVERLAYS` | `pickOverlay` inside `planPhotoDesign` (never covers a face) | `plan.treatment` |
| Opening line | `src/lib/studio/memory.ts` `HOOK_STYLES` | `pickHookStyle` rotation | `intent.hookStyle` |

## Using them for a person's request

Match what the person asks for to a recipe, then let the normal Studio path
make it (metered, brand look, memory, taste all apply):

- "minimal / one object / quiet" → `still-object`, `symbol-object`
- "X is not Y", myths, mix-ups → deliverable `mix-up` → `not-equal` (ad: `not-equal`)
- "No X. No Y. Just Z." → ad `negation-trio`, opening `negation`
- recurring night, happy hour → `blob-event`
- dish, menu item, premium single item → `named-hero-card`
- software outcome without a screenshot → `outcome-chips`
- explain a concept → `iso-panel`
- heritage or craft brand statement → `heritage-ornament`
- wedding, florist, gentle brand → `line-engraving`
- one-word statement → `edge-word`
- "put our headline on my photo" → photo design overlay: `header-band`,
  `curved-panel`, `sky-headline`, `stat-card`, `corner-couplet`,
  `sticker-callout`, `side-column`, `dark-header`
- today's real fact (weather, places left) → ad `live-moment`, opening `right-now`

To force one, pass `artDirection` (picture) or `controls.adFormat` (ad).
Never write a new layout into a single prompt instead.

## Adding a recipe (new reference posts)

1. Study the posts; write down structure, type, colour, where words sit,
   the copy shape. **Never** copy a post, a brand name, a slogan or a logo.
2. Add it to the owning module above (ids are stored: add, never rename).
   Brand-neutral words only; the art-direction test refuses known brand names.
3. Honesty: every figure, offer, quote or price comes from the brief or
   Brand DNA ("never invent"); people are fictional; no logo drawn by the model.
4. Wire it: a deliverable's `prefer`, an objective's `formats` (append, don't
   reorder), or `onlyFor` when it suits one kind of piece only.
5. Test: extend `src/lib/studio/round6-recipes.test.ts` (or a new round's
   test) and run
   `npx vitest run src/lib/studio/art-direction.test.ts src/lib/studio/ad-formats.test.ts src/lib/studio/ad-objectives.test.ts src/lib/studio/creative-knowledge.test.ts src/lib/studio/photo-design src/lib/studio/prompt-size.test.ts`.
6. Add a "Round N" section to `docs/studio/reference-study-2026-10.md`.
