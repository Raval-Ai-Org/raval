# ADR-0032: Brain — the four brains in one place, a workspace strategy, and one look per brand

- Status: Accepted
- Date: 2026-10-06
- Supersedes: ADR-0025 (Brand Kit and Styles)
- Builds on: ADR-0014 (canonical workspaces), ADR-0022 (competitors), ADR-0023
  (Market Brain), ADR-0027 (billing and credits), ADR-0028 (Autopilot), ADR-0031
  (Audience)

## Context

Mellox knows a brand through four "brains": Brand DNA, Audience, Competitors and
Market. They lived in four unrelated places (a Brand DNA dialog, two routes, and
a tab inside the Marketing Coach pop-up), so they never read as one thing.

- Brand Styles and the Brand Kit were a fifth, overlapping place to set look and
  voice: many named styles, a library of uploads, and a style picker in Studio,
  chat, UGC and Autopilot.
- There was no marketing strategy for a workspace. Autopilot kept a short one on
  its own program row; Studio, chat and the Coach had none.
- The Coach pill opened a heavy, paid briefing instead of saying what changed.

## Decision

### 1. One section: Brain

`/w/<id>/app/brain?s=home|brand|audience|competitors|market|strategy`
(`brainPath()`), rendered by `BrainRoute` → `BrainShell` in an `AppModalShell`.
Six tabs across the top; each brain keeps its own inner navigation, so there is
never a rail inside a rail.

- **Brand** is Brand DNA (`BrandDnaSurface`), **Audience** is `AudiencePanel`
  plus the Brand DNA customer notes, **Competitors** is `CompetitorsPanel`,
  **Market** is `MarketBrainPanel`. Nothing was rebuilt; each moved.
- **Home** shows the four brains feeding the strategy, what changed, and what is
  still missing. Its Today tab is the Coach briefing and to-do list; Notes is
  the workspace notes.
- `getBrainOverview` (`src/server/brain/overview.server.ts`) is one free read
  with the caller's own client: no model call, no web search. The pure half
  (health, merging updates, readiness) is `src/lib/brain/brain.ts`.
- The Coach pill (`BrainPulse`) only lists those updates. It never starts a
  briefing or anything paid. Its arrow opens Brain.
- Old entry points keep working: `open:brand-dna`, `open:audience`,
  `open:competitors` and `open:marketing-coach` land on the matching section, and
  the old `/audience`, `/competitors` and `/brand-kit` URLs redirect.
- The four marks are the Mellox Micro 5 glyphs drawn as cell grids
  (`BrainMark`). Their colours identify a brain and nothing else; lime stays the
  only accent for actions.

### 2. One marketing strategy per workspace, followed everywhere

`workspace_marketing_strategy` holds one row per workspace
(`src/lib/strategy/contracts.ts`): positioning, goal and the number to watch,
who it is for, themes with their share of posts, channels and cadence, what to
say at each stage, how to win against each tracked competitor, market moves, a
90-day roadmap, KPIs and rules.

- **The model proposes, pure code decides** (`groundStrategy`): a competitor the
  workspace doesn't track is dropped; a market move with no source Market Brain
  really collected is dropped; with Audience set up, only real groups are kept.
  A person's edit goes through the same function.
- **A draft is never used.** Only a strategy a person confirmed reaches a
  generator (`strategyBlockFor`). A rebuild lands as a draft again.
- **Everything reads it from one place.** `loadStudioContext` appends the block
  (Studio, ideas, prompt writer, content functions, Autopilot planning, Audience
  simulation); chat and the Coach briefing add the same block.
- **Autopilot follows it.** `suggestStrategy` proposes the confirmed strategy
  without a model call, and confirming one updates a live program's `strategy`
  through `syncProgramStrategy`. The program column is a derived copy.
- **Stale, never silently rebuilt.** A fingerprint of the brains is stored with
  the strategy; when it differs the page offers a rebuild. Nothing rebuilds or
  spends by itself.
- **Cost:** the first strategy for a workspace is included; a rebuild is
  `strategy_rebuild` in the billing catalog, charged through `runMetered` and
  not charged when the answer isn't usable. Hand edits are free. Route label
  `strategy.generate` (premium).

### 3. One look per brand, inside Brand DNA

Brand Styles, the Brand Kit library and every style picker are removed. A brand
has one look, stored on its Brand DNA as `dna.look` and edited in
Brain → Brand → Look & voice (colours by role, fonts, image look, logo placement,
writing tone, video), with six one-tap starter looks.

- `src/lib/brand-look/` is the pure core (`parseLook`, `resolveLook`, prompt
  blocks, conformance, fonts). Whatever the look leaves empty comes from Brand
  DNA's own colours, fonts, voice, logo and rules.
- Generators get it only through `loadBrandLook` / `lookTextFor`
  (`src/server/brand-look/resolve.server.ts`), by the verified workspace id.
- Fully automatic Autopilot used to require a ready style with two example
  images. It now requires `lookReady`: colours, a headline font, an image look
  and a mood. `publishDecision()` is unchanged.

## Consequences

- No reference images are sent to the image model any more; the look is
  described in words, colours and fonts. Uploaded font files and kit logos are
  gone; fonts come from the catalog and the logo from Brand DNA.
- The database change is two steps so a running deployment is never broken:
  `20261011090000` copies each workspace's default style into `dna.look`;
  `20261012090000` drops the style columns and tables and is run only after this
  version is live. `scripts/purge-brand-kit-files.mjs` then removes the old
  uploads from storage (dry run by default).
- Workspaces with several styles keep only the default one as their look.

## Verification

Unit: `src/lib/brain`, `src/lib/strategy`, `src/lib/brand-look`. Browser:
`/brain-lab` with `tests/integration/brain-lab.spec.ts`. Real database:
`tests/live/brain.live.ts` (the model call behind `STRATEGY_LIVE_AI=yes`).
