// /api/agents/settings — the workspace kill switch.
//   GET  ?workspaceId=                                → settings + tool catalog
//   POST { workspaceId, agentsPaused?, disabledWorkers? }   (owner/admin only)
import { z } from "zod";
import { jsonError } from "@/server/api-auth";
import { defineRoute } from "@/server/route";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { agentsGloballyDisabled } from "@/server/agents/policy";
import { listTools } from "@/server/agents/registry";
import { WORKERS } from "@/server/agents/workers";

export const dynamic = "force-dynamic";

export const GET = defineRoute({
  name: "agents/settings.get",
  auth: "workspace",
  query: z.object({ workspaceId: z.string().optional() }),
  workspaceId: ({ query }) => query.workspaceId,
  handler: async ({ workspaceId, supabase, role }) => {
    const { data, error } = await supabase
      .from("workspace_agent_settings")
      .select("agents_paused, disabled_workers, updated_at")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (error) return jsonError(500, error.message);
    return {
      agentsPaused: Boolean(data?.agents_paused),
      disabledWorkers: data?.disabled_workers ?? [],
      globallyDisabled: agentsGloballyDisabled(),
      canManage: role === "owner" || role === "admin",
      canAct: role !== "viewer",
      workers: Object.values(WORKERS).map((w) => ({ name: w.name, objective: w.objective })),
      tools: listTools(),
    };
  },
});

export const POST = defineRoute({
  name: "agents/settings.update",
  auth: "workspace",
  minRole: "admin",
  body: z.object({
    workspaceId: z.string(),
    agentsPaused: z.boolean().optional(),
    disabledWorkers: z.array(z.enum(["distribution-reliability", "content-fit"])).optional(),
  }),
  workspaceId: ({ body }) => body.workspaceId,
  handler: async ({ body, workspaceId, userId }) => {
    if (body.agentsPaused === undefined && body.disabledWorkers === undefined)
      return jsonError(400, "Choose a setting to update");
    const { data: current, error: readError } = await supabaseAdmin
      .from("workspace_agent_settings")
      .select("agents_paused, disabled_workers")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (readError) return jsonError(500, readError.message);
    const row: Record<string, unknown> = {
      workspace_id: workspaceId,
      updated_by: userId,
      updated_at: new Date().toISOString(),
      agents_paused: body.agentsPaused ?? current?.agents_paused ?? false,
      disabled_workers: body.disabledWorkers ?? current?.disabled_workers ?? [],
    };
    const { data, error } = await supabaseAdmin
      .from("workspace_agent_settings")
      .upsert(row as never, { onConflict: "workspace_id" })
      .select("agents_paused, disabled_workers")
      .single();
    if (error) return jsonError(500, error.message);
    return { agentsPaused: data.agents_paused, disabledWorkers: data.disabled_workers };
  },
});
