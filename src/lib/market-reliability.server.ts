import "server-only";
export const MARKET_STORAGE_TIMEOUT_MS = 8_000;
// Overall bound for /api/market/intelligence: storage reads + one Claude analysis
// (typically 34-38s) + cache write. The client waits slightly longer than this so
// the server's structured timeout response always reaches it.
export const MARKET_INTELLIGENCE_ROUTE_TIMEOUT_MS = 90_000;

export class MarketTimeoutError extends Error {
  readonly code = "timeout";
  constructor(message: string) {
    super(message);
    this.name = "MarketTimeoutError";
  }
}

export function operationId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

export async function withMarketTimeout<T>(
  operation: PromiseLike<T>,
  timeoutMs = MARKET_STORAGE_TIMEOUT_MS,
  message = "Market operation timed out",
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new MarketTimeoutError(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function marketLog(operation: string, details: Record<string, unknown> = {}) {
  console.info(`[market] ${operation}`, details);
}

/** Error body shared by every Market Brain route so the client reads one shape. */
export function marketFailure(
  httpStatus: number,
  error: { message: string; code?: string },
  extra: Record<string, unknown> = {},
): Response {
  return Response.json(
    { success: false, state: "failed", data: null, ...extra, error },
    { status: httpStatus, headers: { "Cache-Control": "no-store" } },
  );
}
