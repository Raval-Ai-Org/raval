// POST /api/geo/scans — start an AI Visibility scan.
//   mode "quick": the homepage, scored inline (the response carries the result)
//   mode "full":  a site crawl up to the plan's page cap, continued in the
//                 background; poll GET /api/geo/scans/:id for progress
import { z } from "zod";
import { jsonError } from "@/server/api-auth";
import { defineRoute } from "@/server/route";
import {
  createScan,
  driveScan,
  GeoScanConflictError,
  kickScan,
  loadScanView,
} from "@/server/geo/service.server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BodySchema = z.object({
  workspaceId: z.string().uuid(),
  url: z.string().trim().min(1).max(2000),
  mode: z.enum(["quick", "full"]).default("full"),
  trigger: z.enum(["manual", "chat", "rescan"]).default("manual"),
  probes: z.boolean().optional(),
  idempotencyKey: z.string().min(8).max(100).optional(),
});

export const POST = defineRoute({
  name: "geo/scans:create",
  auth: "workspace",
  minRole: "editor",
  body: BodySchema,
  workspaceId: ({ body }) => body.workspaceId,
  // A quick check fetches a handful of URLs; a site scan fetches hundreds.
  rateLimit: ({ body }) => ({ tier: body.mode === "quick" ? "audit" : "geo-scan" }),
  handler: async ({ body, workspaceId, userId, supabase }) => {
    let scanId: string;
    let mode: "quick" | "full" | "targeted";
    try {
      const scan = await createScan({
        workspaceId,
        userId,
        url: body.url,
        mode: body.mode,
        trigger: body.trigger,
        probes: body.probes,
        idempotencyKey: body.idempotencyKey,
      });
      scanId = scan.id;
      mode = scan.mode;
    } catch (error) {
      if (error instanceof GeoScanConflictError) {
        return Response.json(
          { error: error.message, activeScanId: error.activeScanId },
          { status: 409 },
        );
      }
      if (error instanceof TypeError) return jsonError(400, "That URL is not valid.");
      throw error;
    }

    if (mode === "quick") await driveScan(scanId, { budgetMs: 45_000 });
    else kickScan(scanId);

    const scan = await loadScanView(supabase, workspaceId, scanId, { resume: mode === "quick" });
    return Response.json({ scan }, { status: 201 });
  },
});
