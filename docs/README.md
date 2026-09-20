# Mellox AI documentation

This is the canonical documentation map for the Mellox AI repository. It is
written from the current implementation: Next.js 16, React 19, TypeScript,
Supabase/PostgreSQL, server-side AI gateways, workspace isolation, and the
feature routes under `src/app`.

## Start here

| Need | Guide |
| --- | --- |
| Product and system orientation | [Overview](overview.md) |
| Repository ownership and folder map | [Repository layout](repository-layout.md) |
| Architecture and code map | [Architecture overview](architecture-overview.md) · [Codebase](codebase.md) |
| Local development | [Developer guide](developer-guide.md) |
| HTTP and RPC contracts | [API reference](api.md) |
| Tables, relationships, and RLS | [Database reference](database.md) |
| AI providers, routing, prompts, and budgets | [AI reference](ai.md) |
| Configuration keys | [Configuration reference](configuration.md) |
| Deployments and environments | [Deployment](deployment-guide.md) |
| Security boundaries | [Security](security.md) |
| Incidents and diagnosis | [Troubleshooting](troubleshooting.md) · [Operations](operations.md) |

## Product and feature guides

- [Frontend architecture and UI system](frontend.md)
- [Backend and server architecture](backend.md)
- [Workspaces, Brand DNA, and memory](workspaces-and-brand-dna.md)
- [Agents, automation, and tools](agents-and-automation.md)
- [Studio and media generation](studio-and-media.md)
- [Social publishing and integrations](social.md)
- [SEO, AEO, and GEO](geo.md)
- [Product flows and onboarding](product-flows.md)
- [Analytics, usage, credits, and cost controls](analytics-and-usage.md)
- [Performance and scalability](performance.md)
- [Data, privacy, and compliance](privacy.md)
- [Component reference](components.md)
- [Release process](release-process.md)
- [Testing and QA](testing.md)
- [Glossary](glossary.md)

## Existing deep references

The repository also contains feature-specific ADRs, specifications, validation
rules, and operational records. The canonical guides link to those documents
when they describe an implementation detail. Documents containing older Raval
AI terminology or unimplemented proposals are historical unless a canonical
page explicitly marks them current. Do not use a planning document to infer
runtime behavior.

- [Architecture decisions](adr/)
- [Feature specifications](specs/)
- [GEO intelligence](geo-intelligence.md)
- [GitHub connector](github-connector.md)
- [Deployment runbook](DEPLOYMENT.md)
- [Operations runbook](OPERATIONS-RUNBOOK.md)
- [Monitoring](MONITORING.md)

## Documentation rules

See [documentation maintenance](documentation-maintenance.md). In short: cite
the owning source file, separate current behavior from planned work, never
publish secret values or private credentials, and update the relevant canonical
page when a route, migration, provider, or security boundary changes.

The latest audit and its residual TODOs are recorded in
[documentation-audit.md](documentation-audit.md).
