// route.ts — the kernel every /api/admin route is built on.
//
//   export const POST = defineAdminRoute({
//     name: "admin.users.suspend",
//     permission: "users.suspend",
//     write: true,
//     body: BodySchema,
//     handler: async ({ body, admin, audit }) => { … },
//   });
//
// Fixed order, each step independent of the browser:
//   authenticate → is this person an admin (else 404) → second factor
//   (if required) → permission (a refusal is audited) → rate limit →
//   [danger: a recent second-factor check] → validate input → handler.
//
// Input is validated AFTER the admin check, so someone who is not an admin
// cannot tell a real admin route from a missing one by the error it returns.
import "server-only";
import { randomUUID } from "node:crypto";
import { z, ZodError, type ZodType, type ZodTypeDef } from "zod";
import { assuranceOf, isFreshMfa } from "@/lib/admin/assurance";
import { hasPermission, type Permission } from "@/lib/admin/permissions";
import { jsonError, requireUserId } from "@/server/api-auth";
import { enforceRateLimit, type RateLimitTier } from "@/server/rate-limit";
import { runWithRequest, setRequestScope } from "@/server/request-context";
import { readJsonBody, RequestBodyTooLargeError } from "@/server/request-body";
import { knownErrorResponse } from "@/server/route";
import { resolveAdmin, type AdminIdentity } from "./access.server";
import { auditContext, recordAdminAudit, type AuditContext } from "./audit.server";
import { adminMfaRequired } from "./config.server";

type Schema<T> = ZodType<T, ZodTypeDef, unknown>;

export type AdminContext<TBody, TQuery> = {
  request: Request;
  admin: AdminIdentity;
  body: TBody;
  query: TQuery;
  /** Request context to hand to the database functions that write the audit row. */
  audit: AuditContext;
  signal: AbortSignal;
  can: (permission: Permission) => boolean;
};

export type AdminRouteOptions<TBody, TQuery> = {
  /** Used in logs. */
  name: string;
  /**
   * The one permission this route needs. Every route declares one; "any" is
   * only for routes that tell an admin about themselves (/api/admin/me).
   */
  permission: Permission | "any";
  /** The route changes something (its own, stricter rate limit). */
  write?: boolean;
  /**
   * A sensitive change (who is an admin, deletions). Needs a second-factor
   * check from the last few minutes, and gets the slowest rate limit.
   */
  danger?: boolean;
  body?: Schema<TBody>;
  query?: Schema<TQuery>;
  handler: (ctx: AdminContext<TBody, TQuery>) => unknown;
};

/** Every route registered, for the coverage test. */
export const registeredAdminRoutes: Array<{
  name: string;
  permission: Permission | "any";
  write: boolean;
}> = [];

function tierFor(opts: { write?: boolean; danger?: boolean }): RateLimitTier {
  if (opts.danger) return "admin-danger";
  return opts.write ? "admin-write" : "admin-read";
}

function codedError(status: number, code: string, message: string): Response {
  return Response.json(
    { error: message, code },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function firstIssue(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid request";
  const path = issue.path.join(".");
  return path ? `Invalid request: ${path} — ${issue.message}` : `Invalid request: ${issue.message}`;
}

export function defineAdminRoute<TBody = undefined, TQuery = undefined>(
  opts: AdminRouteOptions<TBody, TQuery>,
): (request: Request) => Promise<Response> {
  registeredAdminRoutes.push({
    name: opts.name,
    permission: opts.permission,
    write: Boolean(opts.write || opts.danger),
  });
  return (request: Request) => runWithRequest(request, () => handle(opts, request));
}

async function handle<TBody, TQuery>(
  opts: AdminRouteOptions<TBody, TQuery>,
  request: Request,
): Promise<Response> {
  try {
    const auth = await requireUserId(request);
    if (!auth.ok) return auth.response;
    setRequestScope({ userId: auth.userId, route: opts.name });

    const admin = await resolveAdmin(auth.userId);
    if (!admin) return jsonError(404, "Not found");

    const audit = auditContext(request, randomUUID());
    const assurance = assuranceOf(auth.claims);

    if (adminMfaRequired() && !assurance.mfa) {
      return codedError(403, "mfa_required", "Verify your second factor to use the admin console.");
    }

    if (opts.permission !== "any" && !hasPermission(admin.permissions, opts.permission)) {
      await recordAdminAudit(
        {
          actorUserId: admin.userId,
          actorRole: admin.role,
          action: "admin.permission_denied",
          targetType: "route",
          targetId: opts.name,
          after: { permission: opts.permission },
          success: false,
          error: "Missing permission",
        },
        audit,
      );
      return codedError(403, "forbidden", "Your admin role can't do that.");
    }

    const limited = await enforceRateLimit(tierFor(opts), admin.userId);
    if (limited) return limited;

    if (opts.danger && adminMfaRequired() && !isFreshMfa(assurance)) {
      return codedError(403, "reauth_required", "Confirm with your second factor to continue.");
    }

    let body = undefined as TBody;
    let query = undefined as TQuery;
    if (opts.body) {
      let raw: unknown;
      try {
        raw = await readJsonBody(request);
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) throw error;
        return jsonError(400, "Invalid request body");
      }
      const parsed = opts.body.safeParse(raw);
      if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
      body = parsed.data;
    }
    if (opts.query) {
      const parsed = opts.query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
      if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
      query = parsed.data;
    }

    const result = await opts.handler({
      request,
      admin,
      body,
      query,
      audit,
      signal: request.signal,
      can: (permission) => hasPermission(admin.permissions, permission),
    });
    return result instanceof Response
      ? result
      : Response.json(result ?? null, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const known = knownErrorResponse(error);
    if (known) return known;
    console.error(`[admin-api] ${opts.name} failed`, error);
    return jsonError(500, "Request failed. Please try again.");
  }
}

/* ───────────────────────── shared input shapes ───────────────────────── */

export const uuidSchema = z.string().uuid();

/** `?page=1&pageSize=25` — bounded, so an admin cannot ask for a whole table. */
export const pageQuery = {
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
};
