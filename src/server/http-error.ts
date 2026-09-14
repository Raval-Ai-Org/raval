// http-error.ts — user-facing errors that carry their own HTTP status.
// knownErrorResponse (src/server/route.ts) maps them for both /api routes and
// the RPC transport, so handlers can throw instead of building responses.
import "server-only";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** The caller is signed in but may not act on this workspace or resource. */
export class ForbiddenError extends HttpError {
  constructor(message = "You don't have access to this workspace") {
    super(403, message);
    this.name = "ForbiddenError";
  }
}
