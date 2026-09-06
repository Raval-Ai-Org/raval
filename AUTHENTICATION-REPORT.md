# Authentication & User Management - Complete Codebase Report

**Project**: Mellox AI (formerly "Raval")  
**Date**: 2026-09-04  
**Framework**: Next.js 16 + Supabase  
**Supabase Project ID**: `slcmqbbjzyztqyucauol`

---

## 1. WHERE USERS ARE SAVED (DATABASE)

Users are stored across **two layers**:

### A. Supabase Auth (Managed by Supabase internally)

- **Table**: `auth.users` (owned by Supabase, not directly accessible via client)
- **Contains**: `id` (UUID), `email`, `raw_user_meta_data` (name, avatar, etc.), `created_at`
- **Created on**: Every `supabase.auth.signUp()` or Google OAuth first login
- **This is the source of truth for authentication** - passwords, emails, OAuth tokens live here

### B. Application Database (PostgreSQL via Supabase)

- **Table**: `public.profiles`
  - `id` (UUID, FK → `auth.users.id`, CASCADE DELETE)
  - `name` (text)
  - `avatar_url` (text)
  - `persona` (text, nullable)
  - `persona_set_at` (timestamptz, nullable)
  - `created_at` (timestamptz, DEFAULT now())
  - **RLS**: Users can only SELECT/UPDATE/INSERT their own row (`auth.uid() = id`)

### C. How Profile Gets Created

**Two mechanisms exist (migration trigger + server function):**

1. **Database Trigger** (`on_auth_user_created`):
   - File: `supabase/migrations/20260515092856_f89390f2-6325-42a0-851e-f98e1eefea7f.sql:112-133`
   - Fires `AFTER INSERT ON auth.users`
   - Auto-creates `profiles` row with name from `raw_user_meta_data->>'name'`
   - Auto-creates a "My Workspace" + `workspace_members` row (owner role)

2. **Server Function** (`ensureAuthWorkspace`):
   - File: `src/server/fns/workspaces.ts:122-155`
   - Called after every login/signup (email or Google)
   - **Upserts** into `profiles` with name/avatar from JWT claims
   - Does NOT auto-create workspace (comment says: "New users must create their first client explicitly")
   - Returns the user's first `workspace_id` or `null`

---

## 2. REGISTRATION FLOWS

### A. Email/Password Signup

- **Route**: `/signup` → `src/app/signup/SignupPage.tsx:65-91`
- **Code**:
  ```typescript
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: {
      data: { name: name.trim(), full_name: name.trim() },
      emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
    },
  });
  ```
- **Behavior**:
  - Creates user in `auth.users`
  - If `autoConfirm` is OFF (default): sends confirmation email, user must click link
  - If `autoConfirm` is ON: session returned immediately
  - Trigger fires → profile + workspace auto-created in DB
  - After session is available → `ensureAuthWorkspace()` upserts profile
  - Redirects to `/app` (or `next` param)

### B. Google OAuth Signup

- **Route**: `/signup` → same page, "Continue with Google" button
- **Code**: `src/lib/auth.ts:96-117` → `signInWithGoogle(nextPath)`
  ```typescript
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: authCallbackUrl(nextPath) },
  });
  ```
- **Flow**:
  1. Browser redirects to Google OAuth consent screen
  2. User authenticates with Google
  3. Google redirects to `/auth/callback?code=...`
  4. Callback handler exchanges PKCE code for session
  5. `ensureAuthWorkspace()` creates/updates profile
  6. Redirects to target path

---

## 3. LOGIN FLOWS

### A. Email/Password Login

- **Route**: `/login` → `src/app/login/LoginPage.tsx:65-83`
- **Code**:
  ```typescript
  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  ```
- **Behavior**: Returns session directly, then calls `ensureWorkspace()` and navigates

### B. Google OAuth Login

- **Same as Google Signup** — `signInWithGoogle()` in `src/lib/auth.ts:96-117`
- If user already exists in `auth.users`, they just get logged in
- If new Google user, trigger auto-creates profile + workspace

---

## 4. OAUTH CALLBACK HANDLER

- **Route**: `/auth/callback` → `src/app/auth/callback/AuthCallbackPage.tsx`
- **Handles both flows**:
  1. **Implicit flow**: Hash params `#access_token=...&refresh_token=...` → `supabase.auth.setSession()`
  2. **PKCE flow**: Query param `?code=...` → `supabase.auth.exchangeCodeForSession(authCode)` ← **THIS IS THE ONE USED**
- **After session established**:
  - Calls `ensureWorkspace()` to create/update profile
  - Reads stored `next` path from sessionStorage
  - Navigates to target (default `/app`)

---

## 5. SESSION MANAGEMENT

### Storage

- **Location**: `localStorage` under key `sb-slcmqbbjzyztqyucauol-auth-token`
- **Config**: `src/integrations/supabase/client.ts:76-81`
  ```typescript
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
    flowType: "pkce",
  }
  ```

### Auto-Refresh

- Supabase client automatically refreshes access tokens before expiry
- Refresh token typically valid for 1 week
- Happens transparently in background

### Session Check on Load

- **LandingGate** (`src/app/LandingGate.tsx`): Root `/` page checks session → redirects to `/app` or `/login`
- **LoginPage**: Checks session on mount → redirects to `/app` if already logged in
- **SessionGate** (`src/components/auth/SessionGate.tsx`): Wraps protected routes, redirects to `/login?next=...` if no session

---

## 6. PROTECTED ROUTES

Routes wrapped with `<SessionGate>`:

- `/app` (workspace)
- `/projects`
- `/onboarding`
- `/analytics`
- `/calendar`
- `/content`
- `/studio`
- `/agency`
- `/workspaces`

**Unprotected routes**:

- `/login`, `/signup`, `/reset-password`, `/auth/callback`
- `/share/[slug]` (public share pages)
- `/` (LandingGate redirects based on session)

---

## 7. SERVER-SIDE AUTH

### Token Validation

- **Middleware**: `src/integrations/supabase/auth-middleware.ts:33-103`
  - Extracts `Authorization: Bearer <token>` from request headers
  - Validates JWT format (3 parts)
  - Calls `supabase.auth.getClaims(token)` to verify signature + expiry
  - Extracts `userId` from `claims.sub`
  - Creates RLS-bound Supabase client with the user's token
  - Passes `{ supabase, userId, claims }` to handler context

### RPC Client (Browser → Server)

- **File**: `src/lib/authed-fetch.ts:5-13`
  - Every server function call attaches `Authorization: Bearer <access_token>` from session
- **File**: `src/lib/rpc-client.ts`
  - Browser calls `/api/rpc/<module>/<function>` with auth headers
  - Server function validates token via `requireSupabaseAuth` middleware

### Admin Client (Service Role)

- **File**: `src/integrations/supabase/client.server.ts`
  - Uses `SUPABASE_SERVICE_ROLE_KEY` — bypasses RLS
  - Only used server-side for trusted operations (creating workspaces, upserting profiles)
  - Lazy-loaded inside handlers: `const { supabaseAdmin } = await import("@/integrations/supabase/client.server")`

### API Routes (App Router)

- **File**: `src/server/api-auth.ts:12-36`
  - `requireUserId(request)` — validates Bearer token, returns userId
  - Used by: `/api/ai-generate`, `/api/chat`, `/api/generate-image`, `/api/file-extract`, `/api/brand-extract`, etc.

---

## 8. PASSWORD RESET

- **Route**: `/reset-password` → `src/app/reset-password/ResetPasswordPage.tsx`
- **Initiated from**: Login page "Forgot password?" link
- **Code**:
  ```typescript
  await supabase.auth.resetPasswordForEmail(email, { redirectTo: passwordResetUrl() });
  ```
- **Reset link**: Points to `/reset-password` with recovery token in URL
- **Token exchange**: Handles both implicit (`#access_token`) and PKCE (`?code=`) flows
- **Update**: `supabase.auth.updateUser({ password })` sets new password

---

## 9. LOGOUT

- **File**: `src/lib/auth.ts:25-43` → `signOutAndRedirect()`
- **Actions**:
  1. Cancel React Query subscriptions
  2. Clear query cache
  3. Call `supabase.auth.signOut()`
  4. Remove workspace-scoped localStorage keys (selected workspace, persona, UI state)
  5. Remove session storage auth-next key
  6. Dispatch `workspace:changed` event
  7. Hard redirect to `/login` (drops all in-memory state)

---

## 10. GOOGLE OAUTH STATUS

### Code: Fully Implemented

- `signInWithGoogle()` in `src/lib/auth.ts:96-117`
- Callback handler supports PKCE code exchange
- Error handling for provider not enabled, popup blocked, cancelled

### Supabase Configuration: NOT ENABLED

- Google OAuth provider is NOT configured in the Supabase project
- Trying to use it returns: "provider 'google' is not supported" or "missing oauth secret"
- **To fix**: Go to Supabase Dashboard → Authentication → Sign In → Providers → Enable Google → Add OAuth credentials

---

## 11. ENVIRONMENT VARIABLES

### Client-side (NEXT_PUBLIC_*)

```bash
NEXT_PUBLIC_SUPABASE_URL="https://slcmqbbjzyztqyucauol.supabase.co"
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="sb_publishable_[key]"
NEXT_PUBLIC_APP_URL="https://raval.ai"  # or http://localhost:8080 for dev
```

### Server-only

```bash
SUPABASE_URL="https://slcmqbbjzyztqyucauol.supabase.co"
SUPABASE_PUBLISHABLE_KEY="sb_publishable_[key]"
SUPABASE_SERVICE_ROLE_KEY="[secret]"
```

---

## 12. DATABASE SCHEMA (User-Related Tables)

### `auth.users` (Supabase managed)

- id, email, raw_user_meta_data, created_at, etc.

### `public.profiles`

- id (UUID, PK, FK → auth.users.id)
- name (text)
- avatar_url (text)
- persona (text)
- persona_set_at (timestamptz)
- created_at (timestamptz)

### `public.workspaces`

- id (UUID, PK)
- owner_id (UUID, FK → auth.users.id)
- name (text)
- plan (text, default 'starter')
- brand_voice (jsonb)
- website_url (text)
- industry (text)
- created_at (timestamptz)

### `public.workspace_members`

- id (UUID, PK)
- workspace_id (UUID, FK → workspaces.id)
- user_id (UUID, FK → auth.users.id)
- role (app_role enum: 'owner' | 'admin' | 'editor' | 'viewer')
- created_at (timestamptz)
- UNIQUE (workspace_id, user_id)

### `public.workspace_invites`

- id, workspace_id, email, role, invited_by, token, accepted_at, created_at

---

## 13. KEY FILES REFERENCE

| Purpose                         | File Path                                      |
| ------------------------------- | ---------------------------------------------- |
| Supabase browser client         | `src/integrations/supabase/client.ts`          |
| Supabase admin client           | `src/integrations/supabase/client.server.ts`   |
| Auth middleware (server)        | `src/integrations/supabase/auth-middleware.ts` |
| Auth helpers (client)           | `src/lib/auth.ts`                              |
| Authenticated fetch             | `src/lib/authed-fetch.ts`                      |
| RPC client (browser→server)     | `src/lib/rpc-client.ts`                        |
| API auth helper                 | `src/server/api-auth.ts`                       |
| Login page                      | `src/app/login/LoginPage.tsx`                  |
| Signup page                     | `src/app/signup/SignupPage.tsx`                |
| OAuth callback                  | `src/app/auth/callback/AuthCallbackPage.tsx`   |
| Password reset                  | `src/app/reset-password/ResetPasswordPage.tsx` |
| Root landing gate               | `src/app/LandingGate.tsx`                      |
| Session gate (protected routes) | `src/components/auth/SessionGate.tsx`          |
| Workspace functions             | `src/lib/workspaces.functions.ts`              |
| Workspace server handlers       | `src/server/fns/workspaces.ts`                 |
| Server fn framework             | `src/server/server-fn.ts`                      |
| Middleware framework            | `src/server/middleware.ts`                     |
| DB types                        | `src/integrations/supabase/types.ts`           |
| Initial schema migration        | `supabase/migrations/20260515092856_*.sql`     |
| Security fix migration          | `supabase/migrations/20260515182818_*.sql`     |
| Invites migration               | `supabase/migrations/20260612120630_*.sql`     |
| Environment template            | `.env.example`                                 |
| Supabase config                 | `supabase/config.toml`                         |

---

## 14. ARCHITECTURE DIAGRAM

```
Browser (Client)
├── /login, /signup
│   ├── Email form → supabase.auth.signInWithPassword() / signUp()
│   └── Google button → supabase.auth.signInWithOAuth("google")
│       └── Redirect to Google → /auth/callback?code=...
│           └── exchangeCodeForSession() → session in localStorage
│
├── Protected Routes (SessionGate)
│   └── getSession() check → redirect to /login if no session
│
├── Server Function Calls (RPC)
│   └── authedFetch() attaches Authorization: Bearer <access_token>
│       └── POST /api/rpc/<module>/<function>
│
└── Logout
    └── signOutAndRedirect() → clear localStorage → /login

Server (Next.js API Routes + Server Functions)
├── requireSupabaseAuth middleware
│   ├── Extract Bearer token from headers
│   ├── supabase.auth.getClaims(token) → validate JWT
│   ├── Create RLS-bound Supabase client
│   └── Pass { supabase, userId, claims } to handler
│
├── supabaseAdmin (service role)
│   └── Bypasses RLS for admin operations (create workspace, upsert profile)
│
└── API Routes (/api/*)
    └── requireUserId(request) → validates Bearer token → returns userId

Supabase (PostgreSQL + Auth)
├── auth.users (managed)
│   └── Created by signUp() or Google OAuth
│
├── Trigger: on_auth_user_created
│   └── AUTO-CREATE profiles + workspaces + workspace_members
│
├── public.profiles
│   └── Upserted by ensureAuthWorkspace() after every login
│
├── public.workspaces
│   └── Created by trigger or createWorkspace() server function
│
└── public.workspace_members
    └── Links users to workspaces with role-based access
```

---

## 15. KNOWN ISSUES

1. **Google OAuth not configured** in Supabase project — code is ready but provider is disabled
2. **Supabase project is new/empty** — migrations may not be applied yet
3. **Email confirmation** may be required depending on Supabase project settings
4. **`auth_schema_backup.sql`** in root is empty (0 lines)

---

_Report generated by reading all source files in the codebase. No files were modified._
