// tavily-flags.server.ts — is web research available on this server?
//
// A separate module (like firecrawl-flags.server.ts) so callers can read the
// switch without importing the gateway and pulling its transport in with it.
// Presence of the key is the switch: there is nothing to configure beyond it,
// and a surface that reports "not configured" is better than one that fails
// at the moment someone asks a question.
import "server-only";

export function tavilyEnabled(): boolean {
  return Boolean(process.env.TAVILY_API_KEY?.trim());
}
