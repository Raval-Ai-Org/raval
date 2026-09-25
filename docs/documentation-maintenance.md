# Documentation maintenance

## Authority order

1. Current runtime code and route schemas.
2. Current Supabase migrations and generated types.
3. Tests and deployment/configuration files.
4. ADRs and feature specifications.
5. Historical reports and planning documents.

When sources conflict, document the implementation, link the conflict, and add
`TODO` for an unresolved product or operational decision. Do not silently turn
planned behavior into a current feature.

## Current documentation principle

The repository is a living product with historical notes alongside current code.
The docs must favor the current implementation and the active runtime model over
older names, plans, or historical reports. This is especially important in a
codebase that contains both current Mellox AI product logic and historical Raval
AI artifacts.

## Required updates

Update the relevant canonical page when adding or changing a route, server
function, migration/RLS policy, provider/model, feature flag, workspace
boundary, background job, webhook, security control, or user-facing flow. Add a
source path and, where useful, a short contract example.

## Review checklist

- All links resolve and filenames work on Windows case-insensitively.
- No secrets, token values, private keys, personal credentials, raw provider responses, or sensitive URLs.
- Mellox AI is used for current product references; old Raval AI text is labeled historical.
- Current, external, and planned behavior are separated.
- API, database, environment, security, and operational claims match code.
- Mermaid diagrams remain simple and renderable.

## Release and changelog rules

Documentation changes ship with the code change they describe. Keep a concise
release note or changelog entry for externally visible behavior; link the
owning implementation/ADR. Do not claim a release, SLA, compliance status, or
provider capability without a verified source. TODO: choose the repository's
single release-note file/process; no canonical changelog process was confirmed
in the audit.

## Current governance summary

The current docs are governed by a simple rule: current code and migrations win,
then tests and config, then ADR/spec docs, then historical notes. This keeps the
repository practical for contributors while preserving the historical records as
context and evidence rather than runtime truth.
