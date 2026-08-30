---
id: 0005
title: Twitter and LinkedIn live posting
stage: green
date: 2026-07-31
surface: agent
model: opencode-deepseek-v4-flash-free
feature: 001-social-sde
branch: 001-social-sde
user: nauman_sajjad
command: (conversational request — continue prior session)
labels: ["twitter", "linkedin", "oauth", "live-posting", "social-sde"]
links:
  spec: /home/nauman_sajjad/Desktop/Raval-AI/specs/001-social-sde/spec.md
  ticket: null
  adr: null
  pr: null
files:
  - /home/nauman_sajjad/Desktop/Raval-AI/scripts/twitter_oauth_and_post.py
  - /home/nauman_sajjad/Desktop/Raval-AI/scripts/linkedin_oauth_and_post.py
  - /home/nauman_sajjad/Desktop/Raval-AI/.env
tests:
  - none (live external API smoke test, not a repo test suite)
---

## Prompt

Resume from prior session. User provided Twitter/X OAuth credentials (consumer key/secret,
bearer, client id/secret) plus a screenshot of the X developer app (callback URI
http://localhost:3000/callback, website https://raval.it.com) and asked to set up Twitter
and post first tweet "Hi, this is my first post here!". Later also provided X access token +
refresh token, an updated X app-permissions screenshot (Read and write, Web App), and
LinkedIn credentials (LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET, callback
http://localhost:8000/api/v1/oauth/linkedin/callback) plus LinkedIn app settings screenshots.
Asked to post first LinkedIn test post "hi this is test post happy to see you here".

## Response snapshot

Twitter:

- Wrote scripts/twitter_oauth_and_post.py (OAuth 2.0 PKCE with localhost:3000 callback server).
- Confirmed X app callback URI via OCR of screenshot; PKCE challenge fixed (urlsafe_b64encode).
- User supplied access+refresh tokens; saved to .env (had to fix a line-concatenation bug
  where TWITTER_ACCESS_TOKEN merged onto TWITTER_CLIENT_SECRET line).
- Token refreshed via https://api.twitter.com/2/oauth2/token (grant_type=refresh_token) →
  new access token with tweet.write scope; 401 resolved.
- Post attempt returned HTTP 402 "credits depleted" — X free-tier posting quota exhausted.
  Posting blocked pending tier upgrade or monthly reset.

LinkedIn:

- Wrote scripts/linkedin_oauth_and_post.py (callback server on port 8000 matching the
  registered redirect URI http://localhost:8000/api/v1/oauth/linkedin/callback).
- Iteration 1: scope "w_member_social r_liteprofile openid" → LinkedIn error
  openid_insufficient_scope_error (r_liteprofile deprecated; OpenID scopes profile/email needed).
- Iteration 2: scope "openid profile email w_member_social" → authorization succeeded,
  but token exchange HTTP 401 invalid_client.
- Root cause: PKCE code_verifier rejected for confidential Web App. Removed PKCE entirely
  (standard authorization_code flow with client_secret) → token exchange OK.
- User approved in browser; got access+refresh tokens; saved to .env.
- Fetched userinfo (sub sUHgY5YhVR, name Muhammad Junaid, email junaidsajjad2298@gmail.com).
- Published UGC post via POST /v2/ugcPosts → 201, id urn:li:share:7488998692532768768,
  URL https://www.linkedin.com/feed/update/urn:li:share:7488998692532768768.

## Outcome

- ✅ Impact: First real LinkedIn post published through the SDE pipeline; Twitter wiring fully
  validated up to X's credit gate (402). Established exact LinkedIn OAuth requirements for a
  confidential client (no PKCE; OpenID scopes profile/email required).
- 🧪 Tests: none in repo; live API smoke tests (OAuth exchange, userinfo, ugcPosts).
- 📁 Files: scripts/twitter_oauth_and_post.py, scripts/linkedin_oauth_and_post.py, .env
  (added LINKEDIN_* and updated TWITTER_ACCESS_TOKEN/REFRESH_TOKEN).
- 🔁 Next prompts: craft first platform post sharing how the SDE was built; upgrade X tier or
  wait for credit reset to unblock Twitter; consider storing OAuth tokens via app encryption
  (app.security) instead of raw .env.
- 🧠 Reflection: Platform OAuth quirks (X PKCE-friendly, LinkedIn confidential-client code flow;
  X per-account credits; OpenID scope migration) must be encoded per-platform, not assumed
  generic — matches CLAUDE.md "Adapters Are Armor" principle.

## Evaluation notes (flywheel)

- Failure modes observed: (1) LinkedIn scope mismatch (r_liteprofile → openid/profile/email);
  (2) PKCE code_verifier rejected for confidential clients; (3) X token validity vs credit gate
  are separate failure classes; (4) .env append without newline concatenates lines.
- Graders run and results (PASS/FAIL): PASS — LinkedIn post 201 with share URN; X auth works,
  write gated by credits only.
- Prompt variant (if applicable): none
- Next experiment (smallest change to try): encode LinkedIn non-PKCE rule in accounts.py
  token exchange; add X 402 credit handling to adapter error taxonomy.
