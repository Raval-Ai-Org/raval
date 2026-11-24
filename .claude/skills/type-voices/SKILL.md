---
name: type-voices
description: How each Mellox brand gets its own type (type voices) instead of the old "heavy condensed sans, one accent word" default, for pictures, code-drawn carousel slides and the headline overlay. Use when every post looks set in the same face, when a brand's type looks wrong, when adding a type voice, or when Arabic/Urdu slides or fonts misbehave.
---

# Type voices (Round 9, pack `type`, plus `scripts` and `headline`)

Decision record: `docs/adr/0053-creative-skill-packs.md`.

## Rules

- **One voice per brand, never rotated per piece.** `pickTypeVoice`
  (`src/lib/studio/type-voices.ts`) decides in this order:
  1. the brand's own typography (Inspo look or style bible);
  2. a display-worthy Brand DNA font (`isDisplayWorthy`; a UI sans like Inter
     is body text only);
  3. a stable hash pick among `voicesFor(business)`.
- **The image model gets words, never font names**, because it draws font
  names badly (`typeVoiceLine`).
- **Code-drawn slides and overlays** use the voice's Google Fonts pair
  (`typeVoiceFonts`, resolved through `catalogFont`).
- **Ids are stored.** They live on `meta.type_voice` and campaign
  `controls.typeVoice`. Add, never rename.

## Scripts (pack `scripts`)

- Arabic and Urdu words are drawn right to left in Vazirmatn (`RTL_FONT`,
  `carousel/design.ts`). Tajawal breaks Urdu letters.
- satori has no bidi support, so each word is set in a `row-reverse` row.
- If the font can't load, the renderer throws, and the caller keeps the old
  path.
- Hindi stays off until it passes a render test.

## Headline overlay (pack `headline`)

- The picture is drawn without words. `drawHeadlineOverlay`
  (`src/server/studio/headline-overlay.server.tsx`) measures the calmer band
  and sets the headline in the brand's font.
- The word-free picture is kept as `output.artwork.artStoragePath` with
  `layout: "overlay"`, so Edit text (`editVisualArtwork`) redraws it with no
  new render.

## satori gotchas

- `fontFamily: undefined` crashes it. Spread the font only when it loaded.
- Fonts with GSUB lookupType 5 format 3 crash it.
