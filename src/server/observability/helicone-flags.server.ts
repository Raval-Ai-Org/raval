// helicone-flags.server.ts — Helicone switches, readable without importing
// the logging client (mirrors src/server/geo/agents/flags.ts).
import "server-only";

/** Off unless a self-hosted (or hosted) Helicone base URL is configured. */
export function heliconeEnabled(): boolean {
  return Boolean(process.env.HELICONE_BASE_URL?.trim());
}

/**
 * Whether full request/response bodies are embedded in a Helicone log.
 * Default false: only metadata (model, tokens, cost, latency, status) is
 * sent, even when Helicone itself is self-hosted.
 */
export function heliconeLogPromptsEnabled(): boolean {
  return (process.env.HELICONE_LOG_PROMPTS ?? "false").trim().toLowerCase() === "true";
}
