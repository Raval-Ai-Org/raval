# Autopilot

Decision record: [ADR-0028](adr/0028-autopilot.md).

Autopilot runs a workspace's marketing loop: it plans a week, makes each piece
in Studio, waits for approval, schedules it, and records how it did. It also
turns market and competitor signals into scored opportunities. Agencies see all
of it across clients in the Command Center.

## Switching it on

Autopilot is on by default.

| Variable | Effect |
|---|---|
| `FEATURE_FLAG_AUTOPILOT_ENABLED=false` | Off for every workspace |
| `FEATURE_FLAG_AUTOPILOT_ENABLED_WS_<workspace id>=false` | Off (or `true`: on) for one workspace |
| `FEATURE_FLAG_AUTOPILOT_FULL_ENABLED=false` / `…_WS_<id>` | Removes "Fully automatic"; every post then needs approval |

## Setting it up (once)

Opening Autopilot for the first time shows one screen. Mellox reads Brand DNA
and proposes a strategy (what the posts are for, who they are for, how they
sound, three or four content themes) and the settings: goal, where, how often,
what, who approves, weekly limit. Each setting is a row that opens in place.
One button turns it on. The strategy is saved with the program and every
weekly plan follows it, for up to a year, until someone pauses or stops it.

Who approves:

- **Fully automatic** — plain and image posts that pass every check go out by
  themselves (two a day at most). Anything else waits, and the member who
  turned it on gets an email, at most one a day.
- **I approve each post** — nothing goes out without a yes.
- **I approve the plan too** — the weekly plan waits first, then each post.

Email needs `RESEND_API_KEY` and `BILLING_EMAIL_FROM`; without them the notice
is skipped and the posts simply wait in the app.

Off means: no sidebar entry, RPCs answer 404, the worker skips the workspace.
`AGENTS_DISABLED=true` or a workspace's "pause agents" switch pauses it as well.

No cron job to add. The existing `mellox-run-schedules` job (every minute)
advances it.

## Where things live

| Part | Path |
|---|---|
| Pure rules (slots, limits, plan check, approval rule, scoring) | `src/lib/autopilot/` |
| Worker (`runSweep`), store and port interfaces | `src/server/autopilot/engine.ts` |
| Postgres store / in-memory store for tests | `store.server.ts` / `store.memory.ts` |
| Calls into Studio, content, publisher, Market Brain, the model | `ports.server.ts` |
| What a person can do, and the cron entry | `service.server.ts` |
| RPC | `src/server/fns/autopilot.ts`, stubs `src/lib/autopilot.functions.ts` |
| Workspace UI | `src/components/app/autopilot/` at `/w/<id>/app/autopilot` |
| Agency view | `src/components/app/command-center/AutopilotView.tsx` at `/agency?view=autopilot` |
| Migrations | `20261003090000_autopilot.sql`, `20261003090100_autopilot_rpcs.sql` |

## How a piece moves

```
proposed ─(plan approved, Assist only)→ planned
planned ─(3 days before its slot, within limits)→ generating ─→ needs_approval
needs_approval ─(content item approved)→ approved ─→ scheduled ─→ published ─(+48h)→ measured
```

Side exits: `skipped` (weekly limit), `missed` (not approved within 48 hours of
its slot), `rejected`, `failed`, `cancelled`, and `done` for an article.

Approval is the content item's own status. Approving it in the Autopilot
surface, the content calendar or the Command Center review queue all count.

## More than posts

- **AI visibility check** (on by default): once a week Autopilot starts a full
  site scan through the existing GEO scanner. The score shows on Home; when it
  is under 85 an idea appears that opens AI Visibility, where fixes are
  proposed, approved and verified exactly as before.
- **Market and competitors**: always watched through the existing sweeps; what
  matters becomes an idea.
- **Learning**: every measured post feeds a short "What Mellox learned" list
  (best post, stronger platform, stronger format) that the next weekly plan uses.

## What it asks you to connect

Setup and Home show what is missing, each with a button: social accounts
(required to post), Brand DNA (so posts are true to the brand) and the website
(for the AI visibility check).

## Money

- Writing the plan and rating signals is included.
- Each piece costs the normal Studio price, charged to the workspace owner's
  wallet as the acting member.
- A program has a weekly credit limit and a weekly video limit. A piece that
  would cross either is skipped, not made.
- Publishing never costs credits; the plan's monthly fair-use cap applies.

## Opportunities

Sources: stored competitor updates (last 21 days), the latest Market Brain
analysis and its sources, and posts well below the workspace's usual reach.
Dropped before the model sees them: no usable link, older than the horizon
(news 10 days, competitor 21, trend 30), already seen, or the same story as
something recent. Shown only when the score is 55 or more. They expire after
7 to 14 days.

"Create" makes one piece, or three for a small campaign, with the sources in
the brief. It always waits for approval.

## Checks

```bash
npx vitest run src/lib/autopilot src/server/autopilot tests/db/autopilot.test.ts
npx vitest run --config vitest.live.config.ts tests/live/autopilot.live.ts
```

To look at the screens without signing in, run the dev server and open
`/autopilot-lab` (development only); `tests/integration/autopilot-lab.spec.ts`
checks them at desktop and phone width.

The live check uses the real database and deletes what it creates. Paid steps
are opt-in: `AUTOPILOT_LIVE_GENERATE=yes` makes one real post through Studio.
Nothing in it ever schedules a post to a real account.

## Operating notes

- A stuck piece shows under **Activity → Needs a look** with the reason and a
  Retry button. A post that failed at the network is retried from the content
  calendar, as before.
- `autopilot_events` is the history: who or what did each step. It cannot be
  edited or deleted, even by the service role.
- To stop everything at once: set `AGENTS_DISABLED=true`. Programs pause with
  the reason shown; resume them from the surface afterwards.
