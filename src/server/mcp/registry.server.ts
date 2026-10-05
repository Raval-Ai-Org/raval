// Every MCP tool, and the one wrapper each call goes through:
//   validate → access (member, role, workspace switch) → rate limit → run →
//   record. A tool never runs outside this wrapper.
import "server-only";
import { z } from "zod";
import { isMcpEnabled } from "@/lib/feature-flags";
import { recordAudit } from "@/server/audit.server";
import { consumeRateLimit, RateLimitedError } from "@/server/rate-limit";
import { runWithScope } from "@/server/request-context";
import { requireMcpWorkspace, type McpCaller } from "./access.server";
import { McpError, toMcpError, type McpErrorBody } from "./errors.server";
import { recordToolCall } from "./settings.server";
import { asObject, cleanOutput, workspaceIdInput, type McpTool } from "./tool";
import { audienceTools } from "./tools/audience";
import { autopilotTools } from "./tools/autopilot";
import { contentTools } from "./tools/content";
import { geoTools } from "./tools/geo";
import { intelligenceTools } from "./tools/intelligence";
import { workspaceTools } from "./tools/workspaces";

export const MCP_TOOLS: readonly McpTool[] = [
  ...workspaceTools,
  ...contentTools,
  ...autopilotTools,
  ...audienceTools,
  ...intelligenceTools,
  ...geoTools,
];

export function toolInputShape(tool: McpTool): z.ZodRawShape {
  return tool.scope === "workspace" ? { ...workspaceIdInput, ...tool.input } : tool.input;
}

export type ToolResult =
  { ok: true; data: Record<string, unknown> } | { ok: false; error: McpErrorBody };

/** Identifiers only: which things a call named, never what they contain. */
function summarize(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (key === "workspaceId") continue;
    if (/Id$/.test(key) && typeof value === "string") out[key] = value;
    else if (/Ids$/.test(key) && Array.isArray(value)) out[key] = value.slice(0, 25);
    else if (typeof value === "boolean" || typeof value === "number") out[key] = value;
    else if (typeof value === "string" && value.length <= 40 && !/\s/.test(value)) out[key] = value;
    else if (key === "items" && Array.isArray(value)) out.items = value.length;
  }
  return out;
}

export async function runTool(
  tool: McpTool,
  rawArgs: unknown,
  caller: McpCaller,
): Promise<ToolResult> {
  const started = Date.now();
  let workspaceId: string | null = null;
  let args: Record<string, unknown> = {};
  let result: ToolResult;
  try {
    if (!isMcpEnabled()) throw new McpError("mcp_disabled", "AI assistant access is switched off.");
    args = z.object(toolInputShape(tool)).parse(rawArgs ?? {}) as Record<string, unknown>;

    let role = tool.minRole;
    if (tool.scope === "workspace") {
      const access = await requireMcpWorkspace(caller, args.workspaceId, tool.minRole, {
        write: tool.write,
      });
      workspaceId = access.workspaceId;
      role = access.role;
    }

    const tier = tool.write ? "mcp-write" : "mcp-read";
    const limit = await consumeRateLimit(tier, `${caller.userId}:${workspaceId ?? "account"}`);
    if (!limit.ok) throw new RateLimitedError(tier, limit);

    const data = await runWithScope(
      // No metering label here: the function behind the tool sets its own.
      { userId: caller.userId, workspaceId: workspaceId ?? undefined },
      () => tool.run(args, { caller, workspaceId: workspaceId ?? "", role }),
    );
    result = { ok: true, data: asObject(cleanOutput(data)) };
  } catch (error) {
    result = { ok: false, error: toMcpError(error) };
  }

  const summary = summarize(args);
  await recordToolCall({
    workspaceId,
    userId: caller.userId,
    clientId: caller.clientId,
    tool: tool.name,
    isWrite: tool.write,
    ok: result.ok,
    errorCode: result.ok ? null : result.error.code,
    durationMs: Date.now() - started,
    summary,
  });
  // Changes also go on the workspace's own audit trail, next to the app's.
  if (tool.write && result.ok && workspaceId) {
    await recordAudit({
      workspaceId,
      userId: caller.userId,
      action: `mcp.${tool.name}`,
      entity: String(Object.values(summary).find((v) => typeof v === "string") ?? workspaceId),
      payload: { ...summary, client: caller.clientId },
    });
  }
  return result;
}
