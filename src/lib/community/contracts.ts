// Community Intelligence (Brain → Market → Communities): real discussions where
// people ask about the brand's problem, its competitors or its category, and
// reply drafts a person posts themselves. Browser-safe types and labels.
//
// Mellox never posts a reply. Reddit's own API is off until Reddit approves
// commercial use (FEATURE_FLAG_REDDIT_API_ENABLED); discovery reads Reddit and
// Quora through the one web-search path, and Hacker News and Stack Exchange
// through their open APIs.

/** Where a thread lives. Ids are stored: add, never rename. */
export const COMMUNITY_SOURCES = ["reddit", "quora", "hackernews", "stackexchange"] as const;
export type CommunitySource = (typeof COMMUNITY_SOURCES)[number];

export const SOURCE_LABELS: Record<CommunitySource, string> = {
  reddit: "Reddit",
  quora: "Quora",
  hackernews: "Hacker News",
  stackexchange: "Stack Exchange",
};

/** Why a thread was found. Ids are stored: add, never rename. */
export const MATCH_KINDS = ["problem", "competitor", "alternative", "category"] as const;
export type MatchKind = (typeof MATCH_KINDS)[number];

export const MATCH_LABELS: Record<MatchKind, string> = {
  problem: "Someone has the problem you solve",
  competitor: "Mentions a competitor",
  alternative: "Looking for an alternative",
  category: "About your field",
};

/** Short chip text. */
export const MATCH_CHIPS: Record<MatchKind, string> = {
  problem: "Problem",
  competitor: "Competitor",
  alternative: "Alternative",
  category: "Your field",
};

export const THREAD_STATUSES = ["new", "saved", "replied", "hidden"] as const;
export type ThreadStatus = (typeof THREAD_STATUSES)[number];

export type CommunityReply = {
  text: string;
  /** True when the reply names the brand, so it says the writer works there. */
  disclosed: boolean;
  /** Sentences left out because they carried a figure the brand never gave. */
  removed: number;
  createdAt: string;
};

export type CommunityThreadView = {
  id: string;
  url: string;
  source: CommunitySource;
  /** "r/espresso", "Hacker News", "superuser", "Quora". */
  community: string;
  title: string;
  snippet: string;
  /** Mellox's one-line summary of the supplied text; empty when not classified. */
  summary: string;
  matchedOn: MatchKind;
  /** The words of the query that found it. */
  matchedTerm: string;
  /** The tracked competitor it mentions, when matchedOn is competitor/alternative. */
  competitorName: string | null;
  /** 0-100, Mellox's own read of how relevant it is. */
  relevance: number;
  postedAt: string | null;
  foundAt: string;
  status: ThreadStatus;
  reply: CommunityReply | null;
};

export type CommunityWatchKind = "keyword" | "community";
export type CommunityWatch = {
  id: string;
  kind: CommunityWatchKind;
  value: string;
};

/** Only counts of rows that exist. Never a reach, ranking or AI-citation claim. */
export type CommunitySignals = {
  competitorMentions: Array<{ name: string; count: number }>;
  recurringQuestions: Array<{ question: string; count: number; threadIds: string[] }>;
  activeCommunities: Array<{ source: CommunitySource; community: string; count: number }>;
};

export type CommunityJobState = "never" | "queued" | "running" | "idle" | "failed" | "paused";

export type CommunityHome = {
  threads: CommunityThreadView[];
  watches: CommunityWatch[];
  signals: CommunitySignals;
  job: {
    state: CommunityJobState;
    lastRunAt: string | null;
    nextRunAt: string | null;
    lastFound: number;
    error: string | null;
  };
  /** False when no web search provider is configured (only HN and Stack Exchange work). */
  webSearch: boolean;
  /** Always false until Reddit approves commercial API use. */
  redditApi: boolean;
};

/**
 * How often a workspace is looked at again by itself: weekly, on Growth and up,
 * while a person uses the workspace (communityGate, src/lib/background/gate.ts).
 * "Look now" is always a click.
 */
export const REFRESH_HOURS = 168;
/** A refresh a person asks for is skipped if one ran this recently. */
export const MANUAL_REFRESH_MIN_HOURS = 6;
/** Threads kept in the view. */
export const MAX_THREADS_SHOWN = 120;
/** Watches a workspace may keep. */
export const MAX_WATCHES = 20;
