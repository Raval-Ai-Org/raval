# Product flows and onboarding

## Sign in to workspace

The user enters through `/login` or `/signup`, completes Supabase auth, and is
sent to `/projects`. Workspace pages are then rooted at `/w/<workspaceId>/app`.
The workspace provider supplies the explicit id to app surfaces and queries.

## Create and ground a brand

A workspace is created/listed through workspace services. Brand DNA is captured
and persisted for that workspace, then loaded by brand-grounded AI flows. The
server remains the authority for the selected workspace and brand identity.

## Create, review, and distribute

Users work in chat, Studio, or library/content surfaces; generated work is
persisted and can require approval. Publishing/scheduling routes verify role,
content ownership, destination accounts, provider status, and plan credits.
Delivery is asynchronous and visible through publication state, webhooks, and
reconciliation.

## Improve visibility

A user starts a GEO scan, receives server-computed findings and dimensions,
reviews deterministic fixes or agent proposals, and uses repository PR/approval
flows where a connected source owns the target host. A verification scan is
required before a finding is resolved.

## Operating pattern across the product

Across the main product workflows, the common pattern is consistent:

- user action triggers a workspace-scoped request
- the server validates authorization, input, and provider state
- the work is executed through a server-side service or gateway
- results are stored and surfaced back to the UI
- approval, verification, or reconciliation gates decide what becomes final

This pattern is what makes Mellox AI operationally different from a general
chat experience: it is designed to move work from idea to execution with
controlled review and measurable evidence.

TODO: document the product's final onboarding checklist, user-facing plan names,
and supported invitation lifecycle after confirming the current UI and product
requirements.
