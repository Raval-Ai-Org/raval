// robots.ts — robots.txt parsing for AI-engine access and crawl politeness.
//
// Two questions, two functions:
//   • parseRobotsAllow / summarizeEngines — can an AI product's crawler read
//     the site at all? (a whole-site "Disallow: /" for that agent)
//   • isPathAllowed — may Mellox's own crawler fetch this path? RFC 9309
//     longest-match with `*` and `$`, so the scan never ignores a site's rules.

export type RobotsVerdict = "allow" | "block" | "unknown";

type RobotsGroup = { agents: string[]; allow: string[]; disallow: string[]; crawlDelay?: number };

/**
 * What a crawler is for, as its vendor documents it:
 *   search    builds the index answers are drawn from — blocking it removes you from answers
 *   user      fetches a page when a person asks about it — blocking it breaks live lookups
 *   training  collects model training data — blocking it is a policy choice and
 *             does not decide whether you appear in answers
 */
export type AiBotTier = "search" | "user" | "training";

export type AiBot = { id: string; who: string; tier: AiBotTier };

// Order is stable: rule ids (`ai.bot.<id>`) derive from these ids. Add, don't rename.
export const AI_BOTS: readonly AiBot[] = [
  { id: "GPTBot", who: "OpenAI training crawler", tier: "training" },
  { id: "ChatGPT-User", who: "ChatGPT fetching a page for a person", tier: "user" },
  { id: "OAI-SearchBot", who: "ChatGPT search index", tier: "search" },
  { id: "ClaudeBot", who: "Anthropic training crawler", tier: "training" },
  { id: "Claude-Web", who: "Claude's older browsing agent", tier: "training" },
  { id: "PerplexityBot", who: "Perplexity search index", tier: "search" },
  { id: "Google-Extended", who: "Gemini training control", tier: "training" },
  { id: "Applebot-Extended", who: "Apple Intelligence training control", tier: "training" },
  { id: "CCBot", who: "Common Crawl", tier: "training" },
  { id: "Bytespider", who: "ByteDance / Doubao", tier: "training" },
  { id: "Claude-SearchBot", who: "Claude search index", tier: "search" },
  { id: "Claude-User", who: "Claude fetching a page for a person", tier: "user" },
  { id: "Perplexity-User", who: "Perplexity fetching a page for a person", tier: "user" },
  { id: "Googlebot", who: "Google Search, AI Overviews and AI Mode", tier: "search" },
  { id: "Bingbot", who: "Bing and Microsoft Copilot", tier: "search" },
  { id: "DuckAssistBot", who: "DuckDuckGo AI answers", tier: "user" },
  { id: "MistralAI-User", who: "Mistral Le Chat fetching a page for a person", tier: "user" },
  { id: "Meta-ExternalAgent", who: "Meta AI crawler", tier: "training" },
  { id: "Amazonbot", who: "Amazon crawler (Alexa and AI)", tier: "training" },
];

export const AI_BOT_BY_ID: ReadonlyMap<string, AiBot> = new Map(
  AI_BOTS.map((b) => [b.id.toLowerCase(), b]),
);

/** Crawlers that decide whether a site can appear in AI answers. */
export const ANSWER_BOTS: readonly AiBot[] = AI_BOTS.filter((b) => b.tier !== "training");

// Which answer engine each crawler feeds. An engine's state is judged on its
// search and user crawlers only; a blocked training crawler is listed apart.
export const AI_ENGINES = [
  { id: "chatgpt", name: "ChatGPT", bots: ["OAI-SearchBot", "ChatGPT-User", "GPTBot"] },
  { id: "claude", name: "Claude", bots: ["Claude-SearchBot", "Claude-User", "ClaudeBot"] },
  { id: "gemini", name: "Google AI", bots: ["Googlebot", "Google-Extended"] },
  { id: "perplexity", name: "Perplexity", bots: ["PerplexityBot", "Perplexity-User"] },
  { id: "copilot", name: "Copilot", bots: ["Bingbot"] },
  { id: "apple", name: "Apple Intelligence", bots: ["Applebot-Extended"] },
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
  /** Blocked search / user crawlers — these keep the site out of answers. */
  blocked: string[];
  /** Blocked training crawlers — a choice, not a problem. */
  trainingBlocked?: string[];
};

/** Roll the per-crawler robots.txt verdicts up to one state per AI product. */
export function summarizeEngines(robots: string): EngineAccessSummary[] {
  return AI_ENGINES.map((e) => {
    const bots: string[] = [...e.bots];
    if (!robots) return { id: e.id, name: e.name, state: "unknown", bots, blocked: [] };
    const isBlocked = (b: string) => parseRobotsAllow(robots, b) === "block";
    const answer = bots.filter((b) => AI_BOT_BY_ID.get(b.toLowerCase())?.tier !== "training");
    const blocked = answer.filter(isBlocked);
    const trainingBlocked = bots.filter((b) => !answer.includes(b) && isBlocked(b));
    // An engine with only a training control (Apple) is open unless that is blocked.
    const judged = answer.length ? answer : bots;
    const judgedBlocked = answer.length ? blocked : trainingBlocked;
    const state =
      judgedBlocked.length === 0
        ? "open"
        : judgedBlocked.length === judged.length
          ? "blocked"
          : "partial";
    return { id: e.id, name: e.name, state, bots, blocked, trainingBlocked };
  });
}

/** Paths (with query) from `paths` that robots.txt disallows for `bot`. */
export function blockedPathsFor(robots: string, bot: string, paths: string[]): string[] {
  if (!robots) return [];
  return paths.filter((p) => !isPathAllowed(robots, bot, p));
}

/**
 * Cloudflare's Content Signals line (`Content-Signal: search=yes, ai-input=no, ai-train=no`).
 * A proposal no engine has confirmed honouring — reported, never scored.
 */
export function contentSignals(robots: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const raw of robots.split(/\r?\n/)) {
    const m = /^\s*content-signal\s*:\s*(.+)$/i.exec(raw.replace(/#.*/, ""));
    if (!m) continue;
    for (const part of m[1].split(",")) {
      const [k, v] = part.split("=").map((s) => s.trim().toLowerCase());
      if (k && v && /^[a-z-]+$/.test(k) && /^(yes|no)$/.test(v)) out[k] = v;
    }
  }
  return Object.keys(out).length ? out : null;
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
