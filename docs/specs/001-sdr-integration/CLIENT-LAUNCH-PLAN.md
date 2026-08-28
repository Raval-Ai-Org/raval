# RavalAI Client Launch Plan

> **Status:** Active | **Author:** Muhammad-Junaid-Sajjad | **Date:** 2026-08-27
> **Target launch:** End of September 2026 (~late Sep 2026)
> **Companion docs:** [spec.md](spec.md) · [plan.md](plan.md) · [tasks.md](tasks.md) · [INTEGRATION-HOLD.md](INTEGRATION-HOLD.md)

---

## 0. Executive Summary

RavalAI platform and the Social Distribution Engine (SDR) are both **fully live** as of 2026-08-27. The dev server, vitest suite (115/115), live e2e suite (7/7), Supabase auth, and the live Cloudflare SDR tunnel are all healthy and verified.

**What is left for a public client launch:**

1. The four **developer apps** (RavalAI's registered apps on LinkedIn, X, Facebook, Instagram) — owned by RavalAI, not by clients. Status: **2/4 partial** (LinkedIn ✅, X ✅ done per CLAUDE.md; Facebook ❌, Instagram ❌ not done).
2. **Production deployment** — replace `localhost:8080` and the Cloudflare tunnel with stable HTTPS URLs.
3. **Pricing + billing** — Stripe integration so clients can pay.
4. **Dogfood + launch sprint** — onboard 1 friendly client, fix friction, then go public.

This document is the **single source of truth** for everything that must happen between today and launch. It is organized in 6 phases, each with concrete, testable steps.

---

## 1. Current State (as of 2026-08-27)

### 1.1 What's working (verified live)

| Component | Status | Evidence |
|---|---|---|
| RavalAI app boots | ✅ | `npm run dev` → http://localhost:8080, HTTP 200 |
| Login with `junaidsajjad2298@gmail.com` | ✅ | e2e test 1, 12.5s |
| All major routes load | ✅ | e2e test 2, 8/8 routes |
| Hydration warnings resolved | ✅ | commit `50469ed` |
| `/studio` → `/app/social` redirect | ✅ | 307 verified |
| Vitest unit tests | ✅ | 115/115 in 5.88s |
| Live e2e tests | ✅ | 7/7 in 2.6 min |
| Supabase auth + workspace | ✅ | real Supabase project `smdravaoaeqdajmnrlpr` |
| SDR proxy from RavalAI | ✅ | `/api/sdr/accounts` returns 401 (auth-protected) |
| SDR tunnel live | ✅ | `https://spice-carlo-cure-commonwealth.trycloudflare.com` |
| LinkedIn OAuth code | ✅ | `app/api/accounts.py` lines for `linkedin` |
| X/Twitter OAuth code | ✅ | `app/api/accounts.py` lines for `twitter` |
| Facebook OAuth code | ✅ | `app/api/accounts.py` lines for `facebook` |
| Instagram OAuth code | ✅ | `app/api/accounts.py` lines for `instagram` |
| Token encryption (Fernet) | ✅ | `app/security.py` |
| Webhook receiver | ✅ | `/api/v1/webhooks/...` |
| Celery worker + beat | ✅ | `app/celery_app.py` |

### 1.2 What's missing or in progress

| Gap | Severity | Owner | ETA |
|---|---|---|---|
| Meta (Facebook) Developer App | **CRITICAL** | Junaid | 5-7 business days (App Review) |
| Instagram enabled on Meta app | **CRITICAL** | Junaid | Same as above |
| X/Twitter production credentials | High | Junaid | 1-2 days |
| LinkedIn production credentials | High | Junaid | 1-2 days |
| SDR permanent URL (`sdr.raval.ai`) | **CRITICAL** | Junaid | 1 day (ADR-0005) |
| RavalAI production URL (`app.raval.ai`) | **CRITICAL** | Junaid | 0.5 day (Vercel) |
| Landing page (`raval.ai`) | High | Junaid | 1 day |
| Stripe integration | High | Junaid | 1-2 days |
| Friendly-client dogfood | Medium | Junaid + 1 client | 2-3 days |
| Public launch announcement | Low | Zian | 0.5 day |

### 1.3 What the client sees (current state)

If a client tried to sign up **today**, they would:
1. Land on `https://localhost:8080` ❌ — wrong URL, only works on Junaid's machine
2. Sign up via Supabase auth ✅
3. Create a workspace ✅
4. Click "Connect LinkedIn" ✅ — but get a `redirect_uri_mismatch` because the callback URL `localhost:8080` isn't registered with LinkedIn's developer portal (because RavalAI's developer app isn't fully set up yet)
5. Never be able to publish ❌

**Bottom line:** Everything in our control works. The blocker is external — the developer app registrations on LinkedIn, X, and Meta.

---

## 2. The "Developer App" System Explained

### 2.1 What it is and isn't

A **developer app** is an application you register on a social platform (LinkedIn, X, Meta) that lets **your code** act on behalf of **users who authorize you**. It is:

- ✅ Owned by **RavalAI** (your company), not by clients
- ✅ One app per platform (not per client)
- ✅ Has a Client ID + Client Secret (think: a username and password for your app)
- ✅ Has authorized redirect URLs (where the platform sends users after they click "Authorize")
- ✅ Has scopes/permissions (what your app is allowed to do once authorized)
- ❌ **Not** a developer account for each client — clients never see developer dashboards, never manage API keys, never see webhook secrets
- ❌ **Not** a paid license — most platforms are free for the developer app, but you pay for **API usage** (e.g., X charges $100/mo for Basic tier above 1,500 tweets/mo)

### 2.2 What the client actually experiences

When a client clicks "Connect LinkedIn" inside RavalAI:

```
┌─────────────────────────────────────────────────┐
│ linkedin.com — Real LinkedIn consent screen     │
│                                                 │
│ RavalAI wants to:                               │
│   ✓ Post on your behalf                         │
│   ✓ See your profile                            │
│                                                 │
│ [Authorize]              [Cancel]               │
└─────────────────────────────────────────────────┘
```

The client clicks "Authorize" and is sent back to RavalAI. **They never see a developer console, an API key, or a webhook URL.** That is the entire experience from their side.

### 2.3 The four developer apps — current status

#### LinkedIn Developer App
- **Status:** Partially done per CLAUDE.md ("✅ LinkedIn (connection done)")
- **What we have:** LinkedIn client credentials (need to verify)
- **What we need:** Production callback URL registered
- **Where to manage:** https://www.linkedin.com/developers/apps
- **Required products:** "Marketing Developer Platform" (for posting)
- **Required scopes:** `openid`, `profile`, `email`, `w_member_social`
- **Verification:** LinkedIn requires app verification (business verification) for production use. Check that the verification is still active.

#### X (Twitter) Developer App
- **Status:** Partially done per CLAUDE.md ("✅ X/Twitter (setup done)")
- **What we have:** X client credentials (need to verify)
- **What we need:** Production callback URL registered, "User authentication" enabled
- **Where to manage:** https://developer.twitter.com/en/portal
- **Required app type:** Web App (for OAuth 2.0 PKCE flow)
- **Required scopes:** `tweet.read`, `tweet.write`, `users.read`, `offline.access` (for refresh tokens)
- **API tier:** Free (1,500 tweets/mo) for first 15 clients, then Basic ($100/mo, 3,000 tweets/mo)
- **Critical:** Apply for "Elevated" access if you want to post on behalf of accounts you don't personally own (which is the whole point of this product)

#### Meta Developer App (covers Facebook + Instagram)
- **Status:** **NOT DONE** (per CLAUDE.md: "❌ Facebook (remaining) · ❌ Instagram (remaining)")
- **What we need to create:** A new app at https://developers.facebook.com/apps
- **App type:** "Business" type (required for Instagram Graph API)
- **Required products to enable:**
  - Facebook Login for Business
  - Instagram Graph API
- **Required use case declaration:** "Help users publish content to their Facebook Pages and Instagram business accounts"
- **Required permissions to request:**
  - `pages_show_list` — see the Pages the user manages
  - `pages_manage_posts` — post on behalf of those Pages
  - `pages_read_engagement` — see post performance
  - `instagram_basic` — see the Instagram business account linked to a Page
  - `instagram_content_publish` — post on behalf of that Instagram account
  - `business_management` — access the user's business portfolio
- **App Review:** Meta must approve each permission before it works for users who aren't app admins/testers. **This takes 5-7 business days minimum**, often longer if rejected.
- **Test users:** Add Junaid + Zian as test users so you can develop without waiting for review.

#### Instagram (standalone, optional)
- **Status:** Covered by Meta app above
- **Why mention separately:** Some teams think Instagram is a separate platform. It's not — it's a product inside Meta's app ecosystem. The Meta app covers both.

### 2.4 What credentials to give me when ready

**DO NOT paste credentials in chat.** Put them in a secure note (1Password, Bitwarden, or an encrypted `.env` file). The fields I need:

```
# LinkedIn
LINKEDIN_CLIENT_ID=86xxxxxxxxxxxx
LINKEDIN_CLIENT_SECRET=WPLxxxxxxxxxxxx

# X / Twitter
TWITTER_CLIENT_ID=ABCxxxxxxxxxxxxxx
TWITTER_CLIENT_SECRET=DEFxxxxxxxxxxxxxx
TWITTER_BEARER_TOKEN=AAAAAAAAAAAAAAAAAAAAAxxxxxxxxxxxxxx

# Meta (Facebook + Instagram)
FACEBOOK_CLIENT_ID=1234567890              # This is the "App ID" in Meta dashboard
FACEBOOK_CLIENT_SECRET=abcdef1234567890...  # This is the "App Secret" in Meta dashboard
```

When you have these ready, I will execute Phase 1 below.

---

## 3. Architecture (End State)

```
┌─────────────────────────────────────────────────────────────┐
│                    CLIENT BROWSER                            │
│           (https://app.raval.ai)                             │
└────────────┬────────────────────────────────┬───────────────┘
             │                                 │
             │ HTTPS                           │ HTTPS
             ▼                                 ▼
┌─────────────────────────┐     ┌──────────────────────────┐
│   RAVALAI APP           │     │   SDR                    │
│   (Vercel)              │◄───►│   (AWS Lightsail)        │
│                         │     │                          │
│ - Supabase auth         │     │ - FastAPI                │
│ - Workspace mgmt        │     │ - 4 platform adapters    │
│ - Content generation    │     │ - Celery worker          │
│ - Studio (publish UI)   │     │ - Encrypted token store  │
│ - Stripe billing        │     │ - Webhook receiver       │
│ - Landing page          │     │ - Multi-tenant isolation │
└────────┬────────────────┘     └──────────┬───────────────┘
         │                                 │
         ▼                                 ▼
┌─────────────────────┐         ┌─────────────────────────┐
│ Supabase (Postgres) │         │ SDR Postgres            │
│ - users             │         │ - accounts (tokens)      │
│ - workspaces        │         │ - posts                  │
│ - content_items     │         │ - post_targets           │
│ - workspace_sdr     │         │ - delivery_logs          │
│ - content_public.   │         │ - api_keys (workspace)   │
│ - subscriptions     │         │                          │
└─────────────────────┘         └─────────────────────────┘
                                          │
                                          │ OAuth 2.0
                                          ▼
                          ┌──────────────────────────────────┐
                          │  LinkedIn / X / Meta / Instagram  │
                          │  (RavalAI's developer apps)        │
                          │  (acting on behalf of clients)    │
                          └──────────────────────────────────┘
```

**Key principle:** RavalAI owns the developer apps. Clients just authorize them.

---

## 4. Launch Phases (6 Phases, ~3-4 Days Total)

### Phase 0: Pre-flight (Parallel, starts today)

**Goal:** Set up the production URL and start Meta App Review in parallel with credential collection.

**Why this is Phase 0:** Meta App Review takes 5-7 business days. The other 5 phases take 3-4 days. If we wait until Phase 4 to start App Review, we miss the launch date.

#### 0.1 — Deploy SDR to AWS Lightsail (Day 0, ~4 hours)

Reference: [`history/adr/0005-aws-lightsail-sdr-production-deployment.md`](../../history/adr/0005-aws-lightsail-sdr-production-deployment.md)

Steps:
- [ ] Provision AWS Lightsail instance (Ubuntu 22.04, 1GB RAM, $5/mo)
- [ ] Point DNS `sdr.raval.ai` → instance IP
- [ ] SSH in, install Python 3.12, Docker, docker-compose, Caddy
- [ ] Clone `https://github.com/Raval-Ai-Org/raval` (or the SDR-only repo)
- [ ] Apply Alembic migrations: `cd Social-Distribtion-Engine-RavalAI-SDE && alembic upgrade head`
- [ ] Set up systemd service for `uvicorn app.main:app`
- [ ] Set up systemd service for `celery -A app.celery_app worker`
- [ ] Set up systemd service for `celery -A app.celery_app beat`
- [ ] Configure Caddy for HTTPS (Let's Encrypt auto-renews)
- [ ] Verify `https://sdr.raval.ai/health` returns 200

**Done when:** `curl https://sdr.raval.ai/health` returns `{"status": "ok"}`

#### 0.2 — Start Meta App Review (Day 0, ~2 hours + 5-7 days waiting)

**Why now:** App Review is the longest pole. Start it the moment you create the app.

Steps:
- [ ] Go to https://developers.facebook.com/apps
- [ ] Click "Create App" → Type: **Business** → Name: "RavalAI" → Contact email: `team@raval.ai`
- [ ] Add product: **Facebook Login for Business**
- [ ] Add product: **Instagram Graph API**
- [ ] Settings → Basic: fill in Privacy Policy URL (`https://raval.ai/privacy`), Terms of Service URL, App Icon (use RavalAI logo)
- [ ] Facebook Login for Business → Settings: add `https://sdr.raval.ai/api/v1/oauth/facebook/callback` as valid OAuth redirect URI
- [ ] App Review → Permissions and Features: request `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`, `instagram_basic`, `instagram_content_publish`, `business_management`
- [ ] For each permission, write a 1-paragraph "use case" and provide a screencast video showing how RavalAI uses it (a 2-min Loom recording of you clicking through the RavalAI Studio is enough)
- [ ] Submit for review
- [ ] Add Junaid and Zian as "Test Users" so you can develop without waiting for review

**Done when:** App Review is **submitted** (not approved — that's a 5-7 day wait). While waiting, proceed to Phase 1.

#### 0.3 — Verify LinkedIn and X credentials (Day 0, ~1 hour)

Steps:
- [ ] LinkedIn: log into https://www.linkedin.com/developers/apps, find RavalAI app, copy Client ID and Client Secret
- [ ] X: log into https://developer.twitter.com/en/portal, find RavalAI app, copy OAuth 2.0 Client ID, Client Secret, and Bearer Token
- [ ] Verify each app is in "Live" or "Production" mode (not "Development")
- [ ] Verify app verification is still active (LinkedIn sends a re-verification email yearly)

**Done when:** You have all credentials written down in a secure note.

---

### Phase 1: Inject Credentials (Day 1, ~30 min)

**Goal:** Wire credentials into the SDR and verify OAuth start works for each platform.

#### 1.1 — Add credentials to SDR `.env` (5 min)

Create `Social-Distribtion-Engine-RavalAI-SDE/.env` on the production Lightsail instance:

```bash
# LinkedIn
LINKEDIN_CLIENT_ID=86xxxxxxxxxxxx
LINKEDIN_CLIENT_SECRET=WPLxxxxxxxxxxxx
LINKEDIN_CALLBACK_URL=https://sdr.raval.ai/api/v1/oauth/linkedin/callback

# X / Twitter
TWITTER_CLIENT_ID=ABCxxxxxxxxxxxxxx
TWITTER_CLIENT_SECRET=DEFxxxxxxxxxxxxxx
TWITTER_BEARER_TOKEN=AAAAAAAAAAAAAAAAAAAAAxxxxxxxxxxxxxx
TWITTER_CALLBACK_URL=https://sdr.raval.ai/api/v1/oauth/x/callback

# Facebook + Instagram
FACEBOOK_CLIENT_ID=1234567890
FACEBOOK_CLIENT_SECRET=abcdef1234567890...
FACEBOOK_CALLBACK_URL=https://sdr.raval.ai/api/v1/oauth/facebook/callback
```

#### 1.2 — Restart SDR FastAPI process (1 min)

```bash
ssh ubuntu@sdr.raval.ai
sudo systemctl restart raval-sdr-api
sudo systemctl status raval-sdr-api  # verify "active (running)"
```

**Do NOT restart Celery or Postgres** — OAuth state in Redis must survive.

#### 1.3 — Test OAuth start endpoint for each platform (5 min × 4 = 20 min)

For each platform, run:

```bash
# LinkedIn
curl -X POST https://sdr.raval.ai/api/v1/accounts/oauth/start \
  -H "Authorization: Bearer $SDR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"platform":"linkedin","workspace_id":"workspace_001"}'

# X / Twitter
curl -X POST https://sdr.raval.ai/api/v1/accounts/oauth/start \
  -H "Authorization: Bearer $SDR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"platform":"twitter","workspace_id":"workspace_001"}'

# Facebook
curl -X POST https://sdr.raval.ai/api/v1/accounts/oauth/start \
  -H "Authorization: Bearer $SDR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"platform":"facebook","workspace_id":"workspace_001"}'

# Instagram
curl -X POST https://sdr.raval.ai/api/v1/accounts/oauth/start \
  -H "Authorization: Bearer $SDR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"platform":"instagram","workspace_id":"workspace_001"}'
```

**Expected response for each:**
```json
{
  "auth_url": "https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=...",
  "state": "..."
}
```

**If you get an error like `Unsupported platform: X`:** the platform string in your request doesn't match what the SDR expects. Check `Social-Distribtion-Engine-RavalAI-SDE/app/api/accounts.py` line ~250 for the allowed values (currently `linkedin`, `twitter`, `facebook`, `instagram`).

#### 1.4 — Add credentials to RavalAI `.env` (template only) (5 min)

Update `raval/.env.example` (the template, not the actual `.env`):

```bash
# raval/.env.example
# (existing entries)

# Developer app credentials (RavalAI's apps, not per-client)
LINKEDIN_CLIENT_ID=
TWITTER_CLIENT_ID=
FACEBOOK_CLIENT_ID=
```

Commit:
```bash
git commit -am "chore: document developer app env var template"
```

**Done when:** All 4 OAuth start endpoints return real platform consent URLs (not error responses).

---

### Phase 2: Register Production Callback URLs (Day 1, ~20 min)

**Goal:** Tell each platform where to send users after they click "Authorize".

This is the step most teams miss. If your callback URL isn't registered with the platform, the OAuth flow breaks with a `redirect_uri_mismatch` error.

#### 2.1 — LinkedIn

In https://www.linkedin.com/developers/apps → RavalAI app → **Auth** tab:
- **Authorized redirect URLs:** add:
  - `https://sdr.raval.ai/api/v1/oauth/linkedin/callback` (production)
  - `http://localhost:8080/api/sdr/oauth/linkedin/callback` (dev — for local testing)

#### 2.2 — X / Twitter

In https://developer.twitter.com/en/portal → RavalAI app → **User authentication settings** → **Callback URI / Redirect URL**:
- Add: `https://sdr.raval.ai/api/v1/oauth/x/callback`
- Add: `http://localhost:8080/api/sdr/oauth/x/callback` (dev)

#### 2.3 — Facebook

In https://developers.facebook.com/apps → RavalAI app → **Facebook Login for Business** → **Settings** → **Valid OAuth Redirect URIs**:
- Add: `https://sdr.raval.ai/api/v1/oauth/facebook/callback`
- Add: `http://localhost:8080/api/sdr/oauth/facebook/callback` (dev)

#### 2.4 — Instagram

Same Meta app. Instagram uses the same Facebook Login redirect URI. The SDR distinguishes the two by the `state` parameter and the requested scopes.

**Done when:** All 4 platforms have `https://sdr.raval.ai/...` registered as a valid callback URL.

---

### Phase 3: End-to-End OAuth Testing (Day 2, ~2 hours)

**Goal:** Prove each platform's full OAuth flow works against a real account.

#### 3.1 — Write a Playwright e2e test that exercises the full flow

Create `raval/tests/e2e/live-oauth-e2e.spec.ts`:

```typescript
import { test, expect, Page } from "@playwright/test";

const TEST_EMAIL = "junaidsajjad2298@gmail.com";
const TEST_PASSWORD = "Junaid@1234";
const BASE_URL = process.env.RAVAL_BASE_URL || "http://localhost:8080";

async function loginAndGoToSocial(page: Page) {
  await page.goto(`${BASE_URL}/login`);
  await page.waitForLoadState("domcontentloaded");
  await page.fill('input[type="email"]', TEST_EMAIL);
  await page.fill('input[type="password"]', TEST_PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20000 });
  await page.goto(`${BASE_URL}/app/social`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
}

test.describe("Live OAuth (manual consent step)", () => {
  for (const platform of ["LinkedIn", "X", "Facebook", "Instagram"] as const) {
    test(`OAuth start for ${platform} returns real consent URL`, async ({ page, context }) => {
      await loginAndGoToSocial(page);
      const button = page.locator(`button:has-text("Connect ${platform}")`).first();
      if (await button.count() === 0) {
        test.skip();
        return;
      }
      const [popup] = await Promise.all([
        context.waitForEvent("page", { timeout: 10000 }).catch(() => null),
        button.click(),
      ]);
      if (popup) {
        const url = popup.url();
        console.log(`${platform} consent URL: ${url}`);
        // Assert it's a real platform URL, not a stub
        expect(url).toMatch(new RegExp(platform === "X" ? "twitter\\.com|x\\.com" : platform.toLowerCase()));
        await popup.close();
      } else {
        // Same-window redirect
        await page.waitForTimeout(3000);
        const url = page.url();
        expect(url).toMatch(/linkedin\.com|twitter\.com|x\.com|facebook\.com|instagram\.com/);
      }
    });
  }
});
```

#### 3.2 — Manually complete one full flow per platform (you, 30 min)

For each platform:
1. Run the test
2. When the consent screen appears, **manually click "Authorize"** in the browser
3. Verify you land back in RavalAI with the connection marked "Connected"
4. Verify the SDR has the encrypted token:
   ```bash
   ssh ubuntu@sdr.raval.ai
   sudo -u postgres psql raval_sde -c "SELECT id, platform, display_name, created_at FROM accounts ORDER BY created_at DESC LIMIT 5;"
   ```
5. Verify a real post can be published:
   ```bash
   curl -X POST https://sdr.raval.ai/api/v1/posts \
     -H "Authorization: Bearer $SDR_ADMIN_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"text": "Test post from RavalAI launch verification", "platforms": ["linkedin"], "account_ids": ["..."]}'
   ```

#### 3.3 — Verify token refresh works (programmatic, 30 min)

LinkedIn tokens expire in 60 days. X tokens in 2 hours. Meta tokens in 60 days.

Test that the SDR auto-refreshes:
- Pick the platform with shortest expiry (X, 2 hours)
- Connect an X account
- Wait 2+ hours (or stub the token to look expired)
- Try to publish
- Verify the token was auto-refreshed and the publish succeeded

This catches a class of bug that's invisible until 2am on a Sunday.

Commit:
```bash
git commit -am "test: add live OAuth e2e tests for all 4 platforms"
```

**Done when:** All 4 platforms: OAuth start returns real consent URL → you authorize manually → account appears in DB → real post published successfully.

---

### Phase 4: Production Deployment (Day 3-4, ~1 day)

**Goal:** Stable URLs instead of `localhost` and Cloudflare tunnels.

#### 4.1 — Deploy RavalAI to Vercel (Day 3, ~2 hours)

Vercel has first-class TanStack Start support.

Steps:
- [ ] Sign up at https://vercel.com with `team@raval.ai`
- [ ] Click "Add New Project" → Import `Raval-Ai-Org/raval` from GitHub
- [ ] Framework preset: **TanStack Start** (Vercel auto-detects)
- [ ] Root directory: `./` (the raval repo root)
- [ ] Build command: leave default (Vite build)
- [ ] Environment variables: copy all from `raval/.env`, including:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_PUBLISHABLE_KEY`
  - `SUPABASE_URL`
  - `SUPABASE_PUBLISHABLE_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SDR_BASE_URL=https://sdr.raval.ai` (now using production URL!)
  - `SDR_ADMIN_TOKEN`
  - `CRON_SECRET`
  - `FEATURE_FLAG_SDR_ENABLED=true`
  - `SDR_SECRET_ENCRYPTION_KEY`
- [ ] Click "Deploy"
- [ ] Vercel will give you a `*.vercel.app` URL — verify it works
- [ ] In **Domains** settings, add custom domain `app.raval.ai` (and `raval.ai` for the landing page)
- [ ] Update DNS: add a CNAME record pointing `app.raval.ai` to the Vercel-provided target
- [ ] Wait for Vercel to issue SSL (usually <5 min)

**Done when:** `https://app.raval.ai` returns HTTP 200 with the RavalAI landing page.

#### 4.2 — Update callback URLs everywhere (15 min)

Now that `sdr.raval.ai` and `app.raval.ai` exist, update all 4 platform developer portals:

- LinkedIn: add `https://app.raval.ai/api/sdr/oauth/linkedin/callback` (RavalAI's own callback, not just SDR's)
- X: add `https://app.raval.ai/api/sdr/oauth/x/callback`
- Facebook: add `https://app.raval.ai/api/sdr/oauth/facebook/callback`
- Instagram: same

(These are in addition to the SDR-direct callbacks. RavalAI's UI uses the app.raval.ai callbacks; the SDR receives the redirect.)

#### 4.3 — Verify production end-to-end (Day 4, ~2 hours)

- [ ] Log into `https://app.raval.ai` with your credentials
- [ ] Connect LinkedIn → real consent → connected ✅
- [ ] Connect X → real consent → connected ✅
- [ ] Connect Facebook → real consent → connected ✅
- [ ] Connect Instagram → real consent → connected ✅
- [ ] Generate a post with AI
- [ ] Publish to all 4 platforms
- [ ] Verify each post appears on the actual social account

Commit:
```bash
git commit -am "chore: configure production deployment (Vercel + Lightsail)"
```

**Done when:** Full platform publish to all 4 platforms works from `https://app.raval.ai` against real social accounts.

---

### Phase 5: Friendly-Client Dogfood (Day 5, ~4 hours)

**Goal:** Real client, real money, real test.

#### 5.1 — Pick a friendly client

Zian's network, your network — anyone with:
- A LinkedIn account
- An X account
- 30 minutes to spare
- Willingness to be patient if something breaks

#### 5.2 — Walk them through the flow (1 hour)

1. They go to `https://app.raval.ai/signup`
2. They create an account (Supabase auth)
3. They get an empty workspace
4. They click "Connect LinkedIn" → real LinkedIn consent → connected
5. They click "Connect X" → real X consent → connected
6. They run `/onboarding` → enter their brand website
7. RavalAI generates their first 7 days of content
8. They review, edit, approve
9. They click "Publish to LinkedIn" → SDR posts → appears on their LinkedIn within 30 seconds

#### 5.3 — Capture every friction point (variable)

I'll be on standby. Every "wait, how do I...?" is a bug or missing doc. Fix and document immediately.

Common friction points to watch for:
- OAuth consent screen text is confusing → write better copy in the platform's developer app settings
- Multi-step onboarding is overwhelming → simplify the wizard
- Post preview doesn't match what actually gets published → fix the preview vs reality
- Client doesn't understand "draft vs scheduled vs published" → add tooltips

Commit each fix:
```bash
git commit -am "fix: address first client feedback (e.g. onboarding wizard too long)"
```

**Done when:** One real client has successfully published a real post from `https://app.raval.ai`.

---

### Phase 6: Public Launch (Day 6-7, ~1 day)

**Goal:** Announce, onboard 5 more clients, iterate.

#### 6.1 — Landing page at `raval.ai` (Day 6, ~4 hours)

You need a marketing site (not the app) at `https://raval.ai`.

I can build it as a route in the same TanStack Start app:
- `src/routes/_landing.tsx` (separate route tree from the app)
- Hero section: "AI-native marketing that posts for you"
- "How it works" 3-step section
- Pricing (Solo / Studio / Agency)
- "Get started" CTA → `https://app.raval.ai/signup`

Or use a separate static site (Astro, Next.js, etc.) if you prefer.

#### 6.2 — Pricing + Stripe (Day 6, ~4 hours)

Three tiers as outlined:

| Tier | Price | Features |
|---|---|---|
| **Solo** | $99/mo | 1 workspace, 3 social accounts, 30 posts/mo |
| **Studio** | $499/mo | 5 workspaces, 15 social accounts, 200 posts/mo |
| **Agency** | $1,999/mo | 20 workspaces, 60 social accounts, 1,000 posts/mo, white-label |

Stripe Checkout integration:
- Sign up at https://stripe.com
- Create 3 products matching the tiers
- Add a `subscriptions` table to Supabase
- Webhook handler in RavalAI: `POST /api/stripe/webhook`
- On `checkout.session.completed` → set `subscriptions.status = 'active'`
- On `customer.subscription.deleted` → downgrade to free tier

#### 6.3 — Launch announcement (Day 7, ~1 hour)

Zian posts on LinkedIn and X:
- Personal story of building RavalAI
- "Try it free for 14 days" link to `https://raval.ai`
- Demo video (2 min Loom of using the platform)

#### 6.4 — Onboard 5 more clients in the first week (Day 7-14)

Track each:
- Signup → onboarding → first connection → first publish
- NPS score after 7 days
- Churn risk flag (no login in 7 days, no publish in 14 days)

**Done when:** 5 paying clients (or 5 trial-to-paid conversions) by end of week 2.

---

## 5. Risks and Mitigations

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Meta App Review takes longer than 7 days | Medium | High | Start it Phase 0. Submit screencast videos showing clear use cases. |
| Meta rejects a permission scope | Medium | High | Re-submit with more detailed screencast. Budget 1 week for back-and-forth. |
| LinkedIn rate limit (100 posts/day) hit by an agency | Low | Medium | Show client "X of Y posts used today" in the Studio UI. Cap agency tier at 1,000 posts/mo. |
| X API Basic tier ($100/mo) needed before 15 clients | Low | Low | Monitor usage. Upgrade to Basic when free tier (1,500/mo) reaches 80% utilization. |
| Token refresh breaks at 2am Sunday | Medium | High | Test in Phase 3. Set up health check + alerting in Phase 4. |
| First client has unique setup we didn't anticipate | Certain | Medium | This is why Phase 5 exists. Budget 2-3 days of iteration. |
| Stripe webhook fails to fire on subscription cancellation | Low | High | Test in staging. Add dead-letter queue for failed webhooks. |
| Production URL DNS propagation takes >24h | Low | Low | Set up DNS 48h before launch. |
| Meta "App not in production" mode limits to test users | Medium | High | Submit for App Review immediately (Phase 0.2). |

---

## 6. Cost Summary

### One-time costs
- Domain registration (`raval.ai`): ~$15/year
- AWS Lightsail setup: $0 (free tier covers initial setup)

### Recurring monthly costs (at launch)
- AWS Lightsail (SDR): $5-10/mo
- Vercel Pro (RavalAI): $20/mo (free tier works for first 3 months)
- Supabase Pro: $25/mo (free tier works for first 3 clients)
- Stripe fees: 2.9% + 30¢ per transaction
- **Total: ~$50-60/mo + Stripe fees** before any clients

### Scaling costs (at 10 clients, ~$5,000 MRR)
- AWS Lightsail: $20-40/mo (more CPU for Celery)
- Vercel Pro: $20/mo
- Supabase Pro: $25/mo
- X API Basic: $100/mo (when free tier exceeded)
- **Total: ~$165-185/mo** for $5,000 MRR = ~3.5% infra cost (healthy)

### Scaling costs (at 50 clients, ~$25,000 MRR)
- AWS Lightsail → AWS ECS or Fargate: ~$200/mo
- Vercel Enterprise: $250+/mo
- Supabase Team: $599/mo
- X API Pro: $5,000/mo (high-volume)
- **Total: ~$6,000/mo** for $25,000 MRR = ~24% infra cost (still healthy, but watch X)

---

## 7. Decision Points (Need Your Input)

Before I start executing, I need answers to:

1. **Do you have all 4 developer app credentials ready?**
   - If yes: start Phase 1 immediately
   - If no: start Phase 0 (Lightsail + App Review) in parallel while you collect

2. **Are you willing to spend $50-60/mo on infrastructure?** (Lightsail + Vercel + Supabase Pro)

3. **Do you want Stripe from day 1, or free trial first?**
   - Stripe from day 1: harder to set up but faster to revenue
   - Free trial first: easier to launch, but clients can churn without you knowing

4. **Do you want the landing page built in the same repo as the app, or a separate repo?**
   - Same repo: easier maintenance, single deploy
   - Separate repo: cleaner separation, marketing team can edit without touching app code

5. **Who is the friendly client for Phase 5?**
   - You pick → I'll wait
   - You don't have one yet → I'll find one in Zian's network

6. **Are you OK with me committing directly to `master` for these changes, or do you want them on a `junaid` branch first?**
   - Direct to master: faster, matches our previous workflow
   - Branch + PR: more review, slower but safer

---

## 8. References

- [RavalAI integration spec](spec.md) — original FRD for SDR integration
- [RavalAI integration plan](plan.md) — original architecture
- [RavalAI integration tasks](tasks.md) — task breakdown
- [INTEGRATION-HOLD.md](INTEGRATION-HOLD.md) — current state of integration work
- [ADR-0001: Proxy through server for SDR access](../../history/adr/0001-proxy-through-server-for-sdr-access.md)
- [ADR-0002: Split scheduling (generation vs distribution)](../../history/adr/0002-split-scheduling-generation-vs-distribution.md)
- [ADR-0003: Deployment topology (local-first, Oracle tunnel)](../../history/adr/0003-deployment-topology-local-first-oracle-tunnel.md)
- [ADR-0004: SDR integration full record](../../history/adr/0004-sdr-integration-full-record.md)
- [ADR-0005: AWS Lightsail SDR production deployment](../../history/adr/0005-aws-lightsail-sdr-production-deployment.md)
- [CLAUDE.md](../../CLAUDE.md) — project rules and identity
- [Production verification report 2026-08-10](../../PRODUCTION-VERIFICATION-REPORT.md)
- [T080 deployment guide](../../T080-DEPLOYMENT-GUIDE.md)

---

## 9. Change Log

| Date | Author | Change |
|---|---|---|
| 2026-08-27 | Muhammad-Junaid-Sajjad | Initial plan created. Platform + SDR verified live. 6-phase launch plan documented. |
