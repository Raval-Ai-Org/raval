# Workspaces, Brand DNA, and memory

## Workspace identity

A workspace is the tenant boundary and the canonical source of brand identity.
Workspace pages use `/w/<id>/app/...`; path helpers live in
`src/lib/workspace/paths.ts`. Components read identity through
`WorkspaceProvider`. Never select a workspace by first, newest, or last-created
row. `workspace:last-opened` is only a UI highlight.

Workspace creation, listing, and deletion are centralized in
`src/server/workspaces/service.server.ts` and the workspace RPCs. Deletion is
owner-only and requires explicit confirmation.

## Brand DNA

Brand DNA is stored in `workspace_brand_dna` and accessed through the Brand DNA
server functions/hooks. AI requests load it for the verified workspace. Scraped
or user-provided context is treated as data, not instructions, before entering
prompts.

## Memory

Conversation state uses `conversations` and `chat_messages`; extraction and
insight paths also use memory-related services and `memory_insights`. The exact
retention policy is not established by the audited code: **TODO: document
retention, deletion, export, and user-visible controls after product/legal
confirmation**.

## Workspace change checklist

Any feature that reads or writes workspace data must accept an explicit id,
include it in query keys, verify membership/role, and save async results to the
id captured at request start. On switching workspaces, the provider removes
workspace-scoped cached queries.
