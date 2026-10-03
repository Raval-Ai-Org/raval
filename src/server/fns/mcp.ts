import "server-only";
import { createServerFn } from "@/server/server-fn";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { roleAtLeast } from "@/server/api-auth";
import { HttpError } from "@/server/http-error";
import { requireWorkspaceRole } from "@/server/workspace-access.server";

// Settings → AI assistants (ADR-0029, src/server/mcp/). Members can see
// whether assistants are allowed; turning it on, allowing changes and reading
// the activity need admin. With the flag off everything answers 404.

const uuid = z.string().uuid();

async function assertOn(workspaceId: string) {
  const { isMcpEnabled } = await import("@/lib/feature-flags");
  if (!isMcpEnabled(workspaceId)) throw new HttpError(404, "Not found");
}

export const getMcpSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ workspaceId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    await assertOn(data.workspaceId);
    const role = await requireWorkspaceRole(context, data.workspaceId, "viewer");
    const { getMcpSettings: read } = await import("@/server/mcp/settings.server");
    const { getAppUrl } = await import("@/server/env");
    const { MCP_TOOLS } = await import("@/server/mcp/registry.server");
    return {
      ...(await read(data.workspaceId)),
      canManage: roleAtLeast(role, "admin"),
      serverUrl: `${getAppUrl()}/api/mcp`,
      tools: MCP_TOOLS.map((t) => ({ title: t.title, write: t.write })),
    };
  });

export const updateMcpSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ workspaceId: uuid, enabled: z.boolean(), allowWrites: z.boolean() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertOn(data.workspaceId);
    await requireWorkspaceRole(context, data.workspaceId, "admin");
    const { updateMcpSettings: write } = await import("@/server/mcp/settings.server");
    return write({ ...data, userId: context.userId });
  });

export const listMcpActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ workspaceId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    await assertOn(data.workspaceId);
    await requireWorkspaceRole(context, data.workspaceId, "admin");
    const { listMcpActivity: list } = await import("@/server/mcp/settings.server");
    const { MCP_TOOLS } = await import("@/server/mcp/registry.server");
    const titles = new Map(MCP_TOOLS.map((t) => [t.name, t.title]));
    return (await list(data.workspaceId, 20)).map((item) => ({
      ...item,
      title: titles.get(item.tool) ?? item.tool,
    }));
  });
