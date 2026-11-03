# Saved reference analysis

These small analysis artifacts were copied from `video-clone/temp/` after native-frame refinement. Source videos, raw frame sequences and contact-sheet images remain in the reference workspace; they are not duplicated here.

- `metadata.json`: source dimensions, frame rate, container duration and review-extraction settings.
- `analysis.json`: aggregated media, scene-change and audio analysis. Some provenance paths still point to the original temporary workspace.
- `frame-index.csv`: **current 164-image `fps=4:round=up` extraction**, with nominal output timestamp and actual selected zero-based native source frame/time. This is not the legacy 163-image extraction used for the first-pass timeline table.
- `audio-onset-estimates.csv` / `.json`: transient candidates measured at 5 ms resolution. They are estimates, not a semantic identification of every effect or beat.
- `audio-silence.json` / `.log`: initial and ending silence measurements.
- `waveform.png`: amplitude overview of the reference audio.
- `scene-cut-candidates.csv` / `.log`: automatic whole-picture change candidates, requiring visual interpretation.
- `native/inspection-notes.md`: native visual inspection findings, verified section boundaries, timing/sampling notes and precision limits.
- `native/summary.json`: 30 fps, 1223 native picture count, and 91 typography signal-change candidates.
- `native/native-frame-metrics.csv`: native-picture change measurements.
- `native/typography-cut-candidates.csv` / `.json`: native-frame typography signal-change candidates. A peak can occur during the animation rather than at the first visible glyph.
- `implemented-cues.csv`: snapshot generated from `../config.json` for the implemented cue table in `../timeline-spec.md`; regenerate if cue timings change.

All source frame indexes are zero-based. Seconds = native index / 30. Output is 60 fps, so native frame anchors map to output frame index ×2. The final rendered lockup holds beyond the last source picture to preserve the complete 40.8439-second audio track in the 40.85-second / 2451-frame output.
