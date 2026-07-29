export type AgentMood = "idle" | "scanning" | "thinking" | "excited" | "guarding";

export interface AgentMission {
  id: string;
  label: string;
  description: string;
  durationSec: number;
}

export interface Agent {
  id: string;
  slug: string;            // matches module slug (e.g. "seo")
  name: string;
  role: string;
  description: string;
  emoji: string;
  defaultMood: AgentMood;
  activeMood: AgentMood;
  accentHue: number;       // HSL hue for unique color
  status: { idle: string; working: string; done: string };
  missions: AgentMission[];
}

export const agents: Record<string, Agent> = {
  scout: {
    id: "scout", slug: "seo",
    name: "Scout", role: "Generative Engine Optimization",
    description: "Optimizes your brand for AI search — ChatGPT, Gemini, Perplexity, Claude and classic SERPs.",
    emoji: "🔍",
    defaultMood: "scanning", activeMood: "scanning", accentHue: 217,
    status: { idle: "Watching AI engines…", working: "Scanning all engines…", done: "Scan complete!" },
    missions: [
      { id: "scout-aeo", label: "Audit AEO presence", description: "Top 25 AI prompts", durationSec: 22 },
      { id: "scout-geo", label: "Map GEO citations", description: "Across 5 engines", durationSec: 45 },
      { id: "scout-deep", label: "Deep crawl", description: "Long-tail expansion", durationSec: 60 },
    ],
  },
};

export const agentList = Object.values(agents);

export function agentForSlug(slug: string): Agent {
  return agentList.find((a) => a.slug === slug) ?? agents.scout;
}
