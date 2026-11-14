---
name: brand-style-training
description: How Mellox learns a brand's own design from its website and posts (the style bible, ADR-0048) and how to add a new training round from reference brands a person shares. Use when a person sends a brand's website or posts and says "train Mellox on this", when posts don't look like the brand's site, when debugging the Inspo site read, the logo habit, rich on-picture text, campaign headings or the off-style review, or when adding a new style field, building block or layout.
---

# Brand style training

Mellox is not fine-tuned. "Training" means two things, and a round usually
touches both:

1. **The style bible** — what the analysis model is asked to see in any
   brand's site and posts, and what pure code keeps and tells every picture.
2. **The recipe libraries** — brand-neutral layouts and rules distilled from
   the reference posts (see the `studio-design-recipes` skill for those).

Previous rounds stay: round 7 (painted illustrated worlds) and round 8
(designed graphic systems) must both keep working. Never tune one register
at the other's cost.

## The pipeline (where each piece lives)

| Step | Code |
| --- | --- |
| Capture: screenshot, section crops, artwork crops (flat ones skipped), CSS tokens, fonts, buttons | `src/server/brand-visuals/capture.server.ts` (`pickArtBoxes`, `hasDetail`) |
| Which pictures the model sees: own posts → art → page overview → sections → inspiration | `analysisReferences` in `src/lib/brand-visuals/contracts.ts` |
| The question asked | `ANALYSIS_PROMPT` in `src/server/brand-visuals/worker.server.ts` |
| The answer's shape (lenient, ids stored) | `BibleSchema`, `COMPONENT_KINDS`, `REGISTERS`, `TEXT_DENSITY`, `LOGO_USE` in `contracts.ts` |
| What is kept | `groundBible` / `groundProfile` in `src/lib/brand-visuals/bible.ts` |
| Applied by itself (no manual look) | `autoApplyVisualProfile`, `startIncludedSiteRead` in `service.server.ts` |
| What every picture is told (≤1,100 chars, MUST FOLLOW block) | `bibleRules` |
| Which examples are attached (2 of 4 slots) | `pickAnchors` |
| Logo on this piece or not (brand's habit, seeded by job id) | `bibleWantsLogo` → runner `useLogo` |
| Headline plus eyebrow/body/items/button (rich brands, every campaign piece) | `wantsSupportingLines`, `buildVisualBriefPrompt`, `buildImagePromptDetailed` |
| QA | `image-review.server.ts` (frame, blocks, word amount → `style` score and fixes; other medium → `off-style:`, the one redo) |

## Adding a training round

1. **Look before writing.** For each post: register (painted, photo,
   designed, type), the frame every slide repeats, colours (count them),
   type (face, casing, which words change colour or slant), building blocks,
   how many words, where the logo sits and how often, what the website
   shares with the posts. Write it in
   `Post Training/<yyyy-mm>-<name>/NOTES.md` with the images (git-ignored;
   never commit, never name the brand in product code or prompts).
2. **Free live read of the site** (no spend):
   `STYLE_LIVE_URL=https://site npx vitest run --config vitest.live.config.ts tests/live/brand-style.live.ts`,
   then look at `.live-out/brand-style/` (crops and `tokens.json`). Check the
   art crops are real artwork and the tokens hold the real fonts and colours
   (a cookie banner's buttons in `buttons` means the banner wasn't closed).
   `STYLE_LIVE_AI=yes` also runs the real analysis (a few cents): ask the
   person first.
3. **Decide what is new.** Something every brand of this kind has →
   a bible field or a `COMPONENT_KINDS` id (add, never rename; lenient parse
   so old rows still read) plus a line in `ANALYSIS_PROMPT` and in
   `bibleRules`. A way to stage one picture → an `ARCHETYPES` layout in
   `art-direction.ts`, brand-neutral (the test refuses known brand names).
   A rule for words → `creative-knowledge.ts` / the brief prompt.
4. **Keep the rules short.** `bibleRules` must stay under
   `BIBLE_RULES_LIMIT` with every field full (a test fills them all).
5. **Honesty stays.** No invented figure, quote or offer on a picture; the
   model never draws the logo (code places it, and only when
   `bibleWantsLogo` says so); a recurring figure is never a real person; a
   product photo is never redrawn.
6. **QA.** If the new style has a must-have (a frame, a medium), teach the
   reviewer to lower `style` and name it in `fixes`. Only a clearly
   different medium is `off-style:`; never add a second redo.
7. **Tests:** extend `src/lib/brand-visuals/bible.round8.test.ts` (or a new
   `bible.roundN.test.ts`) and run
   `npx vitest run src/lib/brand-visuals src/server/brand-visuals src/lib/studio src/server/studio src/lib/post-image.consistency.test.ts`.
8. **Docs:** a "Round N" section in ADR-0048 and in
   `docs/studio/reference-study-2026-10.md`, brand-neutral.
9. **See it:** `/inspo-lab?scene=picked` shows the learned direction card.
