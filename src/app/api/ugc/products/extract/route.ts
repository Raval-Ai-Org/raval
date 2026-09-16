// POST /api/ugc/products/extract — read a product page (SSRF-guarded) and
// return grounded product facts for a new UGC ad.
import { ExtractProductBody } from "@/lib/ugc/schemas";
import { defineRoute } from "@/server/route";
import { extractProduct } from "@/server/ugc/product-extract.server";
import { assertUgcEnabled } from "@/server/ugc/route-helpers";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

export const POST = defineRoute({
  name: "ugc/products:extract",
  auth: "workspace",
  minRole: "editor",
  body: ExtractProductBody,
  workspaceId: ({ body }) => body.workspaceId,
  rateLimit: "ugc-draft",
  handler: async ({ body, workspaceId }) => {
    assertUgcEnabled(workspaceId);
    return extractProduct(body.url);
  },
});
