# ADR-0043: Video categories, cheaper models, sound and motion graphics

Status: accepted (2026-11-04)

## Context

Video was Mellox's most expensive and weakest output. A 10-20 s story cost
about $1.74-3.00 (Seedance 2 on KIE, and Premium routed to Hailuo 3 2K on
OpenRouter even though its KIE entry was Gemini Omni Flash). Words warped in
AI footage, there was no voiceover or music, and every video, however simple,
needed a video model.

ADR-0041 (video kinds, storyboards, checks) fixed the story side. This record
covers the models, the money and the two new ways of making a video.

## Decision

1. **Every key on KIE by default.** Premium is Gemini Omni Flash on KIE (first
   and last frame); Long is Wan 3.0 720p (with sound, up to 15 s); a new
   Studio-only `animation` key is Wan 3.0 image-to-video. OpenRouter stays the
   fallback on out-of-credits, auth or model-unavailable, and a fallback never
   costs more than its primary (Premium falls back to Veo 3.1 Fast, not Hailuo
   2K). Kling 4.0 was priced at about $0.14/s and not adopted.
2. **Per-clip models.** A composed video may name a model per clip. Premium
   still uses Omni for every clip: on KIE it is cheaper than any model that
   makes its 10 s follow-on clips, so no opener split is used today.
3. **A price cap.** `VIDEO_MAX_USD_PER_JOB` (default $5) refuses a quote whose
   provider cost is higher, before anything is held.
4. **Sound.** A voiceover of the storyboard's exact words (ElevenLabs on KIE)
   and an instrumental music bed (Suno on KIE), mixed by FFmpeg with the music
   ducked under the voice, at -14 LUFS. It fails open.
5. **Motion graphics.** Opus designs one HTML/SVG + CSS document; pure checks
   decide (no script or outside address, grounded words, safe area, size,
   contrast, an end hold); Chromium draws every frame offline and FFmpeg
   encodes it. No video model, so it is crisp and costs about $0.20-0.40.
   Priced as `motion_graphics` (90 credits). One retry with the reasons, then
   it fails plainly: no template fallback.
6. **A monthly premium quota.** Meter `premium_video`, granted with the plan
   (Free 0, Starter 2, Growth 5, Agency 12, Scale 30), never rolled over. One
   pays for a Premium, Cinematic or Long video up to 24 s; past it, credits.
   Only a `studio_video` hold may use the meter (database guard).

## Consequences

- Typical cost per piece drops: Premium 24 s from about $3.10 to $1.40, Long
  by about a third, and a motion graphic replaces a $1.74 AI clip.
- The migration `20261104090000_premium_video_allowance.sql` extends the meter
  lists; existing accounts get premium videos from their next plan grant.
- The runner wiring (soundtrack, motion-graphics dispatch, per-clip keys) and
  the composer's category step live with the Studio video work (ADR-0041).
- Models are switched without a deploy: `VIDEO_PROVIDER_<KEY>`,
  `KIE_VOICE_MODEL`, `KIE_MUSIC_MODEL`, `KIE_MUSIC_VERSION`,
  `AI_MODEL_STUDIO_MOTION_COMPOSE`.
