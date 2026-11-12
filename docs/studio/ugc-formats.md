# Creator video formats

Decision record: [ADR-0046](../adr/0046-creator-video-formats.md).

A Creator (UGC) video is a kind of Reel first and an ad second. The format
says what kind: a street interview, a POV skit, a car confessional, a GRWM.
Everything Mellox writes and films for that video comes from the format's
record, so a new kind of Reel is a new record, not new code.

## Where things live

| What | Where |
| --- | --- |
| The 30 formats and their groups | `src/lib/ugc/formats/formats.ts` |
| Types (beats, roles, places, twists) | `src/lib/ugc/formats/types.ts` |
| One gold example prompt per format | `src/lib/ugc/formats/examples.ts` |
| Writing rules for every script | `src/lib/ugc/formats/craft.ts` |
| Code checks on a written script | `src/lib/ugc/formats/checks.ts` |
| Variant rotation (place, twist, hook) | `src/lib/ugc/formats/variant.ts` |
| Formats that suit a brand | `src/lib/ugc/formats/suggest.ts` |
| Lead role and second creator | `src/lib/ugc/formats/cast.ts` |
| The video prompt | `src/lib/ugc/formats/prompt.ts` |
| What a render stores (cuts, join, hook cues) | `src/lib/ugc/formats/render.ts` |
| Hook text presets and timing | `src/lib/ugc/hook-text.ts` |
| Drawing hook text on the video | `overlayHookText` in `src/server/studio/video/finish.server.tsx` |
| Script writer | `src/server/ugc/concepts.server.ts` |
| Format picker | `src/components/app/ugc/FormatPicker.tsx` |
| Card pictures | `public/ugc-formats/<id>.jpg`, listed in `src/lib/ugc/format-thumbs.ts` |

## How a video is made

1. **Pick.** The composer opens on the format grid. Auto lets Mox pick a format
   that suits the brand; a chosen format gets a fresh variant. Mox writes one
   script, which the person edits or asks to rewrite (no pick of ideas).
2. **Write.** "Write it for me" sends the format's beats, cast, camera and
   edit rule, the variant, the craft rules and the gold example to the
   writer (route `ugc.concepts`, Sonnet 5.5). Every scene carries its role
   (hook, setup, turn, payoff, button), speaker and cut; the script carries
   the hook text (`onScreen`) and, for the reply preset, the comment it
   answers (`replyTo`).
3. **Check.** `formatScriptIssues` lists what's wrong in plain words. The
   repair pass gets those reasons once; the cleanest ideas come first.
4. **Film.** `buildFormatVideoPrompt` turns the format, the variant and the
   script into a timed shot list. Two-person formats send both people's
   photos where the model takes them. Cut formats split only at beats;
   continuous ones chain from the last frame.
5. **Finish.** The hook text cues stored on the render are drawn on the
   finished video by code, then it is stored. A drawing failure keeps the
   clean video.

## Adding a format

1. Add a record to `UGC_FORMATS` with a new id (never rename one). Beat shares
   must add up to 1; give it three places, three twists and three hook
   patterns, and a hook text preset with an example.
2. Add its gold example to `FORMAT_EXAMPLES`.
3. Add tags so `suggestFormats` can match brands to it.
4. Run `node scripts/generate-ugc-format-thumbs.mjs <id>` for its card
   picture (about $0.01).
5. `npm test` checks that every format is complete, unique and has an
   example.

## Adding a hook text preset

Add the id to `HOOK_TEXT_PRESET_IDS` (never rename one), its record to
`HOOK_TEXT_PRESETS`, its drawing to `renderHookCue` and its small CSS twin to
`HookTextSample`. Keep the words inside the upper third, clear of the app's
top bar and the caption area.

## Rules

- Formats, beats and checks are code's decision; the model only writes words.
- The product is the answer, never the subject, and is named at most twice.
- People are original and fictional. Reply handles are made up. No real
  brand, show or person is named in a format, an example or a picture.
- Video models never draw words; the hook text is always drawn by code.
