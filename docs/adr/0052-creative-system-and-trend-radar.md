# ADR-0052: Creative system and Trend Radar

Status: accepted (2026-11-19). Amends ADR-0051 round 2/3 (lifts its bans on
visual metaphors and "ad stunts").

## Context

Studio posts, carousels and ads came out generic: the headlines were odd, the
pictures off-topic, and the logo was stamped in a corner. The posts on Mellox's
own website (`public/Home/wall/`) are the bar, and each one is built on **one
visual idea**: a superhero shadow, a vinyl record reading "CD", a crane lifting
concrete for a builder, a burger on a skateboard. Each also has bold two-colour
condensed type, one colour field or a dark premium ground, cinematic light and
a small logo designed in at the top.

The pipeline was forbidden from making them:
- the director banned "visual metaphor / ad stunt / surreal concept";
- the carousel writer banned giant objects and metaphors;
- Surprise me offered only product, tip and FAQ ideas;
- text and service posts skipped the director;
- ads used a fixed template prompt at medium quality.

Topics were also stale. Nothing tied a post to what people were talking about
that week.

## Decision

1. **One creative system** (`src/lib/studio/creative-system.ts`, pure):
   - **Idea techniques.** Ids are stored: add, never rename.
   - **Gating by deliverable** (`techniquesFor`). This replaces the blanket ban:
     - hiring, greeting and event posts must be clear first;
     - launches, offers, products and brand posts get the big ideas;
     - a service brand gets a symbolic object;
     - a live trend leads with the culture tie.
   - **The house craft** (`HOUSE_CRAFT`) and the scoring test (`CONCEPT_TEST`).
2. **The director thinks before it writes.** `buildPostPlanPrompt` asks for
   three concepts (technique, idea, headline, score out of 40), picks one, and
   writes it as the image prompt. It is still one call (`studio.image.brief`,
   Sonnet, effort low); only the output tokens grow. The chosen technique is
   stored on the output (`technique`).
3. **Every picture goes through the director.** That covers text and service
   posts (`directPicture` in the runner), and ads too: the ad writer weighs
   three ideas and writes `visualConcept` as the full image prompt;
   `adImagePrompt` adds only the job, colours, exact words, margins and the
   logo corner. Ads with words render at high quality. Director pictures keep
   the logo top-left unless the look sets a corner.
4. **The review scores the idea** (`idea` in `RUBRIC_KEYS`, weighted in
   designed and sales). There is still only ever one redo.
5. **Trend Radar.**
   - **Admin side:**
     - staff post a moment at `/admin/trends` (`TrendsScreen`, permission
       `trends.manage`): a brief, what to make, don'ts, tags, links, pictures
       and clips;
     - the scope is all brands, specific (industries or brands) or micro
       (only the picked industries);
     - the trend runs inside a date window, as draft, live or ended.
   - **Storage:**
     - trends are rows in `platform_trends`, service role only;
     - saves go through `admin_trend_save`, audited in the same transaction;
     - media are stored under `platform/trends/<key>/` in the asset bucket.
   - **Customer side:**
     - customers read through `live_trends_for(workspace)`, which checks
       membership and never shows who else a trend was aimed at;
     - matching is pure (`src/lib/trends/radar.ts`);
     - `radarFor` (60 s memo, never throws) fills `ctx.radar` in
       `loadStudioContext`.
   - **What it reaches:**
     - the director and writers (`radarSection`, when the brief names the
       trend or `controls.trendId` picks it);
     - ideas (source `radar`, "Trending now");
     - Surprise me (idea `trend`);
     - Autopilot's brains (`trends`, staff-picked first);
     - the campaign plan's trend text.
   - **Brand rules** (`RADAR_RULES`): it is made in the brand's own style;
     the trend owner's logos, characters and art are never used; no
     partnership is implied; no fact is invented. Trend pictures go to the
     writer as reference only (when `allowMood` is set), never into a render.
6. **Models.**

   | Route | Before | After |
   |---|---|---|
   | `studio.ad` | WRITER, low effort | WRITER, medium effort |
   | `studio.hero.concept` | WRITER | CONVERSATION, low effort |
   | `studio.ideas` | BUDGET | WRITER |
   | `studio.prompt` | BUDGET | WRITER |

   Images stay on GPT Image 2.5 Flare. There are no extra renders.

## Cost

Text only: about $0.002 to $0.01 more per piece, from the director's longer
prompt and output, Haiku ideas, and medium effort on ads. A picture post still
plans under the $0.085-per-credit ceiling (`plan-economics.test.ts`). Ads with
words move from medium to high render quality. That is the one real increase,
and it is only for ads.

## Not done / follow-ups

- A "Trending now" chip row in the Studio composer (to set `controls.trendId`).
  Today trends reach people through ideas, Surprise me and briefs that name
  them.
- Stills cut from trend videos (`stills` is empty, so videos reach writers by
  their caption only).
- Rendered quality has not been measured. It needs a small paid A/B the owner
  approves with a USD estimate first.
