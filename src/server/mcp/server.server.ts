// The MCP server itself: one per request (stateless), carrying the verified
// caller. It only lists the tools and hands each call to runTool.
import "server-only";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpCaller } from "./access.server";
import { MCP_TOOLS, runTool, toolInputShape } from "./registry.server";

const INSTRUCTIONS = `Mellox is an AI marketing platform. Each workspace is one brand or client.

How to work:
- Start with list_workspaces to get a workspaceId. If the person names a client, match it by name; if it is unclear which one they mean, ask.
- Read before you change. get_workspace_summary gives the overview; get_agency_summary covers every client.
- Content goes draft or pending, then approved, then scheduled, then published. Approval is the person's decision: approve, schedule or post only what they asked for. Nothing can be scheduled or posted before it is approved.
- Tools that create content or run research use the workspace's credits. Say so before starting something large.
- Every error has a code and a plain message. Tell the person what it says; do not retry a refused action in another way.
- A workspace whose assistantAccess is "off" or "read" is set that way by its admin in Mellox under Settings, AI assistants.`;

export function buildMcpServer(caller: McpCaller): McpServer {
  const server = new McpServer(
    { name: "mellox", version: "1.0.0" },
    { instructions: INSTRUCTIONS },
  );
  for (const tool of MCP_TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: toolInputShape(tool),
        annotations: {
          title: tool.title,
          readOnlyHint: !tool.write,
          destructiveHint: Boolean(tool.destructive),
          idempotentHint: !tool.write,
          // Posting and scheduling reach social networks; the rest stays in Mellox.
          openWorldHint: tool.name === "publish_content_now" || tool.name === "schedule_content",
        },
      },
      async (args: unknown) => {
        const result = await runTool(tool, args, caller);
        const body = result.ok ? result.data : { error: result.error };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(body) }],
          structuredContent: body,
          isError: !result.ok,
        };
      },
    );
  }
  return server;
}
