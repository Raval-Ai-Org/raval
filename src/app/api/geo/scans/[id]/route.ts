// GET /api/geo/scans/:id?workspaceId= — scan status, progress and report.
// Reading a scan whose worker lease expired resumes it (see service.server.ts).
import { z } from "zod";
import { jsonError, UUID_RE } from "@/server/api-auth";
import { defineRoute } from "@/server/route";
import { loadScanView } from "@/server/geo/service.server";

export const dynamic = "force-dynamic";

function scanIdFrom(request: Request): string | null {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  const id = parts[parts.indexOf("scans") + 1];
  return id && UUID_RE.test(id) ? id : null;
}

export const GET = defineRoute({
  name: "geo/scans:get",
  auth: "workspace",
  query: z.object({ workspaceId: z.string().uuid() }),
  workspaceId: ({ query }) => query.workspaceId,
  handler: async ({ request, workspaceId, supabase }) => {
    const id = scanIdFrom(request);
    if (!id) return jsonError(400, "Invalid scan id");
    const scan = await loadScanView(supabase, workspaceId, id, { resume: true });
    if (!scan) return jsonError(404, "Scan not found");
    return { scan };
  },
});
