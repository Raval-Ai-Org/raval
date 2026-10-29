# ADR-0036: Designing with the brand's own photos and clips

- **Status:** accepted
- **Date:** 2026-10-29
- **Builds on:** ADR-0026 (OpenRouter models), ADR-0027 (billing), ADR-0032 (one look per brand)
- **Reference:** [docs/studio/photo-design.md](../studio/photo-design.md)

## Context

Clients have real photos and clips: their launch event, their team at work.
They want posts built on those, with a headline, frames, badges and the logo,
and short videos of the same footage.

What existed:

- "Add text to my photo" went through `preserve` mode to a fixed template
  (`composeSourcePhoto`): a blurred fill, a dark fade and plain text. Every
  brand's posts looked the same.
- Only one photo could be kept per picture.
- `edit` lets the image model repaint the photo, so faces drift.
- A picture edit on a kept photo never reached the model: the edit chat
  re-linked the original.
- A clip could only be posted as it was.

## Decision

### 1. The image model designs, code places the photos

A new reference mode, `design`. The image model draws the whole design layer:
layout, shapes, frames, type and stickers. Where each photo goes, it leaves a
window in one flat key colour (green, or magenta when the brand or the photos
are green). Code then:

1. finds each window;
2. fits the real photo into it, pixel for pixel, around the photo's focus
   point and at the window's own angle;
3. lays the design over it, so stickers and words can overlap the photo edges.

The model decides the look per brand from the brand look, visual memory and
earlier approved designs (a series). Nothing is a template. A face is never
redrawn because the model never draws one.

### 2. The photos are checked, never faked

Pure checks (`src/lib/studio/photo-design/checks.ts`) measure each layer:

- one window per photo;
- each window big enough for its photo;
- enough of a full-bleed photo still showing;
- no face covered.

A failed layer is asked for once more, with the reason in the prompt. If that
fails too, the piece fails with a plain message and the hold is released.
**There is no template fallback.**

### 3. The person chooses how exact

- **Keep photos exact** is the default.
- **Blend it more** sends the photos to the model as references and lets it
  repaint. It is labelled "Faces may change slightly" and priced as an
  ordinary picture.

### 4. When it applies

A design is made only when:

- a person picks it;
- more than one photo is chosen;
- the brief asks for words or elements on the photo (`asksForDesign`);
- a person edits the picture, or asks for more versions.

"Post as is" stays exactly that, with the real logo placed by code if asked.
`resolvePhotoMode` decides this once, before pricing, so the charge matches
what runs.

### 5. Clips and recaps are put together by FFmpeg

- **Brand my clips:** up to five clips, one minute in all, stay as filmed.
- **Recap from my photos:** two to six photos.
  - Camera moves keep the photos exact.
  - "Bring photos to life" animates each photo through the normal video
    provider, charged in video credits.

Both get:

- an opening design over the first four seconds, made by the same
  design-layer prompt with a video note;
- the real logo for the whole video;
- a designed closing card built around real frames.

The render runs after the response. Its result is parked in the shared cache
and collected by `advanceStudioJob`. A render with no sign of life for six
minutes is started again, at most twice. Stored files and image calls are
keyed, so a restart repeats no charge. There is no new cron job or queue.

## Consequences

- Prices live in the catalog:
  - `photo_design` is 35 credits;
  - `clip_brand` and `photo_recap` are 45 credits each;
  - animated photos are `studio_video` at five seconds each.
- Flags, each with a per-workspace override and on unless `false`:
  - `FEATURE_FLAG_PHOTO_DESIGN_ENABLED`;
  - `FEATURE_FLAG_CLIP_EDIT_ENABLED`.
- `IMAGE_DESIGN_LAYER_TRANSPARENT=yes` asks the image model for real alpha.
  The key colour still works when it is ignored.
- Clip rendering needs `ffmpeg` on the server (the Dockerfile already installs
  it). Without it, a render fails plainly.
- No model is fine-tuned; OpenRouter models can't be. Each brand's design
  follows its look, memory and approved series through the prompt and the
  references.

## Addendum (2026-10-29): smart cuts, transitions, captions, loudness

- Clips are measured by FFmpeg (`scdet`, `blackdetect`, `freezedetect`,
  `silencedetect`) and the best part of each is used; the minute is shared
  so no clip is dropped. Pure rules in `src/lib/studio/smart-cut.ts`.
- Pieces join with one 0.35 s `xfade` (and `acrossfade`); a failure falls back
  to the straight join.
- "Brand my clips" gets captions (`controls.clipCaptions`, on unless false)
  when someone talks. The sound is heard by local whisper.cpp when configured,
  else route `studio.transcribe` (OpenRouter audio input, inside the
  `clip_brand` price). Rules in `src/lib/studio/captions.ts`.
- The brand's sound is normalised to -14 LUFS.
- Remotion was considered and not adopted: its licence needs a paid company
  licence, and FFmpeg plus next/og already render everything needed.
  Reference: [docs/studio/photo-design.md](../studio/photo-design.md).
