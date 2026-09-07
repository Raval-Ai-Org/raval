"use client";

import { useCallback } from "react";

/**
 * `useServerFn(fn)` — kept so call sites read the same as before. The RPC stubs
 * in `src/lib/*.functions.ts` are already bound, so this only stabilises the
 * identity for dependency arrays.
 */

export function useServerFn<F extends (...args: any[]) => any>(fn: F): F {
  return useCallback(((...args: Parameters<F>) => fn(...args)) as F, [fn]);
}
