import "server-only";
import { createServerFn } from "@/server/server-fn";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { rateLimitFor } from "@/server/rate-limit";
import type { ServerFnContext } from "@/server/server-fn";
import type { WorkspaceRole } from "@/server/api-auth";
import {
  MEMORY_KINDS,
  MEMORY_MAX_CHARS,
  MEMORY_TOPICS,
  TEMP_MAX_HOURS,
  TEMP_MIN_HOURS,
  type MemoryChange,
  type MemoryView,
} from "@/lib/memory/contracts";

// Memory (ADR-0033, src/server/memory/). Reading needs membership; adding,
// editing and removing need editor; the switch and "clear all" need admin.
// Included with every plan: nothing here calls a model.

const uuid = z.string().uuid();
const ws = { workspaceId: uuid };
const body = z.string().trim().min(1).max(MEMORY_MAX_CHARS);
const hours = z.number().min(TEMP_MIN_HOURS).max(TEMP_MAX_HOURS).nullable();
const svc = () => import("@/server/memory/service.server");

async function caller(context: ServerFnContext, workspaceId: string, minRole: WorkspaceRole) {
  const service = await svc();
  service.assertMemoryEnabled(workspaceId);
  const { requireWorkspaceRole } = await import("@/server/workspace-access.server");
  const role = await requireWorkspaceRole(context, workspaceId, minRole);
  return { workspaceId, userId: context.userId, role };
}

/** Whether memory exists for this workspace at all. Never 404s, so the UI can hide itself. */
export const getMemoryStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object(ws).parse(data))
  .handler(async ({ data, context }): Promise<{ available: boolean }> => {
    const { isMemoryEnabled } = await import("@/lib/feature-flags");
    if (!isMemoryEnabled(data.workspaceId)) return { available: false };
    const { requireWorkspaceRole } = await import("@/server/workspace-access.server");
    await requireWorkspaceRole(context, data.workspaceId, "viewer");
    return { available: true };
  });

export const getMemory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object(ws).parse(data))
  .handler(async ({ data, context }): Promise<MemoryView> => {
    const c = await caller(context, data.workspaceId, "viewer");
    return (await svc()).getMemoryView(c);
  });

export const addMemory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("memory-write")])
  .inputValidator((data) =>
    z
      .object({
        ...ws,
        body,
        kind: z.enum(MEMORY_KINDS).optional(),
        topic: z.enum(MEMORY_TOPICS).optional(),
        hours: hours.optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<MemoryView> => {
    const c = await caller(context, data.workspaceId, "editor");
    const service = await svc();
    await service.addMemory(c, data);
    return service.getMemoryView(c);
  });

export const editMemory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("memory-write")])
  .inputValidator((data) =>
    z
      .object({
        ...ws,
        id: uuid,
        body: body.optional(),
        kind: z.enum(MEMORY_KINDS).optional(),
        topic: z.enum(MEMORY_TOPICS).optional(),
        hours: hours.optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<MemoryView> => {
    const c = await caller(context, data.workspaceId, "editor");
    const service = await svc();
    await service.editMemory(c, data);
    return service.getMemoryView(c);
  });

export const removeMemory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("memory-write")])
  .inputValidator((data) => z.object({ ...ws, id: uuid }).parse(data))
  .handler(async ({ data, context }): Promise<MemoryView> => {
    const c = await caller(context, data.workspaceId, "editor");
    const service = await svc();
    await service.removeMemory(c, data.id);
    return service.getMemoryView(c);
  });

/** Undo for a removal. */
export const restoreMemory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("memory-write")])
  .inputValidator((data) => z.object({ ...ws, id: uuid }).parse(data))
  .handler(async ({ data, context }): Promise<MemoryView> => {
    const c = await caller(context, data.workspaceId, "editor");
    const service = await svc();
    await service.restoreMemory(c, data.id);
    return service.getMemoryView(c);
  });

export const clearMemory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("memory-write")])
  .inputValidator((data) => z.object({ ...ws, confirm: z.literal("CLEAR") }).parse(data))
  .handler(async ({ data, context }): Promise<MemoryView> => {
    const c = await caller(context, data.workspaceId, "admin");
    const service = await svc();
    await service.clearMemories(c);
    return service.getMemoryView(c);
  });

export const setMemoryEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("memory-write")])
  .inputValidator((data) => z.object({ ...ws, enabled: z.boolean() }).parse(data))
  .handler(async ({ data, context }): Promise<MemoryView> => {
    const c = await caller(context, data.workspaceId, "admin");
    const service = await svc();
    await service.setEnabled(c, data.enabled);
    return service.getMemoryView(c);
  });

/**
 * What the background reader (src/lib/memory-sync.ts) noticed in a chat. They
 * are proposals: the rules in src/lib/memory/decide.ts decide, and a memory a
 * person removed is never brought back this way.
 */
export const proposeMemories = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("memory-write")])
  .inputValidator((data) =>
    z
      .object({
        ...ws,
        items: z.array(z.object({ text: z.string().trim().min(1).max(1200) })).max(10),
        conversationId: uuid.nullable().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<{ changes: MemoryChange[] }> => {
    const { isMemoryEnabled } = await import("@/lib/feature-flags");
    if (!isMemoryEnabled(data.workspaceId)) return { changes: [] };
    const { requireWorkspaceRole } = await import("@/server/workspace-access.server");
    const role = await requireWorkspaceRole(context, data.workspaceId, "editor");
    const changes = await (
      await svc()
    ).applyOps(
      { workspaceId: data.workspaceId, userId: context.userId, role },
      data.items.map((item) => ({ op: "add" as const, text: item.text })),
      { source: "import", conversationId: data.conversationId ?? null },
    );
    return { changes };
  });
