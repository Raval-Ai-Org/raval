---
name: creative-director
description: How Mellox's Studio comes up with the one visual idea behind a post, carousel cover or ad (creative techniques, house craft, concept round) and how Trend Radar moments reach brands. Use when posts look generic or off-topic, when adding a creative technique, when tuning the director or ad prompts, or when a person asks how a trend they posted in the admin Trend Radar reaches Studio, Campaigns or Autopilot.
---

# Creative director

Decision record: `docs/adr/0052-creative-system-and-trend-radar.md`.

## The bar

The posts on our website (`public/Home/wall/`). Each one has:
- one visual idea;
- a bold condensed two-colour headline;
- one colour field or a dark premium ground;
- cinematic light;
- one or two graphic accents;
- a small logo designed in at the top.

## Where things live

- `src/lib/studio/creative-system.ts`: the techniques (`TECHNIQUES`, ids
  stored: add, never rename), `techniquesFor` (gating by deliverable),
  `HOUSE_CRAFT`, `CONCEPT_TEST` and `creativeSystemLines`.
- `src/lib/studio/post-plan.ts`: the director. It writes three concepts,
  scores them, picks one and writes it as the image prompt (`concept`).
- `src/lib/studio/prompts.ts`: carousels (series idea, cover concept), ads
  (`buildAdPrompt`, three ideas, `visualConcept` = the full image prompt) and
  `radarSection`.
- `src/server/studio/visual-prompts.server.ts`: `postImagePrompt` and
  `adImagePrompt` add only the exact words, canvas, colours and logo corner.
  Never add layout menus, type tables or checklists back.
- `src/lib/studio/image-defects.ts`: the review scores `idea`.

## Adding a technique

1. Add it to `TECHNIQUES`, with a `how` and a brand-neutral `example`. Never
   name a real brand.
2. Put it in the right `techniquesFor` cases. Keep hiring, greeting and event
   posts clear first.
3. Extend `creative-system.test.ts`. Check `prompt-size.test.ts` still passes
   (the director ceiling is 8k).
4. Read the free bench (`tests/bench/`) before and after. No paid renders
   without a USD estimate and the owner's yes.

## Trend Radar

- Staff post at `/admin/trends` (`TrendsScreen`). The scope is all, specific
  or micro.
- Rows are in `platform_trends` (saved through `admin_trend_save`). Customers
  read them only through `live_trends_for`.
- Matching is pure in `src/lib/trends/radar.ts`. `radarFor` fills
  `ctx.radar`.
- A trend reaches:
  - the director, writers, ideas and Surprise me;
  - Autopilot `brains().trends`;
  - the campaign plan `trendText`.
- `RADAR_RULES` always apply: the brand's own style, never the trend owner's
  art or logos, no implied partnership, no invented facts.

## Round 9 skill packs

The creative skill packs (ADR-0053, all off by default) add a few short lines
that code picks about the business: its sector, its type voice and why the
piece sells. They never add style menus.

- Relevance comes first: `CONCEPT_TEST` leads with "unmistakably this business
  and this brief", and services start with `show-the-work`.
- Details are in the `sector-playbooks`, `type-voices`, `video-for-services`
  and `campaign-platform` skills.
- With the packs off, prompts must stay byte-identical
  (`creative-golden.test.ts`).
