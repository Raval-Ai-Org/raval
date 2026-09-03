"use client";

import { useCallback } from "react";

/**
 * `useServerFn(fn)` — kept so call sites read the same as before. The RPC stubs
 * in `src/lib/*.functions.ts` are already bound, so this only stabilises the
 * identity for dependency arrays.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- accepts any RPC stub shape
export function useServerFn<F extends (...args: any[]) => any>(fn: F): F {
  return useCallback(((...args: Parameters<F>) => fn(...args)) as F, [fn]);
}
