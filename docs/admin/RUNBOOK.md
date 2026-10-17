# Mellox admin console: runbook

For the people who run the console. Design and reasons: [ADR-0034](../adr/0034-admin-console.md).
Delivery plan: [ADMIN-PANEL-PLAN.md](ADMIN-PANEL-PLAN.md).

## 1. Setting it up

1. **Apply the migrations** (`20261018090000` to `20261018170000`, eight files; see
   [DEPLOYMENT.md](../DEPLOYMENT.md) §2). Migrate before you deploy the app code. Then run
   `npm run db:verify` and the checks in §6.
2. **Environment**
   - `BILLING_ADMIN_USER_IDS`: comma-separated user ids. These people are super admins
     whether or not they have an `admin_users` row. **This is the way back in if the team
     table is ever wrong. Keep at least one id here.**
   - `ADMIN_REQUIRE_MFA`: on by default in production. Admin routes answer
     `mfa_required` until the person has verified an authenticator code.
3. **Sign in** at `/admin`. A person who is not an admin sees "Admins only" and every
   `/api/admin/*` route answers 404 to them.
4. **Add the team** under Team & access (super admin only; nobody edits their own row and
   the last active super admin can't be removed).

## 2. Roles

Roles are presets in code (`src/lib/admin/permissions.ts`); a person can also be granted or
denied single permissions, and denied always wins.

| Role        | In short                                                             |
| ----------- | -------------------------------------------------------------------- |
| Super admin | Everything, including who else is an admin                           |
| Operations  | Accounts, workspace access, support views, jobs, flags, caps, export |
| Support     | Look up accounts, notes, read-only support views, jobs (read)        |
| Finance     | Accounts, usage, spend caps, credit adjustments, audit export        |
| Engineering | Investigate: health, jobs, usage, AI routing, flags, integrations    |
| Analyst     | Read-only numbers. Cannot change anything                            |

Emails and IP addresses are masked unless the person holds `users.pii.read`.

## 3. Sensitive actions

These need a written reason (at least 10 characters, saved in the audit log) and, when a
second factor is required, a code from the last ten minutes:

- Emergency switches (stop or restart AI text, images, video, web search)
- Spend caps, AI model routing overrides
- Workspace read-only or suspended
- Opening a support view, adding a goodwill credit adjustment
- Changing the admin team, exporting the audit log

Everything is written to **Audit log**, which no screen or route can edit or delete (the
table refuses it even for the service role).

## 4. When something is wrong

| Situation                               | Do this                                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------ |
| A provider is misbehaving or too costly | Emergency → stop that area. Customers see a short "paused" message. Start it again when fixed.   |
| Spend is running away                   | Usage & cost → find the route or workspace. Set a workspace cap, or a platform cap (blocks all). |
| One workspace is abusive or disputed    | Workspace page → Access → read-only (looks around, no changes) or suspended (nothing works).     |
| A customer needs help                   | Support → find them → Open support view (read-only, 30 min, every read logged).                  |
| A render is stuck                       | Jobs → Stuck → Nudge once; if it still doesn't move, Cancel (releases their credit hold).        |
| A model route needs a different model   | AI controls → Model routing → override. "Back to built-in" undoes it.                            |
| Unusual signups or usage                | Abuse signals. It only lists candidates; act from the user or workspace page.                    |

Things that behave in ways worth knowing:

- Switches, flags, caps and workspace access are cached about 10 to 60 seconds per server
  process, so a change takes up to a minute to reach every instance.
- All of them **fail open**: if their table can't be read the product keeps running, and the
  server log says `failing open`. A stopped area that suddenly works again is a reason to
  check the database, not to assume it was restarted.
- An environment variable always outranks the admin console: `AI_MODEL_<ROUTE>`,
  `AI_EFFORT_<ROUTE>` and `FEATURE_FLAG_<KEY>`. The screens show "Set by environment".
- Read-only mode stops requests that need the editor role or higher. A route that writes
  without declaring `minRole: "editor"` would not be stopped, so keep to that convention.
- A suspended workspace's pages still open; its data calls answer 403 with a clear message.
- There is no admin retry of a failed job: retrying spends credits as the customer.

## 5. Recovery

- **Locked out of the console:** an id in `BILLING_ADMIN_USER_IDS` is a super admin without
  a table row. Add yours there and redeploy.
- **A switch can't be started again from the UI:** restart it from the database
  (`update platform_switches set engaged = false where key = '…'`). A change made directly
  in the database leaves no Audit log row, so write down who did it, when and why.
- **A workspace can't be restored from the UI:** `delete from workspace_access_state where
workspace_id = '…'` restores it immediately (after the cache window).
- **Wrong model override:** `delete from model_route_overrides where route_key = '…'`.

## 6. Checking an installation

`npm run db:verify` replays every migration on an empty database. `npx vitest run tests/db/admin`
calls every admin function. Against the real project, after applying migrations:

```bash
npx vitest run --config vitest.live.config.ts tests/live/admin.live.ts
```

It is read-only by default. `ADMIN_LIVE_WRITE=yes` adds the one test that writes (a single
row to the append-only audit log, which can never be removed). It cannot test a real sign-in
or second factor: sign in once by hand and make one low-risk change (create a flag, then
find `flag.created` in the Audit log).

Visual check without signing in, in development only: `/admin-lab?s=<section>&role=<role>`
(sections: overview, users, workspaces, plans, flags, announcements, support, analytics,
integrations, ai, usage, health, emergency, jobs, abuse, audit, security, team, view).
