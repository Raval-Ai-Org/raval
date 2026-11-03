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
   `redoComposedClips` (one round, Mellox's cost). Still failing → the job
   fails with `NOT_DELIVERED_MESSAGE` and the hold is released.
5. **Ending** (`finish.server.tsx`). `back-to-source` dissolves to the exact
   post; `end-card` adds a card drawn with next/og.

## Kinds

| Kind | Made by | Joins | Ends on |
| --- | --- | --- | --- |
| `living-picture` | AI, one clip | single | the exact post |
| `motion-post` | code (recap camera path), no AI | — | the post |
| `product-showcase` | AI | chain | hero frame |
| `brand-story` | AI | chain | payoff + end card |
| `how-it-works` | AI | chain | result |
| `before-after` | AI | chain | the after |
| `mood-broll` | AI | cut (dissolve) | hero frame |
| `offer-teaser` | AI + code card | chain | exact offer card |
| `product-motion` | AI, no people | chain | the picture / hero frame |
| `product-demo` | AI, hands only | chain | product at rest |
| `broll-hook` | AI + code words | cut (dissolve) | hero frame, hook line held throughout |

Ids are stored on jobs: add, never rename. A person talking to the camera is
a Creator (UGC) video.

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
to life (`living-picture`, 8 s), Motion post (`videoMode: "recap"`,
`recapMotion: "camera"`, one photo, priced as `photo_recap`) and Story video
(`brand-story`, 16 s, opens on the post and ends back on it).

## Plans

Premium (`video_premium`) is sold from Starter at its Video Credit price;
Cinematic is Agency and up, Full HD Growth and up. The composer shows a
lock and an upgrade toast; the server still checks.

## Flag and checks

- `FEATURE_FLAG_VIDEO_STORYBOARD_ENABLED` (with `_WS_<id>`), on unless `false`.
- Unit tests: `src/lib/studio/video/video.test.ts`,
  `src/server/ugc/providers/composition.server.test.ts`.
- Live check: `tests/live/studio-video.live.ts` (spends; behind
  `STUDIO_VIDEO_LIVE=yes`).
