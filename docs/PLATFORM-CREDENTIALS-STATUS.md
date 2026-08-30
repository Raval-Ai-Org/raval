# Platform Credentials Status

> **Live status of which developer apps are configured for the RavalAI SDR.**
> Last updated: 2026-08-28

## Current Status

| Platform        | App Status                                         | Credentials in `.env`?                  | App Review                                    | Can publish?                      |
| --------------- | -------------------------------------------------- | --------------------------------------- | --------------------------------------------- | --------------------------------- |
| **LinkedIn**    | ✅ Verified (RavalAI Marketing Developer Platform) | ✅ Yes                                  | ✅ Approved (2026-08-28)                      | ✅ Yes (after SDR is up)          |
| **X / Twitter** | ⏳ Pending setup                                   | ❌ No                                   | ⏳ Not submitted                              | ❌ No                             |
| **Facebook**    | 🆕 Just configured (2026-08-28)                    | ✅ Yes                                  | ⏳ Not yet submitted (use test users for now) | ⚠️ Test users only until approved |
| **Instagram**   | 🆕 Just configured (2026-08-28)                    | ✅ Yes (same App ID/Secret as Facebook) | ⏳ Not yet submitted                          | ⚠️ Test users only until approved |

## LinkedIn — fully ready ✅

- **App:** RavalAI Marketing Developer Platform
- **Client ID:** `77nxccyta71mmk`
- **Verification URL:** https://www.linkedin.com/developers/apps/verification/781663ed-edea-4d71-adbf-b9c4e4ecaff3
- **Verification status:** ✅ APPROVED (use this URL to check status anytime)
- **Scopes granted:** `openid`, `profile`, `email`, `w_member_social` (post on behalf of user)
- **Required scope for org posts:** `r_organization_social` (request if needed)
- **Rate limit:** 100 posts/day per member
- **Callback URL(s) to register in LinkedIn Dev Portal:**
  - `https://sdr.raval.ai/api/v1/oauth/linkedin/callback` (production)
  - `https://spice-carlo-cure-commonwealth.trycloudflare.com/api/v1/oauth/linkedin/callback` (development)
  - `http://localhost:8000/api/v1/oauth/linkedin/callback` (local)

## Meta (Facebook + Instagram) — credentials stored, App Review pending ⏳

- **App:** RavalAI (Meta for Developers)
- **App ID:** `1766289191040965`
- **App Secret:** stored in `raval/.env` as `FACEBOOK_CLIENT_SECRET`
- **App Review status:** Not yet submitted
- **Test users:** Add Junaid + Zian as test users in **Roles → Test Users** so we can test before App Review
- **Scopes to request when submitting App Review:**
  - `pages_show_list` — see user's Pages
  - `pages_manage_posts` — post to Pages
  - `pages_read_engagement` — read post performance
  - `instagram_basic` — see Instagram business account
  - `instagram_content_publish` — post to Instagram
  - `business_management` — access business portfolio
- **Callback URL(s) to register in Meta Dev Portal** (one set, used for BOTH Facebook and Instagram):
  - `https://sdr.raval.ai/api/v1/oauth/facebook/callback` (production)
  - `https://spice-carlo-cure-commonwealth.trycloudflare.com/api/v1/oauth/facebook/callback` (development)
  - `http://localhost:8000/api/v1/oauth/facebook/callback` (local)
- **Instagram account requirement:** The Instagram account you want to post to must be a **Business** or **Creator** account, and must be **linked to a Facebook Page** in the Instagram app's settings.
- **App Review timeline:** 5-7 business days after submission. Provide screencast videos showing RavalAI's flow for each scope.

## X / Twitter — not started ⏳

- **App status:** Not yet created at developer.twitter.com
- **What's needed:**
  1. Apply for a Twitter Developer account at https://developer.twitter.com/
  2. Create a "Web App" or "Automated App" project
  3. Get OAuth 2.0 Client ID and Client Secret
  4. Apply for "Elevated" access (required for posting on behalf of other users)
  5. Set OAuth 2.0 callback URL
- **Free tier limit:** 1,500 tweets/month
- **Paid tier ($100/mo):** 3,000 tweets/month, "Basic" access
- **Estimated time:** 1-2 days for Elevated approval

## How to Test After SDR Is Running

```bash
# 1. Run SDR (when ready, see Phase 4 of CLIENT-LAUNCH-PLAN.md)
# 2. Visit http://localhost:8080/app/social in your browser
# 3. Log in with junaidsajjad2298@gmail.com / Junaid@1234
# 4. Click "Connect LinkedIn" (or Facebook/Instagram if those are approved)
# 5. You'll be redirected to the platform's consent screen
# 6. Click "Authorize"
# 7. You'll land back in RavalAI with the account marked "Connected"
# 8. Verify the encrypted token in the SDR DB:
#    ssh ubuntu@sdr.raval.ai
#    sudo -u postgres psql raval_sde -c "SELECT id, platform, display_name FROM accounts;"
```

## Security Notes

⚠️ **The LinkedIn Client Secret, Meta App Secret, and other credentials are now in your local `raval/.env` and (eventually) on the production server.** They are NOT in git. But they are still in this conversation's chat history. When production-ready, rotate them:

- **LinkedIn:** https://www.linkedin.com/developers/apps → your app → **Auth** tab → regenerate Client Secret
- **Meta:** https://developers.facebook.com/apps → Settings → Basic → "App Secret" → Show → regenerate (you'll need to enter your Facebook password to confirm)

After rotation, update both `raval/.env` (your local) and the SDR's `.env` (on production) with the new values, then restart the services.

## Reference

- Full launch plan: `docs/specs/001-sdr-integration/CLIENT-LAUNCH-PLAN.md`
- LinkedIn adapter code: `Social-Distribtion-Engine-RavalAI-SDE/app/adapters/linkedin.py`
- Facebook adapter code: `Social-Distribtion-Engine-RavalAI-SDE/app/adapters/meta.py`
- Instagram adapter code: `Social-Distribtion-Engine-RavalAI-SDE/app/adapters/instagram.py`
- Twitter adapter code: `Social-Distribtion-Engine-RavalAI-SDE/app/adapters/twitter.py`
