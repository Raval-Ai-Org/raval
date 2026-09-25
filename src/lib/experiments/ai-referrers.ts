// ai-referrers.ts — the one list of AI assistants whose referrals count as
// "AI referral sessions" (ADR-0024 §1). Matched against GA4 `sessionSource`,
// which is the referring host (e.g. "chatgpt.com") or a utm_source value.
// Search engines are deliberately not here: they are organic search.

export const AI_REFERRERS: { id: string; name: string; hosts: string[] }[] = [
  { id: "chatgpt", name: "ChatGPT", hosts: ["chatgpt.com", "chat.openai.com", "openai.com"] },
  { id: "perplexity", name: "Perplexity", hosts: ["perplexity.ai"] },
  { id: "claude", name: "Claude", hosts: ["claude.ai"] },
  { id: "gemini", name: "Gemini", hosts: ["gemini.google.com", "bard.google.com"] },
  { id: "copilot", name: "Microsoft Copilot", hosts: ["copilot.microsoft.com"] },
  { id: "meta-ai", name: "Meta AI", hosts: ["meta.ai"] },
  { id: "grok", name: "Grok", hosts: ["grok.com", "x.ai"] },
  { id: "deepseek", name: "DeepSeek", hosts: ["chat.deepseek.com", "deepseek.com"] },
  { id: "mistral", name: "Le Chat", hosts: ["chat.mistral.ai"] },
  { id: "you", name: "You.com", hosts: ["you.com"] },
  { id: "phind", name: "Phind", hosts: ["phind.com"] },
  { id: "poe", name: "Poe", hosts: ["poe.com"] },
];

const HOSTS = AI_REFERRERS.flatMap((r) => r.hosts.map((host) => ({ host, id: r.id })));
const UTM = new Set(AI_REFERRERS.map((r) => r.id).concat(["chatgpt.com", "openai"]));

/** The AI assistant a GA4 session source belongs to, or null. */
export function aiReferrerOf(sessionSource: string | null | undefined): string | null {
  if (!sessionSource) return null;
  const s = sessionSource
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split(/[/?#]/)[0];
  if (!s || s === "(direct)" || s === "(not set)") return null;
  for (const { host, id } of HOSTS) {
    if (s === host || s.endsWith(`.${host}`)) return id;
  }
  return UTM.has(s) ? (AI_REFERRERS.find((r) => r.id === s)?.id ?? "chatgpt") : null;
}
