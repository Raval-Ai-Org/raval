import "server-only";
import { createMiddleware } from "@/server/middleware";
import { getRequest, setRequestScope } from "@/server/request-context";
import { checkWorkspaceMembership, UUID_RE, verifyBearer } from "@/server/api-auth";

// Server-function middleware: validates the Bearer token and contributes the
// caller's RLS-bound Supabase client to the handler context. Failures throw
// "Unauthorized: …", which the /api/rpc route maps to 401.
//
// It also records the caller in the request scope, plus the optional
// `x-workspace-id` attribution header once membership is verified — the same
// rule as the /api kernel — so usage metering and budgets see who is spending
// on whose behalf.
export const requireSupabaseAuth = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const request = getRequest();
    const result = await verifyBearer(request);
    if (!result.ok) {
      throw new Error(result.status === 401 ? `Unauthorized: ${result.message}` : result.message);
    }
    setRequestScope({ userId: result.userId });

    const header = request.headers.get("x-workspace-id")?.trim();
    if (header && UUID_RE.test(header)) {
      const membership = await checkWorkspaceMembership(result, header);
      if (membership.ok) setRequestScope({ workspaceId: membership.workspaceId });
    }

    return next({
      context: {
        supabase: result.supabase,
        userId: result.userId,
        claims: result.claims,
      },
    });
  },
);
