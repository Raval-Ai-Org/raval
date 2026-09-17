// flags.server.ts — Trigger.dev switch, readable without importing the
// client (mirrors src/server/geo/agents/flags.ts).
import "server-only";

/** Off unless a Trigger.dev API URL is configured (self-hosted or cloud). */
export function triggerEnabled(): boolean {
  return Boolean(process.env.TRIGGER_API_URL?.trim() && process.env.TRIGGER_SECRET_KEY?.trim());
}
