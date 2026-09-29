import "server-only";
import { getDistributionProviderForWorkspace } from "@/lib/feature-flags";
import {
  distributionErrorResponse,
  type HandlerResult,
  type SocialApiDeps,
} from "@/lib/postforme/handlers";
import { getPostForMeDeps } from "@/lib/postforme/workspace.server";

export async function withPostForMe(
  workspaceId: string,
  run: (deps: SocialApiDeps) => Promise<HandlerResult>,
): Promise<Response> {
  if (getDistributionProviderForWorkspace(workspaceId) !== "postforme") {
    return Response.json(
      { error: { code: "DISTRIBUTION_DISABLED", detail: "Post for Me is not configured" } },
      { status: 503 },
    );
  }
  try {
    const out = await run(getPostForMeDeps(workspaceId));
    return out.status === 204
      ? new Response(null, { status: 204 })
      : Response.json(out.body, { status: out.status });
  } catch (e) {
    const out = distributionErrorResponse(e);
    return Response.json(out.body, { status: out.status });
  }
}
