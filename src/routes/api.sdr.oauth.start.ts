// POST /api/sdr/oauth/start — proxy OAuth connect/reconnect to the SDR (FR-001/FR-004).
import { createFileRoute } from "@tanstack/react-router";
import { jsonError } from "@/server/api-auth";
import { requireWorkspaceAccess, getWorkspaceSdrKey } from "@/lib/sdr.helpers.server";
import { oauthStartHandler } from "@/lib/sdr.handlers";

export const Route = createFileRoute("/api/sdr/oauth/start")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { workspaceId?: unknown; platform?: unknown };
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
          const out = await oauthStartHandler(String(body.platform ?? ""), {
            sdrBaseUrl: baseUrl,
            token,
          });
          return Response.json(out.body, { status: out.status });
        } catch (e) {
          return jsonError(503, e instanceof Error ? e.message : "SDR provisioning failed");
        }
      },
    },
  },
});
