# ADR-0051: Brief-first generation for posts and carousels

Status: accepted, 2026-11-17

## Context

Single posts, carousels and the words on posts came out weak, while Stories, made with the same
image model, looked good. Claude, writing one prompt by hand for the same models, got far better
pictures. The models weren't the cause. The pipeline in front of them was:

1. **The post picture prompt was too long.** It was about 13 code-built blocks (12–17k characters)
   cut at 10,000. The cut lost the exact headline and the quality check. What was left held two
   scenes, contradictory text rules ("no text" next to "massive headline behind the subject") and
   pixel maths for the wrong ratio. The Story prompt was about 4–5k characters and coherent.
2. **Carousels were never designed by the model** for credit payers. The job was forced to
   `composed`: one wordless background, with every slide drawn as text on a flat colour.
3. **Auto ignored the brief.** It picked the post kind, angle and opening at random or by hash, and
   pushed for novelty ("change the idea", "don't repeat topics"). The picture's job defaulted to
   "sell", and the brief was under 1% of the writer's input.
4. **Product posters replaced the headline** with a line on a rotated product topic. Their
   grounding refused the brief's own facts (a date, "3 roles", "20% off").
5. **The reviewer was given words the prompt never sent**, and flagged as defects things the prompt
   had asked for.

## Decision

- **Read the brief once.** `readBrief` (`src/lib/studio/brief-read.ts`, pure) finds the
  deliverable, the facts, the quoted words, the subject words and whether a catalogue product is
  really named. It is stored on `output.briefRead`, and every writer and picture prompt is built on
  it.
- **Remove post kinds.** `resolveCategory` returns null and there is no picker. Stored ids still
  read. Angle and opening are picked only for planned pieces (Autopilot); a person's post gets
  `BRIEF_ANGLE`, which means making exactly their point.
- **One writer plans the post.** `buildPostPlanPrompt` (`src/lib/studio/post-plan.ts`) puts the
  brief first and writes the headline (8 words at most), the supporting lines and the picture's art
  direction as one paragraph. `postImagePrompt` adds only short hard rules: exact words, brand look,
  type system, margins for the real ratio, logo corner and quality check. Nothing is cut.
- **Check, then escalate once.** `briefFitIssues` (free) rejects copy that dropped the brief's
  subject, invented a figure or lost quoted words. The rewrite runs on `studio.plan.escalate`
  (Sonnet 5.5). Haiku 5.5 stays the writer otherwise; Sonnet also writes carousels of 7+ slides.
- **Model-designed carousels.** Slide 1 renders first. Every other slide takes slide 1 as its first
  reference (`anchor`), so the set shares one grid, type and colours. Pricing: 1 credit for the
  cover plus ½ credit per extra slide. Composed carousels remain only for seamless carousels and the
  brand's own photos.
- **Product posters keep the message.** Topic `the-brief` comes first whenever the brief says more
  than the product's name. The brief's facts may be used, and the copywriter's headline is the
  first option.
- **No product on non-selling posts** (hiring, greeting, event, milestone and others).
- **The reviewer checks what was sent** (`sentWords`). Every redo keeps the first picture, and
  `keepFirstRender` keeps the better of the two.

## Consequences

- Image models and their routing are unchanged. The extra cost is one Sonnet call, only when the
  free check fails or for long carousels.
- The carousel margin is thin: about $0.045 of image cost per extra slide against ½ credit. Watch
  `admin_cost_per_output`.
- Memes, sale "kinds" and the kind picker are gone; templates no longer set a kind.

## Round 2: native post styles (2026-11-17)

The first round still offered the writer the campaign-stunt layouts of
`art-direction.ts`. These include a monument-sized object, a miniature
diorama, a portal pop-out, a mirror kaleidoscope and a sculpture made of the
headline. The result was weird feed posts: a hiring post or a tip came back as
a surreal sculpture.

- Picture posts are made in native post styles (`src/lib/studio/post-styles.ts`). These are
  the kinds of posts good brands really publish, each with a picture rule, a word rule and a
  medium. Photo styles must look like real photographs.
- Code offers the best three for the brief's deliverable and the platform, never a product
  style without a product, an offer style without a stated figure, or the style used last. The
  writer picks one; a pick that wasn't offered is replaced by the best fit.
- Carousels get one native carousel style (editorial text, photo story, step-by-step, product
  tour). The writer writes for it and every slide is drawn to it; the "recurring motif" and
  the surreal cover layout are gone.
- Surprise me with no input picks a kind of post (product spotlight, tip, behind the scenes,
  customer benefit, FAQ, meet the brand, a close occasion, a stated offer). Trend and
  competitor signals no longer drive the idea.
- Supporting lines (a hiring post's details, an event's date and place) are kept up to the
  style's `maxLines`; before, only "rich" brands kept them.
