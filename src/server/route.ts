// route.ts — the kernel every authenticated /api route handler is built on.
//
//   export const POST = defineRoute({
//     name: "generate-video",
//     auth: "user",
//     body: BodySchema,
//     rateLimit: "video",
//     handler: async ({ body, userId, supabase }) => videoGeneration(body),
//   });
//
// Fixed order: authenticate → validate → workspace membership → rate limit →
// handler. Validation runs before the rate limiter so a malformed request never
// burns quota. `ctx.supabase` is the caller's RLS-bound client — the same
// correct-by-default posture as the RPC path; `supabaseAdmin` stays an
// explicit import for the rare query that must bypass RLS.
import "server-only";
import { ZodError, type ZodType, type ZodTypeDef } from "zod";
import type { UserSupabaseClient } from "@/integrations/supabase/client.user.server";
import { checkWorkspaceMembership, jsonError, requireUserId } from "./api-auth";
import {
  enforceRateLimit,
  RateLimitedError,
  rateLimitResponse,
  type RateLimitTier,
} from "./rate-limit";
import { SsrfBlockedError } from "./safe-fetch";
import { UpstreamError } from "./upstream";

type Schema<T> = ZodType<T, ZodTypeDef, unknown>;

export type RouteContext<TBody, TQuery> = {
  request: Request;
  body: TBody;
  query: TQuery;
  userId: string;
  /** RLS-bound client carrying the caller's JWT. */
  supabase: UserSupabaseClient;
  signal: AbortSignal;
};

export type WorkspaceRouteContext<TBody, TQuery> = RouteContext<TBody, TQuery> & {
  workspaceId: string;
};

type RateLimitSpec<Ctx> =
  RateLimitTier | ((ctx: Ctx) => { tier: RateLimitTier; subject?: string } | null);

type CommonOptions<TBody, TQuery> = {
  /** Used in logs. */
  name: string;
  /** JSON request body schema. Omit for routes without a body. */
  body?: Schema<TBody>;
  /** URL search-params schema (values arrive as strings). */
  query?: Schema<TQuery>;
};

export type UserRouteOptions<TBody, TQuery> = CommonOptions<TBody, TQuery> & {
  auth: "user";
  rateLimit?: RateLimitSpec<RouteContext<TBody, TQuery>>;
  handler: (ctx: RouteContext<TBody, TQuery>) => unknown;
};

export type WorkspaceRouteOptions<TBody, TQuery> = CommonOptions<TBody, TQuery> & {
  auth: "workspace";
  /** Where the workspace id lives in the validated input. */
  workspaceId: (input: { body: TBody; query: TQuery }) => unknown;
  rateLimit?: RateLimitSpec<WorkspaceRouteContext<TBody, TQuery>>;
  handler: (ctx: WorkspaceRouteContext<TBody, TQuery>) => unknown;
};

/**
 * Map errors every route can hit to an HTTP status. Shared with the RPC route.
 * Returns null for anything unrecognised (the caller decides how to log it).
 */
export function knownErrorResponse(error: unknown): Response | null {
  if (error instanceof RateLimitedError) return rateLimitResponse(error.tier, error.result);
  if (error instanceof UpstreamError) return jsonError(error.status, error.message);
  if (error instanceof SsrfBlockedError) return jsonError(400, "URL is not allowed");
  if (error instanceof ZodError) return jsonError(400, "Invalid request");
  if (error instanceof Error && /^Unauthorized/i.test(error.message)) {
    return jsonError(401, error.message);
  }
  return null;
}

function firstIssue(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid request";
  const path = issue.path.join(".");
  return path ? `Invalid request: ${path} — ${issue.message}` : `Invalid request: ${issue.message}`;
}

async function parseInput<TBody, TQuery>(
  request: Request,
  opts: CommonOptions<TBody, TQuery>,
): Promise<{ ok: true; body: TBody; query: TQuery } | { ok: false; response: Response }> {
  let rawBody: unknown = undefined;
  if (opts.body) {
    try {
      rawBody = await request.json();
    } catch {
      return { ok: false, response: jsonError(400, "Invalid request body") };
    }
  }
  const rawQuery = Object.fromEntries(new URL(request.url).searchParams);

  const body = opts.body ? opts.body.safeParse(rawBody) : null;
  if (body && !body.success) return { ok: false, response: jsonError(400, firstIssue(body.error)) };
  const query = opts.query ? opts.query.safeParse(rawQuery) : null;
  if (query && !query.success) {
    return { ok: false, response: jsonError(400, firstIssue(query.error)) };
  }
  return {
    ok: true,
    body: (body ? body.data : undefined) as TBody,
    query: (query ? query.data : undefined) as TQuery,
  };
}

function toResponse(result: unknown): Response {
  if (result instanceof Response) return result;
  return Response.json(result ?? null, { headers: { "Cache-Control": "no-store" } });
}

export function defineRoute<TBody = undefined, TQuery = undefined>(
  opts: UserRouteOptions<TBody, TQuery>,
): (request: Request) => Promise<Response>;
export function defineRoute<TBody = undefined, TQuery = undefined>(
  opts: WorkspaceRouteOptions<TBody, TQuery>,
): (request: Request) => Promise<Response>;
export function defineRoute<TBody, TQuery>(
  opts: UserRouteOptions<TBody, TQuery> | WorkspaceRouteOptions<TBody, TQuery>,
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    try {
      const auth = await requireUserId(request);
      if (!auth.ok) return auth.response;

      const input = await parseInput(request, opts);
      if (!input.ok) return input.response;

      const ctx: RouteContext<TBody, TQuery> = {
        request,
        body: input.body,
        query: input.query,
        userId: auth.userId,
        supabase: auth.supabase,
        signal: request.signal,
      };

      let handlerCtx: RouteContext<TBody, TQuery> | WorkspaceRouteContext<TBody, TQuery> = ctx;
      if (opts.auth === "workspace") {
        const membership = await checkWorkspaceMembership(auth, opts.workspaceId(input));
        if (!membership.ok) return membership.response;
        handlerCtx = { ...ctx, workspaceId: membership.workspaceId };
      }

      if (opts.rateLimit) {
        const spec =
          typeof opts.rateLimit === "string"
            ? { tier: opts.rateLimit }
            : (
                opts.rateLimit as (c: typeof handlerCtx) => {
                  tier: RateLimitTier;
                  subject?: string;
                } | null
              )(handlerCtx);
        if (spec) {
          const limited = await enforceRateLimit(spec.tier, spec.subject ?? auth.userId);
          if (limited) return limited;
        }
      }

      const result = await (opts.handler as (c: typeof handlerCtx) => unknown)(handlerCtx);
      return toResponse(result);
    } catch (error) {
      const known = knownErrorResponse(error);
      if (known) return known;
      console.error(`[api] ${opts.name} failed`, error);
      return jsonError(500, "Request failed. Please try again.");
    }
  };
}
