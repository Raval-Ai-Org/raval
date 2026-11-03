# Reference timeline and Mellox adaptation

The first-pass visual specification was prepared before animation implementation by inspecting **163 images from an initial default-rounding extraction**. Those contact sheets have since been regenerated as **164 images using `fps=4:round=up`**. The legacy first-pass evidence table below is preserved as inspection history; its numbered evidence indexes and nominal sample appearances **do not exactly match the regenerated current sheet files**. The native-frame implementation cue table at the end of this document supersedes the legacy timing estimates. Reference: https://youtu.be/36wf2HBD3GE.

## Measurement and precision

- Source metadata: 1920 × 1080, **30 fps**, H.264/AAC (`video-clone/temp/metadata.json`). Refined media analysis decoded **1223 native pictures**, for a picture duration of **40.766667 seconds**, and measured the extracted audio duration as **40.843900 seconds**. The container's approximate 40.84-second duration is not the native picture duration. Output target: 1920 × 1080, **60 fps, 2451 frames / 40.850000 seconds**, preserving the audio tail after the last source picture.
- Review image `frame_NNNN.jpg` is labeled with the nominal **4 fps output** timestamp **(NNNN − 1) / 4** seconds. The original `ffmpeg fps=4` extraction used default rounding: labels are not the exact timestamp of the selected native source picture. Analyst inspection finds selection around **+0.116 seconds** relative to these nominal labels in the original sheets. The 0.25-second review spacing establishes **250 ms review bins**, not exact native cut boundaries; do not apply the labels directly as source boundaries. The coarse tables below record the first nominal review label where each state is visible. Use native source-frame checks to supersede these estimates. End labels are exclusive next-state boundaries in the review sequence.
- A source picture can only establish a visual boundary to **33.333 ms** (one 30 fps source frame), even when the output runs at 60 fps. Exact original easing curves cannot be recovered from pictures; curve descriptions and suggested motion are explicitly **estimates**.
- **Confirmed native cuts:** countdown begins at native source frame **772 / 30 = 25.733333 seconds**; the final source logo begins at native source frame **1103 / 30 = 36.766667 seconds**. They map exactly to 60 fps output frames **1544** and **2206**. The implemented chapter changes use **278 / 30 = 9.266667 seconds** and **491 / 30 = 16.366667 seconds**, from the refined native-frame cue map. The earlier 9.200000/16.166667 editorial estimates below are superseded.
- **Confirmed opening text:** the first H begins at source frame **38 / 30 = 1.266667 seconds**, full `Hello!` is visible at frame **41 / 30 = 1.366667 seconds**, and its exit begins at frame **51 / 30 = 1.700000 seconds**. This also demonstrates why the nominal 1.250-second review image label must not be treated as its exact source picture timestamp.
- `scene-cut-candidates.csv` contains image-difference candidates, not a verified list of every cut. Example candidates include 4.333333, 5.866667, 6.100000, 9.566667, 10.733333, 13.166667 and 16.100000 seconds. A changing background or letter can also trigger a candidate.

## Visual and motion vocabulary

**D — dark card:** solid black edges with a very subtle charcoal radial/overhead gradient concentrated in the upper center. Text is white, bold sans, centered in the frame. Text usually types on or cuts on in a few frames; a partly exposed trailing glyph appears gray before becoming white. Most words hold with little camera movement. Exits are hard cuts to the next word/card.

**W — light card:** near-white active picture with black letterbox bands at the top and bottom before the countdown section. Dark gray/black centered text, usually hard cuts or a short type-on reveal. A white flash occasionally occupies the active picture without words. The source does not contain documentary/moving camera footage under these text scenes.

**S — stripe card:** vertical grayscale strips of unequal widths across the active picture, mirrored/darkening toward the edges. A narrow bright strip or dark strip moves laterally across the center; the word follows/inverts against the current strip. Some strips smear briefly during motion. Movement is a graphic wipe/translation, not a camera pan over real footage. Estimate 100–200 ms smooth ease-out for each strip relocation; preserve the reference transition anchors when refining.

**I — inverted word boxes:** small rectangular highlight boxes immediately behind each word, no pill rounding. White boxes/black letters on dark cards (`Save your time`) or black boxes/white letters on white (`have something for YOU.`). Words reveal sequentially and the line remains horizontally centered; previous words sometimes turn gray.

**Z — zoom pop:** extremely large type enters from camera depth/overscale, with horizontal/radial blur and pseudo-extruded copies, then snaps down to normal centered text. A fast exponential ease-out over roughly 100–200 ms is an implementation estimate; there is no evidence for a long elastic bounce.

**C — countdown plate:** full-frame studio-gray radial background/floor, standing dark numerals with metallic gold bevels/extrusion, a floor shadow, a bright soft highlight behind the numeral and a slight yaw rotation around the vertical axis. Preserve the actual moving source plate for this section. The number faces front during most of each second and turns through an angled view before the next digit.

The Mellox version recolors the dark cards/stripes into existing navy `#020D16`/`#0A0F13`, uses white or light gray type, and replaces selected light-card/highlight moments with Ultra Moss `#CBE960`. Google Sans Flex is the kinetic type; Michroma 400 is the final wordmark. Any countdown hue treatment should preserve numeral readability and the floor lighting. The source logo must be removed by rebuilding its plain radial background when the Mellox final lockup appears.

## Legacy first-pass visible text cuts, 4 fps review bins

“Start” is the first nominal sample label where the text state appeared in the **initial 163-image default-round extraction**. Each row also records in-row builds so partial typewriter glyphs are not mistaken for separate scenes. These are **legacy coarse visual estimates**, superseded by the native-frame cue table below. Current regenerated sheets use different frame-selection rounding, so the evidence column is a record of the original pass, not a locator for identical imagery in the current 164-image sheets. Refined inspection confirmed the brief word as **Way** at 5.866667 seconds and **Suppress** at 22.066667 seconds.

| Start s | End s | Original text / build | Frame evidence | Background and entrance/exit |
|---:|---:|---|---|---|
| 0.000 | 1.250 | No text | 0001–0005 | Black fades into very dark vertical strips; strip contrast gradually rises. |
| 1.250 | 1.750 | `Hello!` | 0006–0007 | S; black type on narrow white center column. Native refinement: first H 1.266667, full word 1.366667, exit begins 1.700000. Strip closes/repositions on exit. |
| 1.750 | 2.500 | `Are` (`Ar` visible at 1.750) | 0008–0010 | S; white text on dark center band, short trailing-letter reveal. |
| 2.500 | 3.000 | `You` | 0011–0012 | S; black text on bright narrow central strip, stripe wipe. |
| 3.000 | 3.250 | `Ready?` | 0013 | S; white type on dark central band, hard cut out. |
| 3.250 | 3.750 | `LET` → `LET’S` at 3.500 | 0014–0015 | D; upper-case type-on, normal centered scale. |
| 3.750 | 4.250 | `LET’S GO` | 0016–0017 | D; adds GO, small centered hold, cuts to brighter stripes. |
| 4.250 | 5.000 | `Better,` (`Bet` partial at 4.250) | 0018–0020 | S; pale/white strip field, dark type, letter reveal. |
| 5.000 | 5.250 | `Better, faster,` | 0021 | S; adds word, dark/white foreground alternates over moving strip. |
| 5.250 | 5.750 | `Better, faster, smarter.` (partial `sma` at 5.250) | 0022–0023 | S; expanding centered line, lateral gray stripe shift; hard cut. |
| 5.750 | 6.000 | `Way` (initial sample exposes only `W`) | 0024 | D; type-on. Refined native inspection confirms `Way`, implemented anchor frame 176 / 30 = 5.866667. |
| 6.000 | 6.250 | Blank white flash | 0025 | W; abrupt luminance flash. |
| 6.250 | 6.500 | `To earn` | 0026 | W; dark bold centered type, hard cut. |
| 6.500 | 6.750 | `To Grow` | 0027 | D; smaller white centered type, hard cut. |
| 6.750 | 7.000 | `To Show` | 0028 | D; same position/size, hard replacement. |
| 7.000 | 7.250 | `Your` | 0029 | D; hard replacement. |
| 7.250 | 7.750 | `Talent` | 0030–0031 | D; short hold. |
| 7.750 | 8.000 | `And` | 0032 | W; oversized dark text pop, short hold. |
| 8.000 | 8.250 | `To` | 0033 | W; smaller text after previous large word. |
| 8.250 | 8.750 | `Save` | 0034–0035 | D + I; black word in white rectangular box. |
| 8.750 | 9.000 | `Save your` | 0036 | D + I; second word box added. |
| 9.000 | 9.250 | `Save your time` | 0037 | D + I; third word box added, hard exit. Final implementation changes to Scene 2 at source frame 278 / 30 = 9.266667. |
| 9.250 | 9.500 | `We` | 0038 | D; much larger white centered text, scale emphasis. |
| 9.500 | 10.000 | `have` (`ha` at 9.500, `have` at 9.750) | 0039–0040 | W + I; black box/white letters, typing cursor at line end. |
| 10.000 | 10.250 | `have something` | 0041 | W + I; word-by-word box build. |
| 10.250 | 10.500 | `have something for` | 0042 | W + I; adds for, recentered line. |
| 10.500 | 10.750 | `have something for YOU.` | 0043 | W + I; emphatic final uppercase box, hard cut. |
| 10.750 | 11.000 | `We` | 0044 | D; enlarged centered word. |
| 11.000 | 11.250 | `Are` | 0045 | D; scale drops to normal word. |
| 11.250 | 11.750 | `Launching` | 0046–0047 | D; normal centered type and hold. |
| 11.750 | 12.000 | `A Platform` | 0048 | D; same center, wider phrase. |
| 12.000 | 12.250 | `For` | 0049 | W; flash/cut inversion. |
| 12.250 | 12.500 | `You` | 0050 | D; inversion back, hard cut. |
| 12.500 | 12.750 | `To` | 0051 | W; black-to-gray trailing reveal. |
| 12.750 | 13.000 | `To Earn` | 0052 | W; type-on second word. |
| 13.000 | 13.250 | `To Earn Money` | 0053 | W; third word expands line. |
| 13.250 | 13.500 | `Don’t` | 0054 | S; black on a narrow bright strip. |
| 13.500 | 14.000 | `lose` | 0055–0056 | S; white on dark strip, sideways smearing during change at 13.750. |
| 14.000 | 14.250 | `your` | 0057 | S; black on bright strip, wipe. |
| 14.250 | 14.500 | `time!` | 0058 | S; white on dark central strip, hard exit. |
| 14.500 | 15.000 | `Be` (`B` at 14.500) | 0059–0060 | D; letter reveal, short hold. |
| 15.000 | 15.250 | `With` | 0061 | D; hard cut. |
| 15.250 | 15.500 | `Us` | 0062 | W; inverted card. |
| 15.500 | 15.750 | `and` | 0063 | D; hard replacement. |
| 15.750 | 16.000 | `You’re` | 0064 | D; hard replacement. |
| 16.000 | 16.250 | `Gonna` (blurred in sample) | 0065 | W + Z; huge horizontal/radial blur letters rushing through camera depth. Final implementation changes to Scene 3 / Grow cue at source frame 491 / 30 = 16.366667. |
| 16.250 | 16.750 | `Grow` | 0066–0067 | D + Z; frame 16.250 is enormous extruded white word cropped by both sides, settles to medium centered word by 16.500. |
| 16.750 | 17.000 | `Super` | 0068 | W; medium-large bold word. |
| 17.000 | 17.250 | `Fast` | 0069 | D; larger white text, hard replacement. |
| 17.250 | 17.500 | `A` | 0070 | W; large single letter. |
| 17.500 | 18.000 | `A Platform` → `A Platform to` at 17.750 | 0071–0072 | W; word buildup with previous letters gray and new letters darker. |
| 18.000 | 18.250 | `Grow` | 0073 | D; enlarged white emphasis. |
| 18.250 | 18.500 | `in` | 0074 | D; normal size. |
| 18.500 | 19.000 | `Your` | 0075–0076 | D; short hold. |
| 19.000 | 19.250 | `Field` | 0077 | W; normal centered bold. |
| 19.250 | 19.500 | `by` | 0078 | W; hard word replacement. |
| 19.500 | 19.750 | `Ads` | 0079 | W; hard word replacement. |
| 19.750 | 20.000 | `We` | 0080 | D; type-on/gray trailing letter. |
| 20.000 | 20.250 | `We guarantee` | 0081 | D; We turns gray, guarantee reveals white. |
| 20.250 | 20.500 | `We guarantee You.` | 0082 | D; previous words gray, You. white. |
| 20.500 | 20.750 | `Your` | 0083 | S; dark word on bright moving strip. |
| 20.750 | 21.000 | `Your Benefit` | 0084 | S; second word white on darker strip. |
| 21.000 | 21.250 | `Your Benefit To 100%` | 0085 | S; line spans several strips, moving/inverted contrast. |
| 21.250 | 21.500 | `NO` | 0086 | W; very large uppercase emphasis. |
| 21.500 | 21.750 | `Compromises` | 0087 | D; normal centered word. |
| 21.750 | 22.000 | `Don’t` (last letter partly exposed) | 0088 | D; short type-on. |
| 22.000 | 22.250 | `Suppress` (initial sample exposes only `Sup`) | 0089 | W; refined native inspection confirms `Suppress`, implemented anchor frame 662 / 30 = 22.066667. |
| 22.250 | 22.500 | `Your` | 0090 | D; hard replacement. |
| 22.500 | 22.750 | `Creativity` (sample exposes `Creativi`) | 0091 | W; type-on, final letters incomplete at sampled instant. |
| 22.750 | 23.000 | `So` (sample exposes gray trailing letter) | 0092 | D; short type-on. |
| 23.000 | 23.250 | Blank dark interval | 0093 | D; no visible text. |
| 23.250 | 23.500 | `Are` | 0094 | D; hard entrance. |
| 23.500 | 23.750 | `You` | 0095 | D; hard replacement. |
| 23.750 | 24.000 | `Ready` | 0096 | D; hard replacement. |
| 24.000 | 24.250 | `For` | 0097 | D; hard replacement. |
| 24.250 | 24.500 | `The Best` | 0098 | W; enlarged type with short motion blur on entrance. |
| 24.500 | 25.000 | `Let’s` | 0099–0100 | D + Z; enormous extruded/cropped word at 24.500, settles to small centered word by 24.750. |
| 25.000 | 25.250 | `Begin` | 0101 | W; large centered dark text. |
| 25.250 | 25.500 | `The` | 0102 | D; large centered white text. |
| 25.500 | 25.733333 | `Countdown` | 0103 | W; large dark text, hard cut to 3D studio plate at confirmed native frame 772. Start remains a nominal review label. |

## 3D countdown and logo

Only the **countdown start 25.733333** and **logo start 36.766667** below are native-frame-confirmed. Interior per-digit boundaries are provisional one-second estimates, anchored to that confirmed start, and require native source-frame review; they must not be described as exact. The original 4 fps review labels include the extraction rounding offset described above. Each digit holds front-facing, yaws to reveal gold extruded sides around the last third of its second, then changes digit. Keeping the original source plate continuously from frame 772 through frame 1102 preserves the actual 3D geometry, shadows, camera/perspective, digit animation and pacing without requiring estimated digit-boundary reconstruction.

| Source span s | 30 fps frames, start–exclusive end | 60 fps frames, start–exclusive end | Visible content and evidence / certainty |
|---|---|---|---|
| 25.733333–~26.733333 | **772 confirmed**–~802 | **1544 confirmed**–~1604 | 10; review 0104–0107. Angled on entrance/exit, front near nominal review 26.000/26.250. Interior end estimated. |
| ~26.733333–~27.733333 | ~802–~832 | ~1604–~1664 | 9; review 0108–0111. Both internal bounds estimated. |
| ~27.733333–~28.733333 | ~832–~862 | ~1664–~1724 | 8; review 0112–0115. Estimated. |
| ~28.733333–~29.733333 | ~862–~892 | ~1724–~1784 | 7; review 0116–0119. Estimated. |
| ~29.733333–~30.733333 | ~892–~922 | ~1784–~1844 | 6; review 0120–0123. Estimated. |
| ~30.733333–~31.733333 | ~922–~952 | ~1844–~1904 | 5; review 0124–0127. Estimated. |
| ~31.733333–~32.733333 | ~952–~982 | ~1904–~1964 | 4; review 0128–0131. Estimated. |
| ~32.733333–~33.733333 | ~982–~1012 | ~1964–~2024 | 3; review 0132–0135. Estimated. |
| ~33.733333–~34.733333 | ~1012–~1042 | ~2024–~2084 | 2; review 0136–0139. Estimated. |
| ~34.733333–~35.733333 | ~1042–~1072 | ~2084–~2144 | 1; review 0140–0143. Estimated. |
| ~35.733333–36.766667 | ~1072–**1103 confirmed** | ~2144–**2206 confirmed** | 0; review 0144–0147. Start estimated, end confirmed. |
| 36.766667–40.850000 output end | **1103 confirmed**–1223 source end | **2206 confirmed**–2451 output end | Original ADD ASIA logo, seen angled at nominal review 36.750 then nearly frontal and holding from 37.000 onward; review 0148–0163. Replace with Mellox mark plus Michroma “Mellox AI”. Rebuild background to remove the source logo cleanly. Estimate a 150–300 ms Y rotation/scale settle, then hold. Native pictures end at 40.766667; hold the final rendered lockup through 40.850000 to retain the complete audio tail. |

## Replacement text mapping

The three provided lines are literal placeholders and must remain editable, including their square brackets. Preserve the reference micro-cuts within each chapter by revealing/repeating/reframing the chapter's replacement text rather than leaving the original claims visible. The final lockup is exact supplied text.

| Chapter | Seconds | Output frames | Exact copy |
|---|---|---|---|
| Scene 1 | 0–9.266667 | 0–556 | `[INSERT LINE 1]` |
| Scene 2 | 9.266667–16.366667 | 556–982 | `[INSERT LINE 2]` |
| Scene 3 | 16.366667–25.733333 | 982–1544 | `[INSERT LINE 3]` |
| Countdown | 25.733333–36.766667 | 1544–2206 | Retain 10…0 numerals on the source moving plate; both source-layer endpoints confirmed. |
| Final | 36.766667–40.850000 | 2206–2451 | `Mellox AI`, with canonical `assets/mellox-logo.svg`; hold through the full audio tail. |

## Audio synchronization

Use `video-clone/temp/ref_audio.mp3` as the unchanged, full-length master soundtrack beginning at timeline zero. Render the visuals against this master; do not regenerate or replace the original effects. A visual review alone cannot identify the exact onset of every effect.

`audio-onset-estimates.csv` / `.json` contain measured transient candidates at 5 ms analysis resolution, explicitly labeled estimates, with relative strengths and novelty peaks. First candidates: 1.395, 2.005, 2.615, 3.075 and 3.535 seconds. These are candidates, not proof that each event is an isolated beat or SFX. Overlapping music and effects cannot be completely segmented by a peak detector.

Silence detection reports initial silence 0–1.369615 seconds and ending silence 40.669342–40.843900 seconds (`audio-silence.json`). `waveform.png` supports visual amplitude review. Audio measurement resolution does not increase the 30 fps source picture precision. Preserve complete audio timing and avoid claiming millisecond-perfect recovered easing or semantic sound-event labels without verification.

## Implementation priorities and limits

1. Preserve the source audio and exact source countdown footage interval so both retain reference pacing.
2. Rebuild the simple dark, white, stripe and inversion graphics with Mellox fonts/colors; this removes original text cleanly.
3. Anchor every graphic transition to refined source-frame boundaries. Curves remain estimated from source motion, with short type-on reveals, hard rhythmic cuts, stripe wipes and fast overscale settles.
4. Do not use a blanket source-video layer behind replacement text during typography sections; moving original words would show through. The countdown plate is the useful retained motion footage.
5. Source is 30 fps, so retained footage repeats/interpolates source pictures in a 60 fps output; recreating graphic overlays at 60 fps improves their smoothness but cannot add genuinely observed source frames.

## Implemented native-frame cue map

This table is generated from the current `config.json` cues and supersedes the legacy review-bin timings. Source-frame anchors come from the native candidate-sheet visual inspection and the confirmed transitions recorded in `analysis/native/inspection-notes.md`. Several type-on entry anchors are estimated within **one or two source frames**; a signal-change candidate is not automatically the first visible glyph. Countdown and logo section endpoints, and the opening H/full-word/delete frames, are explicitly confirmed as described above. Original easing remains unrecoverable; the implementation uses visually estimated 0.12-second text/zoom reveals, expo-out zoom settling and a 0.34-second final lockup settle. These values are editable in `config.json`.

`stripes` reuses a clean source scanline above the original text, stretches the vertically uniform bands over the active picture, and recolors it into navy/Ultra Moss. `dark` reconstructs the navy vignette. `lime` replaces the reference white graphic card with the brand lime card. `plate` retains the graded source 3D countdown continuously. The final `logo` cue rebuilds the background and draws only the Mellox SVG/wordmark. Source-copy names below identify reference pacing cues; rendered copy comes from the three exact editable replacement lines.

| Native source frames, start–exclusive end | Seconds, start–exclusive end | 60 fps output frames, start–exclusive end | Render background | Motion | Reference pacing cue |
|---|---|---|---|---|---|
| 0–38 | 0.000000–1.266667 | 0–76 | stripes | blank | `Opening` |
| 38–55 | 1.266667–1.833333 | 76–110 | stripes | type | `Hello!` |
| 55–73 | 1.833333–2.433333 | 110–146 | stripes | type | `Are` |
| 73–89 | 2.433333–2.966667 | 146–178 | stripes | type | `You` |
| 89–99 | 2.966667–3.300000 | 178–198 | stripes | type | `Ready?` |
| 99–110 | 3.300000–3.666667 | 198–220 | dark | build | `LET'S` |
| 110–130 | 3.666667–4.333333 | 220–260 | dark | build | `LET'S GO` |
| 130–146 | 4.333333–4.866667 | 260–292 | stripes | build | `Better,` |
| 146–161 | 4.866667–5.366667 | 292–322 | stripes | build | `Better, faster,` |
| 161–176 | 5.366667–5.866667 | 322–352 | stripes | build | `Better, faster, smarter.` |
| 176–183 | 5.866667–6.100000 | 352–366 | dark | type | `Way` |
| 183–193 | 6.100000–6.433333 | 366–386 | lime | build | `To earn` |
| 193–203 | 6.433333–6.766667 | 386–406 | dark | pop | `To Grow` |
| 203–211 | 6.766667–7.033333 | 406–422 | dark | type | `To Show` |
| 211–220 | 7.033333–7.333333 | 422–440 | dark | type | `Your` |
| 220–230 | 7.333333–7.666667 | 440–460 | dark | type | `Talent` |
| 230–238 | 7.666667–7.933333 | 460–476 | lime | type | `And` |
| 238–249 | 7.933333–8.300000 | 476–498 | lime | type | `To` |
| 249–259 | 8.300000–8.633333 | 498–518 | dark | boxes | `Save` |
| 259–268 | 8.633333–8.933333 | 518–536 | dark | boxes | `Save your` |
| 268–278 | 8.933333–9.266667 | 536–556 | dark | boxes | `Save your time` |
| 278–287 | 9.266667–9.566667 | 556–574 | dark | pop | `We` |
| 287–297 | 9.566667–9.900000 | 574–594 | lime | boxes | `have` |
| 297–306 | 9.900000–10.200000 | 594–612 | lime | boxes | `have something` |
| 306–313 | 10.200000–10.433333 | 612–626 | lime | boxes | `have something for` |
| 313–322 | 10.433333–10.733333 | 626–644 | lime | boxes | `have something for YOU.` |
| 322–331 | 10.733333–11.033333 | 644–662 | dark | pop | `We` |
| 331–340 | 11.033333–11.333333 | 662–680 | dark | type | `Are` |
| 340–349 | 11.333333–11.633333 | 680–698 | dark | type | `Launching` |
| 349–358 | 11.633333–11.933333 | 698–716 | dark | build | `A Platform` |
| 358–367 | 11.933333–12.233333 | 716–734 | lime | type | `For` |
| 367–376 | 12.233333–12.533333 | 734–752 | dark | type | `You` |
| 376–383 | 12.533333–12.766667 | 752–766 | lime | build | `To` |
| 383–390 | 12.766667–13.000000 | 766–780 | lime | build | `To Earn` |
| 390–395 | 13.000000–13.166667 | 780–790 | lime | build | `To Earn Money` |
| 395–406 | 13.166667–13.533333 | 790–812 | stripes | type | `Don't` |
| 406–418 | 13.533333–13.933333 | 812–836 | stripes | type | `lose` |
| 418–427 | 13.933333–14.233333 | 836–854 | stripes | type | `your` |
| 427–437 | 14.233333–14.566667 | 854–874 | stripes | build | `time!` |
| 437–446 | 14.566667–14.866667 | 874–892 | dark | type | `Be` |
| 446–455 | 14.866667–15.166667 | 892–910 | dark | type | `With` |
| 455–464 | 15.166667–15.466667 | 910–928 | lime | type | `Us` |
| 464–473 | 15.466667–15.766667 | 928–946 | dark | build | `and` |
| 473–482 | 15.766667–16.066667 | 946–964 | dark | build | `You're` |
| 482–491 | 16.066667–16.366667 | 964–982 | lime | zoom | `Gonna` |
| 491–500 | 16.366667–16.666667 | 982–1000 | dark | zoom | `Grow` |
| 500–509 | 16.666667–16.966667 | 1000–1018 | lime | zoom | `Super` |
| 509–518 | 16.966667–17.266667 | 1018–1036 | dark | zoom | `Fast` |
| 518–527 | 17.266667–17.566667 | 1036–1054 | lime | pop | `A` |
| 527–536 | 17.566667–17.866667 | 1054–1072 | lime | build | `A Platform` |
| 536–540 | 17.866667–18.000000 | 1072–1080 | lime | build | `A Platform to` |
| 540–549 | 18.000000–18.300000 | 1080–1098 | dark | pop | `Grow` |
| 549–558 | 18.300000–18.600000 | 1098–1116 | dark | type | `in` |
| 558–567 | 18.600000–18.900000 | 1116–1134 | dark | type | `Your` |
| 567–576 | 18.900000–19.200000 | 1134–1152 | lime | type | `Field` |
| 576–585 | 19.200000–19.500000 | 1152–1170 | lime | type | `by` |
| 585–594 | 19.500000–19.800000 | 1170–1188 | lime | build | `Ads` |
| 594–602 | 19.800000–20.066667 | 1188–1204 | dark | build | `We` |
| 602–608 | 20.066667–20.266667 | 1204–1216 | dark | build | `We guarantee` |
| 608–616 | 20.266667–20.533333 | 1216–1232 | dark | build | `We guarantee You.` |
| 616–623 | 20.533333–20.766667 | 1232–1246 | stripes | build | `Your` |
| 623–630 | 20.766667–21.000000 | 1246–1260 | stripes | build | `Your Benefit` |
| 630–636 | 21.000000–21.200000 | 1260–1272 | stripes | build | `Your Benefit To 100%` |
| 636–644 | 21.200000–21.466667 | 1272–1288 | lime | type | `NO` |
| 644–653 | 21.466667–21.766667 | 1288–1306 | dark | type | `Compromises` |
| 653–662 | 21.766667–22.066667 | 1306–1324 | dark | type | `Don't` |
| 662–669 | 22.066667–22.300000 | 1324–1338 | lime | type | `Suppress` |
| 669–676 | 22.300000–22.533333 | 1338–1352 | dark | type | `Your` |
| 676–684 | 22.533333–22.800000 | 1352–1368 | lime | build | `Creativity.` |
| 684–693 | 22.800000–23.100000 | 1368–1386 | dark | type | `So` |
| 693–702 | 23.100000–23.400000 | 1386–1404 | dark | type | `Are` |
| 702–711 | 23.400000–23.700000 | 1404–1422 | dark | type | `You` |
| 711–720 | 23.700000–24.000000 | 1422–1440 | dark | build | `Ready` |
| 720–729 | 24.000000–24.300000 | 1440–1458 | dark | type | `For` |
| 729–738 | 24.300000–24.600000 | 1458–1476 | lime | zoom | `The Best` |
| 738–747 | 24.600000–24.900000 | 1476–1494 | dark | zoom | `Let's` |
| 747–756 | 24.900000–25.200000 | 1494–1512 | lime | zoom | `Begin` |
| 756–765 | 25.200000–25.500000 | 1512–1530 | dark | zoom | `The` |
| 765–772 | 25.500000–25.733333 | 1530–1544 | lime | zoom | `Countdown` |
| 772–1103 | 25.733333–36.766667 | 1544–2206 | plate | hold | `10 to 0 source plate` |
| 1103–1223 + tail hold | 36.766667–40.850000 | 2206–2451 | dark | logo | `Mellox AI` |
