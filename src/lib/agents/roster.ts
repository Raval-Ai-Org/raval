// The agents (Phase 5 of ADR-0042). Pure and browser-safe.
//
// An agent is not a new chatbot. It is a name for work Mellox already does,
// built from what exists:
//   - the place its work shows up (Brain, Studio, Campaigns, Publish...);
//   - the Autopilot automations that run it on a schedule (contracts.ts);
//   - the control-plane workers that check it (src/server/agents/workers);
//   - the chat reads it answers from (CHAT_READ_TOOLS).
// Anything that changes the world stays a person's click or an approval.
//
// The status shown is worked out from stored facts only (`agentState`): what
// is set up, what runs, and what is missing with where to fix it.
import type { Automation } from "@/lib/autopilot/contracts";

export type AgentId = "strategist" | "creator" | "social" | "community" | "search" | "growth";

/** Something an agent needs before it can work. */
export type Need = "brand_dna" | "social_account" | "website" | "autopilot" | "crm" | "community";

export const NEED_FIX: Record<Need, { missing: string; fix: string }> = {
  brand_dna: { missing: "Brand DNA", fix: "Scan your website in Brain → Brand." },
  social_account: { missing: "A social account", fix: "Connect one in Settings → Connections." },
  website: { missing: "Your website", fix: "Add it in Brain → Brand." },
  autopilot: { missing: "Autopilot", fix: "Turn it on from the message box." },
  crm: { missing: "HubSpot", fix: "Connect it in Settings → Connections → Apps." },
  community: { missing: "Community watching", fix: "Open Brain → Market → Communities." },
};

export type AgentDefinition = {
  id: AgentId;
  name: string;
  /** Plain words: what it does for the brand. */
  does: string;
  /** Where its work shows up. */
  place: string;
  needs: Need[];
  /** Autopilot automations that run its work every week. */
  automations: Automation[];
  /** Control-plane workers that check its work (src/server/agents/workers). */
  workers: string[];
  /** The chat reads it answers from. */
  reads: string[];
};

export const AGENTS: readonly AgentDefinition[] = [
  {
    id: "strategist",
    name: "Strategist",
    does: "Knows your brand, customers, competitors and market, and keeps one plan.",
    place: "Brain",
    needs: ["brand_dna"],
    automations: [],
    workers: [],
    reads: ["get_workspace_summary", "get_audience", "get_competitors", "get_market_updates"],
  },
  {
    id: "creator",
    name: "Creator",
    does: "Writes and designs posts, carousels, videos and campaigns in your look.",
    place: "Studio and Campaigns",
    needs: ["brand_dna"],
    automations: ["repurpose"],
    workers: ["content-fit"],
    reads: ["list_content", "list_campaigns", "get_campaign"],
  },
  {
    id: "social",
    name: "Social",
    does: "Plans the week, sends approved posts on time and reads how they did.",
    place: "Calendar and Publish",
    needs: ["social_account", "autopilot"],
    automations: [],
    workers: ["distribution-reliability"],
    reads: ["get_content_calendar", "list_social_accounts", "get_autopilot_status"],
  },
  {
    id: "community",
    name: "Community",
    does: "Finds real threads where people ask about your field and drafts helpful replies.",
    place: "Brain → Market → Communities",
    needs: ["brand_dna", "community"],
    automations: [],
    workers: [],
    reads: ["list_community_threads", "get_community_thread"],
  },
  {
    id: "search",
    name: "Search",
    does: "Checks how search engines and AI answers see your site and lines up fixes.",
    place: "AI Visibility",
    needs: ["website"],
    automations: ["geo_scan", "publish_articles"],
    workers: [],
    reads: ["list_geo_scans", "get_geo_findings", "get_tracked_prompts"],
  },
  {
    id: "growth",
    name: "Growth",
    does: "Tracks your goal with real numbers and sends a weekly report.",
    place: "Brain → Goal and Analytics",
    needs: ["crm"],
    automations: ["weekly_report"],
    workers: [],
    reads: ["get_analytics_summary", "list_connected_apps"],
  },
];

/** Stored facts about one workspace (nothing here is estimated). */
export type AgentFacts = {
  hasBrandDna: boolean;
  socialAccounts: number;
  hasWebsite: boolean;
  /** The Autopilot program is active. */
  autopilotOn: boolean;
  /** Automations switched on in the active program. */
  automations: string[];
  /** Apps connected through Composio and working. */
  apps: string[];
  communityThreads: number;
  agentsPaused: boolean;
  disabledWorkers: string[];
};

export type AgentState = {
  id: AgentId;
  /** working: it runs by itself now; ready: set up, runs on a person's click; needs: something's missing; paused. */
  state: "working" | "ready" | "needs" | "paused";
  missing: Array<{ need: Need; missing: string; fix: string }>;
  /** Automations of this agent that are on. */
  running: string[];
  /** Its checks that are switched off. */
  checksOff: string[];
};

function has(need: Need, f: AgentFacts): boolean {
  switch (need) {
    case "brand_dna":
      return f.hasBrandDna;
    case "social_account":
      return f.socialAccounts > 0;
    case "website":
      return f.hasWebsite;
    case "autopilot":
      return f.autopilotOn;
    case "crm":
      return f.apps.includes("hubspot");
    case "community":
      return f.communityThreads > 0;
  }
}

export function agentState(agent: AgentDefinition, f: AgentFacts): AgentState {
  const missing = agent.needs
    .filter((n) => !has(n, f))
    .map((need) => ({ need, ...NEED_FIX[need] }));
  const running = f.autopilotOn ? agent.automations.filter((a) => f.automations.includes(a)) : [];
  const checksOff = agent.workers.filter((w) => f.disabledWorkers.includes(w));
  const usesWorkers = agent.workers.length > 0;
  const state: AgentState["state"] =
    f.agentsPaused && usesWorkers
      ? "paused"
      : missing.length
        ? "needs"
        : running.length ||
            (f.autopilotOn && agent.id === "social") ||
            (usesWorkers && checksOff.length < agent.workers.length)
          ? "working"
          : "ready";
  return { id: agent.id, state, missing, running, checksOff };
}

export function rosterStates(f: AgentFacts): AgentState[] {
  return AGENTS.map((a) => agentState(a, f));
}
