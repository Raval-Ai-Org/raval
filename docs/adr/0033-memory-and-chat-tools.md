# ADR-0033: Memory, and a chat that can read and act

- **Status:** accepted
- **Date:** 2026-10-06
- **Builds on:** ADR-0014 (workspaces), ADR-0026 (models), ADR-0029 (MCP server),
  ADR-0032 (Brain)
- **Reference:** [docs/memory.md](../memory.md)

## Context

Chat already "remembered" things, in two places that did not agree. An approved
`[[action:save-memory]]` tag wrote to `BrandDna.userInsights`, which reached the
chat prompt only through the browser and reached no generator at all. A
background reader wrote to `memory_insights`, which Studio read five rows of. A
person who said "don't use this colour again" in chat was forgotten by
everything that makes content. Nothing could be edited, switched off or given
an end date.

Chat also could not see the workspace. It emitted twelve fixed tags and guessed
at anything it was asked about posts, the calendar, Autopilot or scans.

## Decision

### 1. One memory per brand, on the server

`workspace_memories` holds what a brand's team told Mellox to remember. It is
shared by the workspace's members, read by members under RLS and written only
by the server after a role check. `workspace_memory_settings` is the brand's
own switch.

A memory is one sentence with a kind (`rule`, `preference`, `fact`, `context`),
a topic that decides which generators it matters to, and an optional end. A
memory with no end is kept until removed. A **temporary** memory ends by itself
(an hour to a week, a day by default) and `context` is always temporary: it is
what the team is working on now.

### 2. The model proposes, pure code decides

Every change from chat or the background reader goes through `applyMemoryOps`
(`src/lib/memory/decide.ts`): nothing is saved twice, updates and removals only
touch memories that exist, secrets and private details are refused, a brand
holds at most 200, and a memory a person removed stays as a marker so the
background reader never brings it back. A person saying it again does.

### 3. Every generator reads it through one helper

`memoryBlockFor(workspaceId, surface)` returns one short block: rules first,
temporary ones under their own line, cut from the least important end. It is
cached for a minute, dropped on every change, and fails open. Studio, chat, the
Coach, strategy, Autopilot's plan, video ads, the image and quick-generate
routes, schedules and campaign briefs all call it with the verified workspace
id.

Memory is the team's own words, so it is **not** fenced as untrusted data: a
generator is meant to follow it. Instead a memory that reads like an attempt to
steer the model is refused when it is written, and each line is defanged again
when it is read.

### 4. Chat saves by itself and says so

In chat the model calls `remember`, `update_memory` or `forget` in the same
reply. Nothing asks first. The reply carries a "Memory updated" note with Undo
and Manage. This replaces the approval card: a memory is cheap to undo, visible
in one place, and a prompt on every save made people stop using it.

### 5. Chat reads by itself; a change is always a button

Chat is given the same tools AI assistants use over MCP, split in two:

- **Reads** (an explicit allow-list of `write: false` tools) run when the model
  asks, with the person's own access.
- **Changes** never run for the model. Asking for one stores the exact request
  in `chat_actions` and shows a button. A click runs it once, as the person who
  clicked, through the same server function the app calls.

Chat does not go through the MCP wrapper: that is a workspace's switch for
outside assistants. It has its own flag and its own allow-lists.

### 6. Rounds without replay

A reply is one or more streamed completions. When the model asks for tools they
run, and the next round starts fresh with the results added as reference data.
The model's own tool-call turn is never replayed, so there is no reasoning to
carry between rounds and the loop behaves the same on every tier. The last
round has no tools, so a reply always ends in words.

## Consequences

- `BrandDna.userInsights` is no longer read or written. Existing ones and the
  chat-written `memory_insights` rows are carried over once by the migration.
  `memory_insights` stays for the other signals it holds.
- Not offered from chat, on purpose: creating or deleting workspaces, starting
  or stopping Autopilot, rewriting Brand DNA wholesale, website fixes, billing,
  team and roles, connecting accounts and buying backlinks.
- A failed button stays failed. Asking again makes a new one, so nothing with
  an unknown outcome is retried blindly.
- A reply that looks things up costs more model calls than one that does not.
  It is still one chat message on the bill, bounded by three tool rounds and
  eight tool calls.
- The four strategy/audience/look blocks are unchanged; memory is a fifth.

## Verification

Unit tests for the rules (`src/lib/memory/memory.test.ts`), the tool
allow-lists and the reply loop (`src/server/chat/*.test.ts`), the "/" menu and
schema conversion (`src/lib/chat/chat.test.ts`); `/memory-lab` and
`tests/integration/memory-lab.spec.ts` for the screens; `tests/live/memory.live.ts`
against the real database.
