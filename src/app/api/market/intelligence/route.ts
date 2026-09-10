import { z } from "zod";
import { jsonError } from "@/server/api-auth";
import { requireWorkspaceAccess } from "@/lib/sdr.helpers.server";
import { analyzeMarketCollection, MarketIntelligenceError } from "@/lib/market-intelligence.server";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  workspaceId: z.string().uuid(),
  collectionId: z.string().uuid(),
  analysisType: z.string().trim().min(1).max(60).optional(),
});

export async function POST(request: Request) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return jsonError(400, "Invalid request body");
  }

  const access = await requireWorkspaceAccess(request, body.workspaceId);
  if (!access.ok) return access.response;

  try {
    const result = await analyzeMarketCollection({
      collectionId: body.collectionId,
      workspaceId: body.workspaceId,
      analysisType: body.analysisType,
    });
    return Response.json({ success: true, source: "market_intelligence", ...result });
  } catch (error) {
    if (error instanceof MarketIntelligenceError) {
      return jsonError(error.status, error.message);
    }
    console.error("[market/intelligence] unexpected error", error);
    return jsonError(502, "Market intelligence service unavailable");
  }
}
