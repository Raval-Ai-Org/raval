# Mellox launch security hardening — 14 October 2026

This change strengthens existing security boundaries without changing prices,
plan allowances, supported generation models, or the normal sign-in flow. It
requires deploying the application; no production deployment or live account
configuration was performed from this workspace. No database migration is needed.

## Additional implementation

- Optional Cloudflare Turnstile support now covers email signup, confirmation
  resend, password reset, email login and Google's ID-token login. Every attempt
  consumes a fresh response; failed attempts reset the widget, expired responses
  disable submission, and blocked widgets offer a retry. Supabase performs the
  authoritative verification. With no public site key, authentication remains
  unchanged and the third-party script is not loaded.
- The Docker build accepts `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, and CSP permits
  Turnstile's script and frame origin when that key is configured.
- Signed anonymous-account tokens are refused by the shared server authenticator.
  Promotional signup grants require confirmation in the account owner's trusted
  Supabase Auth record. Browser metadata cannot qualify an account. An unavailable
  Auth lookup postpones only the bonus, leaving existing paid balances usable.
  That lookup is capped at five seconds; its late response cannot issue credits.
  Confirmation checks retry through the existing account cache; the bonus's
  original expiry and idempotency key remain unchanged.
- Production configuration checks reject known private credentials in public
  variables, service-role credentials mislabelled as publishable keys, insecure
  public origins, and Turnstile testing keys. Missing bot-protection configuration
  produces a warning so staged deployment does not interrupt existing login.

### Activate authentication bot protection

1. Create a managed Turnstile widget restricted to Mellox's production domains.
2. Set its **public site key** as `NEXT_PUBLIC_TURNSTILE_SITE_KEY` in the build
   environment and deploy the application. Verify the widget loads and completes.
3. In Supabase Authentication → Bot and Abuse Protection, enable Turnstile and
   store the widget's **secret key there**. Never put it in public variables or
   source code. Enabling Supabase protection before deploying the matching frontend
   can block all supported login flows.
4. Test all five auth operations, including direct Supabase requests without a
   challenge. The latter must be rejected by Supabase, preventing browser bypass.
   Keep email confirmation and Auth rate limits enabled as separate controls.

This integration is implemented but **not activated in the live accounts**: the
production site key and Supabase CAPTCHA configuration have not been supplied or
verified. Without that configuration the app cannot enforce CAPTCHA on direct
Supabase requests. Email auto-confirmation must also stay disabled in Supabase;
an automatically confirmed record is indistinguishable from a confirmed record
to the promotional grant check.

- [Supabase CAPTCHA integration](https://supabase.com/docs/guides/auth/auth-captcha)
- [Turnstile widget lifecycle and expiry](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/)
- [Turnstile CSP requirements](https://developers.cloudflare.com/turnstile/reference/content-security-policy/)

### Additional verification

- All 2,323 unit tests passed; five existing tests were skipped.
- Four browser tests passed with CAPTCHA configured and mocked provider responses:
  signup/resend, email login/reset, Google's token exchange, and expiry/error retry.
- All twelve existing Google/email authentication browser cases passed with CAPTCHA
  unconfigured (ten initially, then two after correcting their fixture hydration
  waits). They cover session cookies, confirmation, preserved destinations,
  duplicate/stale Google callbacks, existing sessions, and provider load failures.
- Browser verification used a dedicated build directory on the alternate workspace
  drive, dummy authentication configuration, and offline font declarations. It
  called no real authentication provider or paid model and changed no source fonts.
- The final isolated production webpack build passed compilation, TypeScript,
  page collection and all 122 static pages using the same offline font fixtures.
  Windows excluded 9,406 outside-root files from its standalone trace, including
  installed browsers and temporary native files. This is a build check, not a
  Linux container smoke test or validation of live font downloads. Verification
  output, dependency links and temporary TypeScript includes were removed.
- A fresh registry check still returned Next.js 16.4.0 and sprintf-js 1.1.3; no
  announced framework patch or patched sprintf-js release was available to install.

## Changes

| Area               | Protection added                                                                                                                                                                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Credit settlement  | Stream capture and cancellation share one settlement operation. An ambiguous capture cannot subsequently release the reservation; capture remains retryable using the same key.                                                                                                             |
| Billing responses  | A paid action cannot start when the database claims a successful reservation but supplies no reservation ID. Calculated prices must remain safe integers.                                                                                                                                   |
| Permissions        | Viewers cannot spend through metered or included spending helpers, including when billing is off or in shadow mode. Plan rollout flags do not disable workspace permissions.                                                                                                                |
| Request limits     | Database failures, thrown errors, and malformed limiter responses use bounded local counters. Ordinary traffic retains the same limits. Counters include concurrent calls and observed shared counts, expire on fixed windows, and never evict active buckets to admit new identities.      |
| Callback payloads  | Stripe, SDR, GitHub, Slack, PostForMe, Kie and OpenRouter callbacks enforce byte limits while reading, including chunked bodies and understated Content-Length headers. Valid UTF-8 remains unchanged for signature verification.                                                           |
| Server functions   | The RPC transport authenticates before reading its body. Each registered function retains its own authentication, role and resource checks.                                                                                                                                                 |
| Outbound downloads | Credentials and custom headers remain on same-origin redirects, but only ordinary crawl/download headers follow a redirect to another origin. Credentials stay removed if a redirect returns to the original site. Additional non-public and obsolete tunneling address ranges are blocked. |
| Private responses  | Explicit responses from authenticated routes also receive `Cache-Control: no-store`. Shared API error responses hide known database, credential and provider details.                                                                                                                       |
| Billing coverage   | Visual analysis is registered under its existing Brand DNA rescan meter. Visual identity review is registered as part of the already charged Studio image action. The existing first-analysis allowance and prices are unchanged.                                                           |

The database remains the shared rate-limit authority. The emergency limiter is
per application process and resets on restart; it cannot provide an exact global
limit across multiple instances during an outage. Atomic database credit holds
remain the authority for paid spending. Preserve monitoring of limiter failures
and readiness rather than treating emergency operation as normal service.

## Validation

- 135 focused authentication, request-bound, redirect, rate-limit and billing
  tests passed across ten files.
- 109 database tests passed across tenant isolation, billing meters and provider
  spend reservations, replaying the real migration history into local Postgres.
- The full test run passed 2,553 tests and skipped five. Its sole failure was
  the two visual model routes missing from billing coverage. That was repaired;
  all nine catalogue/coverage/workbook tests then passed, including a new check
  for those routes. The full suite was not rerun after this catalogue repair.
- Type checking, changed-file lint, changed-file formatting, and diff whitespace
  checks passed. The existing secret scanner found no credentials in 3,164
  tracked files.
- Initial standard build attempts encountered unreachable Google Fonts and a
  full project drive. A subsequent isolated build passed with dummy configuration
  and offline font declarations, as recorded above. Verify live font downloads
  and the production Linux container before deployment. No source-font or live
  production configuration changes were made.

Checks use local fixtures and in-process databases; they do not prove production
settings or replace a live deployment smoke test.

## Dependency findings

The production dependency audit reported **zero high/critical findings and six
moderate entries**. Those entries trace to `sprintf-js` through `argparse`,
`js-yaml`, `gray-matter`, `mammoth` and `@mastra/core`. The published advisory lists
no patched version. npm's suggested changes include incompatible downgrades of
direct libraries, so this change leaves dependencies and document import
behavior intact. Repository inspection found format-string usage in dependency
CLI/help formatting; it did not establish a remotely exploitable application
path. This is a limited reachability observation, not a security guarantee.

- [sprintf-js advisory](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)
- [Primary source report](https://github.com/alexei/sprintf.js/issues/237)

The installed application framework is Next.js 16.4.0. Next.js announced an
upstream security release for 14 October addressing two critical and one high
issue. At review time its official announcement did not yet identify patched
versions or upgrade instructions. Recheck the published release before launch,
apply the documented patch, and repeat the build and compatibility checks.

- [Next.js release announcement](https://nextjs.org/blog/upcoming-nextjs-security-update-october-2026)

## Production settings to verify before launch

These settings were not inspected or changed in the live provider accounts.

1. Set production `BILLING_ENFORCEMENT=on` and confirm there are no unintended
   account-level `off`/`shadow` overrides. Keep the existing billing migrations,
   cron jobs and webhook secrets applied. Credit reservations fail closed when
   balance checks cannot run.
2. Activate the implemented CAPTCHA integration using the order above and confirm
   Supabase email confirmation and appropriate Auth rate limits. Per-user limits
   and CAPTCHA cannot prevent every instance of someone creating many verified
   accounts to collect signup allowances. Anonymous sign-in should stay disabled;
   the app now refuses anonymous accounts at its server boundary.
3. Confirm storage buckets remain private, including Cloudflare R2 public access.
   App permissions and signed URLs cannot protect a bucket made publicly readable
   outside the application. Preserve approved public-sharing and publishing flows.
4. Set provider spending ceilings and alert on unusual signup growth, credit
   usage, limiter failures, rejected signatures and missed billing job heartbeats.
   Require MFA for staff access to hosting, Supabase, payment and source-control
   accounts. Existing repository scans and CI checks should remain enabled.
5. After deployment, smoke-test signup/confirmation, sign-in, one text/image/video
   generation, cancelled and failed work, workspace membership roles, asset
   downloads, and signed callbacks. Confirm both normal charges and appropriate
   refunds, and that a second unrelated account cannot access the first account's
   workspace or files.

This is application hardening with regression checks, not a certification that
the product has no remaining vulnerabilities. Live settings, infrastructure,
multi-account abuse and future dependency advisories remain operational concerns.
