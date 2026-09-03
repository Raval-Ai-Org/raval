import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { runMiddleware, type MiddlewareContext, type ServerMiddleware } from "./middleware";

// `createServerFn` keeps the builder shape the app was already written against
// (`.middleware([]).inputValidator(fn).handler(fn)`), so handler bodies did not
// change when the app moved to Next. The resulting object is registered in
// src/server/fns/index.ts and invoked by the /api/rpc/[...fn] route handler;
// the browser calls it through the matching stub in src/lib/*.functions.ts.

/**
 * What `requireSupabaseAuth` contributes — every server function runs behind it,
 * so handlers can rely on a request-scoped, RLS-bound Supabase client.
 */
export type ServerFnContext = {
  supabase: SupabaseClient<Database>;
  userId: string;
  claims: Record<string, string | number | boolean | null | undefined | object>;
};

export type ServerFnHandlerContext<TData> = {
  data: TData;
  context: ServerFnContext;
  signal?: AbortSignal;
};

export type ServerFn<TData, TResult> = {
  readonly __isServerFn: true;
  readonly method: "GET" | "POST";
  /** Phantom field used to carry input/output types to the client stub. */
  readonly __types?: { data: TData; result: TResult };
  invoke: (data: unknown, signal?: AbortSignal) => Promise<TResult>;
};

class ServerFnBuilder<TData> {
  private middlewareList: ServerMiddleware[] = [];
  private validator: ((input: unknown) => TData) | undefined;

  constructor(private readonly method: "GET" | "POST") {}

  middleware(list: ServerMiddleware[]): this {
    this.middlewareList = list;
    return this;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- validators are written as `(data) => schema.parse(data)`
  inputValidator<TNext>(validator: (input: any) => TNext): ServerFnBuilder<TNext> {
    const next = this as unknown as ServerFnBuilder<TNext>;
    next.validator = validator as (input: unknown) => TNext;
    return next;
  }

  handler<TResult>(
    handler: (ctx: ServerFnHandlerContext<TData>) => TResult | Promise<TResult>,
  ): ServerFn<TData, Awaited<TResult>> {
    const { method, middlewareList, validator } = this;
    return {
      __isServerFn: true,
      method,
      async invoke(data: unknown, signal?: AbortSignal): Promise<Awaited<TResult>> {
        const parsed = (validator ? validator(data) : data) as TData;
        const context = (await runMiddleware(middlewareList, {})) as MiddlewareContext &
          ServerFnContext;
        return (await handler({ data: parsed, context, signal })) as Awaited<TResult>;
      },
    };
  }
}

export function createServerFn(options: { method?: "GET" | "POST" } = {}) {
  return new ServerFnBuilder<unknown>(options.method ?? "GET");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- registry entry, types recovered per call site
export type AnyServerFn = ServerFn<any, any>;
