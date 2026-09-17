// firecrawl-flags.server.ts — Firecrawl switch, readable without importing
// the gateway (mirrors src/server/geo/agents/flags.ts).
import "server-only";

/** Off unless a self-hosted (or hosted) Firecrawl base URL is configured. */
export function firecrawlEnabled(): boolean {
  return Boolean(process.env.FIRECRAWL_BASE_URL?.trim());
}
