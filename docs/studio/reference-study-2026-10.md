# Reference study, October 2026

Notes from studying about 30 published agency posts (84 pictures, 11 clips)
that the team put in `Post Training/` (kept out of git). Everything here is
brand-neutral: the posts are never copied, quoted or named in the product.
Where each lesson lives in code is listed in
[creative-knowledge.md](creative-knowledge.md#reference-study-october-2026).
A later round should add to this file, not start a new one.

## What the best posts have in common

- **Type-led and exact.** The strongest pieces are mostly words, set big and
  spelled perfectly: a hiring reveal in heavy capitals with one word in the
  accent colour, a "we'll … just not today" joke repeated on every slide, a
  greeting that is one symbol and one line. Mellox draws these by code
  (`SlideArt`), never with an image model.
- **The real work, shown plainly.** Case studies give each touchpoint its own
  slide (sign, packaging, website on a device, merchandise) and never show the
  same medium twice. One shape taken from the logo comes back on every slide.
- **Screens always sit in a device.** A phone or a browser window, seen
  straight on, never a raw screenshot filling the frame.
- **Restraint.** The accent colour covers about 3–8% of the picture. One grade
  across the set, with fine grain. Emphasis is either a weight change or one
  coloured word, never both.
- **Depth.** The subject overlaps the giant headline; objects have contact
  shadows; heroes are shot from a slightly low angle.

## Recipes per post kind

| Kind             | Structure                                                                                      | Notes                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Case study       | Cover (the identity on its hero object) → one touchpoint per slide → quiet end card            | Caption ends with a credits block: "Client · category", then "Scope: a · b · c". |
| Agency intro     | Hook → what we do (numbered) → who it's for → proof → action that calls back to the cover      | Plain words; the proof is real work, not adjectives.                             |
| Hiring           | A metaphor hook that doesn't say "hiring" → the reveal → roles as a numbered list → one action | The reveal is low-key: a grey line under the big words.                          |
| Greeting         | One symbol in the brand colour, at least 75% empty space, one line                             | A brand glyph can replace part of the symbol; no logo lock-up needed.            |
| Teaser           | One shape or crop that hides the thing, the date if there is one                               | Never show what is being teased.                                                 |
| Humour           | The same setup and punchline template on every slide; the last slide says why                  | Topical "what if" pictures are photoreal and impossible.                         |
| Collab           | "A × B" set as words, both names the same size                                                 | Never draw either logo.                                                          |
| Market entry     | From → to, as a split picture                                                                  | Only places and dates the brand gave.                                            |
| Website showcase | The real capture in a device on a calm set in brand colours                                    | Headline above or beside the device, never on the screen.                        |

## Captions

A pun, a quoted line or a question opens. One or two emoji at most. Case
studies carry the credits block. The close is a question or the link.
Engagement bait ("comment X to get Y") appears in the set and stays banned
(`viral.ts`).

## The clips, measured

All 4:5 at 720×900, 30 fps, silent, with no cuts. Each moves in a
hold → move → hold rhythm: about a second resting so the screen can be read,
then one smooth move, every 1.5–2 seconds, one interaction per clip. The last
frame matches the first so the feed loops cleanly. Topical reels use a
flip-book instead: 6–7 matched stills of about 0.8 seconds each, cut hard.

Mellox's website reel (`site-reel.ts`) follows the first: 3–5 stops down the
first few screens of the page, a 1-second hold and a 1.2-second eased scroll
between them, then back to the top: 6–12 seconds in all.

## Round 3: product hero posters

One skincare brand's feed (15 posts) against one Mellox post that pasted the
whole product photo into a rounded card with clip-art around it.

- One product per post, cut out and large (55–75% of the frame), never in a
  frame or card.
- Tone-on-tone: the backdrop is a light tint of the pack's own colour, the
  type a deep shade of it, plus one contrasting accent.
- The product's own formula is the prop: a gel pour, a cream swirl, foam,
  drips. Nothing unrelated.
- Recurring stagings: a glow sweep on a curved horizon, a wet glass ledge, a
  macro crop running off the frame, a podium stack, a benefit column with
  small matching icons.
- The same handling every post, so the feed reads as one series.

Distilled into `src/lib/studio/product-hero/` (ADR-0040), the `benefit-list`
art-direction layout for services, and the product-hero deliverable.

## Round 4: campaign poster prompts and caption patterns

About 35 published poster prompts the team collected (giant-object fashion
ads, product worlds, sports posters, birthday and travel posters, exploded
infographics), plus a public library of 112 fill-in-the-blank caption, hook
and carousel prompts. Most poster ideas were already in the library from
rounds 1–3 (`monument-object`, `hero-world`, `exploded-view`,
`miniature-diorama`, `portal-pop-out`, `name-on-the-wall`, `peak-action`,
`pop-collage`, `quiet-editorial`, `literal-metaphor`, `material-swap`,
`double-exposure`, `film-strip-cutout`); nothing was removed. New:

- Layouts `portrait-backdrop` (a huge profile portrait behind, the same person
  small in front, one word cut in vertically), `carved-relief` (a number or
  shape carved into a wall, the subject breaking out), `sculpted-backdrop`
  (a wide stance in front of glossy inflated shapes, a lowercase word behind)
  and `annotated-giant` (the product at the size of a seated person, with thin
  callouts).
- Craft rule: oversized things look real only through contact (shadow,
  reflection, fabric folds).
- Deliverable `milestone` (anniversaries, "turns 5", follower counts): the
  figure from the copy as a carved or sculpted object, never invented.
- Carousels: `insights` (what each finding means, most surprising first, only
  supplied figures) and `soft-sell` (teach first, offer at most a quarter of
  the slides). Steps may name the usual mistake, comparisons end with a rule
  for choosing, checklists are specific actions in before/during/after order.
- Openings `relatable` and `curiosity` (an honest open loop that is paid off).
- Caption rule: written for a phone, benefits over features, no hype words.

What was left out on purpose: the prompts' model names, "8K" and other
quality tags (the gateway picks the model), famous people and other brands'
logos or slogans, and "comment KEYWORD for the link" (still banned bait).

## Round 6: small-business post wall (2026-11-14)

About 60 posts on a public "made with" wall of another AI marketing tool:
restaurants, campsites, parking, cleaning products, property software,
advisers, founders' own photos and a few stock editor templates. Nothing was
copied; every lesson below is rewritten brand-neutral.

**What the best ones do**

- **Portrait 4:5, words in the top third, picture below.** The headline sits
  top-left on a generous margin; the picture fills the rest; the logo is small
  in a corner; the button is a small pill low down. One accent colour.
- **Real photos carry the post; design only frames them.** A colour band
  across the top with a two-line headline (first line regular, second bold),
  or a light panel with a curved lower edge, or words straight on the sky, or
  a small dark card in a corner with one figure. Faces are never covered.
- **Copy shapes that keep working:**
  - a flipped pair of short sentences ("Small shop. Big hours.");
  - "No X. No Y. Just Z.";
  - two things people confuse, set as "X ≠ Y";
  - a real fact about right now (the water is 22° this week);
  - "We built the … we wish we'd had" (only when true);
  - a quiet lowercase line under one still object.
- **One idea, one object.** A padlock for "the load gets lighter", three
  linked rings for "one system", a single chair for hospitality: lit like a
  product, a short line above, a thin accent rule.
- **Emphasis is one move:** a coloured key word, an italic phrase in a serif,
  or a thick underline, never two at once.
- **Founders' own candid photos** (a team, a milestone, a joke) go out with
  no overlay at all; "Post as is" already covers that.

**Mistakes seen:** stock-template posts with script fonts, lorem ipsum,
decorative blobs and three typefaces look dated next to the rest. The
type system (one display face) and "never invent" rules already refuse them.

**Where it lives**

| Lesson                                                                                                                                                                               | Module                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| How words go on a person's own photo (8 treatments, picked clear of faces)                                                                                                           | `photo-design/overlays.ts` → `plan.treatment` → `designLayerPrompt` |
| 10 picture layouts (`not-equal`, `still-object`, `symbol-object`, `line-engraving`, `outcome-chips`, `iso-panel`, `heritage-ornament`, `blob-event`, `named-hero-card`, `edge-word`) | `art-direction.ts`                                                  |
| Deliverable `mix-up` ("X ≠ Y"); event, quote, intro and product hero prefer the new layouts                                                                                          | `creative-knowledge.ts`                                             |
| 7 ad layouts (`photo-band`, `founder-promise`, `negation-trio`, `not-equal`, `live-moment`, `checklist-split`, `stat-card-photo`), listed under the objectives                       | `ad-formats.ts`, `ad-objectives.ts`                                 |
| Openings `paradox`, `negation`, `right-now`                                                                                                                                          | `memory.ts` (`HOOK_STYLES`)                                         |

Checked by `round6-recipes.test.ts` and `photo-design/overlays.test.ts`.
How to use and extend them: the `studio-design-recipes` skill
(`.claude/skills/studio-design-recipes/SKILL.md`).

## Mistakes seen in the set (and guarded against)

- A cover promising "8 slides" over 6 slides → `carouselStoryIssue` refuses it.
- The logo jumping corners between slides → the logo corner is fixed per look.
- Half-resolution clips → reels are rendered at one size all the way through.
- Three display faces in one piece → the type system allows one display face.
- A lead post with no brand mark or contact → every code-drawn slide carries
  the brand name; the closing slide carries the action.
- Background tones that don't match between slides → one colourway per carousel.
- Low-resolution cut-outs → the brand's own pictures are placed by code at
  full size; a product hero's cut-out is checked and cleaned before use.
- A product photo pasted in a card with clip-art (round 3) → product hero
  posters, `HERO_NEVER`, and "no unrelated props" in the quality check.

## Round 7, November 2026: illustrated brand worlds

Five posts and the landing page of one brand that paints everything in one
illustrated world (kept in `Post Training/2026-11-illustrated-world/`, never
named in the product). What makes the set read as one brand:

- **One world, every time.** Hand-painted watercolour with soft anime-style
  linework; the same mountain-lake landscapes and warm wooden interiors; golden
  light; cream skies. The website hero is the same painting as the posts.
- **A recurring figure** in the same clothes, usually seen from behind or with
  its face hidden, so it never competes with the message.
- **One type signature.** A high-contrast editorial serif in sentence case, two
  lines, centred in the top third, with one word set in italics in the brand's
  gold. The wordmark sits small and centred above it.
- **The product lives inside the world.** A laptop on a desk by the window, or
  product cards floating around a relaxed figure on soft motion trails, never a
  raw screenshot pasted on top.
- **Metaphor by landscape.** A figure on a high rock looking over a valley where
  the idea appears as a network of lights.

Where it lives: the style bible (ADR-0048) learns any brand's version of these
from its own site and posts; the layouts `illustrated-world-poster`,
`ui-in-scene`, `orbiting-cards` and `vista-metaphor` (`art-direction.ts`) carry
them brand-neutral.

## Round 8, November 2026: designed graphic systems

One agency's website and six of its posts (notes in
`Post Training/2026-11-designed-system/`, never named in the product). Round 7
was a painted world; this is the opposite register, and both must keep working.
What makes the set read as one brand:

- **A series frame.** Every slide opens with a dark top band (the mark small at
  the left, a slide counter pill in the accent colour at the right) and many end
  with a dark footer band carrying the site address and one diagonal accent
  slash. The frame, not a picture style, is what you recognise first.
- **Three colours only.** Black, white and one coral red, plus a medium grey for
  paragraphs. The website uses exactly the same: red buttons, black stat band,
  outlined icon cards.
- **Type does the work.** A heavy geometric grotesk in capitals, three or four
  lines, base colour with two or three key words in the accent colour; one hand
  -drawn accent underline under a word on some slides.
- **Repeated building blocks.** An outlined eyebrow pill ("02 - section"), line
  icons in rounded outlined squares with a label (a list or a 2x4 grid), a hub
  diagram (big outlined circle, four satellite icons), an annotated phone (accent
  dots linked to short labels), team portraits in a dashed ring, a "key takeaway"
  callout box, a pair of buttons (filled "follow" with an arrow, outlined
  "discuss a project"), thin connector lines ending in a dot.
- **More words than a poster.** Headline, one paragraph, a list and buttons on
  most slides: an explainer carousel, not a mood picture.
- **The logo is part of the frame**, small; slides without the frame carry none.
- **Real work, framed.** Screenshots and phones in rounded frames with a soft
  shadow, never a painted or 3D scene.

Where it lives: the bible's `register`, `frame`, `components`, `text` and
`logo` (ADR-0048 round 8); the layouts `framed-system-slide`, `service-hub`,
`icon-grid-card` and `annotated-device` (`art-direction.ts`); campaign pieces
get an eyebrow heading and button through `wantsSupportingLines`.
