# ADR-0040: Product hero posters — the product cut out and staged

- **Status:** accepted
- **Date:** 2026-10-30
- **Changes:** ADR-0035 §4 and ADR-0036 for single-picture product posts only

## Context

A single-picture product post went through photo design: the image model
painted a key-colour window and code pasted the whole product photo into it.
The result looked like a screenshot in a rounded card, surrounded by clip-art
the model added to fill space (leaves, a lotus, a dropper, a fake wordmark).
Nothing in Mellox removed a background.

Brands that sell products well do the opposite. One product at a time, cut
out, the hero of a lit scene built for it: a backdrop tinted from the pack's
own colour, the product's own formula running around it, a glass ledge, a
macro crop, a calm benefit column. The same handling post after post, so the
feed reads as one series.

## Decision

**A single picture about a picked product is a product hero poster**
(`referenceMode: "hero"`, catalog action `product_hero`, 40 credits). Flag
`FEATURE_FLAG_PRODUCT_HERO_ENABLED` (with `_WS_<id>`), on unless `false`; off,
the post goes back to photo design. Carousels and Stories keep the photo.

1. **The image model cuts the product out** (`background: "transparent"`,
   `src/server/studio/product-hero/cutout.server.ts`), once per photo. The
   cut-out is an `assets` row (`metadata.source = "product-cutout"`,
   `from_asset_id`, `product_id`, `colour`, `cropped`), re-checked against the
   workspace when read. Pure checks (`src/lib/studio/product-hero/cutout.ts`)
   refuse a cut-out with its background left or a speck, and `cleanAlpha`
   removes the model's glow. A photo that cuts the product off is detected
   (alpha edges, plus one vision read) and the poster becomes a macro crop,
   so a missing part is never invented. Any failure falls back to the
   original photo with "use only the product".
2. **Code plans the poster** (`plan.ts`, pure): the staging (`stagings.ts`:
   `glow-sweep`, `texture-burst`, `benefit-column`, `macro-crop`, `wet-glass`,
   `podium-stack`; ids are stored in `meta.art_direction`, add, never rename),
   kept off the latest two and leaning on the team's hearts; a tone-on-tone
   palette from the cut-out's own colour (`palette.ts`); and the words, only
   from the product's stored facts (`copy.ts`).
3. **The AI may blend the product** into the scene: relight it, turn it a
   little, run gel or water over it. Its shape, colours and every word on the
   label stay as in the cut-out; the original photo is sent as the second
   reference and is the truth for the label. The visual review checks the
   product against the cut-out, and one repair follows a failure.
4. **Never in a frame.** The prompt's `HERO_NEVER` list forbids a frame, card,
   box or picture-in-picture, other products, people, clip-art, a separate
   logo, and any badge or claim not in the copy. The real logo is placed by
   code afterwards.
5. **A series look.** Up to two earlier product posters of the brand are sent
   as references for colour handling, type and finish.
6. **A different topic every post, the same brand look.** The brand's
   colours (a light tint of the pack's colour), type and finish stay the
   same; a dark, deep, accent or two-tone colour mood is used only when the
   brief asks. What changes (`variety.ts`), each kept off the brand's latest
   posters, is the topic (one benefit, all benefits, the texture, the
   ingredients, the problem it solves, the moment of use, who it is for, the
   product itself), the staging the topic leads to (eleven, including
   floating, shadow play, colour split, type wall and an ingredient scene
   that needs ingredients the facts name), the light and the set. An
   occasion the brief or campaign names (launch, sale, Eid, Diwali,
   gifting, summer, winter...) adds its only allowed touches and never
   changes the colours. A product photo that cuts the product off rotates
   through the stagings where it can enter from the frame's edge
   (`CROP_SAFE`). Benefits rotate post by post (`rotateBenefits`).
7. **A model writes each poster's idea and headline** (route
   `studio.hero.concept`, priced in `product_hero`), seeing the brand's
   latest posters' ideas and headlines. `groundConcept` decides: a scene
   sentence with people, words or figures is dropped; a headline or support
   line with a figure, award or claim the facts don't state, or close to a
   recent headline, is dropped and the copy writer's line is used. Words the
   person quoted in the brief are set exactly. What a poster used is stored
   as `meta.hero_look` and read back for the next one.

Edits (the edit chat, Versions) start from the current poster and keep its
look.

## Consequences

- "A product's photo is never redrawn" now holds for photo design, carousels,
  Stories and videos. In a hero poster the product is re-rendered by the image
  model from its cut-out. Small print on a multi-product photo can drift; the
  review catches visible differences, not every tiny word.
- Services get the same benefit layout through the `benefit-list`
  art-direction layout.
- Not in this change: cut-outs on carousels and Stories, a "Cut out again"
  button on the Products tile, and a reviews-based layout (no stored reviews
  to ground it).
- Live check: `tests/live/product-hero.live.ts` (`PRODUCT_HERO_LIVE_AI=yes`).
