# Model swap — 12 November 2026

Second cost review of the text-model tiers ([first: 2026-11-03](../../MODEL-USAGE-AUDIT.md),
[ADR-0026](../adr/0026-openrouter-only-models.md)). Goal: cut OpenRouter spend with
results the same or better. Shipped in `src/server/ai/task-models.ts` and the
gateway; **not yet deployed, and no before/after run on real Studio prompts yet**.

## 1. Where the money went (measured)

OpenRouter `/api/v1/activity` (management key, every caller of the key,
dev included), 2026-10-13 → 2026-11-11: **$28.88**. After the 11-03 deploy,
11-04 → 11-11: **$6.11 in 8 days (~$23/month)**:

| Model                  | Share | Note                                                           |
| ---------------------- | ----- | -------------------------------------------------------------- |
| GPT Image 2.5 Flare    | 23.9% | 86 pictures, ~$0.017 each                                      |
| Opus 5.5               | 16.2% | 9 calls, ~$0.11 each; in production only video storyboards (4) |
| DeepSeek V4.1 Flash    | 14.3% | **77% of its output was reasoning** (676k of 876k tokens)      |
| Gemini 3.8 Flash       | 14.0% | **0 cached prompt tokens** of 478k                             |
| GPT Image 2.5 Sunburst | 10.1% | 28 pictures, mostly product cutouts (`unknown` route, ~$0.067) |
| GPT-6.1 Sol            | 8.4%  | Brand DNA scans                                                |
| Sonnet 5.5             | 8.1%  | Creator video scripts                                          |
| GPT-6.1 Terra          | 3.1%  | briefings, Gemini's fallback                                   |
| GLM, Haiku, Flash-Lite | 2.0%  |                                                                |

Fixed before this review: Opus on `market-intelligence` (last call
2026-11-03 13:59) and Hailuo video via OpenRouter ($6.76, last 2026-10-28).

From `ai_usage_events` (read-only): `studio.ideas` on DeepSeek used **5,464
output tokens a call** against Gemini's 960, so the 11-03 move to DeepSeek saved
nothing on ideas ($0.0052 vs $0.0055 a call).

**Bigger than OpenRouter: Tavily web search, $32.14 over the same 30 days.**
Every Tavily call has returned `error` since 2026-11-05 (150–200 a day:
`competitors.updates`, `studio.trends`, `community.refresh`, `competitors.profile`,
`market-brain.scheduled`), so the ladder has been serving Firecrawl/DuckDuckGo.
Likely out of credits; not checked on Tavily's side.

## 2. What changed

Quality figures are the Artificial Analysis Intelligence Index v5 (best listed
effort); prices are OpenRouter list prices per 1M tokens in / out.

| Routes                                                                                                                                                                                                                                                                                                                                                                                   | Old → new                                 | Price                                 | Index                           | Why it is safe                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------- |
| 37 text writers: Studio copy (social, carousel, story, script, ad, captions, upload captions, naturalize, hero concept, briefs, research, trends, standard article), Flash chat, clarify, content._, ai-generate._, schedule.*, autopilot plan/strategy, market intelligence, coach research/trends, community reply, audience synthesize/variants, CMS fixes, experiment values, memory | Gemini 3.8 Flash → **Claude Haiku 5.5**   | $0.825/$4.13 → $0.10/$0.50 (**−88%**) | 30.9 → 36.5 (**+18%**)          | Reads pictures, does tools and both JSON modes (live-checked); escalations to Opus unchanged |
| Summaries (`coach.briefing`, `articles.blog-design`, `experiments.hypotheses`)                                                                                                                                                                                                                                                                                                           | GPT-6.1 Terra → **Haiku 5.5**             | $1/$5 → $0.10/$0.50 (−90%)            | Terra at low effort ≈ 35 → 36.5 | Small structured jobs; briefing still escalates to Opus                                      |
| Image text reads, audience scores and reactions (ECONOMY)                                                                                                                                                                                                                                                                                                                                | Gemini 3.1 Flash-Lite → **Haiku 5.5**     | $0.25/$1.50 → $0.10/$0.50 (−65%)      | 6.2 → 36.5                      | `file-extract` only reads images; a thin read still escalates to Gemini                      |
| Ideas, prompt help, competitor reads, insights, UGC notes (BUDGET)                                                                                                                                                                                                                                                                                                                       | DeepSeek V4.1 Flash → **V4.1 Flash 1017** | $0.30/$1.20 → $0.15/$0.60 (−50%)      | 32.6 (same family)              | Same model line, newer snapshot                                                              |
| `studio.ideas`, `studio.prompt`                                                                                                                                                                                                                                                                                                                                                          | effort low → **none** (reasoning off)     | −77% of output tokens                 | —                               | Brainstorming needs no chain of thought; live check returned clean JSON                      |
| Fallbacks / degraded                                                                                                                                                                                                                                                                                                                                                                     | Terra, Flash-Lite, Gemini → Luna / Haiku  | never dearer than the primary         |                                 | test `keeps every fallback at or under its primary's price`                                  |

`effort: "none"` is sent only when every model in the list accepts it
(`canTurnReasoningOff`). Live 2026-11-12: DeepSeek 1017, Haiku 5.5 and GPT-6 Luna
accept it; Gemini 3.8 Flash, GLM-5.3 Flash and MiniMax M3.1 Flash answer 400
"Reasoning is mandatory". A list with one of those thinks at `low`.

Haiku 5.5 and GPT-6 Luna take no `temperature` (OpenRouter lists none). Plain
calls send it and OpenRouter drops it; strict calls already leave it out.
Claude's default sampling varies answers, so regenerate still gets a fresh take.

## 3. What stays, and why

| Kept                                                                               | Why                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Opus 5.5 — storyboards, motion graphics, GEO code, published articles              | Opus at medium is 48.2; Sonnet at medium 30.8, Sol at medium 46.4. A storyboard costs ~$0.11 and plans a $0.30–$3 video                                                                                                        |
| GPT-6.1 Sol — Brand DNA, strategy                                                  | Runs once per brand (~$0.04) and everything builds on it                                                                                                                                                                       |
| Sonnet 5.5 — Pro chat, Coach, Creator scripts                                      | Comedy timing and natural speech (ADR-0046); Kimi K3.1 Pro writes well but its output costs $8.79/M, no saving                                                                                                                 |
| Gemini 3.8 Flash — image/video QA, photo reads, transcription, second safety reads | The only tier model that hears audio; vision checks are cheap ($0.0016) and gate re-renders                                                                                                                                    |
| GLM-5.3 Flash — labelling                                                          | $0.04/$0.078, cheapest that labels well                                                                                                                                                                                        |
| GPT Image 2.5 Flare — every picture                                                | #2 of 20 on BudgetPixel (1596; Sunburst 1601), #3 on Arena. The newer 2.6 Flare ranks lower (1549) at the same per-token price; Seedream 5.0 Flash ($0.018, 1508), FLUX 3 Klein (~$0.009, 1469), Muse (1512) are clearly worse |
| KIE video                                                                          | Cheaper than OpenRouter for every key at $0.005/credit: Veo 3.1 Fast 8 s $0.30 (OpenRouter $0.80), Wan 3.0 $0.08/s ($0.10), Omni Flash $0.053/s ($0.070 for 1.2 on OpenRouter)                                                 |

Rejected: Grok 4.7 (35.5 at $2/$6 — Haiku scores higher at a twelfth to a twentieth of the price),
Gemini 4 Argon/Carbon (dearer), MiniMax M3.1 Flash (29.1) and MiMo v2.6 Flash
(26.7) (cheaper than Haiku but weaker), Qwen 3.8 Max (33.6 at $2/$6).

## 4. Expected effect (projection, not a measurement)

On the 11-04 → 11-11 mix ($6.11): DeepSeek $0.87 → ~$0.26, Gemini text $0.77 →
~$0.14 (allowing 1.5× tokens for Claude's tokenizer and longer answers), Terra
$0.19 → ~$0.03. **About −$1.4, or −23% of the OpenRouter bill.** Per Studio
picture post (brief + copy + review + picture): ~$0.035 → ~$0.023 (−35%); per
ideas call: $0.0052 → ~$0.0013 (−76%).

40–50% of today's bill is not reachable by model swaps alone without lowering
picture or storyboard quality: pictures (34%), storyboards (16%) and Brand DNA
(8%) are already the best value. Remaining levers, none in this change:

1. **Turn on the local cutout sidecar** (`FEATURE_FLAG_LOCAL_AI_ENABLED` +
   `LOCAL_AI_URL`; BiRefNet-lite first, `judgeCutout` still decides). It is not
   configured, so every product cutout pays Sunburst (~$0.067).
2. **Fix Tavily** (top up or key) and cut its volume: it was 1.4× OpenRouter
   while it worked.
3. Prompt caching now applies to the writer routes (`withPromptCache` marks the
   leading system block for Anthropic models); measure `cached_input_tokens`
   after a week.

## 5. Verify and roll back

- Unit tests: `src/server/ai/task-models.test.ts` (tiers, fallback prices,
  reasoning-off guard), `src/lib/ai-gateway.server.test.ts` (body sent).
- Live (2026-11-12, ~$0.002): DeepSeek 1017 with `none`; Haiku 5.5 with
  `json_object` and strict `json_schema`; the refusals listed above.
- **Not done:** a before/after run on real Studio prompts. Run it before relying
  on the change: the `/…-lab` fixtures and `tests/live/*` with both models.
- Rollback per route, no deploy: `AI_MODEL_STUDIO_SOCIAL=google/gemini-3.8-flash,openai/gpt-6.1-terra`
  (any route key), `AI_EFFORT_STUDIO_IDEAS=low`,
  `AI_MODEL_STUDIO_IDEAS=deepseek/deepseek-v4.1-flash,google/gemini-3.8-flash`.

Sources: OpenRouter `/api/v1/models`, `/api/v1/images/models/*/endpoints`,
`/api/v1/videos/models` (2026-11-12); [benchleader AA v5](https://www.benchleader.com/benchmarks/aa_intelligence_index_v5);
[modelgrep](https://modelgrep.com/leaderboard); [BudgetPixel arena](https://budgetpixel.com/arena/leaderboard);
[Arena text-to-image](https://arena.ai/leaderboard/image/text-to-image);
[EQ-Bench creative writing (llm-stats)](https://llm-stats.com/benchmarks/creative-writing-v3).

## 6. Second round: premium text and video (approved 2026-11-12)

Measured side by side before switching. Each switch is one line to undo.

### Premium text: Opus 5.5 → Gemini 4 Carbon (done)

`PREMIUM` in `task-models.ts` is now `google/gemini-4-carbon` ($2/$10 per 1M,
Artificial Analysis index 60.0 vs Opus 59.1). Opus stays selectable as `OPUS`.

| Live check (2026-11-12)                 | Opus 5.5                 | Carbon                      |
| --------------------------------------- | ------------------------ | --------------------------- |
| Storyboards, 3 briefs (all pass checks) | $0.076–0.087 each, ~39 s | $0.014–0.019 each, 31–154 s |
| GEO agent tool loop                     | (works)                  | submitted, 3 turns, $0.0027 |
| Motion graphic, 8 s                     | ok on the 2nd try, $0.42 | ok on the 1st try, $0.09    |

Carbon thinks longer, so the premium routes got their own time limits
(`timeoutMs` on the plan, 240–300 s; it only ever lengthens a caller's limit).

The motion run found two bugs that broke motion graphics for **every** model
(no motion graphic has ever been made in production): a scene note over 200
characters threw the design away (now cut, `document.ts`), and the MP4 was
written to a pipe, which FFmpeg's MP4 muxer can't do (now a temporary file,
`render.server.ts`).

Rollback: `AI_MODEL_<ROUTE>=anthropic/claude-opus-5.5,google/gemini-3.8-flash`
for any premium route (e.g. `AI_MODEL_STUDIO_VIDEO_STORYBOARD`).

### Premium video: Gemini Omni Flash 1.1 → 1.2 on KIE (done)

Measured: 72 credits for 8 s at 720p (9 credits/s, $0.045/s); KIE lists 1080p
at 10/s. 1.1 was 10.5/s. Ranks above 1.1 on Artificial Analysis. 1.2 takes an
integer duration and up to 6 reference pictures.

### Standard video: Veo 3.1 Fast → Grok Imagine 1.5 on KIE (done, approved after the test below)

`standard` is now `grok-imagine-video-1-5-preview` (family `grok-video`, its own
prompt direction; the old `grok` family stays the photo animator for
Variation). It takes text, one reference picture, or exact first and last
frames; 4–8 s clips as before; 480p and 720p. Prompts are cut to its 4,096
characters by `fitVideoPrompt` (`src/lib/ugc/prompt-fit.ts`), which drops
creative notes, then brand voice, then camera notes before it cuts anything,
so the beat sheet, dialogue, product facts and "do not include" stay
(production prompts ran 3,300–4,700 characters). The OpenRouter fallback is
Veo 3.1 Lite ($0.05/s), the cheapest that speaks.

Checked through the app's own code (`tests/live/standard-video.live.ts`): a
typed car-confessional script, 8 s, 36 credits ($0.18), the line spoken word
for word, the can's label readable. One short beep at the very end.

Rollback: in `src/lib/ugc/models.ts`, `standard` back to `family: "veo"`,
`kie: KIE_VEO_FAST, openrouter: OR_VEO_FAST`.

### Draft and Variation video (measured, not switched)

The same 8 s creator ad (9:16, spoken line, sip) on each model. All five said
the line word for word and had sound.

| Model                       | Where      | 8 s cost | Per second | Notes                               |
| --------------------------- | ---------- | -------: | ---------: | ----------------------------------- |
| Veo 3.1 Fast (Standard now) | KIE        |    $0.30 |    $0.0375 | did the sip                         |
| Grok Imagine 1.5 preview    | KIE        |    $0.18 |    $0.0225 | did the sip; text or one picture    |
| HeyGen Video 1, 768p        | OpenRouter |    $0.14 |     $0.018 | did **not** sip; references $0.10/s |
| Gemini Omni 1.2 (Premium)   | KIE        |    $0.36 |     $0.045 | did the sip                         |

Grok Imagine 1.5 at 720p costs **more** than today's Draft (Veo Lite, 30
credits per 8 s = $0.15) and Variation (Grok image-to-video, 24 credits per
video), so neither was switched; KIE's "from 2.4 credits/s" is its 480p price.
Files: `H:\mellox-cost-scratch\video-compare\`.
