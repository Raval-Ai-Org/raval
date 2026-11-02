# Connected apps: capability matrix

An app in `src/lib/integrations/catalog.ts` moves from `testing` to `live` only
after its row here passes, checked against real accounts Mellox owns. Writes
go to a private or test target and are removed afterwards.

Status: **not run yet** — `COMPOSIO_API_KEY` in `.env` is rejected by Composio
("Invalid API key", 2026-11-02). Put a valid project key there to run it.

| App | Connect (managed sign-in) | Read account | Read posts + stats | Publish | Notes from docs (Nov 2026) |
|---|---|---|---|---|---|
| Instagram | — | — | — | — | Business/Creator only. Container → publish; carousels 2–10; containers expire ~24 h. Comment replies need Mellox's own Meta app. Stories support unconfirmed. |
| Facebook Pages | — | — | — | — | Pages only. Native scheduling ≥10 min ahead. Post insights limited to media views since Nov 2025. |
| LinkedIn | — | — | — | — | Person and organisation posts; video personal only; shared rate limits on the managed app. `w_member_social` and `r_organization_admin` can't be combined on one app. |
| YouTube | — | — | — | — | Shared quota on the managed app; own Google app recommended. |
| Pinterest | — | — | — | — | Creating Pins needs Pinterest Standard access; Trial apps can't create Pins. If the managed app can't, Pinterest goes to Post for Me. |
| Reddit | not run | — | — | — | Off until Reddit approves commercial use. |

How to run: `tests/live/integrations.live.ts` (to be added with Phase 2), with
`FEATURE_FLAG_INTEGRATIONS_TESTING=true` and Mellox's test accounts.
