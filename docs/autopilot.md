# Autopilot

Decision record: [ADR-0028](adr/0028-autopilot.md).

Autopilot runs a workspace's marketing loop: it plans a week, makes each piece
in Studio, waits for approval, schedules it, and records how it did. It also
turns market and competitor signals into scored opportunities. Agencies see all
of it across clients in the Command Center.

## Switching it on

Autopilot is on by default.

| Variable                                                  | Effect                                                    |
| --------------------------------------------------------- | --------------------------------------------------------- |
| `FEATURE_FLAG_AUTOPILOT_ENABLED=false`                    | Off for every workspace                                   |
| `FEATURE_FLAG_AUTOPILOT_ENABLED_WS_<workspace id>=false`  | Off (or `true`: on) for one workspace                     |
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

Off means: no switch in the message box, RPCs answer 404, the worker skips the workspace.
`AGENTS_DISABLED=true` or a workspace's "pause agents" switch pauses it as well.

No cron job to add. The existing `mellox-run-schedules` job (every minute)
advances it.

## Where things live

| Part                                                           | Path                                                                               |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Pure rules (slots, limits, plan check, approval rule, scoring) | `src/lib/autopilot/`                                                               |
| Worker (`runSweep`), store and port interfaces                 | `src/server/autopilot/engine.ts`                                                   |
| Postgres store / in-memory store for tests                     | `store.server.ts` / `store.memory.ts`                                              |
| Calls into Studio, content, publisher, Market Brain, the model | `ports.server.ts`                                                                  |
| What a person can do, and the cron entry                       | `service.server.ts`                                                                |
| RPC                                                            | `src/server/fns/autopilot.ts`, stubs `src/lib/autopilot.functions.ts`              |
| Workspace UI                                                   | `src/components/app/autopilot/` at `/w/<id>/app/autopilot` (`?s=<section>`)        |
| In the chat message box                                        | `src/components/app/autopilot/composer/` (`AutopilotDeck`, `useComposerAutopilot`) |
| Agency view                                                    | `src/components/app/command-center/AutopilotView.tsx` at `/agency?view=autopilot`  |
| Migrations                                                     | `20261003090000_autopilot.sql`, `20261003090100_autopilot_rpcs.sql`                |

## How a piece moves

```
proposed ─(plan approved, Assist only)→ planned
planned ─(3 days before its slot, within limits)→ generating ─→ needs_approval
needs_approval ─(content item approved)→ approved ─→ scheduled ─→ published ─(+48h)→ measured
```

Side exits: `skipped` (weekly limit, or its time passed before it could be
made), `missed` (not approved within 48 hours of its slot), `rejected`,
`failed`, `cancelled`, and `done` for an article.

Approval is the content item's own status. Approving it in the Autopilot
surface, the content calendar or the Command Center review queue all count.

## One plan, one calendar, one set of rules

Autopilot, the content calendar and Studio work from the same decisions.

- **What makes a post worth passing on** is written once, in
  `src/lib/studio/viral.ts`: what a piece is for (to be saved, sent, answered,
  recognised, or acted on) and the rules every piece follows. Studio's prompts,
  Autopilot's weekly plan and the calendar's "Plan my posts" all read it.
- **The week is shaped before a word is written** (`src/lib/autopilot/shape.ts`):
  each feed post gets what it is for and one of the brand's themes, rotated so
  two weeks never start the same way. The plan then fills in the idea.
- **Formats follow the channel** (`src/lib/autopilot/formats.ts`): carousels,
  images and video lead on Instagram; words lead on LinkedIn and X. A text
  post for Instagram, TikTok or YouTube is made with a picture (those channels
  can't take words alone) and priced as an image post. The plan may still swap
  a slot to another allowed format when the idea needs it.
- **The calendar is shared.** A day and channel that already has a person's
  post gets no second one from Autopilot (`freeSlots`), and those posts are
  listed in the plan prompt so nothing repeats them. A planned piece shows on
  the calendar as a slot before it is written, and as a normal post after.
- **Moving a piece on the calendar moves it for Autopilot too.** The worker
  reads the piece's calendar day and time when it checks approval and when it
  schedules (`effectiveSlot`), in the program's time zone.
- **The calendar's own planner** writes to the same rules: the same playbook
  per channel, the same stored trends, the same rotation of openings, and it
  records the opening it used so the next piece starts another way.

## The brief a piece is made from

Before anything is written, the plan decides what each brain adds to a piece
(`src/lib/autopilot/brief.ts`, pure):

| Brain       | What the piece gets                                          |
| ----------- | ------------------------------------------------------------ |
| Brand DNA   | The facts, the voice and the look. Always.                   |
| Audience    | One customer group it is written for. Every piece gets one.  |
| Market      | A stored market signal it responds to, when it is about one. |
| Competitors | A tracked rival's position to stand apart from. Never named. |
| Trends      | A format or opening that is working now, when it fits.       |

The model only points at numbered entries it was shown (`groundPicks`); the
words always come from the stored record, so a group, a rival or a signal
cannot be invented. A sentence with a figure the brand never gave is removed
from the brief before a writer sees it (`withoutUnknownFacts`). The plan also
writes the opening line and, for a picture, carousel or video, what is shown
(the subject only: the brand's look decides colours, type and logo).

Studio then makes **the piece that was planned**: the job carries what the
piece is for and how it opens (`intent.aim`, `intent.hookStyle`), so Studio
keeps its angle to the ones that serve that purpose (`AIM_ANGLES`) and a
carousel takes the structure its brief names (`structureFromBrief`: "a
four-step checklist" is a checklist). A piece that came from an idea or a
reused post gets its customer group when it is made.

The approval card shows what each piece was built from. Home says how many of
the four brains have something in them, with a button to fill an empty one
(`readiness` ids `audience`, `competitors`, `market`; none is required).

## What happens next

Home, the message-box deck and the calendar's side panel say what Autopilot
does next and when: "Writes …", "Posts …", "Plans your next week", each with
its own due time (`src/lib/autopilot/agenda.ts`, pure). Today's row in "Next 7
days" also keeps what already went out, so the day reads as one plan.

## More than posts

Each of these is a switch under **Settings → Also** (and in setup). The home
screen lists every one under "What Autopilot runs", on or off, with where it
stands.

- **AI visibility check** (on by default): once a week Autopilot starts a full
  site scan through the existing GEO scanner. The score shows on Home; when it
  is under 85 an idea appears that opens AI Visibility, where fixes are
  proposed, approved and verified exactly as before.
- **Reuse what worked** (on by default): once a week the best measured post
  that has not been reused comes back in another format the program allows
  (carousel, image post or plain post, never a video or an article). It needs
  three measured posts and at least 100 views on the one it picks; until then
  it does nothing. The new piece is an ordinary planned piece: same price, same
  weekly limits, same approval.
- **Articles to your website** (off by default): when a person approves an
  Autopilot article, it is handed to the existing article publisher
  (`approvePublication`), which checks the site, the blog and the article and
  only then sends it (a pull request on GitHub; a post on WordPress or
  Webflow). No blog connected: the article stays in the content library and
  the history says why. Autopilot never adds a blog and never approves an
  article by itself.
- **Weekly summary email** (on by default): the morning after each week ends,
  one email to the member the program acts for: what went out, views so far,
  the best post, what waits for them and what is coming. Read from stored
  rows; nothing is generated or charged. Needs the same email settings as the
  approval notice; an empty week sends nothing.
- **Market and competitors**: always watched through the existing sweeps; what
  matters becomes an idea.
- **Learning**: every measured post feeds a short "What Mellox learned" list
  (best post, stronger platform, stronger format) that the next weekly plan uses.
- **Mellox Score**: a piece waiting for approval shows the score Audience
  already gave that exact text. Autopilot only reads it.

Adding one: put its name in `AUTOMATIONS` (`src/lib/autopilot/contracts.ts`,
and in `WEEKLY_AUTOMATIONS` if it is a step of its own each week), start the
work through `ports.tasks.run` or a port of its own, and add a row to
`jobsFor` (`src/components/app/autopilot/jobs.tsx`).

## The screens

- **Home** answers three things in order: what needs you (one list, each row
  with its button), the next seven days post by post, and what Autopilot runs.
  Beside them: the last seven days in numbers and the credits used this week.
- **To approve** shows each piece with its text or Story frames, why it was
  made, its Mellox Score and, for an article, where approving sends it.
- The layout follows the width of the window it is in (container queries), so
  it is two columns in the full window and one on a phone.

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

## Where people find it

Autopilot has no sidebar entry. It lives in the chat message box:

- **Off:** one switch in the box's toolbar. Flipping it shows what Mellox
  proposes, in the box, with one "Turn on" button ("Adjust" opens the full setup).
- **On:** the box takes a lime edge and the deck covers it in a new chat: where
  every post is, the next seven days, credits used, what else is running, what
  waits for a person, and a switch that pauses it. "Write" (or just typing) hands the box back; the box
  stays lit and the toolbar switch brings the deck back.
- **Everywhere else:** a small live sign in the top bar while it runs or is
  paused, which opens the full screen (at "To approve" when something waits).

The full view is loaded only while the deck shows, and the proposal is asked
for only after a person flips the switch, so opening chat starts nothing.

To look at the screens without signing in, run the dev server and open
`/autopilot-lab` (development only; `?scene=box` is the message box); `tests/integration/autopilot-lab.spec.ts`
checks them at desktop and phone width.

The live check uses the real database and deletes what it creates. Paid steps
are opt-in: `AUTOPILOT_LIVE_GENERATE=yes` makes one real post through Studio.
Nothing in it ever schedules a post to a real account.

## Operating notes

- **The worker is the `mellox-run-schedules` cron job.** Check it is alive:
  `select job, last_started_at, last_error from cron_heartbeats;`. If
  `run-schedules` is old, the job is not scheduled or cannot reach the app:
  re-run `supabase/ENABLE-CRON-JOBS.sql` once the Vault secrets are set.
- **A picture or video that can't be made right now is tried again**: after
  an hour, then after six, while there is still time before its slot. Only a
  failure of the maker itself counts (out of capacity, provider down); a piece
  that failed for its own reasons stops at once. After two tries it shows under
  "Needs a look" with Retry.
- When the cron is late, reading the Autopilot view moves steps that are
  already more than 90 seconds overdue (`nudgeOverdue`, at most three, at most
  every 45 seconds per workspace). It is a safety net for a missed tick and
  for a machine with no cron; emails, trend refreshes and scheduled posts
  still need the cron.

- A stuck piece shows under **Activity → Needs a look** with the reason and a
  Retry button. A post that failed at the network is retried from the content
  calendar, as before.
- `autopilot_events` is the history: who or what did each step. It cannot be
  edited or deleted, even by the service role.
- To stop everything at once: set `AGENTS_DISABLED=true`. Programs pause with
  the reason shown; resume them from the surface afterwards.
