import { z } from "zod";
import { jsonError } from "@/server/api-auth";
import { defineRoute } from "@/server/route";
import { SsrfBlockedError } from "@/server/safe-fetch";
import { runAudit } from "@/lib/geo-audit.server";

export const dynamic = "force-dynamic";

const BodySchema = z.object({ url: z.string().min(1).max(2000) });

export const POST = defineRoute({
  name: "geo-audit",
  auth: "user",
  body: BodySchema,
  // Crawls five URLs on the target site per run.
  rateLimit: "audit",
  handler: async ({ body }) => {
    try {
      return await runAudit(body.url);
    } catch (error) {
      if (error instanceof SsrfBlockedError) return jsonError(400, error.message);
      if (error instanceof TypeError) return jsonError(400, "That URL is not valid.");
      throw error;
    }
  },
});
