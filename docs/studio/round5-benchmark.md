# Round 5 benchmark (prompt level, $0)

**What was tested.** 100 fixed cases (`evals/creative/cases.ts`): 20 image, 20 sales, 15 memes, 15 carousels, 10 educational, 5 UGC, 5 video and 10 campaigns, across 20 fixture brands in English, Urdu and Roman Urdu.

`tests/bench/creative-prompts.bench.ts` runs each case through the real prompt builders, with no network, and saves every system and user prompt. It ran once before the change (`baseline`) and once after it (`after`), into `H:\MelloxResearch\bench`.

```bash
BENCH_LABEL=after BENCH_OUT=H:/MelloxResearch/bench npx vitest run --config vitest.bench.config.ts
```

**What was not tested.** No image was generated and no model answered: the owner chose no OpenRouter spend. So picture quality, live answers, the creative review's scores and commercial results are **unmeasured**. The grading below compares the instructions each model receives, judged in this session against a written rubric. It is not a measurement of output.

## Tokens (estimated, chars / 4)

| Stage | Before | After | Why |
|---|---|---|---|
| Image brief | 3,700 | 2,771 | 8 shortlisted layouts instead of 33, plus craft |
| Sales picture brief | 3,959 | 2,995 | same |
| Educational picture brief | 3,940 | 2,893 | same |
| Sales ad copy | 2,366 | 2,783 | framework, awareness, offer and urgency skills |
| Carousel | 2,313 | 2,735 | framework, teach/narrative skills |
| Meme concept | 3,000 (Haiku) | 3,822 (Sonnet) | 10 real templates, three ideas and a critique |
| UGC concept | 1,594 | 1,679 | awareness line, customer pains |
| Video storyboard | 2,167 | 2,684 | retention and CTA rules, craft |
| Captions | unchanged | unchanged | the craft stays with the concept |
| **All 100 cases** | **431,579** | **413,277** | **−4.2%** |

## Rubric (prompt level)

Each before/after pair was scored on the same rubric: grounding, category and industry fit, offer and CTA clarity, narrative, joke structure, framework fit and anti-generic rules. Counts come from the saved prompts:

- 85 of 100 cases now get a "Marketing craft" block. The 15 without one are campaign plans (planned by code first) and the caption-only stages.
- 64 get an argument shape. No meme, relatable or quote case gets one, by design.
- All 15 memes go through the Sonnet concept: a template shortlist, three ideas, a self-critique, and words checked against the boxes.
- All 20 sales cases get the five-question sales clarity rule plus "never invent a discount, deadline, guarantee, testimonial, result or feature".
- The carousel writer no longer says "the image model typesets" (wrong for the composed flow).
- Every case's industry is recognised from its industry line. The picture brief gets that industry's look and "never for this category" line instead of a generic mood.

**Example (sales-01, an Eid lawn sale at 20% off until 10 April):**
- Before: the ad prompt had objective rules only.
- After: it adds 4Ps; reader most aware ("lead with the offer"); offer clarity (the figure as headline, "was" only for a real price); genuine urgency (the deadline named exactly); and the online-shop doubt (does it look like the photo).

**Example (meme-01, month-end bookkeeping panic):**
- Before: one Haiku call picked 1 of 8 home-made layouts.
- After: Sonnet gets 10 real templates with mechanics and use/avoid notes, the SaaS audience's worries as joke material, and selling skills deliberately removed.
- A classic meme costs no image call: the template plus code-drawn words, checked visually in `H:\MelloxResearch\bench\memes`.

## Not yet known
- Whether the 6.5 redo bar is set right. It needs real review scores from production, read from `meta` and the job warnings.
- Meme hit rate and send rate. Compare `meta.meme_mode` against measured sends once posts are measured.
- An optional small paid check (about 10 real jobs) would measure the first two items.
