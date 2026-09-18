// errors.ts — one error type for every Google failure, classified into the
// codes the sync runner and UI understand. Messages are safe to show: never a
// token, never a raw response body beyond Google's short error message.
import type { SyncErrorCode } from "@/lib/analytics/types";

export class GoogleApiError extends Error {
  constructor(
    readonly code: SyncErrorCode,
    message: string,
    readonly opts: { status?: number; retryAfterSeconds?: number; api?: string } = {},
  ) {
    super(message);
    this.name = "GoogleApiError";
  }

  get retryable(): boolean {
    return this.code === "quota" || this.code === "upstream";
  }
}

const USER_MESSAGES: Record<SyncErrorCode, string> = {
  token_expired: "Google access has expired or was removed. Reconnect Google to keep syncing.",
  permission_denied: "This Google account can't read that property or site any more.",
  quota: "Google's daily limit was reached. Mellox will retry automatically.",
  upstream: "Google didn't respond. Mellox will retry automatically.",
  not_found: "That property or site no longer exists in Google.",
  config: "Google Analytics isn't set up on this server.",
  internal: "The sync hit an unexpected problem.",
};

export function userMessageFor(code: SyncErrorCode): string {
  return USER_MESSAGES[code];
}

/** Map an HTTP failure from a Google API to a classified error. */
export function classifyGoogleFailure(
  status: number,
  body: unknown,
  api: string,
  retryAfterHeader?: string | null,
): GoogleApiError {
  const err = (body as { error?: { message?: unknown; status?: unknown; errors?: unknown } } | null)
    ?.error;
  const googleStatus = typeof err?.status === "string" ? err.status : "";
  const message = (typeof err?.message === "string" ? err.message : `HTTP ${status}`).slice(0, 300);
  const retryAfter = Number(retryAfterHeader ?? "");
  const retryAfterSeconds = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined;

  // The API isn't enabled in the Google Cloud project that owns the OAuth client.
  if (
    /has not been used in project|is disabled|accessNotConfigured|SERVICE_DISABLED/i.test(
      `${message} ${JSON.stringify(err ?? {}).slice(0, 2000)}`,
    )
  )
    return new GoogleApiError(
      "config",
      `The ${api} API isn't enabled in the Google Cloud project for this Mellox server.`,
      { status, api },
    );
  if (status === 401 || googleStatus === "UNAUTHENTICATED")
    return new GoogleApiError("token_expired", message, { status, api });
  if (status === 429 || googleStatus === "RESOURCE_EXHAUSTED" || /quota|rate limit/i.test(message))
    return new GoogleApiError("quota", message, { status, api, retryAfterSeconds });
  if (status === 403 || googleStatus === "PERMISSION_DENIED")
    return new GoogleApiError("permission_denied", message, { status, api });
  if (status === 404 || googleStatus === "NOT_FOUND")
    return new GoogleApiError("not_found", message, { status, api });
  if (status >= 500) return new GoogleApiError("upstream", message, { status, api });
  return new GoogleApiError("upstream", message, { status, api });
}
