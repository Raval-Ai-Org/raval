---
id: 0008
title: rename co-author to claude code opus 5
stage: general
date: 2026-08-04
surface: agent
model: claude-opus
feature: none
branch: main
user: nauman_sajjad
command: "i want the collaborator along iowth me to be claude code with opus 5 named in it okay ... update the collaborator as well onto my github"
labels: ["github", "contributors", "co-author", "commit-attribution", "git-trailer"]
links:
  spec: null
  ticket: null
  adr: null
  pr: null
files:
  - tests/conftest.py (prior session, unchanged here)
  - history/prompts/general/0008-rename-co-author-to-claude-code-opus-5.general.prompt.md
tests:
  - commit 408868c pushed to origin/main; message verified via GitHub API to contain "Co-Authored-By: Claude Code (Opus 5) <noreply@anthropic.com>"
---

## Prompt

yes i want the collaborator along iowth me to be claude code with opus 5 named in it okay thatit so update the collaborator as well onto my github okay ... oh i forget to tel you thqati wanted to add claud to controrbutor space not collaborator spoace sory i forgrt it as when using working andposufhign the code through the claude code this contributor space is auto occupeid byclude code so i wanted that only ... yes yes the coauthor is th e stuf that inheeds form yiou man , up till nowallthe commits done via claude code man

## Response snapshot

Clarified the user's intent: they want Claude Code to appear as an attributed co-author on commits, not added as a repo collaborator (access-granting), and not literally added to the GitHub Contributors avatars tab. Explained that the Contributors tab is derived from commit history and only links a co-author to a profile when the trailer email resolves to a real GitHub account (noreply@anthropic.com is not one, so no avatar link — the Commit Contributors graph will only accumulate once a real account email is used). The section they control directly is the Co-Authored-By trailer: every commit already carries "Co-Authored-By: Claude <noreply@anthropic.com>"; changing the trailer NAME to "Claude Code (Opus 5)" makes GitHub render that label on commit pages. User chose "just future commits" over a destructive history rewrite. Committed and pushed pending PHR 0007 (commit 408868c) with the new trailer "Co-Authored-By: Claude Code (Opus 5) <noreply@anthropic.com>", verified live on GitHub via the API. Also surfaced the placeholder email issue: git user.email is your_email@example.com, so the user's own work attributes to a mystery "servis" account (8 contributions) instead of their GitHub profile.

## Outcome

- ✅ Impact: New co-author convention adopted — future commits read "Claude Code (Opus 5)". First demonstration live on commit 408868c. No history rewrite, no force-push, no collaborators granted.
- 🧪 Tests: verified trailer present in pushed commit message via GitHub API (commit 408868c on origin/main).
- 📁 Files: commit 408868c (PHR 0007); PHR 0008 (this record).
- 🔁 Next prompts: optionally harden via a prepare-commit-msg hook so non-agent commits also stamp the trailer; optionally fix git user.email so the user's own commits attribute to their GitHub profile; P0 secret rotation still open.
- 🧠 Reflection: "Contributors" vs "collaborators" vs "co-author" are three distinct GitHub concepts; the user's real target was the co-author trailer label, which is fully controllable without any account creation. The Contributors avatars graph still requires a real account email — flagging that limit honestly rather than implying a linked profile.

## Evaluation notes (flywheel)

- Failure modes observed: user initially framed the ask as "add a collaborator/contributor"; probing clarified the actual mechanism (Co-Authored-By trailer). Avoided a destructive history rewrite by offering a scoped choice.
- Graders run and results (PASS/FAIL): trailer-in-commit verification PASS (API showed exact string); push to origin/main PASS.
- Prompt variant (if applicable): direct API verification instead of gh CLI.
- Next experiment (smallest change to try): add a committed prepare-commit-msg hook (core.hooksPath) to stamp the trailer automatically on every commit.