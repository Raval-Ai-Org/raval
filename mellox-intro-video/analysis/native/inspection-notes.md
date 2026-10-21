# Native-frame inspection notes

Reference video is 1920×1080 at 30 fps. Native indexes below are zero-based (`index / 30 = seconds`). The video decodes to 1,223 frames (40.766667 seconds of frame coverage). Audio lasts 40.8439 seconds, so keep the final logo visible through the audio tail.

## Verified entry boundaries

| Event | First native frame | Start seconds | Last preceding state |
|---|---:|---:|---|
| First visible `H` of `Hello!` | 38 | 1.266667 | Frame 37: stripes without text |
| Complete `Hello!` | 41 | 1.366667 | Frame 40: partially revealed final glyph |
| `Hello!` starts deleting | 51 | 1.700000 | Frame 50: complete word |
| `Countdown` word zoom entrance | 765 | 25.500000 | Frame 764: `The` |
| Gold 3D countdown plate | 772 | 25.733333 | Frame 771: `Countdown` |
| Reference logo plate | 1103 | 36.766667 | Frame 1102: zero numeral edge |

The gold countdown enters edge-on, rotates toward the camera, settles front-facing, then rotates away for the next numeral. `10` is readable around frame 774 (25.800000 seconds). The final reference logo begins edge-on/small, rotates and grows to face the camera, then holds.

## Timing and sampling

The original 4 fps extraction used ffmpeg's default `round=near`, which selects imagery from near the end of each nominal 250 ms bin (for example nominal 1.250 seconds selected native frame 41 at 1.366667 seconds). `analyze.py` now uses `round=up`, selecting the native frame at or before the nominal output timestamp. Its `frame-index.csv` records both the nominal output timestamp and actual native source frame/time for this constant-frame-rate reference. Native frame files and refined CSVs are the authority for 33.333 ms visual boundaries.

`typography-cut-candidates.csv` contains 91 change candidates through 25.8 seconds, with background cuts/flashes and center-glyph animation changes. Each candidate has before/at/after images in `candidate-sheets/`. Candidate rows identify signal-change peaks, which can occur during a text entrance rather than on its first visible frame. Inspect `source-frames/source_NNNN.jpg` to confirm semantic boundaries.

The source's early and middle typography sits over solid vignette or animated grayscale stripe backgrounds. White scenes reverse the text to charcoal. The last rapid `Let's / Begin / The / Countdown` sequence uses a large zoom from beyond the frame, directional/radial blur for approximately 2 frames, and a sharp settle into the center. It alternates dark vignette and white backgrounds. There is no live action footage in the inspected typography portion.

`audio-onset-estimates.csv` and the waveform are valid automated signal-analysis outputs. They label transient estimates at 5 ms measurement resolution; they do not establish the semantic identity or exact start of every sound effect. Audio is silent to about 1.369615 seconds and again after about 40.669342 seconds (−40 dB threshold, ≥50 ms).
