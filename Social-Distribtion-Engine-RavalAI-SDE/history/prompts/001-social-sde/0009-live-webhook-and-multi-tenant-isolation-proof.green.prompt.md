---
id: 0009
title: Live webhook and multi-tenant isolation proof
stage: green
date: 2026-08-01
surface: agent
model: claude-code-auto
feature: 001-social-sde
branch: 001-social-sde
user: nauman_sajjad
command: (conversational request — verify webhooks fire + per-workspace API key isolation live on the running stack, after the git commit/push)
labels: ["webhooks", "multi-tenant", "live-verification", "dogfood", "delivery-logs", "social-sde"]
links:
  spec: specs/001-social-sde/spec.md
  ticket: null
  adr: history/adr/0001-multi-tenant-auth-model-per-workspace-api-keys.md
  pr: null
files:
  - app/services/webhook_out.py (fix: delivery_logs FK violation — pass real post_id/post_target_id from payload, NULL for generic events; drop unused webhook_id param; str|None annotations)
  - alembic/versions/003_delivery_logs_post_id_nullable.py (new migration: delivery_logs.post_id nullable)
tests:
  - Full suite 182 passed (regression-free after the fix)
  - Live webhook: signed post.published delivered to local receiver; signature verified True against webhook secret; delivery_log row written with real post_id, http=200
  - Live isolation: tenant-B key sees no tenant-A webhooks/accounts; cross-workspace DELETE → 404; bogus key → 401; tenant-B lists only its own webhook
---

## Prompt

After the sprint commit/push (user created the private repo and ran git init/commit/push on their own), user asked what to do next. Recommended sequence: commit (done by user) → close the last untested wiring live → unblock Twitter/Meta creds → deploy. User approved proceeding with the live verification, including a real LinkedIn test post to fire a genuine post.published webhook event.

## Response snapshot

Verified two untested surfaces live on the running stack (healthz healthy).

(1) Webhooks (FR-011): registered a webhook via API (http URL correctly rejected with VALIDATION_ERROR — HTTPS gate proven; https URL → 201; DELETE → 204), inserted a local http:// URL row via the app DB layer as a local-dev bypass for the delivery proof, published a real LinkedIn post through /api/v1/publish (urn:li:share:7489076091089973248), and confirmed the signed post.published event landed at a local receiver with a valid HMAC-SHA256 signature.

(2) Found a real bug: webhook_out._record_delivery_log wrote post_id="" into a NOT NULL FK column, so the delivery_log write violated delivery_logs_post_id_fkey, rolled back, raised, and was mislogged as "Webhook delivery failed" — despite the HTTP delivery succeeding. The audit trail was silently lost (violates observability principle 2.5). Fixed with migration 003 (post_id nullable) + passing real post_id/target_id from the payload; restart API+worker+beat; re-verified deliver_event writes the row with http=200 and the real post_id.

(3) Multi-tenant isolation (FR-MT-02): minted a ws-tenant-b key via /api/v1/admin/api-keys, proved tenant-B sees zero tenant-A webhooks/accounts, cross-workspace DELETE → 404, bogus key → 401, and tenant-B lists only its own webhook (positive direction). Cleaned up all test webhook rows and revoked the tenant-B key afterward (0 active webhooks, 0 active keys).

## Outcome

- ✅ Impact: Webhook delivery is now observable (delivery_logs written with a real post_id, http status, no FK error) and tenant data isolation is proven live against Postgres; the FK bug (uncommitted before) is fixed with a migration and verified regression-free.
- 🧪 Tests: 182 passed (full suite, post-fix); 25 targeted webhook/multi-tenant/publish tests passed; migration 003 applied to Postgres (is_nullable=YES verified).
- 📁 Files: app/services/webhook_out.py, alembic/versions/003_delivery_logs_post_id_nullable.py (2 files).
- 🔁 Next prompts: user deletes the live test LinkedIn post (urn:li:share:7489076091089973248); commit the fix + migration (both still uncommitted); add celerybeat-schedule to .gitignore (runtime artifact); fill TWITTER_* / Meta creds; deploy to public HTTPS + hosted Postgres/Redis.
- 🧠 Reflection: The live gate caught a bug unit tests could not: the delivery-log write with post_id="" only fails against the real Postgres FK. Also — pkill -f patterns can match the invoking shell's own command line and kill the Bash tool shell (exit 144); kill by explicit PID instead.

## Evaluation notes (flywheel)

- Failure modes observed: FK violation on delivery_logs.post_id (empty string, not NULL); webhook success logged as ERROR; local receiver couldn't be registered via API because of the intentional HTTPS gate (worked around with a DB-inserted http row, transparent in report); pkill self-match killing the shell.
- Graders run and results (PASS/FAIL): PASS — signed webhook signature verifies True; delivery_log row http=200 with real post_id; 182/182 tests; isolation battery 6/6 (list→empty, cross-DELETE→404, accounts→empty, bogus→401, control sees own, positive-scope).
- Prompt variant (if applicable): none
- Next experiment (smallest change to try): verify a scheduled-path (worker) webhook delivery writes its delivery_log too, then Meta/Facebook live publish through the same pipeline.
