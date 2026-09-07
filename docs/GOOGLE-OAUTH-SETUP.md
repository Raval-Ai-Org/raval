# Google OAuth Setup

Mellox uses Supabase Auth as the only authentication authority. The browser starts a PKCE Google sign-in with `supabase.auth.signInWithOAuth`, Google returns to Supabase, and Supabase redirects to the existing Mellox callback at `/auth/callback`.

## Google Cloud OAuth client

Use one Google Web application client for the Supabase Google provider. Add these authorized JavaScript origins:

- `http://localhost:8080`
- `https://raval.ai`

Add this authorized redirect URI exactly:

- `https://slcmqbbjzyztqyucauol.supabase.co/auth/v1/callback`

The redirect URI is the Supabase Auth callback, not the Mellox `/auth/callback` route. Do not add a trailing slash or query string.

## Supabase Auth

In Supabase Dashboard for project `slcmqbbjzyztqyucauol`:

1. Open **Authentication > Sign In / Providers > Google**.
2. Enable Google.
3. Paste the Google Client ID and Client Secret into the provider fields.
4. Set **Authentication > URL Configuration > Site URL** to `https://raval.ai`.
5. Add these **Additional Redirect URLs**:
   - `http://localhost:8080/auth/callback`
   - `https://raval.ai/auth/callback`
6. Save the provider and URL configuration.

The Google Client Secret belongs in Supabase's provider configuration. It must not be placed in `NEXT_PUBLIC_*` variables or source code. `.env.example` lists `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` only for secure deployment automation that provisions Supabase; this Next.js application does not read them in the browser.

## Environment separation

Local development uses the local redirect above and the connected Supabase project. Production uses `https://raval.ai/auth/callback`. The callback is generated from the current browser origin, so a deployment must use the same origin registered in Supabase.

Required application variables remain:

- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` for the browser
- `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` for server functions
- `SUPABASE_SERVICE_ROLE_KEY` for server-only profile/workspace bootstrap

Never commit `.env`, provider secrets, service-role keys, authorization codes, or access/refresh tokens.

## Flow and verification

- Existing users return through the current workspace/session flow.
- New users get an idempotent profile upsert, then continue through the current `/projects` and website -> DNA Scan -> Brand DNA onboarding flow.
- The callback accepts the PKCE code, establishes the Supabase session, calls `ensureAuthWorkspace`, and preserves a safe same-origin `next` path.
- Email/password login, signup, confirmation, reset, protected routes, and logout remain on the existing Supabase implementation.

For a manual check, test login, cancellation, an invalid provider configuration, refresh, logout, an existing user, and a new user in both local and production environments. Provider configuration cannot be changed from this repository; it must be saved in the Supabase and Google Cloud dashboards above.
