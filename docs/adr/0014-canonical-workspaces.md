# ADR-0014: Canonical workspaces — one brand, one isolated workspace

Status: accepted · 2026-09-16

## Context

Workspaces leaked data into each other and got duplicated:

- **No server-side notion of the active workspace.** It lived in
  `localStorage["workspace:selected"]`, read and written by about eight
  components. A module-level cache in `authed-fetch.ts` could go stale. `/app`
  opened the newest workspace when nothing was selected, and sign-in landed on
  `/app`.
- **Brand DNA existed only in localStorage.** The hook didn't reset when the
  workspace changed, so Brand A's DNA fed Brand B's chat and coach and was
  saved under Brand B.
- **Studio drafts and jobs were one global list.** A conversation id from
  another workspace could be opened and written to.
- **Creation wasn't idempotent.** There was no domain uniqueness, and the real
  database had drifted: it still auto-created a "My Workspace" on every signup.
  Production data held groups of 3–8 copies of the same brand.
- **Publishing trusted user-editable `meta`.** Storage paths and provider post
  ids were used with the service role, with no check that they belonged to the
  workspace.

## Decision

1. **Identity comes from the URL.** Workspace pages live at
   `/w/<workspaceId>/app/...`, built only with `src/lib/workspace/paths.ts`.
   `WorkspaceProvider` verifies membership through `getWorkspaceDetails`
   before any workspace UI mounts.
   - It is keyed by the id, so switching remounts all workspace state and
     removes that workspace's React Query entries.
   - A foreign, deleted or malformed id goes to `/projects`.
   - Sign-in and the app root land on `/projects`.
   - Legacy links (`/app`, `/workspace`, `/app/chat/<id>`, `?workspace=`,
     `?invite_token=`) are resolved by `LegacyAppRedirect` without guessing.
2. **One brand is one workspace.** `workspaces.domain` is derived by
   `private.normalize_domain`, with a unique index on `(owner_id, domain)` for
   unflagged rows.
   - Creation goes only through `private.create_workspace_for_user`, which
     takes a per-user advisory lock and an idempotency key, and returns the
     existing workspace for a known domain.
   - The browser insert policy is dropped.
   - Existing duplicates are flagged (`duplicate_of`) against the most active
     copy. They are never merged or deleted automatically.
3. **Brand DNA lives in `workspace_brand_dna`.** Members read it through RLS;
   editors write it through `src/server/fns/brand-dna.ts`.
   - Studio context and content batches load it on the server for the
     verified workspace id.
   - The client store keeps one entry per workspace id. Its debounced saves
     capture that id.
4. **Every AI and data request carries an explicit, verified workspace.**
   - `/api/chat` is `auth: "workspace"`.
   - `requireWorkspaceRole` also sets the metering scope.
   - Chat replies save to the workspace and conversation captured when the
     request started.
   - Studio sessions and jobs carry their own workspace and are filtered by it.
5. **Publishing checks ownership.** Asset paths must be under
   `workspace/<id>/assets/`. Provider post ids must appear in this workspace's
   own `content_publications` rows.
6. **One workspace service.** `src/server/workspaces/service.server.ts` handles
   create, list and delete.
   - The list comes from `public.workspace_overview()`, a security-invoker
     function whose per-workspace counts are correlated on each row's own id.
   - Projects, Agency HQ / Command Center and both switchers use it.
7. **Deletion is a hard delete by the owner.**
   - The owner types `CONFIRM`, which is checked in the UI and again on the
     server.
   - Every related table is removed by cascade, storage objects under
     `workspace/<id>/` are removed, and the SocialAPI brand is released.
   - The deletion is recorded in `workspace_deletions`.

## Consequences

- Deep links always name their workspace. Old bookmarks go to `/projects`
  unless they carry `?workspace=`.
- Workspace columns `plan`, `owner_id` and `duplicate_of` are server-managed
  (enforced by a trigger).
- A second workspace for the same domain requires resolving (deleting) the
  flagged duplicate first.
- Command Center's auto-draft on open still spends AI per active client. That
  is a product decision to revisit.
