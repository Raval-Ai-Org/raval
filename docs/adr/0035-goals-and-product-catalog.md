# ADR-0035: Goals, the product catalogue, and an onboarding that ends in posts

- **Status:** accepted
- **Date:** 2026-10-28
- **Builds on:** ADR-0014 (workspaces), ADR-0027 (billing), ADR-0032 (Brain)
- **Reference:** [docs/onboarding.md](../onboarding.md)

## Context

Onboarding was website → scan → Brand DNA review → "Enter Mellox". It never
asked what the marketing was for, what the brand sold, or where it posted, and
it ended with nothing made.

- **Products** were one free-text line (`BrandDna.products`). Generators could
  name a product, but had no photo of it and no facts beyond the name. Image
  models redrew products from words, so labels and packaging came out wrong.
  Reviews of Holo, a competitor, single out exactly this.
- **Goals** didn't exist. The strategy's goal and KPIs were written by the
  model. Autopilot assumed five posts a week. Nothing could say how a brand was
  doing against what it wanted.
- `NewProjectDialog` skipped onboarding entirely.

## Decision

### 1. Goals are the person's numbers, decided by pure code

`workspace_goals` holds one goal per workspace, read by members and written
only by the server. Every save goes through `decideGoals`
(`src/lib/goals/decide.ts`):

- it cleans and clamps what was typed;
- it refuses a target at or below the person's own starting point;
- it labels a target far beyond a rough growth rule "stretch", but still saves it.

No number in the table is ever an estimate.

Progress (`goalProgress`) is computed from stored rows only: the posts Mellox
published, and the views on those posts. Follower, subscriber, lead and sales
counts aren't readable today. They say so and point at the fix, and never show
a guess.

### 2. The goal decides the strategy's goal and pace

`StrategyFacts.goals` reaches `groundStrategy`, and `followGoals` pins:

- the goal type and number;
- the first KPI;
- the weekly posts across social channels, capped at what the person said
  they can look over.

The model still writes the summary. Autopilot's proposal takes its pace and
channels from the goal. Generators get `goalBlockFor(workspaceId)` through
Studio context and chat.

### 3. Products are rows, and photos are checked assets

`workspace_products` holds products and services. Photos are `assets` rows
(`metadata.source = 'product-photo'`), referenced by id.

- **Discovery** reads the site's own data with no model call: Shopify's
  `/products.json`, then schema.org Product markup on product pages, through
  the SSRF guard, within 8 seconds. It runs alongside the Brand DNA scan.
- **Keeping** discovered products copies their photos into Mellox storage. A
  photo that fails to download is skipped.
- `BrandDna.products` becomes a summary derived from the catalogue. It is only
  updated while it still equals the last summary Mellox wrote, so a line a
  person wrote by hand stays.

### 4. A product's photo is never redrawn

A Studio job may carry `controls.productId`. At job creation
(`createBilledStudioJob`), before pricing:

- the product must belong to the workspace;
- a pictured piece with no photos chosen gets the product's main photo in
  `referenceMode: "preserve"`.

The runner puts the product's stored facts at the top of the prompt, with the
rule to claim nothing else.

> Since ADR-0040 a single picture about a picked product is a product hero
> poster: the product is cut out of its photo and re-rendered in a staged
> scene. Carousels, Stories and videos keep the photo as it is.

### 5. Onboarding ends in three real drafts, only on a click

The flow is: website → goal (asked while the scan runs) → Brand DNA →
products (at least one, required) → channels (optional) → first posts.

The order is decided by the pure `src/lib/onboarding/flow.ts`. "I don't have a
website" swaps the scan for three questions.

The three first posts are ordinary Studio jobs, through the metered route,
with:

- a different aim each (`SHARE_AIMS`);
- the chosen product;
- the person's main channel.

They are created only when the person clicks, with the price shown first. Keys
are fixed per post (`onboarding-first:<workspaceId>:<n>`), so a double click or
refresh makes and charges nothing twice. A 402 never blocks finishing setup.
New projects always start in onboarding.

## Consequences

- Shops that block bots or render in the browser yield few or no candidates.
  Adding by hand and uploading photos are first-class, not fallbacks.
- Goal progress is thin until providers expose follower counts. That gap is
  shown, not filled.
- First posts spend real credits right after signup. The price is on the
  button, and "Later" is next to it.
