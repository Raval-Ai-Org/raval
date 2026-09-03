// POST /api/sdr/cancel — cancel a scheduled item before it fires (FR-009).
import { jsonError } from "@/server/api-auth";
import { requireWorkspaceAccess, getWorkspaceSdrKey } from "@/lib/sdr.helpers.server";
import { cancelScheduledHandler } from "@/lib/sdr.handlers";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Invalid request body");
  }
  const ws = await requireWorkspaceAccess(request, body?.workspaceId);
  if (!ws.ok) return ws.response;
  if (typeof body?.contentItemId !== "string") return jsonError(400, "contentItemId required");

  try {
    const token = await getWorkspaceSdrKey(ws.workspaceId);
    const baseUrl = process.env.SDR_BASE_URL ?? "";
    const out = await cancelScheduledHandler(
      { workspaceId: ws.workspaceId, contentItemId: body.contentItemId },
      { sdrBaseUrl: baseUrl, token, db: supabaseAdmin },
    );
    return Response.json(out.body, { status: out.status });
  } catch (e) {
    return jsonError(503, e instanceof Error ? e.message : "SDR cancel failed");
  }
}
