import "server-only";
import { createMiddleware } from "@/server/middleware";
import { getRequest } from "@/server/request-context";
import { verifyBearer } from "@/server/api-auth";

// Server-function middleware: validates the Bearer token and contributes the
// caller's RLS-bound Supabase client to the handler context. Failures throw
// "Unauthorized: …", which the /api/rpc route maps to 401.
export const requireSupabaseAuth = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const result = await verifyBearer(getRequest());
    if (!result.ok) {
      throw new Error(result.status === 401 ? `Unauthorized: ${result.message}` : result.message);
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
