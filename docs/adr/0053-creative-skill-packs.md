# ADR-0053: Creative skill packs (Round 9)

Status: accepted, every pack **off by default** until it wins the blind benchmark.
Date: 2026-11-24. Builds on ADR-0051 (brief-first generation) and ADR-0052
(creative system and Trend Radar).

## Context

Studio pictures looked polished but were often not about the business. Every
brand was told to use the same heavy condensed sans with one accent word, and
the words drawn didn't always fit the brief. Service businesses had it worst
(a crane for a web agency). Videos treated every business as a product, and a
campaign's pieces shared one sentence and no look.

An earlier training round stacked recipes and bans, and output became more
generic. ADR-0051 showed that style menus and checklists in prompts turn every
post into a template. So this round is built so it **cannot quietly make things
worse**:

- every change sits behind a flag that is off by default;
- with every flag off, the prompts are byte-identical to before
  (`creative-golden.test.ts` against `evals/creative/golden-off.json`);
- a pack is turned on only after it wins a blind benchmark.

We can't retrain the image or video models. "Training" here means four things:

- research (`docs/studio/research-2026-11/`, with a source and licence column);
- knowledge distilled into code;
- a few short lines that code picks for each piece;
- checks.

## Decision

### How a skill reaches a prompt

- **The server picks the lines; the prompt builders stay pure** (`skill-lines.server.ts` →
  `skill-lines.ts`).
- **The budget is small.** A pack adds at most **3 lines and 450 characters**, placed
  inside the existing Business / brand-look sections, after the brief.
- **What a line may say.** Lines state facts and taste about the business, never orders
  or option lists.
- **The system prompt doesn't change.** It is the same with skills on or off, apart from
  swaps of the same length or shorter.
- **Nothing rotates per piece.** There is no style or layout rotation for each post.

Heavy data never reaches the browser:

- sector playbooks are in `src/server/studio/sectors/` (server-only);
- the brief library is in `evals/creative/briefs/`.

### Flags

All packs are read through `creativeSkillsFor(workspaceId)`
(`src/lib/feature-flags.ts`). Each pack is switched by
`FEATURE_FLAG_SKILLS_<PACK>_ENABLED` and per workspace by `…_WS_<id>`. All are
off unless set to `true`.

| Pack | What it does |
|---|---|
| `relevance` | `CONCEPT_TEST` puts "unmistakably this business and this brief" first. Adds a `show-the-work` technique, first for services, and removes the crane examples. The image review sees the person's brief and fails a picture any rival could post. The drawn words and the technique are stored in meta so repeats are caught. |
| `type` | One **type voice** per brand (`src/lib/studio/type-voices.ts`, 27 voices, ids stored: add, never rename). Order: the brand's own type, else a display-worthy Brand DNA font, else a stable pick for the sector. It replaces the "heavy condensed sans, one accent word" default. Code-drawn slides use the voice's Google Fonts pair. Never rotated per piece. |
| `sectors` | 86 business types (`src/lib/studio/sectors/`, kinds product / service / hybrid / venue / digital) and server-only playbooks: what to show, an honest proof ladder, buyer wants and doubts, clichés. Adds one "why it sells" mechanism line from the 567-brief library (`example-briefs.server.ts`), skipping recent ones. |
| `video` | A service never gets a product-only video kind without a product. It falls back to how-it-works or brand story, at the same price tier (`service-kinds.test.ts`). |
| `campaign_platform` | "Write the plan" (same 55-credit call) also writes a platform: tagline, key visual, motif and photo rule. It is grounded like the rest. Pieces get 1–2 platform lines and the phase's deliverable. |
| `context` | The brand's colours, type, product, caption and campaign phase reach the picture director whole instead of being cut off. Adds the WhatsApp chat link (`whatsapp.ts`), only from the number on the brand's profile. |
| `scripts` | Arabic and Urdu words drawn by code, right to left, in Vazirmatn (render-tested). Hindi stays off. |
| `headline` | A plain picture post is drawn without words, and code sets the headline on its calmer band (`headline-overlay.ts`). "Edit text" fixes a word with no new render. |
| `jobdone` | "Before / after" from exactly two of the person's own photos, set side by side or stacked by code (`job-done.ts`). No image model; labels are English only. |
| `besttwo` | A new brand's first 3 picture posts: if the first scores under 8, one more take is made and the better one is kept, at Mellox's cost (`creativeRedo` reason `best`). |
| `culture` | The moments calendar adds the brand's own country's dates (`countryDefinitions` in `moments.ts`). The country comes from the site's domain or the content language (`countryOf`). With no country known, the calendar is the old global list. |

Separate flag `FEATURE_FLAG_TRACKED_LINKS_ENABLED` turns on **tracked links**:

- **What gets swapped.** Own-site links in captions for networks where links can be
  clicked become `/l/<slug>` short links (`tracked_links`, migration
  `20261124120000_tracked_links.sql`).
- **What gets counted.** Clicks by people, never bots, show in goal progress as
  measured.
- **Instagram and TikTok** keep the real link.
- **Failures.** If anything fails, the real link stays.

Onboarding also asks for up to 10 real photos (team, place, work). This is
free, and with 3 or more photos the brand's own media is used often.

### Cost

- **Prices don't change.**
  - The headline overlay renders the picture at medium quality instead of high,
    which is cheaper.
  - Job done uses no image model.
  - Best-of-two is limited to a new brand's first three posts, a first score
    under 8, and one extra render at most. It falls within the plan-economics
    stress case, which already assumes every image is redone once.
  - Everything else adds a few hundred characters of prompt or none.
- **The benchmark is paid and run only on the owner's yes, with a USD quote.**
  - `tests/live/creative-blind.live.ts` has a `CREATIVE_BLIND_MAX_USD` cap.
  - An arm may pin its image model with `@<model id>`, for the Recraft vs
    GPT Image arm. When the skills match, the plan is shared, so only the model
    differs.

## Ship gate

A pack is turned on only after a blind round meets all of these:

- at least 64 non-tie pairs;
- a win rate of 60% or more, with the lower Wilson bound above 50%;
- no score dimension down by 0.3;
- the service subset is not worse;
- within-brand similarity is not worse.

The judge scores each pair both ways, and a win counts only when both ways
agree. The owner also votes blind in `gallery.html`.

## Not done / later

- Hindi drawn by code.
- Non-English job-done labels.
- Google reviews as proof posts.
- Brand-level design languages.
- New big-brand techniques.
- Changing the default image model. That needs the benchmark and the owner's
  yes, and CLAUDE.md's Models section would be corrected afterwards.
