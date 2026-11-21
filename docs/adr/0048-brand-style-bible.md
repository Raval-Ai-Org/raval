# ADR-0048: Brand style bible — learn the look from the site and posts, use it on every picture

- **Status:** accepted
- **Date:** 2026-11-14
- **Builds on:** ADR-0032 (one look), ADR-0037 (Inspo), ADR-0047 (creative review)
- **Changes:** ADR-0037's "a learned direction reaches generators only after Use this", for
  brands with no look of their own.

## Context

The Brand DNA scan reads HTML (colours, fonts, logo, words) and never looks at the brand.
Inspo's visual taste read screenshots, but a direction held only a four-value layout, a
three-value motif and free-text notes. It could not say "a hand-painted illustrated world,
a serif headline with one italic word in the accent colour, the wordmark centred at the top,
a recurring figure". Three faults made it worse:

- the image prompt never said what the attached reference images were (`styleLead` needed
  `references.count`, which nothing set);
- product photos took all four reference slots, and the website crops sent were UI sections;
- the review could not fail a picture painted in the wrong medium.

People expect a brand with only a URL to get posts in its own world, without setup.

## Decision

1. **A style bible per direction** (`BibleSchema`, `src/lib/brand-visuals/contracts.ts`):
   world (medium, rendering, setting, lighting, palette mood), type (headline face, one
   emphasis style, casing, placement), composition (logo place, headline and subject zones,
   density), up to five signature elements, an optional recurring subject, avoid list, and
   2–4 anchor examples. Plus `adherence` (`light` default, `close`, `strict`) and per-source
   `roles` (artwork, photo, ui, type, overview). Every field parses leniently: a bad bible
   never drops a profile; old rows still parse.
2. **The model proposes, `groundProfile` decides** (`src/lib/brand-visuals/bible.ts`): ids
   the model wasn't shown are dropped, a UI crop or page overview is never an anchor, a
   recurring subject needs two of the brand's *own* pictures (website or Board "Love" posts,
   never inspiration), directions are ordered by confidence, anchors join the direction's
   sources so activation approves them.
3. **Better evidence.** The capture also cuts the site's largest pictures and painted
   backgrounds from the screenshot (`region.type: "art"`, `pickArtBoxes`) and reads CSS colour
   and font variables, loaded font faces and button styles, as open-source token extractors
   do. The read sends the brand's own posts first, then artwork, one shrunk homepage overview
   (rhythm only, never a reference), then a crop per page — up to ten pictures, same route,
   model and price.
4. **Automatic, still a person's choice.** The Brand DNA scan starts the included first read
   (`startIncludedSiteRead`, the same rule Inspo uses). When it finishes and the brand has
   nothing active and no visual look of its own (`hasManualVisualLook`), the strongest
   direction is activated with `auto: true` (`autoApplyVisualProfile`). Inspo shows it as
   "In use — Mellox picked this from your site" with **Keep this**, other directions and
   **Stop**, and the Light / Close / Strict control. A person's save always clears `auto`.
5. **Every picture gets it.** `compileVisualSnapshot` puts `bibleRules` at the top of the
   rules (the MUST FOLLOW block of every image prompt: posts, carousels, Stories, ads, product
   heroes, photo design, UGC) and picks references with `pickAnchors`, which keeps two of the
   four slots for the brand's own examples. The single-post prompt now names them
   (`withStyleReferences` → `styleLead`, strength `world` for light adherence: same world,
   fresh composition). Light keeps Mellox's layouts; Close adds the composition; Strict follows
   the examples' framing.
6. **The review scores it.** With a learned style the rubric adds `style`; a clear departure
   is reported as `off-style:` and is a hard defect, so it earns the one redo at Mellox's cost.
7. **Four brand-neutral layouts** from the November reference round:
   `illustrated-world-poster`, `ui-in-scene`, `orbiting-cards`, `vista-metaphor`.

## Round 8 (November 2026): designed graphic systems

The second training brand makes no painted world: every post is a designed
slide from one graphic system (a dark top band with the mark and a slide
counter, an outlined eyebrow pill, a heavy caps headline with its key words in
the accent colour, a grey paragraph, line icons in outlined squares, real work
in rounded frames, a pair of buttons, a footer band with the site address).
The bible now also learns, and code decides from:

- `register` (illustrated, photographic, designed-system, typographic, mixed).
  A designed system is told to stay a flat designed graphic.
- `frame`: the chrome every post of a series repeats. Kept on every picture.
- `components`: up to eight reusable building blocks (`COMPONENT_KINDS`, ids
  stored: add, never rename). An unknown kind drops that item only.
- `type.emphasis: "colour-words"`: several key words in the accent colour.
- `text` (minimal, headline, rich). A rich brand's brief writes the headline
  plus role lines (`eyebrow:`, `body:`, `item:`, `button:`), kept only with a
  role, set verbatim with the eyebrow first (`buildImagePromptDetailed`).
  **Every campaign piece** gets the same (`wantsSupportingLines`): the eyebrow
  is the campaign's name or phase and the button its own call to action. A
  brand whose pictures stay word-free (`minimal`) never does.
- `logo` (always, often, sometimes, rarely). Not every post carries the logo:
  `bibleWantsLogo` decides per piece from the brand's habit, deterministic on
  the job id so a redo keeps the answer. No bible: the logo is placed as before.
- The review checks the frame, the building blocks and the amount of words:
  a missing frame lowers the `style` score and is named in `fixes`; only a
  different medium is `off-style:` (the one redo).
- Four more brand-neutral layouts: `framed-system-slide`, `service-hub`,
  `icon-grid-card`, `annotated-device`.

How to add the next round: the `brand-style-training` skill.

## Consequences

- No new table, no new cron job, no new price. The first read stays included; a repeat is
  `brand_dna_rescan`.
- A product's photo is still never redrawn; a recurring figure is drawn, never a real person.
- Not fine-tuning: the "training" is the extracted bible plus the brand's own examples sent
  with each picture, and the reference study distilled into the layouts.
