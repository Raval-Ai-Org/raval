# Google Identity Services sign-in

Login and signup now render Google's GIS button on Mellox and exchange its ID
token using the existing Supabase SSR browser client's `signInWithIdToken`.
There is no navigation through `/auth/v1/authorize` or the Supabase callback.
Supabase still receives background authentication requests; its hostname is
visible in browser developer tools, but is not the sign-in destination.

## Configuration before release

1. Use the **existing Google Web OAuth client** configured in the current
   Supabase project's Google provider. Set `NEXT_PUBLIC_GOOGLE_CLIENT_ID` to
   that public client ID before building Next.js. A local server must restart
   after this variable changes. No client secret belongs in a public variable.
2. Add each actual Mellox origin (for example `https://mellox.ai` and
   `http://localhost:8080`) to that client's Authorized JavaScript origins.
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
Blocked/failed SDK loads show a retry control; absent configuration leaves
email authentication available. CSP permits only the required Google GIS
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

- 30 targeted unit tests passed across auth helpers, nonce/ID-token exchange,
  GIS security headers, API authentication and workspace services.
- 11 Chromium integration tests passed on an isolated Next.js development
  server with a test-only Web client ID and mocked GIS/Supabase endpoints.
  Coverage includes login/signup success, duplicate callbacks, nonce-bound
  retries, SDK failure/retry, email signup/login, cookie persistence after
  reload, legacy session recovery, empty credentials, expired attempts and
  callbacks after switching auth pages.
- TypeScript, ESLint and Prettier validation passed for the implementation.
- The public sign-in Web client ID was subsequently resolved from the existing
  Supabase provider's Google authorization URL and saved in the ignored
  `.env.local` as `NEXT_PUBLIC_GOOGLE_CLIENT_ID`. The existing
  `GOOGLE_ANALYTICS_CLIENT_ID` is a different client and was left unchanged.
- Real GIS smoke checks returned Google's "The given origin is not allowed
  for the given client ID" error for `http://localhost:8082` and
  `https://mellox.ai`. The latter check used a synthetic page intercepted locally
  under that origin; nothing was published. Add the actual Mellox sign-in
  origin and required localhost origins to this Web client's **Authorized
  JavaScript origins** in Google Cloud before real sign-in can work.
- Live Google consent/branding, real account identity linking, Safari/Firefox
  and a production build remain release checks. No deployment or external auth
  configuration was changed.

To rerun browser tests, start Next.js on an authorized test origin with
`NEXT_PUBLIC_GOOGLE_CLIENT_ID` set, then run
`npx playwright test --project=integration tests/integration/google-sign-in.spec.ts --workers=1`.
Use `PLAYWRIGHT_BASE_URL` when the server is not on port 8080. The tests intercept
Google and Supabase browser requests; they do not create real accounts.

References: [Supabase Google authentication](https://supabase.com/docs/guides/auth/social-login/auth-google),
[GIS setup and CSP](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid),
[Google button API](https://developers.google.com/identity/gsi/web/reference/js-reference).
