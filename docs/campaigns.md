# Campaigns

Decision record: [ADR-0039](adr/0039-campaigns.md). This page is the
working reference.

## Where things are

| Part | Path |
| --- | --- |
| Pure core | `src/lib/campaigns/` (`contracts`, `playbooks`, `skeleton`, `media`, `links`, `ground`, `progress`, `sync`, `suggest`, `prompt`) |
| Server | `src/server/campaigns/service.server.ts`, `context.server.ts` |
| RPC | `src/server/fns/campaigns.ts`, stubs `src/lib/campaigns.functions.ts` |
| UI | `src/components/app/campaigns/` (`CampaignsScreen` presentational, `CampaignsPanel` wired), route `CampaignsRoute.tsx` |
| Lab | `/campaigns-lab` (dev only), `tests/integration/campaigns-lab.spec.ts` |
| Table | `workspace_campaigns`, plus `autopilot_actions.campaign_id` (migration `20261031090000_campaigns.sql`) |
| Model routes | `campaign.plan` (PREMIUM, 55 credits via `campaign`), `campaign.write` (ECONOMY, via `ideas`) |
| Chat / MCP | `list_campaigns`, `get_campaign` (read only); chat place `campaigns` |

## Life of a campaign

1. **Draft.** The designer saves the brief (`saveCampaign`): kind, name,
   dates, goal and link, facts, offer, products, photos and clips, channels,
   pace and Stories. The skeleton is laid out at once and is free.
2. **Ready.** "Write the plan" (`planCampaign`) writes the ideas, then
   grounds them.
3. **Running.** "Start campaign" (`startCampaign`) writes one Autopilot step
   per piece. The worker makes each piece before its day, and approval
   follows Autopilot.
4. **Paused / ended / done.**
   - Pause parks unmade steps.
   - End cancels them.
   - `settleFinished` marks a campaign done when its days and its pieces are
     over.

## Rules to keep

- Only code decides dates, channels and formats. A model writes only words,
  and they pass `groundCampaignPlan`.
- One feed post per channel per day across the person's own posts,
  campaigns and Autopilot.
- The person's link is checked as public https. Instagram and TikTok get
  "link in bio", never a URL in the caption.
- The goal count is typed by the person. Never estimate it.
- A piece is only ever made through the Autopilot worker and
  `createBilledStudioJob`.
- Never write `content_items` from Campaigns. Never approve a piece here.
- A new campaign kind is a new playbook entry. The integrity test checks its
  aims, deliverable and hooks.
