# Mellox AI — Your brand. Built to grow.

Completely redesigned brand film: pure black, white typography, exact Ultra Moss #CBE960, Mellox SVG identity, and original product-focused copy. 1920 × 1080, 60 fps, 40.85 seconds. All graphics are drawn at 60 fps; no source video or countdown is used. The original requested audio master remains synchronized at zero.

## Preview

From this folder:

```powershell
npm run dev
```

Open http://127.0.0.1:4177. Space plays/pauses. Use the timeline or chapter buttons to inspect a scene. The preview draws directly from the audio clock without seeking video backgrounds.

Edit config.json to change headlines, supporting copy, chapter times, and palette. Saving reloads the composition at the current playhead. App/asset changes reload the preview automatically.

## Render

```powershell
npm run render
```

Output: output/mellox-black-brand-film-1080p60.mp4. H.264 CRF 15, limited-range BT.709 yuv420p, 60 fps, AAC 320 kb/s, fast-start metadata. The renderer uses JPEG quality 99 for its canvas frames. The source MP3 is not remixed, shortened, or time-stretched; AAC is a lossy final encode.

```powershell
npm run stills
python storyboard.py
python validate-output.py
```

The validator decodes all 2,451 frames, verifies frame timestamps and color metadata, and checks audio alignment/drift and continuity against the master. output/mellox-v2-storyboard.jpg shows all nine layouts.

To run elsewhere: use Node 20+, npm install, Chrome (or npx playwright install chromium), and FFmpeg with libx264. Set FFMPEG_PATH or CHROME_PATH for custom executable paths. In this workspace, the renderer finds the installed FFmpeg under ../video-clone/tools/imageio_ffmpeg/binaries/ automatically. Validation/storyboard scripts use the existing local Python tools or installed numpy, scipy and Pillow.

## Creative direction

The new story explains Mellox's actual workflow: Brand DNA, four brains, Content Studio, distribution, AI visibility and Autopilot. Product cards are custom motion illustrations, not captured screens or measured customer results. There are no invented growth metrics or ranking promises.

Google Sans Flex 400/500/600 carries the typography; Michroma 400 carries the wordmark. Mellox's canonical mark and four brain SVG geometries are copied from the codebase; brain icons are unified in Ultra Moss for the film. Fonts and OFL licenses are local in assets/fonts/.

timeline-spec.md contains the new scene/copy/motion specification. brand-notes.md records brand sources. The previous reference analysis is retained in analysis/, with the first timeline saved as analysis/reference-v1-timeline-spec.md. The rejected first render is kept privately under output/archive/ for recovery. Existing application files are unchanged.
