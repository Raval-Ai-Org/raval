---
name: campaign-platform
description: How a Mellox campaign gets one platform (tagline, key visual, motif, photo rule, type voice) so every piece looks like one campaign. Use when campaign pieces look unrelated, when tuning "Write the plan", or when the campaign_platform skill pack is benchmarked.
---

# Campaign platform (Round 9, pack `campaign_platform`)

Decision record: `docs/adr/0053-creative-skill-packs.md`; campaigns
ADR-0039. Off unless `FEATURE_FLAG_SKILLS_CAMPAIGN_PLATFORM_ENABLED=true`.

## How it works

- **Same call, same price.** The existing "Write the plan" call (55 credits)
  also writes `platform`: `tagline`, `keyVisual`, `motif` and `photoRule`
  (`planSystem({ platform: true })` in `src/lib/campaigns/prompt.ts`).
- **Schema.** `CampaignPlanSchema` keeps `platform` as optional; a bad value
  becomes `undefined`.
- **Grounding.** `groundPlatform` (`src/lib/campaigns/ground.ts`) grounds it
  like the rest of the plan. An offer reaches the tagline only if the brief has
  one, and unknown figures, foreign links and competitor names are dropped.
- **Type.** Code picks the campaign's type voice from the brand's. It reaches
  pieces through `campaignControls` as `controls.typeVoice`, and only valid
  ids are kept.
- **Pieces.** Each piece gets 1–2 platform lines plus the phase's
  deliverable. With no platform, the piece brief is byte-identical to before.

## Tests

`src/lib/campaigns/platform.test.ts`.
