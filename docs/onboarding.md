# Onboarding, goals and products

Decision record: [ADR-0035](adr/0035-goals-and-product-catalog.md).

## The flow

`src/app/onboarding/OnboardingPage.tsx` (route `/w/<id>/onboarding`) renders
the steps. `src/lib/onboarding/flow.ts` decides the order and what each step
needs. The flow is pure and tested.

| Step                                  | Component                                                     | Needs to continue                        |
| ------------------------------------- | ------------------------------------------------------------- | ---------------------------------------- |
| Website                               | `UrlStep`                                                     | a valid URL, or "I don't have a website" |
| Your brand (no website)               | `ManualBrandStep` (five parts, see below)                     | a name and a one-liner                   |
| Your goal                             | `GoalStep` + `ScanStrip` while the scan runs                  | a goal saved through `saveGoals`         |
| Scan (only if the goal is done first) | `ScanStage`                                                   | the scan finishes                        |
| Brand DNA                             | `BrandReveal`                                                 | — (saves Brand DNA)                      |
| Products                              | `ProductsStep` / `Catalogue`                                  | at least one product or service          |
| Channels                              | `ChannelsStep` + `SocialAccountsSection variant="onboarding"` | optional                                 |
| Ready (finish)                        | `FinishStep` + `HoldToEnter`                                  | press and hold; nothing is made          |

Leaving Products marks the workspace onboarded. Channels and first posts are
extras: a person who closes the tab there still has a set-up brand.

## No website: the brand kit

"I don't have a website" opens `ManualBrandStep`: five short parts, one at a
time (Basics → Category → Look → Inspiration → Competitors), Mox asking each,
with a live card of the brand filling in beside them (under them on a phone).
Only the basics (name and one line) are needed; every other part has "Skip for
now", and Brain / Inspo fill the rest later.

- **Pure rules** in `src/lib/onboarding/manual-brand.ts` (tested): categories,
  tones, ready-made palettes, colour helpers, `paletteFromPixels` (a logo's own
  colours), `addCompetitor`, `kitScore`, and `manualDnaFields`, the only
  mapping into Brand DNA. An empty answer stays empty (never a guess) and is
  listed in `missing`; filled fields carry a "set by you" source.
- **Logo:** redrawn in the browser (`manual/logo.ts`) as a PNG/WebP of at most
  512 px and ~350 kB, stored on `dna.logoUrl` as an inline image, which the
  logo overlay already reads. An empty palette is filled from the logo.
- **Colours:** `dna.colors` with roles Primary / Secondary / Accent, so
  `paletteFromDnaColors` maps them; tone becomes `dna.voice`.
- **Inspiration:** each picture or link is an Inspo "Love" reference
  (`brand_visual_sources`, purpose `style`) through
  `POST /api/brand-visuals/upload` (`manual/use-manual-inspiration.ts`), so it
  is on the Inspo board afterwards. Uploading is free; "Learn my style" stays a
  click in Inspo.
- **Competitors:** name and optional site on `dna.competitors`; finishing calls
  the included `bootstrapCompetitors`, which tracks them (looking up a site
  from a name). A plan without competitor tracking skips it quietly.
- **Products:** the normal Products step; a services brand is offered "Add a
  service" first.
- The draft survives a refresh in this browser (`onboarding:manual:<id>`) and
  is cleared when setup finishes or is skipped.
- `/onboarding-lab?step=manual` (and `&part=look` etc. for a filled kit)
  renders it; `tests/integration/onboarding-lab.spec.ts` walks it.

## Goals

- **Code:** pure rules in `src/lib/goals/` (`contracts.ts`, `decide.ts`,
  `progress.ts`, `block.ts`); server in `src/server/goals/`; RPC
  `src/server/fns/goals.ts`; table `workspace_goals`.
- **Editing:** in onboarding, and in Brain → Brand → Goal (`GoalEditor`). Brain
  home shows `GoalCard`.
- **Rules:**
  - Save only through `decideGoals`.
  - Show progress only from stored rows (`goalProgress`). Never estimate a
    follower or sales number.
  - Generators read the goal through `goalBlockFor`.

## Products

- **Code:** pure rules in `src/lib/products/` (`catalog.ts`, `block.ts`);
  server in `src/server/products/` (`discover.server.ts`, `service.server.ts`,
  `context.server.ts`); RPC `src/server/fns/products.ts`.
- **Photos:** upload through `POST /api/products/photos`. Images are imported
  through `src/server/assets/reference-image.server.ts`, shared with UGC.
- **Editing:** in onboarding and in Brain → Brand → Products (`ProductsEditor`).
- **Finding them on the site** starts the moment the person gives the link,
  inside the Brand DNA scan, and keeps going while they answer the goal
  questions. In order (`discover.server.ts`, pure parts in `catalog.ts`):
  1. Store feeds: Shopify `/products.json`, WooCommerce `/wp-json/wc/store/v1/products`.
  2. Product and service pages (`catalogLinks`: `/products/…`, `/product-page/…`,
     `/services/…`, …) from the crawl, the sitemap and its product sitemaps
     (`catalogSitemaps`), and the listing pages (`LISTING_PATHS`), read for
     schema.org Product / Service markup; an ItemList or OfferCatalog on a
     listing page counts too (`catalogFromJsonLd`).
  3. The Brand DNA model's `catalog` list from the crawled text, in the same
     call (no extra charge). `groundCatalog` keeps an item only if its name is
     on the site, a price only if it is written there, a link only to this
     site, and a description only if most of its words are the site's own.
     Results stream to the browser as `discovery` / `products` events.
- **Kept by itself.** `useOnboardingProducts.autoKeep` saves what was found in
  batches of six as it arrives, so the products step is filled in when the
  person gets there; they remove what they don't sell. `importCandidates` only
  ever adds: anything already in the catalogue, or a product a person removed,
  is left as it is.
- **Rules:**
  - Photos are `assets` rows checked against the workspace
    (`productForGeneration`). Never trust a URL or a path from the browser.
  - `controls.productId` on a Studio job makes the piece with the product's
    own photos (`productPhotoControls` in `src/lib/products/feature.ts`),
    decided before pricing in `createBilledStudioJob`. A product the brief
    names is picked by itself; Autopilot also rotates through the catalogue
    for selling briefs.
  - Generators read the catalogue through `catalogBlockFor`, and one product
    through `productContextFor`.

## Checking it

- **Unit tests:** `src/lib/goals/goals.test.ts`,
  `src/lib/products/products.test.ts`, `src/lib/onboarding/flow.test.ts`,
  `src/server/products/discover.server.test.ts`, and the goal cases in
  `src/lib/strategy/strategy.test.ts`.
- **Visual:** `/onboarding-lab?step=goals|manual|products|channels|language|finish`
  (`&saving=1` shows found items while they are saved, `&empty=1` an empty catalogue)
  (development only). It is covered by `tests/integration/onboarding-lab.spec.ts`
  at desktop and phone width.
