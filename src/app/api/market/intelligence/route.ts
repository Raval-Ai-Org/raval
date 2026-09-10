import { z } from "zod";
import { jsonError } from "@/server/api-auth";
import { requireWorkspaceAccess } from "@/lib/sdr.helpers.server";
import { analyzeMarketCollection, MarketIntelligenceError } from "@/lib/market-intelligence.server";
import { marketLog, operationId, withMarketTimeout } from "@/lib/market-reliability.server";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  workspaceId: z.string().uuid(),
  collectionId: z.string().uuid(),
  analysisType: z.string().trim().min(1).max(60).optional(),
});

export async function POST(request: Request) {
  const operation = operationId("market-intelligence");
  marketLog("intelligence API request received", { operation });
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return jsonError(400, "Invalid request body");
  }

  const access = await requireWorkspaceAccess(request, body.workspaceId);
  if (!access.ok) return access.response;

  try {
    const result = await withMarketTimeout(
      analyzeMarketCollection({
        collectionId: body.collectionId,
        workspaceId: body.workspaceId,
        analysisType: body.analysisType,
        operation,
      }),
      75_000,
      "Market intelligence request timed out",
    );
    marketLog("intelligence API response returned", { operation, state: result.state });
    return Response.json({ success: true, source: "market_intelligence", ...result });
  } catch (error) {
    if (error instanceof MarketIntelligenceError) {
      marketLog("intelligence API failed", { operation, code: error.code });
      return Response.json(
        { status: "failed", data: null, error: { message: error.message, code: error.code } },
        { status: error.status },
      );
    }
    marketLog("intelligence API failed", { operation, reason: error instanceof Error ? error.message : "unknown" });
    return Response.json(
      { status: "failed", data: null, error: { message: "Market intelligence service unavailable" } },
      { status: 502 },
    );
  }
}
