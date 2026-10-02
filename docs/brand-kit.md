# Brand Kit and Styles

Decision record: [ADR-0025](adr/0025-brand-kit-styles.md).

## What it is

- **Brand DNA** — who the brand is (facts, audience, voice, rules). Unchanged.
- **Brand Kit** — the workspace library: logos (main, for dark, icon), fonts
  (uploaded files), elements, patterns, product photos, example posts and
  videos, writing samples.
- **Style** — a named look and voice built from the kit. Pick one when creating;
  one can be the workspace default.

Surface: `/w/<id>/app/brand-kit` (sidebar → Intelligence → Brand Kit, command
bar, `open:brand-kit` event with `{ styleId?, section?, create? }`).

## How the surface is laid out

Kept deliberately small. Don't add a rail entry, a tab or an always-visible
field without removing one.

- **Rail:** Styles, Logos, Fonts, Images, Examples. Examples holds posts,
  videos and writing (a Posts / Writing switch). Colours have no page of their
  own: they are edited inside a style, or in Brand DNA. Old `colors` and
  `writing` deep links still open the right place.
- **Style editor:** three tabs (Look, Writing, Video). Each shows only the
  choices most people change; everything else sits under one "More options"
  fold (`MoreOptions` in `controls.tsx`). Examples are at the top of Look.
  "Use for" is the pill in the header; Make default, Duplicate, Copy to Brand
  DNA and Archive are in the header menu.
- **Brand DNA fallback:** one switch per tab ("Fill the rest from Brand DNA",
  `FollowBrand`), which sets that tab's `inherit` keys together.
- **New style:** one screen. Add posts you like, or pick Describe it / Use
  Brand DNA / Start blank underneath.

## Code map

| Part | Where |
|---|---|
| Tables, RLS, `set_default_brand_style` | `supabase/migrations/20261001090000_brand_kit_styles.sql` |
| Spec, resolve, prompt blocks, merge, conformance, fonts (pure) | `src/lib/brand-kit/` |
| View contracts, upload limits | `src/lib/brand-kit/contracts.ts` |
| Store, uploads, analysis, resolve | `src/server/brand-kit/*.server.ts` |
| RPC / browser stubs | `src/server/fns/brand-kit.ts`, `src/lib/brand-kit.functions.ts` |
| UI | `src/components/app/brand-kit/` (`BrandKitPanel`, `StyleEditor`, `CreateStyleFlow`, `LibrarySections`, `StylePicker`, `ColorPicker`, `look`) |
| Colour maths for the picker (pure) | `src/lib/brand-kit/color.ts` |
| Visual QA without a sign-in (dev only) | `/brand-kit-lab` (`BrandKitLab.tsx`) |

## Where a style is applied

| Generator | How |
|---|---|
| Studio text (all formats) | `CreateJobSchema.styleId` → `loadJobStyle` → `ctx.style` → `styleSection` in `prompts.ts` |
| Studio images | `imageStyleInput` → `buildImagePromptDetailed({ style })`; close/exact references go as `referenceAssets` |
| Calendar, post images | the browser builds the prompt without the style; `/api/generate-image` applies it with `restyleImagePrompt` |
| Studio video | `videoStyleBlock` in `videoPrompt` |
| Caption naturalize | style block + protected terms in `naturalize.server.ts` |
| UGC | `brief.styleId` → `projectStyle` → concepts (`styleText`) and render (`styleNotes`) |
| Chat | `styleId` on `/api/chat` → writing block for drafted copy |
| Batches, social-multi | `styleTextFor(workspaceId, styleId, format)` |
| Campaign brief, experiment copy | default style's voice only |

The browser remembers the last pick per workspace (`studio:style:<id>`), shared
by Studio, chat, UGC and the calendar.

## How a style decides the look

- **The style leads the image prompt.** `styleLead` in `src/lib/post-image.ts`
  puts the style and its reference images first, as the top priority. The
  seeded layout, the mood derived from the brand voice and the "canvas
  defaults" are only used when there is no style; with one, the layout is the
  style's own (or "follow the reference images") and the mood is the style's.
- **Examples are read for design, not just colour.** Each example gives the
  job of each colour (`roles`: background, text, main, accent), the layout
  grid, the background treatment, the shapes and the text treatment
  (`analyze.server.ts`). `mergeAnalyses` builds the palette from those roles
  (`paletteFromRoles`) and picks the description most of the examples agree on
  (`representativeText`), so one odd example never sets the style.
- **Analyses carry a version** (`ANALYSIS_VERSION`). "Update style from these"
  in the editor reads again any example studied by an older reader
  (`requeueOutdated`), then applies what it learned without touching fields a
  person set.
- **Copy my examples** (A little / Closely / Exactly) sets the strength of
  every reference at once. Only Closely and Exactly send the examples with
  each picture.
- A style made from examples uses its first example as its cover.

## Rules

- Generators get a style only through `loadResolvedStyle` / `styleTextFor`.
- Never trust a style id from the browser without the workspace check there.
- Analysis goes through the AI gateway (`llmJson`); never call a model directly.
- Colours are picked with `ColorPicker` / `PaletteEditor`, never a native
  `<input type="color">`.
- Don't overwrite a user-set field from analysis (`provenance`).

## Checks

```bash
npx vitest run src/lib/brand-kit tests/db/brand-kit.test.ts
npx vitest run --config vitest.live.config.ts tests/live/brand-kit.live.ts
BRAND_KIT_LIVE_ANALYZE=yes npx vitest run --config vitest.live.config.ts tests/live/brand-kit.live.ts   # paid
```
