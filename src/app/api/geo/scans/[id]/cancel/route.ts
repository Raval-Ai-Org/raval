// POST /api/geo/scans/:id/cancel — stop a queued or running scan. Pages
// already analyzed are kept; the scan ends in "cancelled" without a score.
import { z } from "zod";
import { jsonError, UUID_RE } from "@/server/api-auth";
import { defineRoute } from "@/server/route";
import { loadScanView, requestCancel } from "@/server/geo/service.server";

export const dynamic = "force-dynamic";

function scanIdFrom(request: Request): string | null {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  const id = parts[parts.indexOf("scans") + 1];
  return id && UUID_RE.test(id) ? id : null;
}

export const POST = defineRoute({
  name: "geo/scans:cancel",
  auth: "workspace",
  minRole: "editor",
  body: z.object({ workspaceId: z.string().uuid() }),
  workspaceId: ({ body }) => body.workspaceId,
  handler: async ({ request, workspaceId, supabase }) => {
    const id = scanIdFrom(request);
    if (!id) return jsonError(400, "Invalid scan id");
    const cancelled = await requestCancel(workspaceId, id);
    if (!cancelled) return jsonError(409, "This scan has already finished.");
    return { scan: await loadScanView(supabase, workspaceId, id) };
  },
});
