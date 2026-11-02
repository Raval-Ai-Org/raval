# Connected apps: capability matrix

An app in `src/lib/integrations/catalog.ts` moves from `testing` to `live` only
after its row here passes, checked against real accounts Mellox owns. Writes
go to a private or test target and are removed afterwards.

Last run: **2026-11-03**, `tests/live/integrations.live.ts` against the real
Composio project. Every tool slug in the catalog exists at Composio (36 of 36).
"Connect" below means the gateway found or made the managed sign-in, made a
sign-in link, read the pending account back and deleted it. Reading and
publishing need a real account signed in through the link; those columns stay
open until a person connects Mellox's test accounts and sets
`COMPOSIO_LIVE_ACCOUNT_<APP>`.

| App            | Connect (managed sign-in)                                            | Read account         | Read posts + stats   | Publish              | Notes from docs (Nov 2026)                                                                                                                                                                                                  |
| -------------- | -------------------------------------------------------------------- | -------------------- | -------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Instagram      | pass                                                                 | needs a test account | needs a test account | needs a test account | Business/Creator only. Container → publish; carousels 2–10; containers expire ~24 h. Comment replies need Mellox's own Meta app. Stories support unconfirmed.                                                               |
| Facebook Pages | pass                                                                 | needs a test account | needs a test account | needs a test account | Pages only. Native scheduling ≥10 min ahead. Post insights limited to media views since Nov 2025.                                                                                                                           |
| LinkedIn       | pass (held back: stays on Post for Me until pictures and video work) | needs a test account | needs a test account | needs a test account | Person and organisation posts; video personal only; shared rate limits on the managed app. `w_member_social` and `r_organization_admin` can't be combined on one app.                                                       |
| YouTube        | pass (held back: uploads take a file, not a link)                    | needs a test account | needs a test account | needs a test account | Shared quota on the managed app; own Google app recommended.                                                                                                                                                                |
| Pinterest      | pass                                                                 | needs a test account | needs a test account | needs a test account | Creating Pins needs Pinterest Standard access; Trial apps can't create Pins. **Creating a Pin is not checked yet: it still needs a live test with a Pinterest Standard-access account.** Pinterest has no Post for Me path. |
| Reddit         | pass                                                                 | —                    | —                    | —                    | Off until Reddit approves commercial use.                                                                                                                                                                                   |
| HubSpot        | managed sign-in exists                                               | —                    | —                    | —                    | Later (Phase 4).                                                                                                                                                                                                            |
| Shopify        | **no managed sign-in**                                               | —                    | —                    | —                    | Needs Mellox's own Shopify app as an auth config.                                                                                                                                                                           |

How to run:

```bash
npx vitest run --config vitest.live.config.ts tests/live/integrations.live.ts
```

To add the read and publish columns, connect a test account in the app with
`FEATURE_FLAG_INTEGRATIONS_TESTING=true`, copy its Composio account id (from
`integration_accounts.composio_account_id`) into
`COMPOSIO_LIVE_ACCOUNT_<APP>` and run it again.

## Pinterest in Studio

Pinterest is a content platform (`PlatformId` and `DISTRIBUTION_PLATFORMS`):
the image post can target it at 2:3, Autopilot and campaigns plan Pins as
pictures, and the social accounts picker lists it once
`routeSocialPlatform("pinterest")` sends it to Composio (`connectablePlatforms`
in `/api/sdr/status`). It is never on Post for Me's list.

A Pin is exactly one picture. `pinIssue` (`src/lib/social/pinterest.ts`) stops
a video, a Story, a carousel or words alone before approval (editorial approve,
Studio's approve-on-finish and Autopilot), and `planPublish` refuses the same
at send time.

**Still open:** creating a real Pin needs a live test with a Pinterest
Standard-access account (Trial apps can't create Pins). Until that passes, the
app stays `testing` in the catalog.
