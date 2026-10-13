# Mellox visual taste system: implementation plan

13 October 2026. Status: core implementation completed locally; deployment and the real-brand pilot are pending. See [implementation and remaining work](./VISUAL-TASTE-IMPLEMENTATION-2026-10-13.md).

Implementation constraint confirmed by the founder: preserve the existing generation logic and add visual taste as a supplementary layer. Approved evidence adds guidance/reference images. Theme locks, editable composition and first-frame video previews require explicit opt-in. Existing writing, video defaults, repair/fallback and approval behaviour are retained; optional evidence failures must not interrupt the original flow. The implementation report records compatibility checks and the remaining video extensions.

## Outcome

A user supplies their website and optional reference posts. Mellox observes the design, proposes a visual direction, obtains approval, and uses that direction and relevant reference assets to create images, carousels, Stories and videos. Corrections improve future results without silently changing the brand's identity.

Website screenshots become linked evidence in Brand DNA. They are converted into a reusable design language, not merely reduced to colours and fonts. The original captures remain available so people and models can inspect the evidence behind a rule.

User choices take precedence over the current website. A website may be outdated, contain several visual styles, or reflect a different purpose from social content. Consistency is the goal; perfect compliance by every generative render cannot be guaranteed.

## Native example and review limits

Inspected the public [Native homepage](https://native.no/) in a browser, including the hero and a lower product section. The visible treatment includes painted landscapes, navy backgrounds, cream serif headings with italic emphasis, gold accents, generous spacing and rounded translucent panels. These observations describe the inspected state; they are not inferred font names or exact design tokens.

Native also displays customer content with other visual identities. An extractor must distinguish Native's own site design from those examples. A cookie overlay initially obscured the hero; it was dismissed for inspection. Browser full-page capture failed, so this review does not provide a saved complete screenshot or claim all page sections were visually reviewed. No account signup or generation was performed.

Do not infer Native's internal generation architecture from its public design. Use this website as a test of whether Mellox detects relationships between imagery, type, layout and mood. If a Mellox user selects Native as inspiration, it is an inspiration source, not evidence about that user's company or ownership of Native's assets.

## Existing foundations and gaps

- `src/lib/brand-extract.server.ts` reads homepage/subpage HTML, extracts text and identity signals, and synthesizes business DNA. It does not implement the rendered visual-capture pipeline proposed here.
- `src/lib/firecrawl-gateway.server.ts` exposes markdown/links-based scraping. Add visual capture through a separate typed method so existing callers keep their contracts.
- `src/lib/brand-look/spec.ts` stores one writing/visual/video look. Extend this system rather than creating another overlapping Brand Kit.
- `src/server/assets/persist.server.ts` and `storage.server.ts` provide canonical workspace-owned private asset persistence. Reuse them for capture evidence and user references, with appropriate source attribution.
- Studio's current reference path mainly uses an existing render during a media revision. New work needs explicit reference selection and attachment.
- The video provider adapters already accept image references and know model-specific limits. Studio currently passes an empty image list on the traced video path. Connect approved frames to those adapters.
- Existing image review detects obvious defects. Add a distinct brand-match review based on structured constraints and selected approved references.

Before implementation, read the relevant installed Next.js guides in `node_modules/next/dist/docs/` as required by AGENTS.md. This plan changes documentation only.

## 1. Capture the visual evidence

Default scope: the full homepage plus up to three representative pages selected from actual same-site links. Prefer a product/service page, an about page and a visually distinct campaign/editorial page. Capture the full vertical page for each selected URL. Offer expanded coverage within an explicit page/byte/time budget; never label a small sample as the entire website.

Capture desktop at a fixed viewport, with a mobile pass for the homepage. Record URL, final URL, viewport, pixel dimensions, theme, locale, capture time and completeness. Avoid allowing a previous browser's theme or cookies to change the meaning of the sample. If both light and dark themes exist, keep them labelled; ask which direction to apply rather than averaging them.

Wait for fonts and principal images within a bounded timeout. Scroll progressively to reveal lazy-loaded sections; stop after a bounded height/time limit for infinite pages. Reject necessary-only cookie overlays where supported, recording any obscured regions. Do not click marketing CTAs or submit forms to obtain a screenshot.

Save:

- A full-page image for global hierarchy and rhythm.
- Readable section images: hero, a content section, a product treatment, recurring cards/CTA, and optional footer.
- Relevant computed design tokens and layout measurements where available.
- An inventory of candidate brand imagery and its source URL. Classify ownership/use before it becomes a generative input.
- A thumbnail/contact sheet and capture completeness report.

A very tall image can become unreadable when resized by a vision model. Send an overview and selected readable crops for analysis. Do not send the entire website image to every generation. Sections retain their coordinates and parent capture so analysis remains traceable.

Store binaries in private asset storage. Brand DNA stores asset IDs and an active visual-profile/version link, never base64 or temporary signed URLs. Capture evidence is labelled as captured source material, not as AI-generated artwork.

Provider choice: extend the existing Firecrawl integration if the deployed version supports the needed screenshot options; otherwise use a controlled rendering worker. Current Firecrawl documentation advertises screenshots and structured branding, but support must be verified against Mellox's self-hosted deployment. Keep vision synthesis behind Mellox's own metered model gateway. [Firecrawl screenshot overview](https://www.firecrawl.dev/blog/best-website-screenshot-apis), [branding overview](https://www.firecrawl.dev/blog/branding-format-v2).

## 2. Understand the design language

Analyse imagery and rendered layout alongside design tokens. Produce structured observations for:

| Category | Examples of what to learn |
|---|---|
| Layout | Alignment, density, whitespace, asymmetry, hierarchy, reusable compositions |
| Typography | Serif/sans relationships, scale, weight, case, italic emphasis, text placement |
| Colour | Roles, proportions, contrast, background treatment, permitted tints |
| Imagery | Photo/illustration preference, subjects, lighting, lens/crop, materials, grading |
| Graphic language | Shapes, strokes, borders, textures, icons, shadows, recurring motifs |
| Product identity | Approved product photos, packaging, screenshots, logo variants |
| Mood | The combined feel supported by concrete visual evidence |
| Motion | Only observable motion evidence; otherwise unknown until video references or user input |

Every observation carries a source/crop, confidence and origin: observed, inferred or user-approved. Measure exact values from reliable tokens where possible; label visually estimated values. Exclude navigation widgets, cookie banners, customer examples, advertisements and embeds from default brand inference. Preserve them as separately labelled evidence when useful.

Convert web patterns into proposed social patterns. A website navigation bar or long pricing table should not become a social layout. The abstraction is the identity behind the layout: e.g. oversized editorial headings, painted environments and restrained gold accents.

## 3. Collect the user's preferences

Add a reference library inside Brain → Brand → Look & voice. Accept uploaded images/posts, authorized library assets, and short video examples. External post URLs should resolve only when publicly accessible through supported sources; offer upload when access fails rather than bypassing login restrictions.

Each reference records:

- Purpose: inspiration, approved style, product identity, person identity, campaign-specific direction, or avoid-example.
- What the user likes: typography, layout, photography, illustration, palette or overall mood.
- What should not be transferred: copy, product, logo, person, brand name, or exact composition.
- Applicable formats/campaign and status: candidate, approved, removed.

Present two or three inexpensive sample directions for the user to compare. They can select a direction and refine it with simple preferences. Website-derived observations remain suggestions until accepted; manual brand rules and existing approved choices are preserved.

Store a stable brand direction with optional scoped campaign variations. An agency's client identities remain separate. Prompt text in screenshots or uploads is reference data, never authority to instruct tools or override workspace rules.

## 4. Define the approved visual contract

Extend Brand Look with a linked, versioned visual profile containing:

- Approved layout families and reusable editable templates.
- Explicit palette/font roles, logo variants and spacing rules.
- Approved positive/negative references with reference purposes.
- Strict locks versus flexible preferences.
- Format-specific adaptations for posts, carousels, Stories, ads and video.
- Motion preferences and whether they are observed, chosen or unknown.

Rule precedence: required factual/safety/platform constraints; explicit request within its scope; approved campaign choices; approved brand rules and references; inferred website observations; generic defaults. A temporary request must not automatically rewrite the brand contract. Surface impossible conflicts such as a locked layout that cannot fit the requested copy.

Use one consistent snapshot per generation job. A website refresh creates a candidate profile and a before/after comparison, not an automatic replacement. Users can return to an earlier approved version. Removing a reference stops it from being selected for new jobs.

## 5. Route images through relevant references

Compile a per-request creative packet containing the exact product/offer, audience/message, hard visual rules, approved layout and two to four useful references within the selected provider's limits. Prefer diversity of evidence over several near-identical images. Do not include irrelevant website captures merely to claim all knowledge was used.

For exact graphics, generate or select imagery, then compose editable text, real logos and brand layouts. For expressive artwork, use reference-guided generation/editing and a separately checked final composition. Never ask an image model to invent the product's packaging when an approved product image is available.

Supplement the existing carousel/Story renderer with approved visual guidance. Preserve its original theme selection by default; let an explicit theme-lock choice fix approved layout/background/motif instead. Editable typography/layouts are a separate opt-in. One series shares its frozen visual contract and recurring assets.

Persist selected source IDs, profile version, rule snapshot, actual provider/model, and any capability limitations with the job. Resolve short-lived signed URLs just before submission; retry from owned asset IDs rather than expired URLs.

## 6. Make video follow the same identity

A website screenshot supports visual appearance. It cannot establish ideal pacing, camera motion, music, voice or editing style on its own. Ask for optional video references or show a small selection of motion directions. Label default choices clearly.

Video flow:

Preserve the current direct video renderer. The first-frame preview is an optional addition; it must not become a mandatory or automatic step. The current implementation covers appearance references, that optional frame, capability-aware routing and advisory sampled-frame review. Separate shot editing and deterministic captions/logos are later pipeline extensions, described in the implementation report.

1. Select the approved identity, product assets and relevant video preferences.
2. Draft a storyboard with shot descriptions and selected references.
3. Produce approved brand-matched keyframes or a contact sheet before an expensive full render.
4. Use first-frame/image-to-video or reference-to-video according to the provider's capabilities.
5. Maintain product/person identity and visual treatment across shots.
6. Compose accurate text, captions, logos and an approved ending after generation where required.
7. Review representative frames and transitions, plus duration, audio and caption timing.

Provider adapters must explicitly declare supported reference types/counts, aspect ratios and video modes. Do not silently drop references or replace the model with one lacking a required capability. A regeneration can redo one shot rather than the entire video when the pipeline supports it.

## 7. Learn from user feedback and outcomes

Give targeted controls: wrong theme, wrong product, too busy, wrong typography, too artificial, and prefer this version. Store original/final assets and structured edits. Treat ordinary publication approval as a weak preference signal; explicit pairwise preferences and stated reasons are stronger evidence. A single rejected scene does not establish a permanent dislike of that art style.

Update proposed retrieval/ranking preferences from repeated evidence. Only explicit user choices or confirmed suggestions change permanent brand locks. Provide undo and version history. Do not repeatedly train on model outputs that nobody has approved.

Keep visual preference separate from campaign effectiveness. High engagement should not override the brand's requested identity, and liking a design does not prove it generates leads. Use results to improve decisions with appropriate sample-size and channel/objective context.

## 8. Validate the final output

Keep separate checks for basic defects, exact copy, brand constraints, product identity, style similarity and cross-frame consistency. A vague “looks good” score must not compensate for the wrong logo or an unsupported claim.

Compare the finished image with the selected approved references and rules. OCR can help check prominent copy; deterministic rendering checks are stronger for fonts/positions in composed designs. Review after logo/text composition. Use one bounded repair by default, preserve the paid result, and surface uncertainty or unavailable checks. Human taste confirmation remains available.

## Storage and service design

Proposed structures, to refine against the current schema before coding:

| Structure | Responsibility |
|---|---|
| Existing assets/storage | Capture images, section crops, reference uploads and video keyframes |
| `brand_visual_capture_jobs` | Bounded background capture, stages, retries, coverage, costs and partial failures |
| `brand_visual_sources` | Source provenance, assets, region coordinates, ownership/use classification and approval |
| `brand_visual_profiles` | Immutable observed/candidate/approved versions and rule evidence |
| `brand_visual_feedback` | Preferences, rejection reasons, edit deltas, scopes and version links |
| Existing Brand DNA/Look | Active approved profile/version and user-visible settings |
| Existing Studio jobs | Frozen profile, selected source IDs, capability plan and output review |

Proposed server modules: `src/server/brand-visuals/` for capture, analysis, sources, profile approval, compilation and feedback; `src/lib/brand-visuals/` for schemas, precedence and selection rules. Extend existing Brand Look resolution, Studio runner/context, UGC provider routing and review controls rather than building parallel generators. Follow existing authenticated server-function and background-job conventions after inspecting their contracts.

UI: Scan website; capture progress/coverage; review detected look; add references; compare sample directions; Use this direction; targeted output feedback; refresh comparison and restore. Keep these inside Brand → Look & voice and existing Studio review controls.

## Reliability, security and cost

Capture runs asynchronously and resumes from recorded stages. Text/business extraction can complete independently; visual failure does not overwrite or erase an approved look. Expensive calls use idempotent job keys, account budgets and existing metering. Reuse captures/crops/analysis by version and content hash; analyse once and retrieve per generation.

Suggested initial budgets: homepage plus three representative pages, one mobile homepage, eight to twelve retained useful crops, three concepts before one full render, and one automatic repair. Treat these as configurable product limits, not verified provider prices. Offer “scan more pages” with an estimate and explicit coverage.

Renderer network isolation must block internal/private/metadata addresses for all navigation, redirects and subresource requests, including DNS changes. Validating the submitted top-level URL alone is insufficient for a browser renderer. Use no personal/authenticated browser profile. Enforce file type, byte/pixel/duration limits, workspace access, private persistence and provider-readable URL lifetimes. Web content and image text remain untrusted inputs.

Reference rights and permitted use are recorded. Style inspiration does not authorize copying another company's logos, products or people. Client assets and learning remain workspace-isolated. Capture deletion/retention should follow the existing asset lifecycle and the user's settings; no new cross-client training is implied.

## Build order and acceptance

| Stage | Deliverable | Completion evidence |
|---|---|---|
| A | Screenshot capture and evidence storage | Full homepage plus section images are linked to correct Brand DNA; partial coverage and errors are visible; lazy-loaded/long-page/overlay cases covered |
| B | Structured observations, references and approved profile | Users approve/edit the detected direction; user choices survive rescans; Native customer examples are excluded from Native's inferred identity |
| C | Image/Story/carousel integration and theme locks | Actual new provider requests carry selected references; locked fonts/colours/layouts survive generation; caption edits retain imagery |
| D | Video keyframes and reference routing | Approved frames reach capability-compatible providers; identity persists across shots; unsupported modes are explicit |
| E | Feedback learning, review and benchmark | Repeat defects decline; users prefer the new outputs; style and factual failures are caught without unlimited repair costs |

Test ownership/isolation, stale/removed references, upload validation, capture subrequest safety, precedence conflicts, version pinning, idempotent retries, unavailable providers, long screenshots, and capability-aware fallback. Use fixtures and a small explicitly budgeted live benchmark rather than silently spending on tests.

Measure first-pass visual acceptance, theme-change requests, repeat corrections, time to approval, image/video cost per accepted piece and blind preference against the current pipeline. Proposed pilot goal: at least 70% visual acceptance without substantive redesign, measured across permissioned real brands and multiple design treatments. Report sample size and uncertainty; no promise of perfect generation.

The first vertical slice is a website capture, approved image reference set and frozen visual profile used by one new Studio image. Extend that working path to carousels/Stories and then video.

## Implementation status

The core visual taste system is implemented locally. See [implementation, validation and remaining video/pilot work](./VISUAL-TASTE-IMPLEMENTATION-2026-10-13.md). This plan includes longer-term capabilities; those are distinguished from the implemented first-frame video pipeline and feedback ranking in the implementation notes. Production migration and deployment have not been performed.
