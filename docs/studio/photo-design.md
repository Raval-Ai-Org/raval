# Designing with your own photos and clips

Decision record: [ADR-0036](../adr/0036-own-photos-and-clips.md).

## What a person sees

- **Studio → Your photos:** four modes.
  - **Post as is** posts the photo unchanged.
  - **Design with my photos** takes up to 6 photos. A switch under it offers
    **Keep photos exact** or **Blend it more**.
  - **Edit details** changes only what the brief asks.
  - **Inspiration** makes something new in the photo's style.
- **Studio → Video → Make the video from:**
  - **Make a new video**;
  - **Brand my clips**: upload up to 5 clips;
  - **Recap from my photos**: 2 to 6 photos, with **Slow camera moves** or
    **Bring photos to life**.
- **Chat:** attach photos and ask in plain words.
  - "Add text and elements", "put our headline on it" or several photos: a
    design, photos kept exact.
  - "Blend", "redraw" or "illustrated": a design with Blend it more.
  - "As it is" or "don't change it": posted as is.
  - Attached clips are branded. Two or more photos plus "video" make a recap.
- **Upload → Design with this / Brand this clip** opens Studio with the file.
- **MCP `create_content`** takes `photoAssetIds` and `clipAssetIds`.

## How a photo design is made

| Step                                                                                  | Where                                             |
| ------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Photos opened from workspace storage and turned upright                               | `src/server/studio/photo-design/photos.server.ts` |
| One vision read: scene, faces, focus, calm areas, colours (route `studio.photo-read`) | `readDesignPhotos` → `groundRead`                 |
| Plan: overlay or windows, photo order, key colour, exact words, faces to keep clear   | `src/lib/studio/photo-design/plan.ts`             |
| Design-layer prompt: brand look, memory, type system, craft rules, verbatim copy      | `src/lib/studio/photo-design/prompt.ts`           |
| Layer rendered as an ordinary Studio image task (metered, routed, retried)            | `startMedia` in `runner.server.ts`                |
| Windows found, photos placed, design laid over, checks run                            | `compose.server.ts`, `geometry.ts`, `checks.ts`   |
| One more layer with the failure written in, or a plain failure                        | `finishPhotoDesign`                               |
| Real logo by code, visual review, saved with `source_preserved: true`                 | `advanceStudioJob`                                |

A picture edit starts from the previous layer (`design_layer_path`), so only
what was asked changes. Up to two earlier approved designs are references, so
a brand's posts read as a series.

## How a video is put together

All in `src/server/studio/clip-edit/`:

- the timeline is pure, in `src/lib/studio/clip-edit.ts`, `smart-cut.ts` and
  `captions.ts`;
- the FFmpeg steps are in `ffmpeg.server.ts`; captions are heard in
  `transcribe.server.ts` and drawn in `captions.server.tsx` (`CaptionArt`).

1. **Each clip is measured** in one quick FFmpeg pass: scene changes
   (`scdet`), black and frozen stretches (`blackdetect`, `freezedetect`) and
   pauses (`silencedetect`). These are the ideas of auto-editor and
   PySceneDetect, done with FFmpeg's own filters, so there is no Python.
2. **The minute is shared fairly** (`shareTime`): a short clip keeps all of
   itself, the rest is split, at most 20 s each, so every clip appears.
3. **The best part of each clip is used** (`bestWindow`): black, frozen or
   silent ends are skipped; a window starts on a scene change or as someone
   starts talking, and a talking clip stops at a pause, not mid-word. The
   footage itself is never changed. A clip known only by its length plays
   from the start, as before.
4. Each piece is fitted to the post's shape with a blurred fill. A recap
   photo becomes a slow push-in.
5. Frames are read like photos.
6. The opening design is a design layer over the first frame. It is checked
   for face cover and made see-through, then faded over 0–4 s. When captions
   will run, the layer is told to keep their band clear.
7. The closing card is a framed design around real frames (3 s). If it can't
   be made, the video ends on the footage and says so.
8. **Pieces are joined with one short transition** (0.35 s, `xfade` and a
   crossfade of the sound; one style per video from its seed, a dissolve for
   recaps and into the end card). A transition is never longer than a third
   of the shortest piece, and a failed one falls back to a straight join.
9. **Captions** ("Brand my clips", on unless the person turns them off):
   - only when someone talks (`isTalky`); a clip with no speech asks for no
     transcript and spends nothing;
   - the finished video's sound is heard once: by whisper.cpp on the server
     when `WHISPER_CPP_PATH` and `WHISPER_MODEL_PATH` are set (free, local),
     otherwise by route `studio.transcribe` through the gateway (OpenRouter
     audio input; about $0.001 a minute, inside the `clip_brand` price). The
     transcript is cached by the sound's hash, so a restart never pays twice;
   - `believableSegments` drops words "heard" in measured silence, loops and
     control characters; `buildCues` makes short cues (two lines at most, 0.7
     to 2.6 s, broken after punctuation, never ending on a small word);
   - one word per cue is in the brand's colour, lifted until it reads on the
     dark plate; white words otherwise; the brand's heading font when the
     catalogue has it;
   - they sit below the middle and above the Reels / TikTok / Shorts buttons
     (`captionBox`), drawn as one timed track (one overlay, any number of cues);
   - a script the renderer can't draw, or speech that can't be heard, leaves
     captions out and says so. The video is still made.
10. The real logo stays in its corner. The sound of the brand's own clips is
    brought to -14 LUFS (`loudnorm`), the level social apps play at.

The render runs after the response, under the request's scope.
`advanceStudioJob` collects the parked result and starts a stalled render
again. "Bring photos to life" first waits for one animated clip per photo
(`motion:<n>` slots, never linked to the post).

## Rules

- A photo is never redrawn unless the person chose Blend it more. A single
  picture about a picked product is a product hero poster instead (ADR-0040):
  the product is cut out and staged, never pasted in a window.
- The model never draws a logo or a person; only the real logo, placed by code.
- No template fallback: a design that can't hold the photos fails plainly.
- Photo and clip ids are always checked against the workspace
  (`resolveStudioReferences`, `resolveStudioClips`); no URL from the browser.

## Checks

- Unit tests:
  - `src/lib/studio/photo-design/*.test.ts`;
  - `src/lib/studio/clip-edit.test.ts`;
  - `src/lib/chat-intent.test.ts`.
- Render test: `src/server/studio/photo-design/compose.server.test.ts` (photo
  pixels inside the window equal the source).
- FFmpeg tests: `src/server/studio/clip-edit/ffmpeg.server.test.ts` and
  `smart-cut.server.test.ts` (measuring, crossfades, the caption track,
  loudness). They are skipped where `ffmpeg` isn't installed; set
  `FFMPEG_PATH` to run them with a binary that isn't on `PATH`.
  `CAPTION_SMOKE_OUT=<dir>` writes a captioned frame with a real font.
- Pure tests: `src/lib/studio/smart-cut.test.ts`.
- Live check: `tests/live/clip-captions.live.ts` (real transcription behind
  `CAPTIONS_LIVE_AI=yes`; well under a cent).

## Reference projects

Studied, not vendored. Only ideas were taken, rewritten as Mellox code.

| Project              | Licence                                          | Used                                                                                       |
| -------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| FFmpeg               | LGPL/GPL                                         | Yes, as the server's own binary (subprocess, as before)                                    |
| auto-editor          | Unlicense                                        | Idea only: cut dead air by measured loudness                                               |
| PySceneDetect        | BSD-3-Clause                                     | Idea only: start on scene changes (FFmpeg `scdet`)                                         |
| whisper.cpp          | MIT                                              | Optional local engine for captions (not bundled)                                           |
| Remotion             | Remotion licence (companies need a paid licence) | Not used; FFmpeg and next/og cover it                                                      |
| Motion Canvas        | MIT                                              | Not used: an editor-driven tool, not a server renderer                                     |
| ComfyUI              | GPL-3.0                                          | Not used: a GPU node server and a copyleft licence                                         |
| rembg                | MIT                                              | Not used: needs Python, ONNX and ~170 MB models per worker                                 |
| Wan2.2, ai-toolkit   | Apache-2.0, MIT                                  | Not used: GPU video models and fine-tuning; Mellox's models run through OpenRouter and KIE |
| Konva / react-konva  | MIT                                              | Not used yet: editable designs already open in Canva                                       |
| Label Studio, MLflow | Apache-2.0                                       | Not used: there is no training here to label or track                                      |
