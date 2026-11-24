# How the Round 9 example briefs are written

Study and benchmark data (ADR-0053). Never bundled, never pasted into a prompt.
Only each brief's `mechanism` line ever reaches a writer, one at a time.
Schema: `types.ts` (`ExampleBrief`). One JSON file per group: `g1.json` … `g6.json`,
each an array of `ExampleBrief`.

## Per sector

- **Count:** 7 briefs for a `service`, `venue` or `hybrid` sector; 6 for `product` or `digital`.
- **Spread:** at least 3 different `goal`s and at least 3 different `format`s per sector.
  Goals: `sell`, `lead`, `trust`, `launch`, `event`, `moment` (a cultural or seasonal
  moment: Ramadan/Eid, Diwali, Christmas, Lunar New Year, back to school, summer,
  monsoon, Black Friday, Valentine's, Mother's Day, national days, exam season — mix
  regions, never only one country). Formats: `post`, `carousel`, `ad`, `story`, `video`.
- **Ids:** `<sector>-01` … `<sector>-07`, in order.
- `awareness`: `unaware` | `problem` | `solution` | `product` | `most`, honest to the brief.

## The `brief` (60–160 words)

Written in the format's labelled sections, each on its own line as `Label: text`:

| format | sections, in order |
|---|---|
| post | Idea, Headline, Supporting line, Picture, Caption idea |
| carousel | Idea, Cover, Slides, Last slide, Caption |
| ad | Offer, For, Angle, Headline, Supporting line, Picture, Button |
| story | Idea, Frame 1, Middle frames, Last frame |
| video | Idea, Shots, Sound, Caption idea |

- Says WHAT the piece is: the one idea, the exact words, the one picture. Never camera,
  lens, lighting, colours or fonts (the brand decides those).
- Headline 2–6 words; Cover under 8; Frame 1 under 8; ad Headline under 6; Button 1–3 words.
- Carousel `Slides`: 4 inside slides, `Slide 2: heading — one line` … `Slide 5: …`.
- Video `Shots`: 4–6 lines `Shot N (0–2s): what we see and what moves`, filmable by a small team.
- **Services:** show the real work, the people, the tools, the place, the result — never a
  symbolic object like a crane, a key, a lightbulb, a rocket, a puzzle or a handshake.
- **No figures.** No prices, percentages, counts of two or more digits, ratings, years in
  business or customer numbers. Use placeholders instead: `{price}`, `{offer}`, `{area}`,
  `{years}`, `{hours}`, `{guarantee}`, `{product}`, `{date}`, `{link}`. List every placeholder
  used in `placeholders`. Small counts written as words are fine ("Three signs").
- **No invented proof:** no testimonials, quotes, awards, "#1", "best in town", "trusted by
  thousands", before/after claims the brand didn't give. Proof comes only from placeholders
  (`{review_quote}`, `{customer_first_name}`) the brand fills from its own facts.
- **No brand names** (real companies, rivals, celebrities, platforms' products as heroes).
  The business is "we" or `{brand}`.
- **No generic phrases:** "elevate", "unlock", "game-changer", "seamless", "next level",
  "look no further", "in today's world", "one-stop shop", "take it to the next level",
  "your journey", "we've got you covered", "high-quality", "state-of-the-art".
- Every brief in a sector must be about a different situation; no two share a headline idea.
  Make them specific to how that business really wins customers (the research files in
  `docs/studio/research-2026-11/` list each sector's wants, doubts, proof and clichés).

## The `mechanism` (at most 140 characters)

Why this kind of piece sells for this kind of business, brand-neutral, as a plain fact a
writer can use. Not an instruction, not a slogan.
Good: "A fixed price agreed before work starts removes the fear of a surprise bill."
Bad: "Use a bold headline!" / "Show quality."

## Other fields

- `expect`: one sentence, what a good result shows (benchmark only).
- `source`: `"mellox-round9-original"`; `license`: `"proprietary, written for Mellox"`.
