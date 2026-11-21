# MotionMox (vendored, modified)

MotionMox is Mellox's **modified fork of Remotion** (https://github.com/remotion-dev/remotion).
Unlike `vendor/image-metadata-toolkit`, this copy **is** changed. Every change is
made by `scripts/motionmox/rename.mjs`, never by hand.

| | |
|---|---|
| Upstream | `remotion-dev/remotion` |
| Tag | `v4.0.542` (stay on 4.x: Remotion 5.0 changes the licence) |
| Commit | `8fe67926dca6a9829622b281769da8097ef81fcf` (2026-11-09) |
| Full fork | `H:\MotionMox` on the main dev machine (too big for this drive) |
| Here | only the built packages Mellox uses, in `packages/` |

## Licence

Remotion's licence (`LICENSE.md`, copied into every package) still applies to
this code, and its copyright stays. Mellox uses the **Free License**: it has 3
or fewer people (decided 2026-11-10). **Once the team is larger than 3, Mellox
needs a Remotion Company License** (remotion.pro); with one, set
`MOTIONMOX_USAGE_EVENTS=true` so usage is reported as that licence asks.
MotionMox itself is never sold, licensed or offered to customers as a tool:
Mellox sells the videos it makes. See `NOTICE` and ADR-0045.

## Upgrade (or rebuild)

```bash
git clone --depth 1 --branch v4.0.<n> https://github.com/remotion-dev/remotion.git H:\MotionMox
node scripts/motionmox/rename.mjs --root H:\MotionMox   # rename + Mellox patches, writes a report
node scripts/motionmox/build.mjs  --root H:\MotionMox   # bun install + turbo make (temp on H:)
node scripts/motionmox/sync.mjs   --root H:\MotionMox   # copy built packages here
npm install                                             # relinks the file: dependencies
npm run motionmox:bundle                                # the compositions' bundle
```

A rename patch whose anchor no longer matches stops the script: read the
upstream change and update the patch in `rename.mjs`.

What is renamed and patched: `MELLOX_PATCHES.md`.
