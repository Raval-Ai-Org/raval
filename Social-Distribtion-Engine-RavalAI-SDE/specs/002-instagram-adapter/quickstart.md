# Quickstart: Connect & Publish to Facebook + Instagram

**Feature**: `002-instagram-adapter` · **Date**: 2026-08-03

This is the **product path** — clients authorize only; no client developer accounts, no client-visible credentials. The RavalAI Meta app is built once.

## Prerequisites

1. ONE RavalAI Meta app exists (Business type) with products: Facebook Login, Graph API, Instagram Graph API.
2. `.env` has `FACEBOOK_CLIENT_ID`, `FACEBOOK_CLIENT_SECRET`, `FACEBOOK_CALLBACK_URL` (= `http://localhost:8000/api/v1/accounts/oauth/facebook/callback`).
3. The client's Instagram is a **Professional (Business/Creator)** account **linked to their Facebook Page** (done by the client in Meta's own settings).
4. Stack is up: `docker-compose up -d` (API, Redis, Postgres, worker).

## 1. Client authorizes (no credentials, ever)

```bash
# Start flow — returns an authorization_url the client opens in a browser
curl "http://localhost:8000/api/v1/accounts/oauth/facebook/start" \
  -H "Authorization: Bearer $WORKSPACE_API_KEY"
# → {"authorization_url": "https://www.facebook.com/v18.0/dialog/oauth?...", "state_token": "..."}
```

The client logs in to Facebook/Instagram, clicks **Authorize**. Meta redirects to the callback; the engine stores the account encrypted and scoped to the workspace. Repeat for `platform=instagram`.

## 2. Verify the account connected

```bash
curl "http://localhost:8000/api/v1/accounts" \
  -H "Authorization: Bearer $WORKSPACE_API_KEY"
# → list shows facebook + instagram accounts, active, no tokens exposed
```

## 3. Publish (approval happens in the platform BEFORE this call — engine never decides)

```bash
curl -X POST http://localhost:8000/api/v1/publish \
  -H "Authorization: Bearer $WORKSPACE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "idempotency_key": "ig-demo-001",
    "targets": [
      {
        "account_id": "<instagram account id>",
        "content": {
          "text": "Hello from RavalAI SDE 🚀",
          "media_urls": ["https://example.com/post.jpg"]
        }
      }
    ]
  }'
```

Instagram requires media (image or video) + caption. Facebook accepts text-only.

## 4. Check delivery

```bash
curl "http://localhost:8000/api/v1/jobs/<job_id>" \
  -H "Authorization: Bearer $WORKSPACE_API_KEY"
# → platform_post_id + platform_post_url + delivery log
```

## Dev/test fallback (NOT the product path)

For local verification without a browser, `scripts/seed_meta_account.py` accepts the **owner's** creds. It exists only to test; production connects run through the OAuth authorize flow above.

## Limits & notes

- Instagram: image posts ≈20 / 24h, video posts ≈1 / 24h (via API). `429` surfaces as a rate-limit error with wait time.
- Videos must be public HTTPS URLs; business accounts may need extra permission for >60s video (keep MVP short).
- A Meta change touches only the adapter/contract files (adapter-as-armor).
