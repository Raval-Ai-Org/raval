// Turning anything a Mellox service throws into one structured tool error an
// assistant can read and explain: { code, message, details? }. Same order of
// checks as knownErrorResponse (src/server/route.ts). An unknown error never
// leaks its message: it is logged and reported as internal_error.
import "server-only";
import { ZodError } from "zod";
import { BudgetExceededError } from "@/server/ai/budget";
import { BillingError } from "@/server/billing/errors";
import { HttpError } from "@/server/http-error";
import { RateLimitedError } from "@/server/rate-limit";
import { SsrfBlockedError } from "@/server/safe-fetch";
import { StudioJobError } from "@/server/studio/runner.server";
import { UpstreamError } from "@/server/upstream";

export type McpErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "mcp_disabled"
  | "read_only"
  | "not_found"
  | "invalid_input"
  | "conflict"
  | "not_approved"
  | "rate_limited"
  | "budget_exceeded"
  | "upgrade_required"
  | "insufficient_balance"
  | "limit_reached"
  | "spend_not_allowed"
  | "brand_frozen"
  | "schedule_failed"
  | "upstream_error"
  | "unavailable"
  | "internal_error";

export type McpErrorBody = {
  code: McpErrorCode;
  message: string;
  details?: Record<string, unknown>;
};

/** Thrown by the MCP layer itself (access checks, tool preconditions). */
export class McpError extends Error {
  constructor(
    readonly code: McpErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "McpError";
  }
}

function fromStatus(status: number): McpErrorCode {
  if (status === 400 || status === 422) return "invalid_input";
  if (status === 401) return "unauthenticated";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limited";
  if (status === 503) return "unavailable";
  return status >= 500 ? "upstream_error" : "invalid_input";
}

export function toMcpError(error: unknown): McpErrorBody {
  if (error instanceof McpError) {
    return { code: error.code, message: error.message, details: error.details };
  }
  if (error instanceof BillingError) {
    const { code, message, ...details } = error.toJSON() as {
      code: McpErrorCode;
      message: string;
    } & Record<string, unknown>;
    return { code, message, details };
  }
  if (error instanceof RateLimitedError) {
    return {
      code: "rate_limited",
      message: `Too many requests. Try again in ${error.result.retryAfterSeconds} seconds.`,
      details: { retryAfterSeconds: error.result.retryAfterSeconds },
    };
  }
  if (error instanceof BudgetExceededError) {
    return { code: "budget_exceeded", message: error.message };
  }
  if (error instanceof UpstreamError) {
    return { code: fromStatus(error.status), message: error.message };
  }
  if (error instanceof StudioJobError) {
    return { code: fromStatus(error.status), message: error.message };
  }
  if (error instanceof HttpError) {
    return { code: fromStatus(error.status), message: error.message };
  }
  if (error instanceof SsrfBlockedError) {
    return { code: "invalid_input", message: "That address can't be used." };
  }
  if (error instanceof ZodError) {
    return {
      code: "invalid_input",
      message: "Some of the input isn't valid.",
      details: {
        issues: error.issues.slice(0, 10).map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
    };
  }
  if (error instanceof Error && /^Unauthorized/i.test(error.message)) {
    return { code: "unauthenticated", message: "Sign in again." };
  }
  // Older server functions throw a plain Error for these two cases.
  if (error instanceof Error && /^Invalid content status transition/i.test(error.message)) {
    return {
      code: "conflict",
      message: "That post can't be moved to that status from where it is.",
    };
  }
  if (error instanceof Error && /^Forbidden/i.test(error.message)) {
    return { code: "forbidden", message: "You can't do that in this workspace." };
  }
  console.error("[mcp] tool failed", error);
  return { code: "internal_error", message: "Something went wrong. Please try again." };
}
