# MotionMox in Studio

MotionMox is Mellox's modified fork of Remotion (ADR-0045). Studio uses it to
finish a person's own clips ("Brand my clips") and photos ("Recap from my
photos") with animated elements.

## How a video is made

1. `renderClipEdit` (`src/server/studio/clip-edit/render.server.ts`) downloads
   the clips or photos, cuts each clip (`smart-cut.ts`), makes the end card and,
   when asked, the designed opening. FFmpeg joins the pieces, which gives the
   timeline captions are heard on and the fallback video.
2. `planMotionMox` (`src/lib/studio/motionmox/plan.ts`) decides the elements,
   and `groundSpec` (`spec.ts`) checks the result.
3. `renderMotionMox` (`src/server/studio/motionmox/render.server.ts`) renders
   the `mellox-video` composition (`compositions/MotionMoxVideo.tsx`) from the
   pre-built bundle, serving the render's files on `127.0.0.1` with a token.
4. FFmpeg brings the sound to -14 LUFS, and the video is saved as before.
5. If step 2 or 3 fails, the FFmpeg path renders the piece, and the designed
   opening is made then if it was skipped.

## Elements (`elements.ts`)

| id | chip | words from |
|---|---|---|
| `headline` | Headline | the "Headline" copy line |
| `lower-third` | | another copy line |
| `captions` | Captions (brand only) | what is heard (whisper.cpp / `studio.transcribe`) |
| `logo-bug` | Logo | the real logo, placed by code |
| `price-tag` | Price | a copy line or quoted phrase with a price in it |
| `badge` | | a short copy line or quoted phrase |
| `cta` | Button | a quoted phrase or a copy line like "Shop now" |
| `end-card` | End card | the designed end card |
| `progress-bar` | | none |

Nothing picked means `elementsFromBrief` reads the description. The logo, the
end card and heard captions are always kept.

## Commands

```bash
node scripts/motionmox/rename.mjs --root H:\MotionMox
node scripts/motionmox/build.mjs  --root H:\MotionMox
node scripts/motionmox/sync.mjs   --root H:\MotionMox
npm run motionmox:bundle
```

`/motionmox-lab` plays the composition with sample data in every ratio
(development only; `tests/integration/motionmox-lab.spec.ts`).

## Checks

- `tests/motionmox-render.test.ts`: a real render, behind `MOTIONMOX_RENDER_TEST=yes`.
- `tests/live/motionmox.live.ts`: a real "Brand my clips" job through
  `renderClipEdit` (real storage, the paid end card), behind
  `MOTIONMOX_LIVE_AI=yes`. It checks `renderer: "motionmox"` and removes what
  it stored.

## Environment

| var | meaning |
|---|---|
| `FEATURE_FLAG_MOTIONMOX_ENABLED` (`_WS_<id>`) | off: FFmpeg only |
| `MOTIONMOX_BROWSER_EXECUTABLE` / `VISUAL_CAPTURE_BROWSER_PATH` | Chromium to use |
| `MOTIONMOX_BUNDLE_DIR` | the bundle (default `.motionmox-bundle`) |
| `MOTIONMOX_CONCURRENCY` | frames in parallel (default 1) |
| `MOTIONMOX_OFFLINE=false` | let renders reach the internet (debugging only) |
| `MOTIONMOX_USAGE_EVENTS=true` | only with a Remotion Company License |
