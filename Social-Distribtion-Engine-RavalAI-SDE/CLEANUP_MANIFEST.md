# CLEANUP_MANIFEST — Codebase Update, Restructure & Cleanup

**Date:** 2026-08-01 · **Branch:** `main` · **Audience:** RavalAI engineering

This document records every file removed, untracked, or kept during the codebase
update + restructure pass, with the **reason** and a **severity/priority** level
for each. Nothing was permanently deleted — every removed item was moved to the
**OS trash** (`~/.local/share/Trash/`) and is recoverable.

---

## 🔴 Security note (P0 — highest priority)

`.env` contained live credentials (LinkedIn access/refresh tokens, `FERNET_KEY`,
`SDE_API_TOKEN`, `SDE_SIGNING_SECRET`, Postgres password) and **was committed to
git and pushed to GitHub**.

**Action taken:** untracked (`git rm --cached .env`) and added to `.gitignore`.
The file stays on disk — the running stack still reads it.

**Remaining exposure (not fully resolved by untracking):** the secrets still exist
in the two past commits' history (`05ed8b9`, `8bb6a9f`) and in the pushed remote.
Untracking prevents them from appearing in *future* commits; it does not scrub the
past. **Recommended follow-up: rotate the exposed secrets** — regenerate the
Postgres password, `FERNET_KEY`, and `SDE_API_TOKEN`, and re-issue the LinkedIn
tokens via OAuth. Optionally rewrite git history (requires a force-push).

---

## Trash manifest (recoverable via OS Trash)

| Item | Action | Reason | Priority |
|---|---|---|---|
| `.env` | untrack + gitignore (kept on disk) | Live secrets committed & pushed — security | **P0** |
| `**/__pycache__/*.pyc` (4,505 files) | untrack + trash dirs | 37% of the repo was compiled bytecode; regenerable | **P1** |
| `celerybeat-schedule` | untrack + trash | Runtime beat state; regenerates on next tick | **P3** |
| `.coverage` | trash | Coverage data artifact; regenerates on `pytest --cov` | **P3** |
| `htmlcov/` | trash | Generated HTML coverage report; regenerable | **P3** |
| `raval_sde.egg-info/` | untrack + trash | Build metadata from `pip install -e .`; regenerable | **P3** |
| `.mypy_cache/` | trash | mypy cache; regenerable | **P3** |
| `.pytest_cache/` | trash | pytest cache; regenerable | **P3** |
| `.ruff_cache/` | trash | ruff cache; regenerable | **P3** |
| `.hypothesis/` | trash | Hypothesis test database; regenerable | **P3** |
| `specs/001-social-sde/COMPLETION_REPORT.md` | trash | One-time status snapshot, superseded by spec/plan/tasks | **P2** |
| `specs/001-social-sde/PROJECT_STATUS.md` | trash | Stale phase-5 snapshot (2026-07-27), out of date | **P2** |
| `specs/001-social-sde/SUMMARY_AND_NEXT_STEPS.md` | trash | Stale handoff snapshot, superseded | **P2** |
| `specs/001-social-sde/TEST_EXECUTION_ROADMAP.md` | trash | Historical plan, superseded by tasks.md | **P2** |
| `specs/001-social-sde/PHASE_3_IMPLEMENTATION_PLAN.md` | trash | Already-executed plan (T015–T024 done) | **P2** |
| `specs/001-social-sde/DECISION_FRAMEWORK.md` | trash | Stale decision snapshot (end of Phase 2) | **P2** |
| `specs/001-social-sde/TESTING_STRATEGY.md` | trash | Draft superseded by test suite + tasks.md | **P2** |

## Untracked but kept on disk

These were removed from git tracking only — the files remain in the project
folder and keep working:

- `.env` (P0 — see security note above)
- `celerybeat-schedule`
- `raval_sde.egg-info/`
- `**/__pycache__/*.pyc` (until their `__pycache__` dirs were trashed)

## Kept (untouched)

- **Source:** `app/` (adapters, api, services, core modules) — already a clean
  modular monolith; moving modules would break imports & the running stack.
- **Config:** `.env` (on disk), `.env.example`, `.env.example.twitter-or-X`,
  `pyproject.toml`, `Dockerfile`, `docker-compose.yml`, `alembic.ini`, `README.md`,
  `CLAUDE.md`, `AGENTS.md`, `.gitignore` (new).
- **Infra:** `alembic/` (env.py, script.py.mako, README, versions 001–003),
  `.github/workflows/ci.yml`, `.claude/`, `.vscode/settings.json`.
- **Dev tooling:** `scripts/`, `tests/` (unit, integration, e2e), `.specify/`.
- **Docs (living SDD artifacts):** `specs/001-social-sde/spec.md`, `plan.md`,
  `tasks.md`, `data-model.md`, `quickstart.md`, `runbook.md`, `MULTI_TENANCY.md`,
  `research.md`, `TWITTER_SETUP_GUIDE.md`, `contracts/`, `checklists/`,
  `integration/`, `demo/`.
- **Records:** `history/adr/` (0001–0003), `history/prompts/` (all PHRs incl. 0009).
- **Env:** `venv/` (required by the running stack).

## Verification performed

- `git status --short` clean after hygiene pass (only ignored residue).
- Full test suite: **182 passed**.
- `/healthz` healthy (db + redis + workers) — stack untouched.
- Trashed items present in `~/.local/share/Trash/files/` (restore-capable).

## Follow-ups

1. **Rotate exposed secrets** (see P0 security note) — highest priority.
2. Optional: rename two misnumbered PHR files
   (`history/prompts/001-social-sde/001-resolve-alembic-migrations.general.prompt.md`
   and `1-model.general.prompt.md`) to fit the ID sequence.
3. Optional: expand `README.md` (currently 147 bytes) into a proper project readme.
