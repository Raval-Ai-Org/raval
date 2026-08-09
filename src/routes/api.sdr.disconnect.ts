// POST /api/sdr/disconnect — disconnect a connected account (FR-003).
import { createFileRoute } from "@tanstack/react-router";
import { jsonError } from "@/server/api-auth";
import { requireWorkspaceAccess, getWorkspaceSdrKey } from "@/lib/sdr.helpers.server";
import { disconnectHandler } from "@/lib/sdr.handlers";

export const Route = createFileRoute("/api/sdr/disconnect")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { workspaceId?: unknown; accountId?: unknown };
        try {
          body = await request.json();
        } catch {
          return jsonError(400, "Invalid request body");
        }
        const ws = await requireWorkspaceAccess(request, body.workspaceId);
        if (!ws.ok) return ws.response;

        try {
          const token = await getWorkspaceSdrKey(ws.workspaceId);
          const baseUrl = process.env.SDR_BASE_URL ?? "";
          const out = await disconnectHandler(String(body.accountId ?? ""), { sdrBaseUrl: baseUrl, token });
          return Response.json(out.body, { status: out.status });
        } catch (e) {
          return jsonError(503, e instanceof Error ? e.message : "SDR provisioning failed");
        }
      },
    },
  },
});
