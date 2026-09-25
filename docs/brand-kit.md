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

## Code map

| Part | Where |
|---|---|
| Tables, RLS, `set_default_brand_style` | `supabase/migrations/20261001090000_brand_kit_styles.sql` |
| Spec, resolve, prompt blocks, merge, conformance, fonts (pure) | `src/lib/brand-kit/` |
| View contracts, upload limits | `src/lib/brand-kit/contracts.ts` |
| Store, uploads, analysis, resolve | `src/server/brand-kit/*.server.ts` |
| RPC / browser stubs | `src/server/fns/brand-kit.ts`, `src/lib/brand-kit.functions.ts` |
| UI | `src/components/app/brand-kit/` (`BrandKitPanel`, `StyleEditor`, `CreateStyleFlow`, `LibrarySections`, `StylePicker`) |

## Where a style is applied

| Generator | How |
|---|---|
| Studio text (all formats) | `CreateJobSchema.styleId` → `loadJobStyle` → `ctx.style` → `styleSection` in `prompts.ts` |
| Studio images | `imageStyleInput` → `buildImagePromptDetailed({ style })`; close/exact references go as `referenceAssets` |
| Studio video | `videoStyleBlock` in `videoPrompt` |
| Caption naturalize | style block + protected terms in `naturalize.server.ts` |
| UGC | `brief.styleId` → `projectStyle` → concepts (`styleText`) and render (`styleNotes`) |
| Chat | `styleId` on `/api/chat` → writing block for drafted copy |
| Calendar, post images | `brandStyle` on `/api/generate-image` (verified workspace only) |
| Batches, social-multi | `styleTextFor(workspaceId, styleId, format)` |
| Campaign brief, experiment copy | default style's voice only |

The browser remembers the last pick per workspace (`studio:style:<id>`), shared
by Studio, chat, UGC and the calendar.

## Rules

- Generators get a style only through `loadResolvedStyle` / `styleTextFor`.
- Never trust a style id from the browser without the workspace check there.
- Analysis goes through the Anthropic gateway; never call a model directly.
- Don't overwrite a user-set field from analysis (`provenance`).

## Checks

```bash
npx vitest run src/lib/brand-kit tests/db/brand-kit.test.ts
npx vitest run --config vitest.live.config.ts tests/live/brand-kit.live.ts
BRAND_KIT_LIVE_ANALYZE=yes npx vitest run --config vitest.live.config.ts tests/live/brand-kit.live.ts   # paid
```
