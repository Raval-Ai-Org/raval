# ADR-0039: Campaigns — planned runs of posts and Stories

- **Status:** accepted
- **Date:** 2026-10-30
- **Builds on:** ADR-0028 (Autopilot), ADR-0032 (strategy), ADR-0035 (goals and products), ADR-0036 (own photos and clips)

## Context

A business buying Mellox wants more than single posts. It runs campaigns: a
launch that teases, reveals and follows up; an event that needs 1,000
registrations from one form link; a winter season; a sale; a meme series.
Several run at once, alongside the everyday posts, and all of them should
follow the brand's strategy.

Mellox had no campaign anywhere. `backlink_campaigns` belongs to Backlinks.
Autopilot's opportunity format `campaign` is three linked pieces. Studio's
`controls.campaign` is a free-text tag. The billing catalog already sold
"Campaign plans" (feature `campaigns`, Growth and up, action `campaign` at 55
credits) with nothing behind it.

## Decision

**A campaign kind is data.** `src/lib/campaigns/playbooks.ts` has 16
playbooks (product launch, event, seasonal, sale, showcase, teach, memes,
behind the scenes, social proof, giveaway, lead magnet, collab, milestone,
grand opening, hiring, awareness day). Each one lists its phases (before, on
or after the key date), and for each phase:

- what the phase is for;
- its share aims (`viral.ts`) and formats;
- its deliverable (`creative-knowledge.ts`);
- its opening styles (`HOOK_STYLES`);
- its Story theme;
- which of the person's photos suit it;
- how hard it points to the link.

Playbook ids are stored on campaigns: add new ones, never rename.

**The shape is code's; the words are the model's.**

- `buildCampaignSkeleton` is pure and free. It decides dates around the key
  date, channels, formats each channel can carry, aims, openings and Stories.
- It keeps at most one feed post per channel per day across everything
  already planned: the person's own posts, other campaigns and Autopilot.
- `settleFormats` and `assignMedia` place the person's own photos and clips:
  close-ups to tease, the main photo for the reveal, two or more event photos
  for a recap.
- The designer draws this preview in the browser before anything is paid.
- "Write the plan" (`campaign.plan`, PREMIUM, the existing `campaign` action
  at 55 credits) only writes the big idea and each piece's title, idea and
  visual.
- `groundCampaignPlan` then removes:
  - a figure the brief never gave;
  - a link other than the person's own;
  - a sentence that names a competitor.
- "Write it for me" (`campaign.write`, ECONOMY, priced as `ideas`) drafts the
  name, the "about" text and the key message. It never writes an offer.

**The goal is the person's number.** A campaign goal has a kind, an optional
target, and the person's link, which must be public https (`isShareableLink`
and `assertPublicUrl`).

- Links work in captions on LinkedIn, Facebook, X and Threads, so the link
  goes there.
- On Instagram and TikTok the caption says "link in bio" and the card shows
  the link to copy (`linkRule`).
- Registrations and sales are a count the person types in ("your count").
- Mellox shows posts out and measured views next to it, and never estimates.

**Pieces are Autopilot steps, nothing else.** Starting a campaign writes one
`autopilot_actions` row per piece, with `campaign_id` set and `program_id`
null. The dedupe key is
`campaign:<id>:<piece>:<rev>:<hash>`.

- The existing worker makes each piece through `createBilledStudioJob` and
  `ports.studio.create`. `campaignControls` adds the campaign's photos or
  clips, product and call to action.
- Pieces are scheduled through `scheduleForWorkspace`, and approval follows
  `awaitApproval`.
- Approval follows the live Autopilot program's mode while it runs.
  Otherwise a person approves every piece.
- Each piece is charged at its usual Studio price when it's made.
- Editing a live campaign bumps `plan.rev`, and `diffPieces` adds and cancels
  steps. A step that has already made something is never touched.
- Pausing parks unmade steps, ending cancels them, and a deleted campaign
  cancels its unmade steps. The worker gate checks `campaignState`, and runs
  campaign steps even when Autopilot is off.
- No new cron job: the existing `run-schedules` hook drives everything.

**Everything else hears about it.**

- `loadStudioContext` reads `runningCampaignsFor`. Every generator gets the
  "Campaigns running now" block, and Studio ideas get a `campaign` signal.
- Autopilot's `calendar()` counts campaign steps as taken slots, so everyday
  posts fill around campaigns.
- A made post carries `meta.campaign_id`, `campaign_phase` and
  `campaign_name`. The calendar shows the name, and the Library filters by it.
- Chat and MCP get read-only `list_campaigns` / `get_campaign`, plus a
  Campaigns place in chat. Planning and starting a campaign are never offered
  from chat.
- Autopilot's campaign-sized opportunities get "Plan as a campaign".

**Campaigns replace "Content calendar" in the sidebar.** The calendar opens
from the Campaigns header. The route is `/w/<id>/app/campaigns` (`?c=`,
`?v=new`, `?type=`, `?tab=`; links are built with `campaignsPath`), opened by
`open:campaigns`.

Flag: `FEATURE_FLAG_CAMPAIGNS_ENABLED` (with `_WS_<id>`), on unless `false`.
When it's off, the RPCs answer 404, the worker cancels campaign steps and
generators get no block.

## Consequences

- One engine makes everything, so a campaign piece obeys the same approval,
  billing, product-photo and calendar rules as any other post.
- `notifyWaiting` only emails about program steps. A campaign piece waiting
  for a person shows in Campaigns, the Library and the calendar, but sends no
  email yet.
- Up to six campaigns run at once (`MAX_RUNNING_CAMPAIGNS`), each at most 12
  weeks and 60 pieces.
