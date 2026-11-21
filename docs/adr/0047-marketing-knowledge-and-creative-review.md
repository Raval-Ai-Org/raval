# ADR-0047: Marketing knowledge, creative review and meme templates (Round 5)

Status: accepted, 2026-11-13

## Context
- Studio's writers had strong format craft, but no shared sales frameworks or awareness stages, and no industry playbooks.
- Every image brief was sent all 33 layouts.
- The picture review caught broken pictures, never weak ones.
- Memes were one Haiku call on 8 home-made layouts, with nothing to judge whether the joke works.

## Decision
1. **Knowledge is code-picked, model-applied** (`src/lib/studio/knowledge/`, pure).
   - `knowledgeFor(job)` gives one piece:
     - at most one framework (12, e.g. AIDA, PAS, BAB, PASTOR, 4Ps, FAB, STAR);
     - the reader's awareness stage;
     - the sales-clarity rule for selling pieces;
     - at most three of 22 specialist skills;
     - the industry's buyer (20 playbooks).
   - It is capped at 1,800 characters and is deterministic, so prompt caches keep hitting.
   - Native kinds (meme, relatable, trend…) get no framework and no selling skills, only the audience's world.
   - Every Studio writer reads it through `craftRule`, except the caption call, which follows the concept.
2. **Layouts are shortlisted.** The image brief gets about 8 layouts, the industry's proven ones first (`archetypeMenu` `shortlist`), not all 33. The brief also writes a one-line `strategy` before the concept.
3. **Creative review scores the picture** (`image-defects.ts`, `image-review.server.ts`).
   - Rubric keys and weights depend on the piece's kind (designed / native / meme / sales).
   - A hard defect, or a weighted score below 6.5 with concrete fixes, earns **one** redo at Mellox's cost (`studio.image.rerender`).
   - The first picture is kept, and `keepFirstRender` keeps the better of the two. Never more than one redo.
4. **Memes are concepted by Sonnet** (`studio.meme.concept`). This replaces the Haiku brief for memes; it never adds a call.
   - One call writes three ideas, judges them and picks one.
   - It picks from a code shortlist of 10 real templates (`memes/select.ts`, 133 curated from memegen in `public/memes`), or makes an original scene on the 8 layouts.
   - Modes:
     - `classic`: the real template with its words drawn by code (Anton, bundled). No image cost.
     - `remix`: the image model redraws the template's scene in the brand's world with no words, and code draws the words.
     - `original`: as before.
   - Words that don't fit the boxes are sent back once (`memeConceptIssue`), then made as an original scene. A real person is never remixed.
   - Flag `FEATURE_FLAG_MEME_TEMPLATES_ENABLED` (on unless `false`). `meta.meme_format` / `meta.meme_mode` are stored so the next meme uses another template.
5. **Sync.**
   - Strategy pillars keep their `share` (`pillarSequence`), and every Autopilot slot gets a funnel stage plus the strategy's stage message (`stageLine`).
   - `syncProgramStrategy` also syncs the goal.
   - The campaign block carries the key message, the offer (exact terms), the big idea and the hashtag.
   - Learnings count saves, sends and comments per view (`actionRate`), grouped by aim, two posts per group, and are labelled "Measured". A number a network didn't report is left out.
6. **UGC** gets the customer's pains, objections, triggers and jobs from Brand DNA, plus an awareness line from its objective.
7. **Video storyboards** get a retention rule (open loop, re-hook at ~40%) for 12 s+ and a CTA rule fitted to the goal.
8. **Roman Urdu** (`ur-Latn`) is a content and UGC language, with a script note (`languageNote`).
9. **Context caps** (`src/lib/studio/caps.ts`) keep each brain block short, and `prompt-size.test.ts` caps each system prompt.

## Consequences
- The prompt-level benchmark (100 cases, no paid calls) shows estimated prompt tokens down 4.2% while every case gets the right craft. See `docs/studio/round5-benchmark.md`.
- Meme concepts cost more per call (Sonnet). Classic memes cost no image at all.
- Real image quality, live outputs and commercial impact are not measured yet.
