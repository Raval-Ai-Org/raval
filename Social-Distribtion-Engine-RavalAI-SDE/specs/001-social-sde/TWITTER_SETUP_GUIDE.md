# Setting Up Twitter/X for Real Publishing — Step by Step

This guide walks you through connecting a real Twitter/X account to the SDE
so you can publish tweets programmatically.

---

## Step 1: Create a Twitter Developer Account

1. Go to **https://developer.twitter.com**
2. Click **"Sign in"** — use your regular Twitter/X account
3. If you don't have a developer account yet:
   - Click **"Sign up for a free account"**
   - Fill in your details (name, email, use case)
   - For use case, select **"Making a bot"** or **"Exploring the API"**
   - Accept the Terms of Service
   - Verify your email if prompted

4. You should now see the **Developer Portal** dashboard

---

## Step 2: Create a Project and App

1. In the Developer Portal, click **"+ Create Project"**
2. Name it something like **"RavalAI SDE"**
3. Choose a use case: **"Making a bot"** or **"Exploring the API"**
4. Give it a brief description: "Social media publishing engine"
5. Click **"Next"**

6. Now create an **App** within the project:
   - Name: **"raval-sde"**
   - Click **"Next"**
   - Note the **"Client ID"** and **"Client Secret"** shown on screen — these are your OAuth 2.0 credentials
   - Click **"Done"**

---

## Step 3: Get Your API Keys

On the app settings page, you should see:

```
Client ID: xxxxxxxxxxxxxxxxxxxx
Client Secret: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

**Copy both of these** — you'll need them in Step 5.

Also, click **"Regenerate keys"** if you want a fresh Client Secret.

---

## Step 4: Configure OAuth Settings

1. In your app settings, go to **"User authentication settings"**
2. Click **"Edit"**
3. Set:
   - **App permissions**: **"Read and Write"** (so you can publish tweets)
   - **Type of App**: **"Web App, Automated App or Bot"**
   - **Callback URI**: `http://localhost:8000/api/v1/oauth/twitter/callback`
   - **Website URL**: `http://localhost:8000`
4. Click **"Save"**

---

## Step 5: Update Your .env File

Open `/home/nauman_sajjad/Desktop/Raval-AI/.env` and add your credentials:

```
# Twitter/X OAuth (paste your values here)
TWITTER_CLIENT_ID=your_client_id_here
TWITTER_CLIENT_SECRET=your_client_secret_here
TWITTER_CALLBACK_URL=http://localhost:8000/api/v1/oauth/twitter/callback
```

**Important**: Make sure the `TWITTER_CALLBACK_URL` matches exactly what you entered in Step 4.

---

## Step 6: Start the Stack and Test

```bash
# 1. Start all services
docker-compose up -d

# 2. Verify everything is healthy
curl http://localhost:8000/healthz

# 3. Start the OAuth flow (opens browser)
curl "http://localhost:8000/api/v1/oauth/twitter/start"
# This returns: {"authorization_url": "https://twitter.com/i/oauth2/authorize?..."}

# 4. Open the authorization_url in your browser
#    → Log in to Twitter
#    → Click "Authorize app"
#    → You'll be redirected to the callback URL
```

---

## Step 7: Publish a Real Tweet

Once you've completed the OAuth flow, you should have a connected account.
Now publish your first real tweet:

```bash
# Get your account ID first
curl http://localhost:8000/api/v1/accounts \
  -H "Authorization: Bearer $SDE_API_TOKEN"

# Publish immediately
curl -X POST http://localhost:8000/api/v1/publish \
  -H "Authorization: Bearer $SDE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "idempotency_key": "my-first-real-tweet",
    "targets": [
      {
        "account_id": "YOUR_ACCOUNT_ID_FROM_ABOVE",
        "content": {
          "text": "Hello from RavalAI SDE! 🚀 Testing automated publishing."
        }
      }
    ]
  }'

# Check if it published
curl http://localhost:8000/api/v1/jobs/{job_id} \
  -H "Authorization: Bearer $SDE_API_TOKEN"
```

---

## Troubleshooting

### "Callback URL doesn't match"
- Make sure `TWITTER_CALLBACK_URL` in `.env` EXACTLY matches what you entered in Step 4
- No trailing slash differences
- Protocol must match (http vs https)

### "Invalid client_id"
- Double-check your `TWITTER_CLIENT_ID` value
- Make sure there are no extra spaces or quotes

### "401 Unauthorized when publishing"
- The Bearer token might be expired
- Re-run the OAuth flow to get fresh tokens
- Check that app permissions include "Write" (not just "Read")

### "Rate limit exceeded"
- Twitter has 200 tweets/day and 15 per 15-minute window
- Wait for the Retry-After period
- Or use the DryRun adapter to test without hitting real limits

---

## What to Expect After Publishing

1. **The tweet appears on your Twitter timeline**
2. **The SDE returns a job_id** with status "published"
3. **The response includes `platform_post_id`** — the actual Twitter tweet ID
4. **You can view the tweet** at `https://x.com/i/status/{platform_post_id}`

---

## Security Notes

- Your Client Secret and Access Tokens are **encrypted in the database** (Fernet)
- Never commit `.env` to version control
- Tokens expire — the SDE has a daily token refresh task that checks for expiring tokens
- If a token is revoked, the account status changes to "disconnected" and webhooks notify you
