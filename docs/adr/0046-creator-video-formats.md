# ADR-0046: Creator video formats, written like real Reels

Status: accepted (2026-11-11). Extends the Creator (UGC) composer; nothing in
ADR-0041 (Studio video kinds) changes.

## Context

Creator videos came out as storyless ads. The code made them that way:

- every video was one creator in selfie framing, and typed scripts put the
  same three shots on every line;
- the video prompt opened with "UGC video ad for …" and banned split screens,
  so a street interview or a two-person skit could not be made at all;
- there was no format in the composer, and the default (`problem_solution`,
  `authentic`) is the ring-lit testimonial that is wearing out fastest;
- scripts came from the workhorse model with no beats, no turn and no rules
  for cut rhythm;
- longer videos were separate clips that drifted, and the router matched words
  inside words ("reaction" picked cinematic, "quick" picked variation);
- nothing was written on the video, so there was no Reels-style hook text.

## Decision

- **Formats are data** (`src/lib/ugc/formats/`, pure). Thirty formats in five
  groups (Interviews & shows, Skits, Talking, Reviews & demos, Lifestyle), each
  a director's brief: the show, who holds the phone, light and look, the cast
  and their behaviour, the beats with time shares, speakers and cuts, the
  sound, how the product shows up, three places, three twists, three hook
  patterns, the hook text preset and a caption pattern. Ids are stored on
  briefs, scripts and renders: add, never rename. The old brief formats are
  read-only aliases (`LEGACY_FORMAT_ALIASES`).
- **Each format has a gold example** (`examples.ts`), written in the shape of
  the street-interview prompt that started this work (kept word for word). The
  script writer reads it as a style reference; `buildFormatVideoPrompt` writes
  every video prompt in the same shape: "Real vertical smartphone video …, raw
  social-media footage, not cinematic, not an advertisement", camera, light,
  set, one block per person, a timed shot list with `HARD CUT` / `SPLIT
  SCREEN` / continuous markers and quoted lines, sound, realism and the
  product-exactness lines. Split screens are banned only where a format
  doesn't use one.
- **Every video is a new variant.** `pickVariant` (seeded, skips the brand's
  last two per format, read by `recentCreatorWork`) chooses the place, twist
  and hook pattern. A chosen format gets one script in a fresh variant; Auto
  gets the best suggested format (one script since Mellox Lean, 2026-11) (`suggestFormats`, string
  work, no model call).
- **The writer is Sonnet 5.5** (`ugc.concepts` → CONVERSATION tier,
  `AI_MODEL_UGC_CONCEPTS` is the rollback). The prompt is a viral writer's
  brief with `craftRules`: a hook inside 1.5 s, no banned openers, the product
  is the answer and is named at most twice, a turn and a payoff, lines written
  to be spoken, a native call to action or none.
- **Code checks decide** (`formatScriptIssues`): banned openers, ad voice,
  hook length, line length, product mentions, missing turn or payoff, wrong
  speakers, shots too long for a cut format, hook text over 8 words, an opening
  the brand already used. The existing repair pass gets the reasons once;
  ideas are ordered by how clean they are. Nothing new is charged.
- **Two-person formats get two people.** The picked creator plays the lead
  (`leadRole`); the second is the person's pick or a contrasting ready-made
  creator (`pickPartner`), sent as a second reference where the model takes
  three or more images.
- **Clips follow the format.** Cut formats render in one generation up to the
  model's longest clip and split only at beat boundaries (`cutAt`); continuous
  formats chain each clip from the last frame of the one before. The router
  takes the format's model first and matches whole words only.
- **Hook text is drawn by code** (`src/lib/ugc/hook-text.ts`): nine
  Instagram-style presets (classic outline, bubble, marker, pov, reply
  sticker, breaking-news bar, two labels, word by word, stacked with the
  brand's accent). `hookCues` times them in the first 2.8 s; the engine draws
  them on the finished video (`overlayHookText`, next/og + FFmpeg) before it
  is stored. It fails open to the clean video. Video models never draw words.
- **The format comes first in the composer**, as a grid of 9:16 picture cards
  (`FormatPicker`), Auto first, "For your brand" from `suggestFormats`. The
  pictures are generated once by `scripts/generate-ugc-format-thumbs.mjs`
  (fictional people, no product, no words). After the pick it is the same one
  screen as before, with a "Format · Change" pill, Host / Guest slots for
  two-person formats and the hook text row.

## Consequences

- Old projects keep working: their brief format resolves through the aliases
  and renders with the format prompt; a Studio-imported script
  (`scriptSource: "studio"`) keeps the old prompt.
- Writing costs a little more per call (Sonnet instead of Flash); the
  `ugc_concepts` price is unchanged.
- The hook text adds one FFmpeg pass per render on the worker.
- Live check: `tests/live/ugc-formats.live.ts` behind
  `UGC_FORMATS_LIVE_RENDER=yes`.
