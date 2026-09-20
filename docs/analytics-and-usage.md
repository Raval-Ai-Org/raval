# Analytics, usage, credits, and cost controls

## Analytics

Analytics connectors and sync services live under `src/server/analytics` and
persist sources, sync runs, GA4/GSC daily data, dimensions, aggregates, and
insights. The Google OAuth callback is `/api/integrations/google/callback` and
sync is advanced through the analytics hook. Social analytics has dedicated
routes under `/api/social/analytics` and metrics sync.

The codebase does not establish a universal business definition for every
metric. Treat stored fields and server aggregations as implementation facts;
TODO: publish metric definitions and timezone/attribution rules with product
and data owners.

## Usage and budgets

AI usage events and reservations record route, provider/model, kind, estimated
cost, cache status, and outcome. Budget checks provide daily/monthly spend,
image/video/post quotas, warnings, and hard failures. `/api/usage` is the
workspace usage read model.

Plan limits are code-owned by `src/server/plans`; social publishing consumes
post credits, while AI/media work consumes its applicable quota and budget.
Exact commercial pricing is not documented because the repository does not
prove a public price sheet.

## Cost controls

All paid calls must use an approved gateway, budget reservation/metering path,
cache where applicable, and a declared rate-limit tier. Feature flags disable
expensive probes or providers by default where configured. Never bypass budget
checks to make a test pass.
