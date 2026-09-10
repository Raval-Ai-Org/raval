export const MARKET_STORAGE_TIMEOUT_MS = 8_000;

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
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function marketLog(operation: string, details: Record<string, unknown> = {}) {
  console.info(`[market] ${operation}`, details);
}