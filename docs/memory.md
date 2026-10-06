# Memory and chat tools

Decision record: [ADR-0033](adr/0033-memory-and-chat-tools.md).

Two things that work together:

- **Memory**: what a brand's team told Mellox to remember. Every generator
  follows it.
- **Chat tools**: chat reads the workspace's own data to answer, saves to
  memory by itself, and offers every change as a button.

## Flags

| Flag | Default | Off means |
| --- | --- | --- |
| `FEATURE_FLAG_MEMORY_ENABLED` (`_WS_<id>`) | on | Settings section and account-menu entry hidden, RPCs 404, chat saves nothing, generators get no block |
| `FEATURE_FLAG_CHAT_TOOLS_ENABLED` (`_WS_<id>`) | on | Chat is one plain reply with the older action tags |

A workspace also has its own switch (Settings → Memory → "Use memory"), which
an admin sets.

## Memory

### Data

`workspace_memories` (migration `20261014090000_workspace_memory.sql`):

| Column | Meaning |
| --- | --- |
| `body` | One sentence, 1–500 characters |
| `kind` | `rule`, `preference`, `fact`, `context` |
| `topic` | `visual`, `voice`, `content`, `audience`, `business`, `other` |
| `expires_at` | `NULL` = kept until removed; set = temporary |
| `status` | `active`, or `removed` (kept as a marker) |
| `source` | `chat`, `manual`, `import` (the background reader, the backfill) |
| `fingerprint` | Normalised text; unique per workspace |

Members read under RLS. Only the server writes.

### Rules (`src/lib/memory/`, pure)

- `decide.ts` `applyMemoryOps`: the only way a proposed change becomes a write.
  Limits are at the top of `contracts.ts` (200 per brand, 1 h – 7 days for a
  temporary one, 5 changes per reply).
- `block.ts` `memoryBlock`: the text a generator reads. A picture or a video
  only gets `visual` and `other`.
- `conformance.ts` `checkMemoryConformance`: a rule that names quoted words to
  avoid (`Never say "cheap"`) is checked against a caption. A hit adds a
  warning to the Studio job, which also holds it back in fully automatic mode.

### Server (`src/server/memory/`)

- `service.server.ts`: list, add, edit, remove, restore, clear, the switch,
  `applyOps`, `purgeExpiredMemories` (run from the existing `run-schedules`
  hook).
- `context.server.ts`: `memoryBlockFor(workspaceId, surface)`, `loadMemories`,
  `isMemoryOn`. Cached for 60 s and invalidated, with Studio's context, on
  every change.
- RPC `src/server/fns/memory.ts`; stubs `src/lib/memory.functions.ts`. Reading
  needs membership, changing needs editor, the switch and "Clear all" need
  admin.

### Who reads it

`loadStudioContext` (first in `brandText`, plus `visualBrandText` for pictures
and video), the chat route, the Coach briefing, strategy generation, UGC
concepts and notes, `/api/generate-image`, `/api/social-multi`,
`/api/ai-generate`, scheduled jobs and campaign briefs. Autopilot reads it
through `loadStudioContext`.

Adding a generator: call `memoryBlockFor` with the verified workspace id and
put the block near the top of the prompt. Do not fence it as untrusted data.

### Screens

- Settings → Memory and Account menu → Memory: `src/components/app/memory/`
  (`MemoryScreen` presentational, `MemoryPanel` wired, `use-memory.ts`).
- `/memory-lab` renders the screens and the chat note with sample data
  (`tests/integration/memory-lab.spec.ts`).

## Chat tools

### How a reply runs

`src/app/api/chat/route.ts` builds the prompt (brand context, memory with ids,
style, research, history), opens the first streamed completion, and hands it to
`chatReplyStream` (`src/server/chat/stream.server.ts`):

1. Words go straight to the browser.
2. If the model asked for tools, each one runs through `createChatTools`
   (`src/server/chat/tools.server.ts`).
3. The next round starts with what was found added as a system message. Up to
   three rounds use tools; a last one without tools writes the answer.
4. The stream ends with what the reply changed or offered:
   `data: {"mellox": {"memory" | "actions" | "offers": …}}`.

The browser stores those on the assistant message's `metadata`
(`src/lib/chat/events.ts`), so they are there after a reload.

### The three kinds of tool

| Kind | Examples | What happens when the model calls it |
| --- | --- | --- |
| Read | `list_content`, `get_pending_approvals`, `get_strategy`, `get_backlinks` | Runs now, as the person. Result is fenced as data. |
| Change | `schedule_content`, `review_content`, `start_geo_scan` | Nothing runs. A row is stored in `chat_actions` and a button appears. |
| Memory | `remember`, `update_memory`, `forget` | Runs now, through `applyMemoryOps`. |

Plus `open_in_mellox`, which only offers a button to a place.

The allow-lists are `CHAT_READ_TOOLS` and `CHAT_ACTION_TOOLS`. A test checks
that every read is `write: false` and every offered change is a real write.

### Buttons (`chat_actions`)

`runChatAction` (`src/server/chat/actions.server.ts`, RPC
`src/server/fns/chat-actions.ts`):

- reads the request from the stored row, never from the browser;
- checks the clicking person's role again;
- moves `offered → running` with a compare-and-set, so two clicks run once;
- runs the tool through the bridge with the person's own token, so plan,
  credits and approval rules apply as in the app;
- stores `done` with the result or `failed` with the reason.

A button is out of date after 24 hours. Something that removes or publishes
asks once more, in place.

### The "/" menu

`src/lib/chat/places.ts` lists every place in Mellox; `commands.ts` adds a few
common asks and does the matching. Picking one is the person's own click, so it
may open a place, fill the box or send. Add a place there and it appears in the
menu and becomes something a reply can offer.

## Live check

`tests/live/memory.live.ts` (real database; no model call).
