import { AsyncLocalStorage } from "node:async_hooks";

// Ambient request scope for server-function middleware. Route handlers open the
// scope once per request so middleware (e.g. requireSupabaseAuth) can read the
// incoming headers without every handler threading the Request through.
const storage = new AsyncLocalStorage<{ request: Request }>();

export function runWithRequest<T>(request: Request, fn: () => T): T {
  return storage.run({ request }, fn);
}

export function getRequest(): Request {
  const store = storage.getStore();
  if (!store) {
    throw new Error("getRequest() called outside of a request scope");
  }
  return store.request;
}

export function tryGetRequest(): Request | undefined {
  return storage.getStore()?.request;
}
