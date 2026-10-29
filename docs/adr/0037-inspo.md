# ADR-0037: Inspo — the brand's look, voice and media in one place

- **Status:** accepted
- **Date:** 2026-10-29
- **Builds on:** ADR-0032 (one look per brand), ADR-0036 (own photos and clips)

## Context

Brain → Brand had two tiles for how content looks:

- **Look & voice**: a long editor (about thirty controls) plus the visual-taste
  panel (website scan, references, learned directions, history). People found
  it dense and hard to follow.
- **Assets**: a list of label + URL rows in `dna.assets`. No generator read it
  and it had no upload.

People wanted one place to show Mellox what they like: posts they love, looks
to avoid, their own product and team photos, and the look and voice of their
posts, with far less text.

## Decision

A new surface, **Inspo**, at `/w/<id>/app/inspo?s=<section>` (`inspoPath`),
opened from the sidebar (Workspace → Inspo), the chat "/" menu and
`open:inspo`. This is the one exception to "a brain view never gets its own
sidebar entry": the owner asked for it, and it is about the brand's look, not
another brain.

Five sections (`src/lib/inspo/sections.ts`):

| Section    | Writes                                                                |
| ---------- | --------------------------------------------------------------------- |
| Board      | `brand_visual_sources` with purpose `style` / `inspiration` / `avoid` |
| Post look  | `dna.look.visual`                                                     |
| Video look | `dna.look.video`                                                      |
| Voice      | `dna.look.writing`, including `writing.examples` (up to three)        |
| Media      | `brand_visual_sources` with purpose `product` / `person`              |

Rules:

- **Still one look.** Inspo edits the same `dna.look` (through `tidyLook`) and
  the same visual-taste direction. No second look, no picker, no Brand Kit.
  Generators still read the look only through `loadBrandLook` / `lookTextFor`.
- **No new tables.** Cards are `brand_visual_sources` rows (`inspoCards`,
  pure); uploads go through the existing `POST /api/brand-visuals/upload`
  (files or a public link through `safeFetch`). A video's sampled frames are
  hidden and follow the video when it is removed or re-tagged.
- **Nothing paid runs by itself.** "Learn my style" and "From my site" are the
  existing analysis (first included, later `brand_dna_rescan` credits from the
  catalog), shown with the price on the button. A learned direction reaches
  generators only after a person presses "Use this".
- **Style strength** (`styleSteps` / `styleStrength`) only counts what is
  saved. The voice sample (`voiceSample`) is string work, no model call.
- **Use in a post** opens Studio (`open:canvas`) with the card's asset as a
  reference: `inspire` for posts the brand loves, `design` for its own product
  and people photos; an "avoid" card is never sent. Nothing is made until
  Generate.
- Studio's photo picker (`/api/studio/references`) lists Inspo's product and
  people photos first.
- Old links (`?s=brand&t=look`, `&t=assets`, `/brand-kit`,
  `open:brand-dna {tab: "look"}`) land in Inspo. Brain → Brand keeps one Inspo
  tile that opens it.

UI: `src/components/app/inspo/` — `InspoRoute` → `InspoPanel` (data) →
presentational `InspoScreen`. `/inspo-lab` renders it with sample data in
development (`tests/integration/inspo-lab.spec.ts`).

## Consequences

- `LookEditor`, `VisualTastePanel` and `/visual-taste-lab` are removed; their
  controls (`brain/brand/look/controls.tsx`, `ColorPicker`, `preview.tsx`,
  `presets.ts`) are reused by Inspo.
- `dna.assets` is no longer edited. Its site pictures appear once under
  Media → "From your site" and can be kept as real uploads; nothing is deleted.
- The website scan's page-by-page crop review is no longer shown; a scan's
  approved crops appear on the board marked "Your site".
