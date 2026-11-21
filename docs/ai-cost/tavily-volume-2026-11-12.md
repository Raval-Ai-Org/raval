# Tavily web-search volume (2026-11-12)

Companion to [model-swap-2026-11-12.md](model-swap-2026-11-12.md). Measured
from `ai_usage_events` (read-only) and Tavily's own `GET /usage` (free).

## What was wrong

- The key is on Tavily's free **Researcher** plan: **1,000 credits a month**.
  On 2026-11-12 it had used 1,001. A basic search is one credit.
- The app made about **5,100 searches in 30 days (~170 a day)**, so it spent
  the whole month by about the 5th. After that, Tavily answers 432 and every
  search falls to the DuckDuckGo scrape (Firecrawl is not configured). The
  same happened from 10-28 to 10-31.
- From 11-05 to 11-12: 1,180 failed calls and 158 good ones. Failed calls cost
  nothing, but every feature that searches got the weakest rung. The shared
  trends snapshot has failed since 11-04 ("Too little current coverage"),
  so Studio has had no trends block.

Where the 30 days went:

| Route                    | Calls | Per day | Who starts it             |
| ------------------------ | ----: | ------: | ------------------------- |
| `competitors.updates`    | 1,600 |      53 | cron sweep                |
| `studio.trends`          | 1,344 |      45 | cron (one global row)     |
| `market-brain.scheduled` |   842 |      28 | cron                      |
| `competitors.profile`    |   600 |      20 | cron + a person           |
| `brand-extract.search`   |   282 |       9 | a person (3 per scan)     |
| `competitors.discovery*` |   225 |       8 | a person / a scan         |
| `community.refresh`      |   172 |       6 | cron                      |
| everything else          |    70 |       2 | a person (research, chat) |

Background sweeps made about three quarters of it. All 25 workspaces that
track competitors (96 competitors) are on Free, which sells no sweeps.

## What changed

Committed in `907742db` (2026-11-12), **not yet deployed**: production was
still sweeping at 16:00 UTC that day.

- `src/lib/background/gate.ts`: Market Brain, competitor sweeps and the
  community refresh run only as often as the plan sells them, and never for
  frozen, paused or 14-day-inactive workspaces. Free gets none of the three.
- A scan tracks at most `limits.competitors` (Free: 0).
- The trends refresh waits a day after a failed or thin read, not six hours.
  It was retrying every ~6 h at 16 searches a try, and it does nothing while
  Tavily is paused.
- A shared pause (`tavilyPausedReason`): out of credits or a refused key is
  30 min, rate limited 5 min. While it is set, the ladder skips Tavily.

Added in this change:

- **A failed competitor profile is never retried by itself** (`profileDue`,
  `src/server/competitors/service.server.ts`). A site that blocks readers
  failed the same way on every sweep, at about 8.5 Tavily calls a try (71
  builds in 30 days; 6 tracked competitors are in that state). The reason
  stays on screen and "Research again" retries.
- **A plan with no sweeps gets the first profile only**, without the
  two-search news sweep. `updates_checked_at` moves only on a real sweep, so
  the first sweep after an upgrade still looks back over what it missed.

## Expected volume once deployed

With today's customers, all on Free:

| Route                     | Before (30 d) | After (a month)                                    |
| ------------------------- | ------------: | -------------------------------------------------- |
| `competitors.updates`     |         1,600 | ~0 (Free sells no sweeps)                          |
| `studio.trends`           |         1,344 | 80–160 (every 3 days, 8 searches, 8 more if thin)  |
| `market-brain.scheduled`  |           842 | 0 on Free                                          |
| `competitors.profile`     |           600 | new competitors and "Research again" only          |
| `community.refresh`       |           172 | 0 on Free                                          |
| `brand-extract.search`    |           282 | unchanged (3 per Brand DNA scan, kept for quality) |
| discovery, research, chat |          ~300 | about the same (a person's click)                  |
| **Total**                 |    **~5,100** | **~450–650: inside the free 1,000**                |

A paying workspace adds what it buys. A Starter account sweeps 3 competitors
once a week at 2 searches each, about 26 a month. Growth sweeps 10 twice a
week, about 172 a month (~$1.40 at $0.008). Market Brain and community add
their weekly reads. Past roughly 1,000 a month in total, the owner needs a
paid Tavily plan or pay-as-you-go. That is a business decision, not a code one.

## What the owner has to do

1. **Deploy** `907742db` and this change. Until then the old sweeps keep
   spending the month's credits in the first days.
2. **For the rest of November** there are no credits left. Either wait for
   the reset on the 1st (search runs on the DuckDuckGo fallback until then),
   or turn on pay-as-you-go with a low limit in Tavily's dashboard. At the
   new volume that is about 15–20 searches a day, roughly $0.15 a day.

## Not changed, on purpose

- No search was removed from a person's own action: a Brand DNA scan, Studio
  research, chat research, Coach and "Find competitors" search exactly as before.
- The competitor news sweep still runs two queries. Merging them would halve
  that route's cost on paid plans, but it would miss stories, so it stays.
- No new cron job and no second search path (ADR-0022).
