// POST /api/sdr/disconnect — disconnect a connected account (FR-003).
import { jsonError } from "@/server/api-auth";
import { requireWorkspaceAccess, getWorkspaceSdrKey } from "@/lib/sdr.helpers.server";
import { disconnectHandler } from "@/lib/sdr.handlers";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
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
    const out = await disconnectHandler(String(body.accountId ?? ""), {
      sdrBaseUrl: baseUrl,
      token,
    });
    return Response.json(out.body, { status: out.status });
  } catch (e) {
    return jsonError(503, e instanceof Error ? e.message : "SDR provisioning failed");
  }
}
