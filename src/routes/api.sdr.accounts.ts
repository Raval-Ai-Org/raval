// GET /api/sdr/accounts — list the workspace's connected accounts (FR-002).
// Tokens are never exposed. Provisions on first use (G3rd-7) so a fresh
// workspace returns a clean empty list rather than an error.
import { createFileRoute } from "@tanstack/react-router";
import { jsonError } from "@/server/api-auth";
import { requireWorkspaceAccess, getWorkspaceSdrKey } from "@/lib/sdr.helpers.server";
import { listAccountsHandler } from "@/lib/sdr.handlers";

export const Route = createFileRoute("/api/sdr/accounts")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const workspaceId = url.searchParams.get("workspaceId");
        const ws = await requireWorkspaceAccess(request, workspaceId);
        if (!ws.ok) return ws.response;

        try {
          const token = await getWorkspaceSdrKey(ws.workspaceId);
          const baseUrl = process.env.SDR_BASE_URL ?? "";
          const out = await listAccountsHandler({ sdrBaseUrl: baseUrl, token });
          return Response.json(out.body, { status: out.status });
        } catch (e) {
          return jsonError(503, e instanceof Error ? e.message : "SDR provisioning failed");
        }
      },
    },
  },
});
