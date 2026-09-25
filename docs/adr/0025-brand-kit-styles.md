# ADR-0025: Brand Kit and Styles

- Status: Accepted
- Date: 2026-09-25
- Builds on: ADR-0014 (canonical workspaces); Brand DNA (`workspace_brand_dna`)

## Context

Brand DNA says who a brand is: facts, audience, voice, rules, a few colours and
fonts as free text. It can't express a repeatable *look and writing style*
("our launch posts", "calm educational tips"), fonts never loaded, logos were
only a scraped URL, and the image style was guessed from the voice. Studio
images, chat and the coach also read a browser copy of Brand DNA.

People want to show Mellox examples ("make it look like this"), keep several
looks per brand, and have every generator follow the one they pick.

## Decision

1. **A Style is a named recipe** (`brand_styles`, spec in
   `src/lib/brand-kit/spec.ts`): writing (voice, tone sliders, emoji, hashtags,
   hooks, banned words, examples, per-format notes), look (palette roles, fonts,
   medium, mood, light, layout, text on images, logo use, "never"), video (pace,
   shots, captions) and references to example posts with a strength
   (loose / close / exact).
2. **Brand DNA stays the source of facts.** A style inherits colours, fonts,
   voice, logo and rules from Brand DNA field by field (`inherit` toggles, on by
   default). `resolveStyle` (`src/lib/brand-kit/resolve.ts`, pure) is the only
   merge, used by the server and the browser previews alike. "Copy colors and
   fonts to Brand DNA" writes through the browser's Brand DNA store so its
   debounced save can't overwrite it.
3. **One entry point for generators:** `loadResolvedStyle(workspaceId, choice)`
   (`src/server/brand-kit/resolve.server.ts`). `choice` is a style id, `"none"`
   (Brand DNA only) or empty (the workspace default). It reads Brand DNA on the
   server and only trusts a style id found inside the verified workspace.
   An explicit pick always applies; the default only applies to the formats it
   lists (`applies_to`).
4. **Wired everywhere that creates:** Studio text prompts (`## Style` section),
   Studio images (visual block, palette and fonts override, logo variant and
   corner, reference images through the existing image-to-image route, still the
   premium KIE model), Studio video, the caption naturalize pass (keeps style
   phrases and hashtags), UGC concepts and renders, chat drafts, the calendar and
   post-image generators (`brandStyle` on `/api/generate-image`, applied only
   for a verified `x-workspace-id`), content batches, social-multi, campaign
   briefs and experiment copy (voice only). GEO/CMS fixes are out on purpose:
   factual copy bound by grounding rules.
5. **Learning from examples uses Claude vision** through the Anthropic gateway
   (new `images` option; metered and budget-checked). Writing samples are
   wrapped as untrusted data. Analysis runs in `after()`, claimed by
   compare-and-set on `analysis_status` so a double click never pays twice; a
   stuck run is retried after 10 minutes. `mergeAnalyses` (pure) turns several
   examples into a suggestion; `applySuggestion` never overwrites a field a
   person set (`provenance`).
6. **Uploads go straight to Storage** via one-time signed upload URLs for paths
   the server chose (`workspace/<id>/assets/brand-kit/<asset>/…`);
   `finishUpload` checks size and type before recording. Big images are shrunk
   in the browser; a video is read from four still frames grabbed in the browser.
7. **No new cron job, no new provider.** Rate-limit tiers `brand-kit-upload`
   and `brand-kit-analyze`.

## Consequences

- Studio jobs and assets record `style_id`; a revision keeps its draft's style.
- The review panel checks drafted text against the style's mechanical rules
  (`checkWritingConformance`, free) and offers a one-click "Fix".
- Uploaded fonts are used in previews and canvas overlays; image models only get
  the font described in words, so exact type on images comes from the overlay.
- SVG uploads are refused (served from a public bucket).
