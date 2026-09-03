// Minimal middleware primitive for server functions: a middleware receives
// `{ next, context }` and calls `next({ context })` to contribute to the context
// the handler eventually sees.
export type MiddlewareContext = Record<string, unknown>;

export type NextFn = (options?: { context?: MiddlewareContext }) => Promise<MiddlewareResult>;

export type MiddlewareResult = { context: MiddlewareContext };

export type ServerMiddlewareFn = (options: {
  next: NextFn;
  context: MiddlewareContext;
}) => Promise<MiddlewareResult>;

export type ServerMiddleware = { server: ServerMiddlewareFn };

export function createMiddleware(_options?: { type?: "function" | "request" }) {
  return {
    server(fn: ServerMiddlewareFn): ServerMiddleware {
      return { server: fn };
    },
    /** Client-side middleware is a no-op here — the RPC client attaches auth headers. */
    client(_fn: unknown): ServerMiddleware {
      return { server: async ({ next, context }) => next({ context }) };
    },
  };
}

/** Run a middleware chain, threading the accumulated context to the last call. */
export async function runMiddleware(
  middleware: ServerMiddleware[],
  seed: MiddlewareContext,
): Promise<MiddlewareContext> {
  let index = -1;

  const dispatch = async (i: number, context: MiddlewareContext): Promise<MiddlewareResult> => {
    if (i <= index) throw new Error("next() called multiple times in one middleware");
    index = i;
    const mw = middleware[i];
    if (!mw) return { context };
    return mw.server({
      context,
      next: async (options) => dispatch(i + 1, { ...context, ...(options?.context ?? {}) }),
    });
  };

  const result = await dispatch(0, seed);
  return result.context;
}
