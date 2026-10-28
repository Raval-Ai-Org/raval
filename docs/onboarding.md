# Onboarding, goals and products

Decision record: [ADR-0035](adr/0035-goals-and-product-catalog.md).

## The flow

`src/app/onboarding/OnboardingPage.tsx` (route `/w/<id>/onboarding`) renders
the steps. `src/lib/onboarding/flow.ts` decides the order and what each step
needs. The flow is pure and tested.

| Step                                  | Component                                                     | Needs to continue                        |
| ------------------------------------- | ------------------------------------------------------------- | ---------------------------------------- |
| Website                               | `UrlStep`                                                     | a valid URL, or "I don't have a website" |
| Your brand (no website)               | `ManualBrandStep`                                             | a name and a one-liner                   |
| Your goal                             | `GoalStep` + `ScanStrip` while the scan runs                  | a goal saved through `saveGoals`         |
| Scan (only if the goal is done first) | `ScanStage`                                                   | the scan finishes                        |
| Brand DNA                             | `BrandReveal`                                                 | — (saves Brand DNA)                      |
| Products                              | `ProductsStep` / `Catalogue`                                  | at least one product or service          |
| Channels                              | `ChannelsStep` + `SocialAccountsSection variant="onboarding"` | optional                                 |
| First posts                           | `FirstWinStep` + `useFirstPosts`                              | optional; "Later" enters the app         |

Leaving Products marks the workspace onboarded. Channels and first posts are
extras: a person who closes the tab there still has a set-up brand.

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
- **Rules:**
  - Photos are `assets` rows checked against the workspace
    (`productForGeneration`). Never trust a URL or a path from the browser.
  - `controls.productId` on a Studio job keeps the product's photo
    (`preserve`), decided before pricing in `createBilledStudioJob`.
  - Generators read the catalogue through `catalogBlockFor`, and one product
    through `productContextFor`.

## Checking it

- **Unit tests:** `src/lib/goals/goals.test.ts`,
  `src/lib/products/products.test.ts`, `src/lib/onboarding/flow.test.ts`,
  `src/server/products/discover.server.test.ts`, and the goal cases in
  `src/lib/strategy/strategy.test.ts`.
- **Visual:** `/onboarding-lab?step=goals|manual|products|channels|first|first-running|first-failed`
  (development only). It is covered by `tests/integration/onboarding-lab.spec.ts`
  at desktop and phone width.
