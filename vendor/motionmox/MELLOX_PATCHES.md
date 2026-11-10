# What makes MotionMox different from Remotion

All of this is applied by `scripts/motionmox/rename.mjs` (tested in
`tests/motionmox-rename.test.ts`).

## Rename

- `remotion` → `@motionmox/core`, `@remotion/*` → `@motionmox/*`, wherever
  the name is a module (imports, `require`, package.json). Plain strings that
  only look like it (the compositor binary `remotion`, an FFmpeg argument)
  are left alone.
- CLI `remotion` → `motionmox` (also `motionmoxb`, `motionmoxd`).
- `remotion.config.*` → `motionmox.config.*`, `npx remotion` → `npx motionmox`.
- Env vars `REMOTION_*` → `MOTIONMOX_*`.
- The word "Remotion" in messages and docs → "MotionMox", except on lines that
  state a licence or copyright or link to the original project.
- API names stay the same (`useCurrentFrame`, `Composition`, `Sequence`,
  `interpolate`, `getRemotionEnvironment`...), so code written for Remotion
  works unchanged.

## Patches (each marked `MOTIONMOX-PATCH` in the source)

| Marker | File | What it does |
|---|---|---|
| `usage-off` | `licensing/src/register-usage-event.ts`, `get-usage.ts` | No calls to remotion.pro unless `MOTIONMOX_USAGE_EVENTS=true` (only with a Company License). |
| `system-browser` | `renderer/src/ensure-browser.ts`, `get-local-browser-executable.ts` | Uses `MOTIONMOX_BROWSER_EXECUTABLE` or `VISUAL_CAPTURE_BROWSER_PATH` (the Chromium the Dockerfile installs), so no browser is downloaded. |
| `offline` | `renderer/src/open-browser.ts` | Chromium resolves only `localhost` / `127.0.0.1`: a render can't reach the internet. `MOTIONMOX_OFFLINE=false` turns it off for debugging. |

## Mellox defaults (in `src/server/studio/motionmox/render.server.ts`)

h264, yuv420p, CRF 18, AAC, one render at a time, concurrency 1
(`MOTIONMOX_CONCURRENCY`), canvas sizes from `videoCanvas`.

## Not built or shipped

Lambda, Cloud Run, the Studio app's server, templates, docs and examples stay
in the fork's source but are not built into `packages/` here.
