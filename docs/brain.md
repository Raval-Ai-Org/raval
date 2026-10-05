# Brain

Decision record: [ADR-0032](adr/0032-brain-strategy-and-one-look.md).

Brain is the one place a workspace's knowledge lives: the four brains (Brand,
Audience, Competitors, Market) and the marketing strategy written from them.

## Where things are

| What                   | Where                                                            |
| ---------------------- | ---------------------------------------------------------------- |
| Route                  | `/w/<id>/app/brain?s=<section>&t=<place>` (`brainPath`)          |
| Window and tabs        | `src/components/app/BrainRoute.tsx`, `brain/BrainShell.tsx`      |
| Marks                  | `brain/BrainMark.tsx` (`BrainMark`, `BrainIcon`)                 |
| Home                   | `brain/BrainHome.tsx` (presentational)                           |
| Today (Coach briefing) | `brain/home/TodayBrief.tsx`                                      |
| Strategy               | `brain/strategy/StrategyScreen.tsx` (+ `StrategyPanel`)          |
| Look & voice           | `brain/brand/look/LookEditor.tsx`                                |
| Coach pill             | `brain/BrainPulse.tsx`                                           |
| Data hooks             | `brain/use-brain.ts`                                             |
| Overview (pure)        | `src/lib/brain/brain.ts`                                         |
| Overview (server)      | `src/server/brain/overview.server.ts`, `src/server/fns/brain.ts` |
| Strategy (pure)        | `src/lib/strategy/` (`contracts.ts`, `ground.ts`)                |
| Strategy (server)      | `src/server/strategy/`, `src/server/fns/strategy.ts`             |
| Brand look (pure)      | `src/lib/brand-look/`                                            |
| Brand look (server)    | `src/server/brand-look/resolve.server.ts`                        |
| Lab                    | `/brain-lab` (`brain/BrainLab.tsx`), development only            |

## Sections

- `home` — tabs `overview` (default), `today`, `notes`.
- `brand` — `t` is a Brand DNA tile: `logo`, `identity`, `typography`, `colors`,
  `look`, `voice`, `headline`, `audience`, `assets`, `notes`.
- `audience` — `t=customers` shows the customer notes kept on Brand DNA.
- `competitors`, `market`, `strategy`.

To open one from anywhere: `emitAppEvent("open:brain", { section, tab })`. The
older events (`open:brand-dna`, `open:audience`, `open:competitors`,
`open:marketing-coach`) still work and land on the matching section.

## The strategy

1. **Create** — `generateStrategy` gathers what the brains hold
   (`gatherStrategySources`), asks the premium model, and grounds the answer.
   The result is saved as a draft.
2. **Review** — a person edits (free) and presses "Use this strategy".
3. **Follow** — from then on the confirmed strategy is part of the context for
   Studio, chat, the Coach briefing and Autopilot planning.
4. **Refresh** — when a brain changes, the page says so and offers a rebuild.

Rules that must hold:

- A strategy may only name competitors the workspace tracks and market sources
  Market Brain collected. `groundStrategy` enforces it for model answers and for
  edits.
- A draft never reaches a generator.
- Nothing rebuilds or spends without a person's click.
- The first strategy is included; later rebuilds are `strategy_rebuild`.

## The look

`dna.look` is a `BrandLookSpec` (`src/lib/brand-look/spec.ts`): `writing`,
`visual`, `video`. `resolveLook(dna)` merges it with Brand DNA's colours, fonts,
voice, logo and rules into the `BrandLook` every generator reads. A workspace
with no look behaves exactly like plain Brand DNA (`customized: false`, no style
block in prompts).

## Updates and the Coach pill

`getBrainOverview` returns each brain's health (0–100), one line of news, a
merged list of updates and what is still missing. It reads existing rows only.
"New" is decided in the browser from a last-seen time in `localStorage`; it only
controls which marks glow.

## Checks

```bash
npx vitest run src/lib/brain src/lib/strategy src/lib/brand-look
npx vitest run --config vitest.live.config.ts tests/live/brain.live.ts
PLAYWRIGHT_BASE_URL=http://localhost:8081 npx playwright test tests/integration/brain-lab.spec.ts --project=integration --workers=1
```

## Finishing the removal of Brand Styles

After this version is deployed:

```bash
supabase db push --db-url "$SUPABASE_DB_URL"        # applies 20261012090000_drop_brand_styles.sql
node scripts/purge-brand-kit-files.mjs              # counts the old uploads
node scripts/purge-brand-kit-files.mjs --confirm    # deletes them
```
