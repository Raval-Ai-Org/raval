# Team Credentials — Mellox AI Local Dev Setup

> **This document is a TEMPLATE. The real values live in 1Password (or Bitwarden).**
> **Do NOT commit the real values to this file. It exists so you know which values to share.**

When a new team member joins, they need these values in their local `.env` file. The fastest way to share them is via 1Password — but this file documents what's needed so you don't miss anything.

> **Current-state note:** The canonical configuration reference is
> [configuration.md](configuration.md). This historical credential handoff
> template is retained for operational context and must contain names only, not
> real credentials or test-account details.

---

## Local credential handling

Use the team's approved secrets manager to obtain only the credentials needed
for your role and environment. Do not paste the full `.env` into a shell command,
chat, ticket, or shared note. Never commit `.env` or place secret values in this
document.

### Developer setup

```bash
npm run setup
npm install
npm run dev
```

Replace only the required placeholders in your local `.env`. The variable list
and whether a feature-specific credential is required are documented in
[configuration](configuration.md) and enforced by `src/server/env.ts`. Follow
the [developer guide](developer-guide.md) for local setup and validation.

Use an approved test account managed outside this repository. Never place
account names, passwords, or tokens in documentation.

---

## Credential requirements

The source of truth for variable names, required settings, and feature-specific
credentials is [`src/server/env.ts`](../src/server/env.ts) together with
`.env.example`. Do not treat credentials for optional integrations as
requirements for every developer or environment. Treat service-role keys,
provider tokens, encryption keys, and webhook secrets as server-only.

---

## If a credential is exposed

Revoke or rotate the affected credential with its owning provider, update the
approved secrets manager and affected environments, then verify the dependent
service. Follow the provider-specific incident procedure; rotation can invalidate
sessions, encrypted data, or in-flight work. If a secret reached Git, assume it
is compromised even after removing it from the latest revision.

---

## Why `.env` stays out of Git

Even in a private repo:

1. **Git history is forever.** A future `git log -p` will find the old `.env` and leak it.
2. **Backups replicate.** GitHub backs up to multiple regions. A breach exposes everything.
3. **Supabase service_role key** is the most dangerous — it bypasses RLS. If leaked, attacker can read/write/delete all data, impersonate users, and publish to social accounts.
4. **Dependabot and other scanners** may detect secrets even in private repos and alert.
5. **Access expansion.** If you add a contractor, intern, or open-source contributor, they get production credentials.

Use the approved secrets manager and least-privilege access process for this
team.

---

## FAQ

**Q: Can't I just commit `.env` to master since the repo is private?**
A: Technically yes, but it's a bad habit that will bite you when you add a third team member, when you accidentally make the repo public for a demo, or when GitHub is breached. The 30 seconds of 1Password setup is worth it.

**Q: What if I don't have access to the secrets manager?**
A: Request access through the team's approved process. Do not send secrets over
email, chat, or tickets.

**Q: Can I use GitHub Actions secrets for local dev?**
A: No. GitHub Actions secrets are only available inside CI workflows, not on developer machines. For local dev, you need a secrets manager that runs on the developer's laptop (1Password, Bitwarden, Doppler CLI, etc.).

**Q: What if a team member leaves?**
A: Revoke their access and rotate credentials according to the owning provider's
incident procedure.

**Q: Can local development avoid manual secret setup?**
A: Only if the organization provides an approved secrets-manager integration.
Do not commit credentials to make local setup automatic.
