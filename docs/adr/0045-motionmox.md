# ADR-0045: MotionMox, Mellox's fork of Remotion, for people's own clips and photos

Status: accepted (2026-11-10). Supersedes ADR-0036's note that Remotion is not used.

## Context

"Brand my clips" and "Recap from my photos" (ADR-0036) keep the person's
footage exact and lay a designed opening PNG and an end card over it with
FFmpeg. When people asked for something to be added ("add our logo, captions
and a price tag", "end with Shop now"), the only answer was a still design that
fades in and out. We wanted those things animated, in the brand's colours,
without giving a model control of the video.

ADR-0036 turned Remotion down over its licence. Mellox has 3 or fewer people,
which the Remotion Free License covers.

## Decision

- **A fork, renamed.** The whole Remotion repository (tag `v4.0.542`) is
  cloned to `H:\MotionMox` and renamed MotionMox by `scripts/motionmox/rename.mjs`:
  packages `@motionmox/*`, the CLI `motionmox`, env vars `MOTIONMOX_*`, the
  product word in messages. API names stay the same. Three patches: no usage
  calls home, the machine's own Chromium, renders that can only reach
  loopback (`vendor/motionmox/MELLOX_PATCHES.md`). Only the built packages
  Mellox uses are copied into `vendor/motionmox/packages` (`sync.mjs`) and
  installed as `file:` dependencies. The fork is rebuilt and re-synced, never
  edited by hand.
- **The licence stays.** Remotion's `LICENSE.md` and copyright are in every
  vendored package, with a `NOTICE`. **When the team grows past 3 people,
  Mellox buys a Company License** and sets `MOTIONMOX_USAGE_EVENTS=true`.
  MotionMox is never sold or offered to customers as a tool.
- **Code shapes, MotionMox draws.** `src/lib/studio/motionmox/`: a zod
  `MotionMoxSpec` is the only input to a render; `planMotionMox` decides which
  elements appear, when and where (`elements.ts`, ids stored: add, never
  rename); `groundSpec` clamps every time and drops any words that aren't in
  the approved copy, the brand's name or words the person quoted. The model
  never writes a composition or a spec. A price, button or badge nobody wrote
  is left out with a plain note, never invented.
- **Wired into the existing render, not beside it.** `renderClipEdit` still
  downloads, cuts (`smart-cut`), joins and hears captions as before; MotionMox
  then draws the video (`src/server/studio/motionmox/render.server.ts`, one at
  a time, files on a token-guarded loopback server). If MotionMox fails, the
  FFmpeg path renders the same video, so nobody loses their piece. Assets
  record `renderer: "motionmox" | "ffmpeg"`.
- **What the person asks for** comes from the "Add to the video" chips
  (`controls.motionElements`), else from their brief (`elementsFromBrief`,
  string work only), so chat and MCP get it with no change.
- **Prices don't change** (`clip_brand`, `photo_recap`): MotionMox adds no
  model call. Asking for an animated headline even skips the image call for
  the designed opening.
- Flag `FEATURE_FLAG_MOTIONMOX_ENABLED` (with `_WS_<id>`), on unless `false`.
- Motion graphics (ADR-0043) stay on their HTML + Playwright path for now.

## Consequences

- The bundle is built once (`npm run motionmox:bundle`), never per render.
- The Docker image needs the vendored packages before `npm ci`, and the bundle
  copied into the runner.
- Upgrades are "clone the tag, rename, build, sync" (`vendor/motionmox/MELLOX_VENDOR.md`).
