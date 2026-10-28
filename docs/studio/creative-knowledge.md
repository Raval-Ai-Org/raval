# Creative knowledge for Studio pictures

How Mellox briefs the image model for post images, carousels, Stories and ads,
and where those rules came from.

## What it is

Two pure, browser-safe modules feed every picture prompt:

- **`src/lib/studio/art-direction.ts`**: 21 campaign layouts (oversized
  object, product in its own world, exploded view, miniature diorama, spotlight
  noir, flat-lay story, callout board, material lettering, clean split, number
  monument and more), each with a scene, a typography treatment, light and
  camera, finish and what to avoid. Plus the craft rules every picture gets and
  the carousel series system.
- **`src/lib/studio/creative-knowledge.ts`**: the production side.
  - **Deliverables:** offer, event, hiring, launch, quote, tips cover, feature
    board, comparison, product hero and brand moment. Each one has a reading
    order, a layout, copy rules and a "never invent" list. `detectDeliverable`
    picks one from the piece's own words with plain string matching, and each
    deliverable prefers the layouts that suit it.
  - **The prompt contract:** exact copy is set as data
    (`verbatimTextBlock`, "TEXT — RENDER VERBATIM") with a fixed line count and
    one emphasis treatment per brand. The image prompt ends with a quality
    check (`qualityCheckLines`) that says to simplify rather than add.
  - **Type system:** a scale in proportions of the canvas width, two
    typefaces, 4.5:1 contrast and safe margins.
  - **Writer rules:** the two-second cover test, the silent self-review
    before a carousel is returned, and the concept method (pick the one image
    that sells the idea, the glance test, styles named by era and technique,
    never by a living artist or another brand).

## Where it is used

| Surface                                  | What it gets                                                                                              |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Post images (`buildImagePromptDetailed`) | deliverable, layout, exact headline from the brief (`onImageText`), type system, final check              |
| Image brief (`buildVisualBriefPrompt`)   | layout menu (`artDirection`), concept method, campaign-line headline                                      |
| Carousel slides (`carouselSlidePrompt`)  | series system, deliverable and layout on the cover, verbatim copy with emphasis, type system, final check |
| Carousel writer (`buildCarouselPrompt`)  | cover test, self-review                                                                                   |
| Story frames (`storyFramePrompt`)        | verbatim copy, type system, final check (no letters when Mellox draws the words)                          |
| Connected carousel background            | real material and light, never a gradient mesh                                                            |
| Ads (`buildAdPrompt`)                    | key-visual art direction and the concept method                                                           |
| "Write it for me" (`prompt-writer.ts`)   | cover test, a scroll-stopping image idea, ad visual detail                                                |

A brand look with its own layout, or reference posts to match exactly, keeps
that layout: the library then only adds craft rules.

## Rules for changing it

- Add a layout or deliverable in the module; never in one prompt only.
- Never name another company, campaign, celebrity or living artist in it (tests
  check the common ones).
- No engagement bait ("comment YES"), in line with `src/lib/studio/viral.ts`.
- Product-only layouts stay behind `sellsPhysicalProduct`; a pack the model
  hasn't seen stays unlabelled.

## Sources and licences

The rules were distilled and rewritten in Mellox's own words from the projects
below. No prompt library was copied in. Changes were made to everything used:
it was condensed, generalised to any brand, and combined with Mellox's own
rules.

| Source                                                                                                                                           | Licence                                                   | What informed Mellox                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [GPT Image 2 Prompts](https://github.com/apimodels/gpt-image-2-prompts) by API Models ([apimodels.app](https://apimodels.app)), commit `980d100` | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | The structure of strong commercial prompts (format, hero, surface, light direction, named palette, lens and angle, mood, exact text with its placement), emphasis treatments, offer and carousel-cover patterns                        |
| [Awesome Nano Banana Pro Prompts](https://github.com/flaqai/awesome-nano-banana-prompts) by Flaq AI, commit `58f7077`                            | MIT                                                       | The prompt contract (function, layout, assets, quality locks), verbatim text blocks, reference roles, concrete negatives, the final check, deliverable recipes (offer, event, quote, feature board, exploded view, material lettering) |
| [Viral Carousel AI Agent Skill](https://github.com/RahulMirji/Carousel-Skill) by Rahul Mirji, commit `d1a0973`                                   | MIT                                                       | One idea per slide, the two-second cover, one focal visual, the self-review checklist                                                                                                                                                  |
| [Open Carrusel](https://github.com/Hainrixz/open-carrusel) by Enrique Rocha (@soyenriquerocha) and contributors, commit `27ea3cd`                | MIT                                                       | The type scale, margins and safe area, hook shapes, varied layouts inside one system                                                                                                                                                   |
| [prompts.chat](https://github.com/f/prompts.chat) by Fatih Kadir Akin and contributors, commit `8d430cd`                                         | Prompts CC0 1.0, code MIT                                 | The concept method (pick the moment that sells, glance test, styles by era and technique), product lighting setups, the mirror and miniature-store layouts                                                                             |

Deliberately left out: other brands' palettes and names, comment-trigger calls
to action, "swipe" prompts inside the artwork, and any prompt that clones a
real person or a living artist's style.

### MIT notices

The MIT-licensed sources above are used under these terms:

> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in
> all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

- Copyright (c) 2026 Flaq AI
- Copyright (c) 2026 Rahul Mirji
- Copyright (c) 2026 Enrique Rocha (@soyenriquerocha); Copyright (c) 2026 Open Carrusel Contributors
- Copyright (c) 2022-present Fatih Kadir Akin and contributors

## Checking it

```bash
npx vitest run src/lib/studio/art-direction.test.ts src/lib/studio/creative-knowledge.test.ts \
  src/lib/post-image.consistency.test.ts src/server/studio/visual-prompts.server.test.ts
```

These check the prompts, not the pictures. Whether the pictures got better is
judged by generating real pieces for a few brands and comparing them.
