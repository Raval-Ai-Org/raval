"use client";

import { authedFetch } from "@/lib/authed-fetch";
import type { ServerFn } from "@/server/server-fn";

// Browser-side counterpart to src/server/server-fn.ts. `serverFn("module/name")`
// returns a callable with the same signature the app already used for TanStack
// server functions — `await fn({ data })` / `await fn()` — transported over the
// /api/rpc/[...fn] route with the Supabase bearer token attached.

export class ServerFnError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ServerFnError";
    this.status = status;
  }
}

async function call(path: string, data: unknown, signal?: AbortSignal): Promise<unknown> {
  const response = await authedFetch(`/api/rpc/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ data: data ?? null }),
    signal,
  });

  const text = await response.text();
  let payload: { result?: unknown; error?: unknown } | undefined;
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
        : `Request failed with status ${response.status}`;
    throw new ServerFnError(response.status, message);
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function serverFn<F extends ServerFn<any, any>>(
  path: string,
): F extends ServerFn<infer TData, infer TResult>
  ? (options?: { data?: TData; signal?: AbortSignal }) => Promise<TResult>
  : never {
  const fn = (options?: { data?: unknown; signal?: AbortSignal }) =>
    call(path, options?.data, options?.signal);
  return fn as unknown as F extends ServerFn<infer TData, infer TResult>
    ? (options?: { data?: TData; signal?: AbortSignal }) => Promise<TResult>
    : never;
}
