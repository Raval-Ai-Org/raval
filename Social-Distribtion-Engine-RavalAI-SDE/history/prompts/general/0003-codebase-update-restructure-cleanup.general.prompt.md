---
id: 0003
title: Codebase update restructure and cleanup
stage: general
date: 2026-08-01
surface: agent
model: claude-code-auto
feature: none
branch: main
user: nauman_sajjad
command: (conversational request — update codebase with latest changes, restructure for cleanliness, move unneeded files to OS trash recoverable, produce a robust cleanup report)
labels: ["cleanup", "restructure", "gitignore", "secrets", "git-hygiene", "social-sde"]
links:
  spec: null
  ticket: null
  adr: null
  pr: null
files:
  - app/services/webhook_out.py (committed: delivery-log FK fix)
  - alembic/versions/003_delivery_logs_post_id_nullable.py (new, committed)
  - history/prompts/001-social-sde/0009-live-webhook-and-multi-tenant-isolation-proof.green.prompt.md (new, committed)
  - .gitignore (new, committed)
  - CLEANUP_MANIFEST.md (new, committed)
  - .env (untracked from git, kept on disk)
  - untracked: 4,505 *.pyc files, celerybeat-schedule, raval_sde.egg-info, .env
  - moved to OS trash (recoverable): .coverage, htmlcov/, all __pycache__/, .mypy_cache/, .pytest_cache/, .ruff_cache/, .hypothesis/, raval_sde.egg-info/, 7 stale spec status docs
tests:
  - Full suite 182 passed (regression-free after hygiene)
  - /healthz healthy (db+redis+workers); git status clean after hygiene
---

## Prompt

User asked to: (1) update the full codebase with all our latest session changes, (2) restructure the codebase for cleanliness/optimization, (3) move every unneeded file out of the project folder to the OS trash — recoverable, never permanently deleted, (4) produce a robust report of what is removed, why, and severity/priority.

## Response snapshot

Explored the repo: no `.gitignore` existed; **4,505 committed `.pyc` files = 37% of all tracked files**; **`.env` with live secrets (LinkedIn tokens, FERNET_KEY, SDE_API_TOKEN, DB password) was committed and pushed**. User approved: trash the 7 stale one-time spec status docs; untrack + gitignore `.env`. Executed:

- Commit A `b5519fb`: webhook delivery-log FK fix + migration 003 + PHR 0009 (the "latest changes").
- Created a comprehensive `.gitignore`; `git rm --cached` the 4,505 `.pyc`, `celerybeat-schedule`, `.env`, `raval_sde.egg-info` (all kept on disk).
- Moved to OS trash via `gio` (verified 22 items + `.trashinfo` in `~/.local/share/Trash/`, restore-capable): `.coverage`, `htmlcov/`, all 11 `__pycache__/`, `.mypy_cache/`, `.pytest_cache/`, `.ruff_cache/`, `.hypothesis/`, `raval_sde.egg-info/`, and the 7 stale spec docs.
- Wrote `CLEANUP_MANIFEST.md` — itemized table: item | action | reason | severity/priority, plus the P0 `.env` security note.
- Commit B `e0b7943`: hygiene pass (4,521 files changed).
- Verification: 182 tests pass, stack healthy, `git status` clean even after pytest regenerated the (now ignored) caches.

`app/` left untouched — it is already a clean modular monolith; moving modules would break `uvicorn app.main:app` / `celery -A app.celery_app` / alembic imports for zero benefit.

## Outcome

- ✅ Impact: Repo updated with latest fixes; ~4,500 junk files out of git; live secrets untracked; everything recoverable in OS trash; manifest documents each removal with reason + priority; memory updated with P0 rotation follow-up.
- 🧪 Tests: 182 passed; healthz healthy; git status clean.
- 📁 Files: `.gitignore`, `CLEANUP_MANIFEST.md`, 2 commits (b5519fb, e0b7943); PHR 0009 + this PHR.
- 🔁 Next prompts: rotate exposed `.env` secrets (P0, they remain in git history); fill TWITTER_*/Meta creds; deploy; optional `git gc` + README expansion + PHR renumber.
- 🧠 Reflection: The biggest cleanup wins were invisible from source — the repo had no `.gitignore` (37% of it was bytecode) and `.env` committed with live credentials. "Restructure" here meant repo/root hygiene, not moving app code. Trash-first via `gio` satisfies the "recoverable, never permanent" constraint cleanly.

## Evaluation notes (flywheel)

- Failure modes observed: Bash auto-classifier intermittently unavailable (waited/retried; used Write for the manifest meanwhile); earlier `pkill -f` matching the invoking shell (exit 144); `gio trash` is silent on success → verify via `ls ~/.local/share/Trash/files/` + `.trashinfo` count.
- Graders run and results (PASS/FAIL): PASS — 182/182 tests; git status clean; 22 items in OS trash incl. all 7 stale docs; critical files (.env, app/, migrations, core specs) intact.
- Prompt variant (if applicable): none
- Next experiment (smallest change to try): rotate secrets; then `git gc --prune=now` to reclaim loose objects left by the mass untrack.
