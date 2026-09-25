# Frontend architecture and UI system

## Composition

Pages under `src/app` provide route entry points and metadata. Client product
surfaces live mainly under `src/components/app`; shared layout, workspace, and
brand components live beside them. TanStack Query, theme state, navigation,
and progress UI are wired in `src/app/providers.tsx` and related `src/lib`
modules.

Workspace-aware UI reads identity from `WorkspaceProvider` and helpers in
`src/lib/workspace/paths.ts`. Query keys for workspace data must include the
workspace id so switching tenants cannot reuse another tenant's cache.

## Product UI model

The frontend is the editorial layer of the system. It presents the workspace,
its content, media, findings, and commands, but does not own the trust model or
execution path. This makes the UI simpler and safer: it reflects state from the
server, triggers validated actions, and surfaces the operational result back to
users with loading, empty, error, and success states.

## Design system

The repository uses Tailwind v4, Radix primitives, `lucide-react`, bespoke
icons from `src/components/icons`, Framer Motion, Recharts, and Sonner. Existing
Mellox patterns include `EmptyState`, `ErrorState`, `Skeleton`, and
`AppModalShell`. Preserve those patterns for new surfaces. Do not add a new
component library without an architectural reason.

## UI state contract

Every async feature should expose loading, empty, error, disabled/flag-off, and
success states. Mutations should invalidate the workspace-scoped query keys and
use app events where an existing event is defined. TODO: add a generated
component catalog and Storybook if the project adopts one; none was confirmed
in the audited repository.

## Accessibility and visual QA

Use semantic controls, visible focus states, accessible names, and stable
layouts. Run the Playwright visual suite and targeted integration tests for
user-facing changes. The visual scripts are defined in `package.json`.
