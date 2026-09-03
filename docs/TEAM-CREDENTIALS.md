# Team Credentials — Mellox AI Local Dev Setup

> **This document is a TEMPLATE. The real values live in 1Password (or Bitwarden).**
> **Do NOT commit the real values to this file. It exists so you know which values to share.**

When a new team member joins, they need these values in their local `raval/.env` file. The fastest way to share them is via 1Password — but this file documents what's needed so you don't miss anything.

---

## Quick share procedure (recommended)

### One-time, using 1Password CLI

```bash
# As the team lead (Junaid), run this on YOUR machine:
op item create \
  --category="Secure Note" \
  --title="RavalAI local dev .env" \
  --vault="Engineering" \
  --generate-password=long \
  notes="$(cat raval/.env)"

# This creates a 1Password item with the .env contents as a note.
# Then share that item with Zian.
```

### Manual share (no 1Password CLI)

1. Open `raval/.env` in your editor
2. Copy the entire contents
3. Paste into a 1Password Secure Note titled "RavalAI local dev .env"
4. Share the item with Zian (1Password → Share → enter Zian's email)

### Teammate's setup procedure

```bash
# 1. Clone the repo
git clone https://github.com/Raval-Ai-Org/raval.git
cd raval

# 2. Run setup (creates .env from .env.example with placeholders)
npm run setup

# 3. Open .env in your editor
# (in VS Code: code .env)

# 4. Replace each placeholder with the real value from 1Password
#    (open the "RavalAI local dev .env" item in 1Password, copy each line)
#    Required keys (see .env.example for the full list):
#      VITE_SUPABASE_URL
#      VITE_SUPABASE_PUBLISHABLE_KEY
#      SUPABASE_URL
#      SUPABASE_PUBLISHABLE_KEY
#      SUPABASE_SERVICE_ROLE_KEY
#      SDR_BASE_URL
#      SDR_ADMIN_TOKEN
#      SDR_SECRET_ENCRYPTION_KEY
#      CRON_SECRET

# 5. Verify everything works
npm run setup        # should say "✓ .env has real values"
npm run dev          # predev check should pass, Vite should start

# 6. Test login
# Open http://localhost:8080/login
# Use: junaidsajjad2298@gmail.com / Junaid@1234
```

---

## What the credentials are (reference for the team lead)

This section explains what each value is for, so you know what you're sharing.

| Key                             | What it is                               | Where to find it                                                 | Sensitivity                            |
| ------------------------------- | ---------------------------------------- | ---------------------------------------------------------------- | -------------------------------------- |
| `VITE_SUPABASE_URL`             | Your Supabase project URL                | Supabase Dashboard → Project Settings → API                      | Public (safe to share)                 |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Browser-safe Supabase key                | Supabase Dashboard → Project Settings → API → "Publishable key"  | Public                                 |
| `SUPABASE_URL`                  | Same as VITE_SUPABASE_URL (server-side)  | Same                                                             | Public                                 |
| `SUPABASE_PUBLISHABLE_KEY`      | Same as VITE_ version (server-side)      | Same                                                             | Public                                 |
| `SUPABASE_SERVICE_ROLE_KEY`     | **Server-only admin key — bypasses RLS** | Supabase Dashboard → Project Settings → API → "Service role key" | **CRITICAL — never expose to browser** |
| `SDR_BASE_URL`                  | URL of the deployed SDR service          | AWS Lightsail IP or `sdr.raval.ai`                               | Semi-public                            |
| `SDR_ADMIN_TOKEN`               | Admin token to mint workspace API keys   | Set by you in SDR `.env`                                         | **CRITICAL**                           |
| `SDR_SECRET_ENCRYPTION_KEY`     | AES key for encrypting tokens at rest    | Generated via `Fernet.generate_key()`                            | **CRITICAL**                           |
| `CRON_SECRET`                   | Secret for cron job auth                 | Set by you                                                       | Semi-sensitive                         |

**Bottom line:** The 4 critical secrets are `SUPABASE_SERVICE_ROLE_KEY`, `SDR_ADMIN_TOKEN`, `SDR_SECRET_ENCRYPTION_KEY`, and `CRON_SECRET`. The others are either public (Supabase URL, publishable key) or semi-sensitive.

---

## What to do if a secret is leaked

If `.env` is ever accidentally committed to git, pushed to a public repo, or sent to the wrong person:

### 1. Supabase service role key

- Supabase Dashboard → Project Settings → API → "Service role key" → **Roll / Regenerate**
- Update `.env` on every team member's machine
- The old key stops working immediately

### 2. SDR admin token

- Update `SDE_API_TOKEN` in the SDR's `.env` (on the production server)
- Restart the SDR API: `sudo systemctl restart raval-sdr-api`
- Update `.env` on every team member's machine

### 3. SDR encryption key

- **Critical:** if this leaks, ALL stored OAuth tokens are decryptable
- You must:
  1. Generate a new Fernet key: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`
  2. Set it as `FERNET_KEY` in SDR `.env`
  3. Restart SDR
  4. Re-authorize every client's social accounts (the old encrypted tokens are now unreadable)

### 4. CRON_SECRET

- Set a new value in SDR `.env` and RavalAI `.env`
- Restart both

### 5. Rotate your 1Password item

- After rotating, create a new 1Password Secure Note with the new values
- Share with the team

---

## Why we don't commit `.env` to git

Even in a private repo:

1. **Git history is forever.** A future `git log -p` will find the old `.env` and leak it.
2. **Backups replicate.** GitHub backs up to multiple regions. A breach exposes everything.
3. **Supabase service_role key** is the most dangerous — it bypasses RLS. If leaked, attacker can read/write/delete all data, impersonate users, and publish to social accounts.
4. **Dependabot and other scanners** may detect secrets even in private repos and alert.
5. **Access expansion.** If you add a contractor, intern, or open-source contributor, they get production credentials.

The 1Password approach takes 5 minutes of setup, is more secure, and is the industry standard for teams your size.

---

## FAQ

**Q: Can't I just commit `.env` to master since the repo is private?**
A: Technically yes, but it's a bad habit that will bite you when you add a third team member, when you accidentally make the repo public for a demo, or when GitHub is breached. The 30 seconds of 1Password setup is worth it.

**Q: What if I don't have 1Password?**
A: Use Bitwarden (free, open source), or any password manager that supports shared notes. Don't use email or Slack for secrets.

**Q: Can I use GitHub Actions secrets for local dev?**
A: No. GitHub Actions secrets are only available inside CI workflows, not on developer machines. For local dev, you need a secrets manager that runs on the developer's laptop (1Password, Bitwarden, Doppler CLI, etc.).

**Q: What if Zian leaves the team?**
A: Revoke his GitHub access. Then rotate all secrets (see "What to do if a secret is leaked" above).

**Q: Is there any way to make `npm run dev` "just work" without manual setup?**
A: Not safely. The whole point of requiring `.env` is to keep secrets out of the repo. Any "just works" approach would either (a) commit secrets to the repo, or (b) fetch them from a remote source (which is what 1Password CLI does, but adds complexity).
