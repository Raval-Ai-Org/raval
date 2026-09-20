# Component reference

## Shared primitives

Look in `src/components/ui` and `src/components/icons` for the existing visual
and icon primitives. Radix components provide accessible dialog, menu, tabs,
select, progress, switch, tooltip, and alert behavior.

## Product components

- `src/components/app`: chat, library, Studio, analytics, social, workspace, and product panels.
- `src/components/app/geo`: GEO dashboard, findings, fixes, readiness, and agent panels.
- `src/components/app/connectors`: GitHub/source connector setup and status.
- `src/components/workspace`: provider and workspace-aware context.
- `src/components/brand`: Mellox brand identity and logo components.

## Contribution rules

Prefer an existing primitive and product pattern before adding a new abstraction.
Components that read workspace data should use workspace hooks and query keys;
components that mutate server state should use the existing function/route
client. Add loading, empty, error, disabled, and success states. Keep server
modules out of client runtime imports; use type-only imports at the boundary.

TODO: generate a prop/event catalog from the TypeScript source if a public
component API is needed; this repository does not currently expose Storybook
or an equivalent catalog.
