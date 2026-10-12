# Google Identity Services sign-in

Login and signup now render Google's GIS button on Mellox and exchange its ID
token using the existing Supabase SSR browser client's `signInWithIdToken`.
There is no navigation through `/auth/v1/authorize` or the Supabase callback.
Supabase still receives background authentication requests; its hostname is
visible in browser developer tools, but is not the sign-in destination.

## Configuration before release

1. Use the **existing Google Web OAuth client** configured in the current
   Supabase project's Google provider. Set `GOOGLE_CLIENT_ID` in the Railway
   application's Variables to that client's ID. The public identifier is read
   at request time by `/api/auth/google/config`; it is not frozen into a browser
   build. `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is accepted at runtime for compatibility
   when `GOOGLE_CLIENT_ID` is empty. Restart local servers after editing env
   files. No client secret belongs in a public variable or API response.
2. Add each actual Mellox origin (for example `https://mellox.ai` and
   `http://localhost:8080` and `http://localhost:8082` for verification) to that
   client's Authorized JavaScript origins.
   Origins have no path. Preview origins need explicit authorization too.
3. In Google Auth Platform > Branding, configure Mellox AI's name, logo,
   support email, verified domain, homepage, privacy policy and terms links.
   Complete Google's brand verification/publication requirements. Code alone
   cannot change Google's consent screen branding or testing audience.
4. Keep Google enabled in the **same Supabase project**, with the Web client ID
   in its accepted client IDs. Keep **Skip nonce checks disabled**.
5. Retain the existing Supabase OAuth redirect URI and app callback allowlist
   during the transition: outstanding OAuth attempts, confirmation emails and
   password recovery links still need their existing routes.

No database migration, account recreation, identity deletion, key rotation,
storage-key change or session invalidation is needed. Existing Google subjects
resolve through Supabase's existing identity records. Verified-email identity
linking remains Supabase's responsibility; the browser never chooses user IDs
or links accounts itself. Email/password login, email confirmation, recovery,
legacy local-storage migration and cookie refresh remain in place.

## Security and behavior

Each mounted/retried button generates a random 256-bit nonce in memory. Google
receives its SHA-256 hex hash; Supabase receives the original nonce alongside
the credential and validates the signed token. A callback is consumed only
once, rejects stale attempts after ten minutes, and is ignored after unmount
or while email authentication is busy. Failed exchanges regenerate the nonce.
Credentials never enter URLs, application logs or custom browser storage.

The official button opens Google's popup; no One Tap or automatic sign-in is
enabled. Closing the popup leaves the page available for another attempt.
Blocked/failed SDK or configuration loads show a retry control; absent
configuration leaves email authentication available. The configuration response
contains only a validated Web client ID, uses `Cache-Control: no-store`, and
never reads the client secret or falls back to the Analytics connector's client.
CSP permits only the required Google GIS
script/style/connect sources and Google's frame origin. COOP already allows
popups. Existing Supabase cookies and auth listeners receive the new session
before the normal workspace setup and safe `next` navigation run.

## Release validation (manual with configured client)

Use a staging build on an authorized origin. Check desktop Chrome, Safari and
Firefox, mobile widths, popup blocking and third-party-cookie restrictions.
Sign up with a new Google test account; verify profile, workspace/invite
destination and session persistence after refresh. Log out, sign in again and
confirm the same Supabase user UUID/workspace. Sign in with a pre-existing
Google account and confirm its original UUID/data. Test a verified email
account using Google with the same email and confirm Supabase's identity-linking
policy preserves its UUID. Check an existing session survives the new build,
refresh and sign-out. Repeat email login/signup, confirmation and recovery.
Inspect the popup: it must identify Mellox and its authorized domain; the page
must never navigate to the Supabase project domain. Reject invalid/expired or
wrong-audience tokens and verify no session is created. Do not disable nonce
verification to make an incorrectly configured client pass.

Automated tests use stubbed GIS credentials and Supabase responses. They verify
the application's integration contract, not Google's signature validation or
the live project's account-linking configuration.

### Local verification — 2026-10-12

- 36 targeted unit tests pass, including server ID precedence, runtime updates,
  invalid/missing configuration, secret exclusion, ID-token exchange, nonce
  generation, security headers, API authentication and workspace handling.
- All 12 Chromium integration cases pass on an isolated Next.js development
  server with mocked runtime configuration and GIS/Supabase endpoints.
  Coverage includes login/signup success, duplicate callbacks, nonce-bound
  retries, SDK failure/retry, email signup/login, cookie persistence after
  reload, legacy session recovery, empty credentials, expired attempts and
  callbacks after switching auth pages.
- TypeScript, ESLint and Prettier validation passed for the implementation.
- The public sign-in Web client ID was subsequently resolved from the existing
  Supabase provider's Google authorization URL and saved in the ignored
  `.env.local` as `NEXT_PUBLIC_GOOGLE_CLIENT_ID`. The existing
  `GOOGLE_ANALYTICS_CLIENT_ID` is a different client and was left unchanged.
- Fresh real GIS smoke checks render the Google button for `https://mellox.ai`.
  Google rejects `http://localhost:8080` and `http://localhost:8082` with
  "The given origin is not allowed for the given client ID". These checks use
  synthetic pages intercepted locally under each origin; nothing was published
  and no Google user signed in. The production origin is currently accepted;
  add the required localhost origins to this Web client's **Authorized
  JavaScript origins** before real local sign-in can work.
- The production build passes with both Google client-ID variables absent
  during compilation. Its standalone server returns the correct public ID
  when only `GOOGLE_CLIENT_ID` is supplied at runtime, with no-store caching.
  This reproduces Railway's build/runtime separation without deploying.
- Four additional Chromium signup/login success and rejection/retry cases
  pass against that standalone production server, using its real runtime
  configuration endpoint and mocked Google/Supabase credentials.
- Live account sign-in, consent/branding, real account identity linking and
  Safari/Firefox remain release checks. No deployment or external auth
  configuration was changed.

To rerun mocked browser tests, start Next.js, then run
`npx playwright test --project=integration tests/integration/google-sign-in.spec.ts --workers=1`.
Use `PLAYWRIGHT_BASE_URL` when the server is not on port 8080. The tests intercept
Google and Supabase browser requests; they do not create real accounts.

## Production diagnosis and next steps

The live `https://mellox.ai/login` page returned the original unavailable message
and never initialized GIS. The live `/api/auth/google/config` returned 404,
confirming this runtime fix is not deployed. Locally, that endpoint returns 200
with only the client ID, matching the existing Supabase provider, and no-store
caching. The original component read a build-inlined
`NEXT_PUBLIC_GOOGLE_CLIENT_ID`; Docker declared build arguments for the other
public variables but omitted this one, and `.dockerignore` excludes local env
files. A value saved locally or injected only into the running Railway container
therefore could not repair the already-built browser bundle.

The correction removes that build dependency using the dynamic runtime endpoint.
For the next reviewed release:

1. **Railway application > Variables:** set `GOOGLE_CLIENT_ID` to the Web client ID
   shown in **Supabase > Authentication > Sign In / Providers > Google**.
   The existing `NEXT_PUBLIC_GOOGLE_CLIENT_ID` may remain; the server variable
   takes precedence. Do not use `GOOGLE_ANALYTICS_CLIENT_ID`, and never set a
   `NEXT_PUBLIC_GOOGLE_CLIENT_SECRET`. `APP_URL` / `NEXT_PUBLIC_APP_URL` in
   production must be `https://mellox.ai`, not localhost.
2. **Google Auth Platform > Clients > the same Web application client >
   Authorized JavaScript origins:** add `https://mellox.ai`,
   `http://localhost:8080` and `http://localhost:8082` for the local test ports.
   Add `https://www.mellox.ai` only if it actually serves sign-in. Do not add
   `/login`, `/signup` or `/auth/callback` to origin entries. Save the client.
3. **Supabase:** keep the same project, Google provider and Web client ID, with
   Skip nonce checks disabled. Keep existing OAuth redirect URIs for old links.
4. When ready, deploy the reviewed code manually. Check
   `/api/auth/google/config` returns 200 with only `{ "clientId": "..." }` and
   `Cache-Control: no-store`, then test new signup, returning-user login and
   existing sessions on the live domain. A 503 means the runtime ID is absent
   or invalid. Google console "origin is not allowed" means step 2 is incomplete.

No accounts, identities, cookie storage settings or existing sessions are
migrated or invalidated. No automatic rollback to the Supabase-domain redirect
is introduced: external Google origin settings cannot be corrected by changing
the authentication UI.

References: [Supabase Google authentication](https://supabase.com/docs/guides/auth/social-login/auth-google),
[GIS setup and CSP](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid),
[Google button API](https://developers.google.com/identity/gsi/web/reference/js-reference).
