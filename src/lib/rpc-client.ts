"use client";

import { authedFetch } from "@/lib/authed-fetch";
import { messageForStatus, userSafeMessage } from "@/lib/user-errors";
import type { ServerFn } from "@/server/server-fn";

// Browser-side counterpart to src/server/server-fn.ts. `serverFn("module/name")`
// returns a callable with the same signature the app already used for TanStack
// server functions — `await fn({ data })` / `await fn()` — transported over the
// /api/rpc/[...fn] route with the Supabase bearer token attached.

export class ServerFnError extends Error {
  readonly status: number;
  /** A 402's plan details ({ code, limit, used, max, ... }), for an inline upgrade card. */
  readonly billing: ({ code: string } & Record<string, unknown>) | null;
  constructor(
    status: number,
    message: string,
    billing: ({ code: string } & Record<string, unknown>) | null = null,
  ) {
    super(message);
    this.name = "ServerFnError";
    this.status = status;
    this.billing = billing;
  }
}

type CallOptions = {
  data?: unknown;
  signal?: AbortSignal;
  /** The caller shows its own upgrade card for a 402; skip the global toast. */
  billingInline?: boolean;
};

async function call(path: string, options: CallOptions = {}): Promise<unknown> {
  const response = await authedFetch(`/api/rpc/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ data: options.data ?? null }),
    signal: options.signal,
    billingInline: options.billingInline,
  });

  const text = await response.text();
  let payload: { result?: unknown; error?: unknown; message?: unknown; code?: unknown } | undefined;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = undefined;
    }
  }

  if (!response.ok) {
    const message =
      typeof payload?.error === "string"
        ? payload.error
        : typeof payload?.message === "string"
          ? payload.message
          : null;
    // Every screen shows this text as it is, so it is made safe once, here.
    // A 402 is the person's own plan ("You're out of credits"), already ours.
    throw new ServerFnError(
      response.status,
      response.status === 402 && message
        ? message
        : userSafeMessage(message, messageForStatus(response.status)),
      response.status === 402 && payload && typeof payload.code === "string"
        ? (payload as { code: string } & Record<string, unknown>)
        : null,
    );
  }

  return payload?.result;
}

/**
 * Declare the client stub for a registered server function.
 *
 * `serverFn<typeof Handlers.renameWorkspace>("workspaces/renameWorkspace")`
 * — the type parameter is a type-only reference to the server module, so no
 * server code reaches the browser bundle.
 */
// The `any` type arguments are the wildcard the `infer` below matches against;
// narrowing them would stop the stub from picking up each function's own types.

export function serverFn<F extends ServerFn<any, any>>(
  path: string,
): F extends ServerFn<infer TData, infer TResult>
  ? (options?: { data?: TData; signal?: AbortSignal; billingInline?: boolean }) => Promise<TResult>
  : never {
  const fn = (options?: CallOptions) => call(path, options);
  return fn as unknown as F extends ServerFn<infer TData, infer TResult>
    ? (options?: {
        data?: TData;
        signal?: AbortSignal;
        billingInline?: boolean;
      }) => Promise<TResult>
    : never;
}
