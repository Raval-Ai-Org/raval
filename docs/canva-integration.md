# Canva integration

Settings → Connections stores one Canva grant per Mellox workspace. OAuth uses a ten-minute, single-use server state, PKCE, authenticated user and workspace binding, and a safe internal return path. The callback is `/api/integrations/canva/callback`. Configure `CANVA_CLIENT_ID` and `CANVA_CLIENT_SECRET` server-side. The app derives a provider-specific token encryption key from the required `SUPABASE_SERVICE_ROLE_KEY`; `CANVA_TOKEN_ENCRYPTION_KEY` is optional and remains available to read grants encrypted before this change. Register `https://mellox.ai/api/integrations/canva/callback` and `http://127.0.0.1:8080/api/integrations/canva/callback` in Canva (Canva refuses `localhost`; Mellox sends the `127.0.0.1` address by itself when `APP_URL` is local and hands back to `APP_URL`). `FEATURE_FLAG_CANVA_MAGIC_LAYERS_ENABLED` is on unless set to `false` (see Editing).

For a deployed instance, set `APP_URL` to its public HTTPS origin and register that exact origin plus `/api/integrations/canva/callback` in Canva. Keep `SUPABASE_SERVICE_ROLE_KEY` stable across deployments so saved grants remain readable. If an older grant was encrypted with a dedicated key, keep that `CANVA_TOKEN_ENCRYPTION_KEY` available until the grant is replaced; otherwise reconnect Canva. Deploy the Canva Supabase migrations separately from the web build, and check the connection status in Settings before using “Edit with Canva.”

Scopes: `asset:read asset:write design:content:read design:content:write design:meta:read`. The authorization URL sends these five scopes as one space-separated value.

`canva_oauth_credentials` is service-role only and stores AES-256-GCM encrypted access and refresh tokens. The server gateway refreshes tokens and normalizes errors. The browser receives only connection status, mapping identifiers, mode, and a validated Canva editor URL. Disconnect deletes usable local credentials and attempts revocation. Audit records connection, disconnection, design creation, import and selection without credentials.

## Editing

One control, "Edit in Canva" (`src/components/studio/CanvaEditButton.tsx`): a single button that opens a small panel. It is in the Studio review toolbar (once per post) and in the Library.

Opening resolves workspace-owned stored images server-side and uploads the bytes into Canva. Each picture is then converted with Canva's [Image-to-Design job](https://www.canva.dev/docs/connect/api-reference/design-imports/) (Magic Layers), which rebuilds the text and elements so a person can change them. The result is recorded as `magic_layers`. The conversion is tried directly: asking Canva whether the account may use it (`/users/me/capabilities`) needs the `profile:read` scope, which this app does not request. If the conversion is refused, out of allowance or fails, that picture is placed whole with the [Create Design API](https://www.canva.dev/docs/connect/api-reference/designs/create-design/) (`flat_image`), and the panel says its text can't be changed.

Image-to-Design is a Canva Preview API. Canva does not approve public integrations that use Preview APIs, so set `FEATURE_FLAG_CANVA_MAGIC_LAYERS_ENABLED=false` before submitting the integration for public review; everything else keeps working, with flat pictures.

A carousel or Story becomes one Canva design per slide (`canva_fallback_slide_designs`, in slide order), because Canva converts one picture at a time and has no API to add pages. The panel lists the slides. Only when no slide can be converted is a carousel that Mellox drew itself rebuilt from its words as one multi-page presentation through the [Design Import API](https://www.canva.dev/docs/connect/api-reference/design-imports/create-design-import-job/) (`design_import`): editable, but a plainer layout than the slides.

A design is found by the image it was made from (`mappingForAsset`), not by the post, so a post that got a new picture never offers the old picture's design. A picture that was brought back from Canva reopens the design it came from. A design deleted in Canva is set aside and a new one is made.

## Bringing an edit back

"Bring back my edit" is one step. The server starts a [PNG export](https://www.canva.dev/docs/connect/api-reference/exports/create-design-export-job/) (page one of each slide design, or every page of a presentation), polls with a bound, checks the page count against the post, downloads every temporary URL through the guarded fetcher, validates PNG MIME and dimensions, and saves each page through the canonical asset path (JPEG unless the design is see-through). `canva_import_versions` and `canva_import_pages` keep sequential versions and ordered pages; each new asset names the original as its parent, and originals are never overwritten.

The same call then points the post at the new version (`pointPostsAt`): every post in the workspace that shows that picture (one per platform), and the Studio job's media so the preview follows. Scheduled and published posts are left alone and the edit is only saved to the Library; an approved or pending post returns to draft for review. "Use original" (`restoreCanvaOriginal`) points the same posts back at the pictures Mellox made. There is no continuous Canva polling.

All server actions require an explicit workspace and editor role. Source assets, mapping, version and pages are checked within the workspace. Raw tokens and temporary export URLs are never returned to the browser or persisted as asset identity. Provider download URLs must be HTTPS Canva hosts, then pass Mellox's SSRF-safe fetch and size checks. Async jobs have bounded polling and normalized errors.

Live check: `tests/live/canva.live.ts` (the round trip that creates designs is behind `CANVA_LIVE_WRITE=yes`).
