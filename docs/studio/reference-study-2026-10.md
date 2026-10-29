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

| Kind | Structure | Notes |
| --- | --- | --- |
| Case study | Cover (the identity on its hero object) → one touchpoint per slide → quiet end card | Caption ends with a credits block: "Client · category", then "Scope: a · b · c". |
| Agency intro | Hook → what we do (numbered) → who it's for → proof → action that calls back to the cover | Plain words; the proof is real work, not adjectives. |
| Hiring | A metaphor hook that doesn't say "hiring" → the reveal → roles as a numbered list → one action | The reveal is low-key: a grey line under the big words. |
| Greeting | One symbol in the brand colour, at least 75% empty space, one line | A brand glyph can replace part of the symbol; no logo lock-up needed. |
| Teaser | One shape or crop that hides the thing, the date if there is one | Never show what is being teased. |
| Humour | The same setup and punchline template on every slide; the last slide says why | Topical "what if" pictures are photoreal and impossible. |
| Collab | "A × B" set as words, both names the same size | Never draw either logo. |
| Market entry | From → to, as a split picture | Only places and dates the brand gave. |
| Website showcase | The real capture in a device on a calm set in brand colours | Headline above or beside the device, never on the screen. |

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

## Mistakes seen in the set (and guarded against)

- A cover promising "8 slides" over 6 slides → `carouselStoryIssue` refuses it.
- The logo jumping corners between slides → the logo corner is fixed per look.
- Half-resolution clips → reels are rendered at one size all the way through.
- Three display faces in one piece → the type system allows one display face.
- A lead post with no brand mark or contact → every code-drawn slide carries
  the brand name; the closing slide carries the action.
- Background tones that don't match between slides → one colourway per carousel.
- Low-resolution cut-outs → the brand's own pictures are placed by code at
  full size, never cut out by a model.
