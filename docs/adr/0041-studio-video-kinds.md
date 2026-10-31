# ADR-0041: Studio video kinds, storyboards, chained clips and checks

Status: accepted (2026-10-31)

## Context

Studio pictures and carousels were good; Studio AI videos were not. Tracing
the pipeline found concrete causes:

- **Clips were cut mid-action.** A length was split into equal parts, each
  rendered at the next native length and then trimmed (`-t`), so an 8 s clip
  the model finished at 8 s was shown cut at 5 s.
- **No continuity.** Every clip was sent at once with the same references;
  nothing carried clip 1 into clip 2, so the person, product and place drifted.
- **No real plan.** One free-text concept, no cast or product record, no
  planned ending.
- **Picture → video was broken:** a square post was cropped to 9:16, every
  part restarted on the picture, and the video never ended on the real post.
- **Checks were advisory.** Three sampled frames added warnings; nothing was
  ever made again.
- **Defaults and pricing disagreed:** the runner fell back to Premium while
  the quote priced plain video, and Starter could not choose Premium at all.

## Decision

1. **A video has a kind** (`src/lib/studio/video/kinds.ts`, ids stored: add,
   never rename): `living-picture`, `motion-post`, `product-showcase`,
   `brand-story`, `how-it-works`, `before-after`, `mood-broll`,
   `offer-teaser`. Each says how its clips join (`single` / `chain` / `cut`
   / `code`), whether people appear, its default and most clips, its ending
   and the models it suits. `pickVideoKind` chooses one from the brief and
   source when the person leaves it on Auto. A person talking to the camera
   stays a Creator (UGC) video.
2. **Whole clips only** (`lengths.ts`): every length is a whole number of
   native clips, so nothing is ever trimmed. Old lengths snap to the nearest
   offered one.
3. **A storyboard, written once** (route `studio.video.storyboard`, Opus):
   a bible (cast, product, setting, light, palette, camera) and per clip
   what it opens on, its timed shots, what it ends on and its sound. Pure
   `storyboardIssues` refuses a plan without a hook, an ending, known cast or
   grounded words; the job stops before any video spend. `clipPrompt` builds
   each clip's prompt deterministically, with the full bible in every clip.
4. **Chained clips** for story kinds: clip N+1 is sent only after clip N
   finishes, opening on clip N's last frame (stored as a `video_chain_frame`
   asset of the workspace). Consistency first, at the cost of slower renders.
   Mood videos render in parallel and join with a short dissolve.
5. **Checked before anyone sees it** (`checks.ts`, route `studio.video.qa`):
   FFmpeg measures length, black or frozen footage, sound and size; a vision
   model scores frames at the start, middle and end of every clip against the
   storyboard and source picture; pure code decides. A failing clip is made
   again once at Mellox's cost (in chained mode with every clip after it). A
   video that still fails is **not delivered** and the person is not charged.
6. **Endings are exact:** a video from a post dissolves back to the post
   itself; an offer ends on a code-drawn card with the exact words.
7. **Picture → video offers three choices**: Bring it to life (AI, one clip,
   the post framed whole for the video shape), Motion post (code moves over
   the post, no AI, priced as a photo recap) and Story video.
8. **One default model** (`DEFAULT_STUDIO_VIDEO_MODEL = "standard"`), shared
   by the composer, the quote and the runner; Premium is never picked by
   itself. **Premium is sold from Starter** at its Video Credit price;
   Cinematic stays Agency and up, Full HD Growth and up. The composer shows
   locks with an upgrade toast.

Flag `FEATURE_FLAG_VIDEO_STORYBOARD_ENABLED` (with `_WS_<id>`), on unless
`false`. Off restores the single-prompt path without checks or redo.

## Consequences

- Videos take longer when chained (each clip waits for the one before).
- Storyboard and checking calls are included in the video's price; a redo
  is Mellox's cost.
- UGC keeps its own path; `withVideoComposition` without `clips` / `chain`
  behaves as before.
