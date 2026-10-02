# ADR-0028: Autopilot — one engine that runs a workspace's marketing

- Status: Accepted
- Date: 2026-10-03
- Builds on: ADR-0014 (canonical workspaces), ADR-0022 (web intelligence and
  competitors), ADR-0023 (Market Brain), ADR-0025 (Brand Kit styles),
  ADR-0026 (OpenRouter-only models), ADR-0027 (billing and credits)

## Context

Mellox already has every part of a marketing loop: Brand DNA, Market Brain,
competitor updates, Studio, the content calendar, approvals, publishing and
post metrics. A person has to drive each step by hand. Three things were asked
for:

1. **Autopilot** — set a goal, platforms, pace, duration, formats, limits and
   an approval level; Mellox plans, creates, schedules and measures, in a loop.
2. **Trend / opportunity → content** — turn a meaningful market trend,
   competitor move or result into a recommendation that can become content.
3. **Agency Autopilot** — see and steer all of that across client workspaces.

## What the codebase gave us (findings that shaped this decision)

- **Studio has no queue.** A job runs inside `POST /api/studio/jobs`, and the
  credit hold lives in that route, not in `createStudioJob`. Renders advance
  only when something calls `advanceStudioJob`.
- **Nothing in Mellox publishes on a timer.** `scheduleHandler` hands the post
  to the provider, which fires it. So nothing may reach the provider before it
  is approved.
- **The publisher promotes a draft.** `promoteForDistribution` treats an
  explicit send as consent and moves `draft` → `approved`. A caller that wants
  an approval gate has to check the status itself.
- **"Approved" means "approved as it is now".** The content lifecycle trigger
  demotes an approved item to `draft` if its content changes.
- **Billing and publishing guards need a real member** (`getEntitlements`,
  `assertPublishingAction` take a user id and role).
- **Market Brain's opportunities have no id, score, status or link**, and
  Studio ideas are cached for 30 minutes and never stored.
- **Agency HQ already lists `pending` content across clients**, so Autopilot's
  drafts appear in its review queue with no extra work.
- There is an agent control plane (`src/server/agents/`) with a per-workspace
  kill switch. Its workers are read-only; its approval table is for single tool
  calls, not for a piece of content moving through a lifecycle.

## Decision

### 1. One engine, nothing new underneath it

Autopilot adds a program (the settings), a leased action row per step, an
append-only history and an opportunities table. It adds **no generator, no
publisher, no approval store, no queue service and no cron job**.

| Need | What is used |
|---|---|
| Make a piece | `createStudioJob`, through `createBilledStudioJob` (the Studio route uses the same function) |
| Approve | `content_items.status` — the only approval there is |
| Schedule | `scheduleForWorkspace` (the `/api/sdr/schedule` route uses the same function) |
| Advance work | the existing 1-minute `run-schedules` hook, plus `after()` for a click |
| Research | what Market Brain and the competitor sweeps already collected |
| Brand facts | `loadStudioContext` → Brand DNA by the verified workspace id |
| Kill switch | `AGENTS_DISABLED` and `workspace_agent_settings.agents_paused` |

### 2. Data model

- `autopilot_programs` — one live program per workspace (partial unique index).
  `acting_user_id` is the member whose plan, credits and publishing rights it uses.
- `autopilot_actions` — kinds `plan`, `content`, `scan`. Leased with
  `claim_autopilot_actions` (SKIP LOCKED). `unique (workspace_id, dedupe_key)`.
- `autopilot_events` — append-only (trigger). Real transitions and decisions
  only, never model reasoning.
- `marketing_opportunities` — `unique (workspace_id, fingerprint)`.
- RLS: members `SELECT`; every write is the service role, after the RPC layer
  checked the workspace and the role.

### 3. The content lifecycle

`proposed → planned → generating → needs_approval → approved → scheduled →
published → measured`, with `done` (an article: ready, not posted), `skipped`,
`missed`, `rejected`, `failed`, `cancelled`.

- Every change is a compare-and-set on the status the row was read at.
- A piece is made about three days before its slot, so there is time to approve.
- **The gate:** an item is handed to the publisher only if it reads `approved`
  at that moment. If it was edited after approval it reads `draft`, and the
  action goes back to `needs_approval`.
- The Studio idempotency key is `autopilot:<actionId>:<attempt>`. After a crash
  the worker finds the existing job by that key and follows it.
- Scheduling is never retried by the worker. The outcome is read from the
  content item; a failure is shown with the publisher's own reason.
- Not approved within 48 hours of its slot → `missed`. The draft stays in the
  workspace's content.

### 4. Who decides what

- **The model** proposes what each slot should be about, and rates how relevant
  a signal is to the brand. It answers by slot number and by signal index.
- **Pure code** (`src/lib/autopilot/policy.ts`, `opportunities.ts`) decides the
  dates and platforms (from the calendar planner), the allowed format, the
  weekly credit and video limits, duplicates against recent work, freshness,
  the score, and whether a person must approve.
- Titles, links and dates of an opportunity are copied from the source record.
  A claim from the web with no usable link is not shown.

### 5. Modes

- **Assist** — the plan waits as `proposed` until a person approves it; then
  each piece needs approval.
- **Autopilot** — the plan runs by itself; each piece needs approval.
- **Full** — `publishDecision()` approves a piece without a person only when
  all of these hold: mode is `full`, `FEATURE_FLAG_AUTOPILOT_FULL_ENABLED` is on
  for the workspace, the piece is a plain or image social post, Studio raised no
  warning, the text states no figure, date or link missing from the brand
  context, fewer than two pieces were auto-approved in the last 24 hours, and
  the account is connected. Anything else waits, and the acting member is
  emailed at most once a day. The flag is on unless set to `false` (changed on
  2026-10-03: the product owner asked for a set-up-once, hands-off mode). The
  checks are not configurable.

### 5a. One-time setup and the brand strategy

`suggestStrategy` reads Brand DNA and proposes a strategy (summary, audience,
voice, three or four pillars) plus settings. The person confirms on one screen.
The strategy is stored on the program (`autopilot_programs.strategy`) and is
part of every weekly planning prompt, so goals are stated once. A program runs
for up to a year.

### 6. Opportunities

A `scan` action is queued (once per hour at most) when Market Brain finishes an
analysis, when a competitor sweep finds updates, and when a program starts. It
reads only stored data — competitor updates, the latest Market Brain analysis
with its sources, and posts that fell far below the workspace's own usual
reach — so it costs no web search. Stale, unsourced, low-quality-host, already
seen and same-story candidates are dropped before the model is called. A
running program in Autopilot or Full mode with "respond to strong
opportunities" on may turn at most two a week into drafts by itself; they still
need approval.

There is no customer-feedback table in Mellox today. Customer pains and
objections from Brand DNA shape relevance; they are not triggers.

### 7. Agency HQ

No second engine. `autopilot_overview()` is `SECURITY INVOKER` and returns one
row per workspace the caller is a member of. The Command Center's Autopilot
view reads it and calls the same per-workspace functions (pause, resume, open,
approve in the existing review queue), each role-checked for that workspace.

### 8. Roles, flags, cost

- View: any member. Approve, skip, pause, resume, accept or dismiss an
  opportunity: editor. Start, change, stop: admin.
- `FEATURE_FLAG_AUTOPILOT_ENABLED` (+ `_WS_<id>`), on unless set to `false`
  (changed on 2026-10-03 at the product owner's request). Off means the
  sidebar entry is hidden, RPCs answer 404 and the worker skips the workspace.
- Plan feature `autopilot` (Growth and above).
- Planning and reading signals are included (`autopilot.plan`,
  `autopilot.opportunities` in `INCLUDED_ROUTES`). Each piece costs the normal
  Studio price, held and captured exactly as when a person makes it.

## Decisions made with the product owner

The product owner left the design decisions to the implementation. The ones
most likely to be revisited: the plan tier (Growth), who may start a program
(admin), and the weekly cap of two self-started opportunity responses.

## Out of scope

- Paid ads, video scripts and UGC video ads (hands-on in Studio).
- Publishing an article to a website (the existing article publishing flow).
- Automatic retry of a failed post.
- Client-portal approval as a publishing gate.

## Consequences and risks

- The `run-schedules` hook now declares `maxDuration = 120`, because a text
  piece is written inside that request. Autopilot runs in parallel with the
  schedules it shares the hook with and cannot fail them.
- If the acting member leaves or loses the editor role, the program pauses with
  a reason. Whoever resumes it becomes the acting member.
- A crash between the credit hold and the Studio job insert leaves a hold that
  expires on its own; the action fails and can be retried with a new attempt.
- Performance warnings need at least four measured posts on a platform and a
  usual of 100 views, so they appear only for accounts with real history.
