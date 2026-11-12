# Studio video

Decision record: [ADR-0041](../adr/0041-studio-video-kinds.md).

## The path of one AI video

1. **Settle** (`src/lib/studio/video/settle.ts`, pure). The composer, the
   quote route and `createBilledStudioJob` all call `settleVideoControls`,
   which decides `videoKind` (Auto → `pickVideoKind`), `videoModelKey`
   (`studioVideoModelFor`, never Premium by itself) and `durationSec`
   (`snapLength`, whole clips). The price shown is the price of what runs.
2. **Storyboard** (`buildVideoStoryboardPrompt` in `prompts.ts`, route
   `studio.video.storyboard`). Gets the kind's rules, the clip plan and the
   whole studio context (brand look, memory, goal, products, campaign,
   taste, strategy). `fitStoryboard` keeps every shot inside its clip;
   `storyboardIssues` refuses a plan that can't make a complete video. A
   reviewed script's exact words go to the clip they fall in
   (`sourceScriptClipDirection`).
3. **Render** (`startStoryboardVideo` in `runner.server.ts` →
   `withVideoComposition`). One prompt per clip from `clipPrompt`. Story
   kinds chain: each clip opens on the last frame of the one before
   (`video_chain_frame` asset). Mood clips run in parallel and dissolve
   (0.3 s). A post's picture is framed whole for the video shape
   (`frameForVideo`) and stored as `video_first_frame`.
4. **Check** (`finishStoryboardVideo`, `src/server/studio/video/qa.server.ts`,
   pure verdicts in `checks.ts`). FFmpeg probe + vision judge
   (`studio.video.qa`) on frames from every clip. Fail → `redoPlan` →
   `redoComposedClips` (one round, Mellox's cost). A broken file (missing
   footage, dead frames, wrong size or required audio) still fails and releases
   the hold. A completed, safety-cleared file with only an unresolved visual
   concern is delivered with a review warning instead of being discarded at the
   finish line.
5. **Ending** (`finish.server.tsx`). `back-to-source` dissolves to the exact
   post; `end-card` adds a card drawn with next/og.

## Storyboard first (long and premium videos)

A person reads the whole video before it is made, so a long or premium
render is never spent on a plan they wouldn't have chosen.

- **When:** `needsStoryboard` (`src/lib/studio/video/board.ts`, pure): an AI
  video or video Story of 16 s or more, or on Premium, Cinematic or Long.
  Short clips (an 8 s product demo, Animate, recaps, "From my website",
  motion graphics) skip it. The switch in Options ("Storyboard first") is on
  and locked for those videos, optional for the rest.
- **Studio:** `createBilledStudioJob` forces `controls.videoPreview` for a
  person's new job (never an Autopilot or campaign step, a revision or a
  refine). The job writes the captions and storyboard as usual, then draws one
  low-quality key frame for the opening, the middle and the end (3,
  `framePicks`; slot `main` and `board:<n>`, metered
  `studio.image.storyboard`, never linked to the post, no vision review).
  Every other scene shows the key frame it follows from (`keyFrameFor`).
  Charged `video_storyboard` (10 credits).
- **Review** shows `StoryboardView` (`src/components/studio/storyboard/`):
  a stage with the chosen scene big and "Play through" (each scene for its
  real length), the script beside it (time, camera, action, the exact words
  said and shown, sound), a film strip of every scene, what stays the same in
  every scene, and one "Create video" pill with the price. Create is a media-only refine that
  reuses the approved `videoPlan`, so the video is made from exactly that
  plan. "Change the plan" opens the edit chat.
- **Creator (UGC) videos** only when long and many-scene (`creatorNeedsStoryboard`:
  15 s and 4 scenes or more); a short talking-head script goes straight to Generate:
  Generate becomes "Plan the storyboard". The saved script becomes the board
  (`boardFromCreatorScript`, free) and `POST /api/ugc/projects/:id/storyboard`
  draws a frame per scene with the creator's and product's photos as
  references (`creatorStoryboard`). Frames are assets keyed by the script
  (`creatorBoardKey` + ratio): the same script shows them again for nothing.
  Create starts the ordinary render.
- Labs: `/studio-lab?scene=storyboard`, `/layout-lab?scene=ugc-storyboard`.

## Kinds

| Kind               | Made by                         | Joins          | Ends on                               |
| ------------------ | ------------------------------- | -------------- | ------------------------------------- |
| `living-picture`   | AI, one clip                    | single         | the exact post                        |
| `motion-post`      | code (recap camera path), no AI | —              | the post                              |
| `product-showcase` | AI                              | chain          | hero frame                            |
| `brand-story`      | AI                              | chain          | payoff + end card                     |
| `how-it-works`     | AI                              | chain          | result                                |
| `before-after`     | AI                              | chain          | the after                             |
| `mood-broll`       | AI                              | cut (dissolve) | hero frame                            |
| `offer-teaser`     | AI + code card                  | chain          | exact offer card                      |
| `product-motion`   | AI, no people                   | chain          | the picture / hero frame              |
| `product-demo`     | AI, hands only                  | chain          | product at rest                       |
| `broll-hook`       | AI + code words                 | cut (dissolve) | hero frame, hook line held throughout |
| `motion-graphics`  | code (Opus design, Chromium)    | —              | the last frame, held                  |

Ids are stored on jobs: add, never rename. A person talking to the camera is
a Creator (UGC) video.

The composer groups the cards under five headings (`group` on each kind,
`VIDEO_KIND_GROUPS`): From your post, Show the product, Tell a story, Mood and
B-roll, Words and offers. A kind that needs a picture says so on its card
when there is none, and the note under the cards names the kind made
instead. A kind drawn by code (Motion post, Motion graphics) is never made by
a video model: `usableKind` turns a leftover one into a living picture, and
switching "Make the video from" clears it.

## What makes each video different

- **By length** (`structure.ts`): `clipRoles(kind, clips)` gives each clip a
  role. 8 s is one idea that loops, 16 s a hook and a payoff, 24 s and more a
  full arc with B-roll between hero shots. The storyboard prompt lists the
  roles, so a longer video is planned differently, not stretched.
- **The opening** (`hooks.ts`): code picks one of `VIDEO_HOOKS` that fits the
  kind and the people rule (never hands in a no-people video), skipping the
  brand's last two (`meta.video_hook`), seeded by the job id so a retry keeps
  it. `meta.video_kind` is stored too. A followed Inspo recipe overrides it.
- **Words are drawn by code** (`overlay.ts` → `overlayWords` in
  `finish.server.tsx`): clips get `wordsByCode`, so the model never letters
  anything. A B-roll reel's hook line is held over the whole video; other
  kinds show each clip's phrase during that clip. A video made from a post, an
  offer (its card) and a motion post get no overlay.
- **Nothing invented** (`storyboardIssues`): besides unknown numbers and
  competitor names (now passed from `ctx.competitorNames`), a plan is refused
  for claims the brand never made (`unknownClaims`: #1, award-winning,
  clinically, proven, guaranteed, certified, organic, vegan...) and for
  readable words written into the footage. The prompt says the product's
  shape, features and what it does come only from its facts and photos.

## Picture → video

`repurposeTargets` offers these choices for a finished picture: Animate the
product (`product-motion`, 24 s), Product demo (`product-demo`, 16 s), Bring it
to life (`living-picture`, 16 s), Motion post (`videoMode: "recap"`,
`recapMotion: "camera"`, one photo, priced as `photo_recap`) and Story video
(`brand-story`, 24 s, opens on the post and ends back on it).

## Models and cost

Decision record [ADR-0043](../adr/0043-video-categories-and-motion.md).

- Every video key runs on KIE (`src/lib/ugc/models.ts`): Standard on Grok
  Imagine 1.5 (cost review 2026-11-12), Draft on Veo 3.1 Lite, Premium on
  Gemini Omni Flash 1.2 (first and last frame), Long on Wan 3.0 720p,
  Cinematic on MiniMax H3, and `animation` (Studio only) on Wan 3.0
  image-to-video. OpenRouter is the fallback, used only when KIE refuses for
  good. Standard and Premium have no OpenRouter model as cheap as their KIE
  one that still speaks the lines, so their fallbacks (Veo 3.1 Lite / Fast)
  cost more during a KIE outage; every other fallback costs the same or less.
- A composed video can use a different model per clip (`clips[].model` in
  `VideoRenderRequest`). Premium uses Omni for every clip: it is cheaper on
  KIE than any model that makes its 10 s follow-on clips.
- `VIDEO_MAX_USD_PER_JOB` (default $5) refuses a quote over the cap before
  anything is held.

## Sound

`src/lib/studio/audio/soundtrack.ts` (pure) and
`src/server/studio/audio/soundtrack.server.ts`: a voiceover of the
storyboard's exact words (ElevenLabs on KIE; whole lines only, as many as fit
at 2.5 words a second, the same brand always on the same voice) and an
instrumental music bed (Suno on KIE). `startSoundtrack` starts both while the
clips render, `collectSoundtrack` reads them, `meterSoundtrack` records the
cost once, `mixSoundtrack` ducks the music under the voice and brings the mix
to -14 LUFS. Every step fails open: the video keeps its own sound.
`VIDEO_SOUNDTRACK_ENABLED=false` turns it off.

## Motion graphics

`src/lib/studio/motion/` (pure) and `src/server/studio/motion/`:

- Opus (route `studio.motion.compose`) writes one HTML/SVG + CSS document with
  CSS `@keyframes` only, on a layout from `MOTION_LAYOUTS` and the craft rules
  in `principles.ts` (add rules there, never in the prompt).
- `staticIssues` refuses scripts, handlers, outside addresses, invented
  figures and claims, and slots with nothing to fill them. The real logo and
  photos are placed by code into `data-slot` images.
- `inspectMotion` lays the page out in Chromium (offline, no scripts) and
  `drawnIssues` checks the words on screen are the copy, inside the safe area,
  big enough, readable (contrast) and still for the last 1.5 s.
- A failed design is asked for once more with the reasons, then the piece
  fails plainly. `renderMotion` seeks every animation per frame at 30 fps and
  pipes the frames to FFmpeg. One drawing at a time per process.
- Priced as `motion_graphics` (90 credits). Live check:
  `tests/live/motion.live.ts` (behind `MOTION_LIVE_AI=yes`, needs FFmpeg).

## Plans

Premium (`video_premium`) is sold from Starter at its Video Credit price;
Cinematic is Agency and up, Full HD Growth and up. The composer shows a
lock and an upgrade toast; the server still checks.

Each plan has premium videos a month (`allowances.premiumVideos`: Free 0,
Starter 2, Growth 5, Agency 12, Scale 30; meter `premium_video`, never rolled
over). `videoChargePlan` spends one on a Premium, Cinematic or Long video of up
to 24 s, then credits. Free videos (Draft, Standard) are never spent on them.

## Flag and checks

- `FEATURE_FLAG_VIDEO_STORYBOARD_ENABLED` (with `_WS_<id>`), on unless `false`.
- Unit tests: `src/lib/studio/video/video.test.ts`,
  `src/server/ugc/providers/composition.server.test.ts`.
- Live check: `tests/live/studio-video.live.ts` (spends; behind
  `STUDIO_VIDEO_LIVE=yes`).
