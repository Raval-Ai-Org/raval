// robots.ts — robots.txt parsing for AI-engine access and crawl politeness.
//
// Two questions, two functions:
//   • parseRobotsAllow / summarizeEngines — can an AI product's crawler read
//     the site at all? (a whole-site "Disallow: /" for that agent)
//   • isPathAllowed — may Mellox's own crawler fetch this path? RFC 9309
//     longest-match with `*` and `$`, so the scan never ignores a site's rules.

export type RobotsVerdict = "allow" | "block" | "unknown";

type RobotsGroup = { agents: string[]; allow: string[]; disallow: string[]; crawlDelay?: number };

export const AI_BOTS = [
  { id: "GPTBot", who: "OpenAI training crawler (ChatGPT)" },
  { id: "ChatGPT-User", who: "ChatGPT browsing user-agent" },
  { id: "OAI-SearchBot", who: "ChatGPT search index" },
  { id: "ClaudeBot", who: "Anthropic Claude crawler" },
  { id: "Claude-Web", who: "Claude browsing user-agent" },
  { id: "PerplexityBot", who: "Perplexity index" },
  { id: "Google-Extended", who: "Gemini training and grounding" },
  { id: "Applebot-Extended", who: "Apple Intelligence" },
  { id: "CCBot", who: "Common Crawl (feeds most LLMs)" },
  { id: "Bytespider", who: "ByteDance / Doubao" },
] as const;

// Which answer engine each crawler feeds. A product is only fully readable when
// none of its crawlers are blocked (ChatGPT search can't cite a GPTBot-only allow).
export const AI_ENGINES = [
  { id: "chatgpt", name: "ChatGPT", bots: ["GPTBot", "ChatGPT-User", "OAI-SearchBot"] },
  { id: "claude", name: "Claude", bots: ["ClaudeBot", "Claude-Web"] },
  { id: "gemini", name: "Gemini", bots: ["Google-Extended"] },
  { id: "perplexity", name: "Perplexity", bots: ["PerplexityBot"] },
  { id: "apple", name: "Apple Intelligence", bots: ["Applebot-Extended"] },
  { id: "commoncrawl", name: "Common Crawl", bots: ["CCBot"] },
] as const;

/** Split robots.txt into groups: consecutive User-agent lines share one rule set. */
export function parseRobotsGroups(robots: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let sawRule = false;

  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (key === "user-agent") {
      if (!current || sawRule) {
        current = { agents: [], allow: [], disallow: [] };
        groups.push(current);
        sawRule = false;
      }
      current.agents.push(value.toLowerCase());
    } else if ((key === "allow" || key === "disallow") && current) {
      sawRule = true;
      current[key].push(value);
    } else if (key === "crawl-delay" && current) {
      sawRule = true;
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.crawlDelay = n;
    }
  }
  return groups;
}

function groupsFor(groups: RobotsGroup[], agent: string): RobotsGroup[] {
  const token = agent.toLowerCase();
  const specific = groups.filter((g) => g.agents.includes(token));
  if (specific.length) return specific;
  return groups.filter((g) => g.agents.includes("*"));
}

function verdictFor(groups: RobotsGroup[]): "allow" | "block" {
  const allow = groups.flatMap((g) => g.allow);
  const disallow = groups.flatMap((g) => g.disallow);
  // Whole-site block = "Disallow: /" not overridden by "Allow: /" (RFC 9309:
  // equal-length matches resolve to allow).
  return disallow.includes("/") && !allow.includes("/") ? "block" : "allow";
}

/**
 * Whether robots.txt lets `bot` crawl the site root. A group naming the bot
 * takes precedence over `*`; rules from other bots' groups never apply.
 */
export function parseRobotsAllow(robots: string, bot: string): RobotsVerdict {
  if (!robots) return "unknown";
  const groups = groupsFor(parseRobotsGroups(robots), bot);
  return groups.length ? verdictFor(groups) : "allow";
}

export type EngineAccessSummary = {
  id: string;
  name: string;
  state: "open" | "partial" | "blocked" | "unknown";
  bots: string[];
  blocked: string[];
};

/** Roll the per-crawler robots.txt verdicts up to one state per AI product. */
export function summarizeEngines(robots: string): EngineAccessSummary[] {
  return AI_ENGINES.map((e) => {
    const bots = [...e.bots];
    if (!robots) return { id: e.id, name: e.name, state: "unknown", bots, blocked: [] };
    const blocked = bots.filter((b) => parseRobotsAllow(robots, b) === "block");
    const state =
      blocked.length === 0 ? "open" : blocked.length === bots.length ? "blocked" : "partial";
    return { id: e.id, name: e.name, state, bots, blocked };
  });
}

function patternToRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/**
 * RFC 9309 path check for `agent` (with `*` fallback). The longest matching
 * rule wins; on a tie Allow wins. An empty Disallow allows everything.
 */
export function isPathAllowed(robots: string, agent: string, pathWithQuery: string): boolean {
  if (!robots) return true;
  const groups = groupsFor(parseRobotsGroups(robots), agent);
  if (!groups.length) return true;
  let best: { length: number; allow: boolean } | null = null;
  for (const g of groups) {
    for (const [rules, allow] of [
      [g.allow, true],
      [g.disallow, false],
    ] as const) {
      for (const rule of rules) {
        if (!rule) continue;
        if (!patternToRegex(rule).test(pathWithQuery)) continue;
        const length = rule.length;
        if (!best || length > best.length || (length === best.length && allow)) {
          best = { length, allow };
        }
      }
    }
  }
  return best ? best.allow : true;
}

/** Crawl-delay (seconds) declared for `agent` or `*`, if any. */
export function crawlDelayFor(robots: string, agent: string): number | null {
  if (!robots) return null;
  const delays = groupsFor(parseRobotsGroups(robots), agent)
    .map((g) => g.crawlDelay)
    .filter((d): d is number => typeof d === "number");
  return delays.length ? Math.max(...delays) : null;
}

/** Sitemap URLs declared anywhere in robots.txt. */
export function robotsSitemaps(robots: string): string[] {
  const out: string[] = [];
  for (const raw of robots.split(/\r?\n/)) {
    const m = /^\s*sitemap\s*:\s*(\S+)/i.exec(raw);
    if (m && /^https?:\/\//i.test(m[1]) && !out.includes(m[1])) out.push(m[1]);
  }
  return out.slice(0, 20);
}
