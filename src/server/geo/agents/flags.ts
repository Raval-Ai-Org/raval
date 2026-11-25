// flags.ts — GEO coding agent switches, readable without importing the agent
// service (which imports the fix service, which needs these).
import "server-only";
import { textAiConfigured } from "@/lib/ai-provider.server";

export function geoAgentEnabled(): boolean {
  return (process.env.FEATURE_FLAG_GEO_AGENT_ENABLED ?? "true").trim().toLowerCase() !== "false";
}

/** The agent's models are reached through the text gateway (KIE or OpenRouter). */
export function geoAgentModelConfigured(): boolean {
  return textAiConfigured();
}
