// flags.ts — GEO coding agent switches, readable without importing the agent
// service (which imports the fix service, which needs these).
import "server-only";

export function geoAgentEnabled(): boolean {
  return (process.env.FEATURE_FLAG_GEO_AGENT_ENABLED ?? "true").trim().toLowerCase() !== "false";
}

export function geoAgentModelConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}
