# Release and versioning

The repository has build, typecheck, lint, unit, live, visual, SEO, migration,
and AI evaluation scripts, but it does not contain one authoritative release
workflow or semantic-versioning policy. Do not invent a version number or
release cadence from package metadata alone.

## Minimum release gate

1. Review code, migrations, docs, and security impact.
2. Run typecheck, lint, unit tests, build, and relevant focused/live/visual checks.
3. Verify migrations against the target database and regenerate types.
4. Check environment requirements, feature flags, health/readiness, and hooks.
5. Deploy, smoke test authentication, workspace isolation, one representative
   AI flow, and any changed integration.
6. Record externally visible behavior and rollback/migration notes.

## Versioning TODOs

Confirm the release tag format, changelog owner, deployment approval, rollback
procedure, and database migration compatibility policy. Until then, use the
pull request and commit SHA surfaced by health checks as the implementation
identity, not as a public semantic version.
