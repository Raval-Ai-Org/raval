// contracts.ts — the browser-facing shape of a competitor.
//
// Kept free of `server-only` so components may `import type` from it, and free
// of database row shapes so a schema change does not ripple into the UI. Every
// field a card renders is here, and every claim that came from the web carries
// the source it came from: the Competitors surface shows a source chip or it
// shows nothing.

export type CompetitorStatus = "suggested" | "tracked" | "ignored";
export type CompetitorSource = "discovered" | "manual" | "brand_dna";
export type CompetitorRelationship = "direct" | "indirect" | "alternative" | "unknown";
export type CompetitorProfileStatus = "pending" | "running" | "ready" | "failed";

export type CompetitorEvidence = { claim: string; source: string };

export type CompetitorSourceLink = { title: string; url: string; snippet?: string };

/**
 * What Mellox knows about a competitor after researching them. Every list may
 * be empty: an unsupported field is left blank rather than guessed, which is
 * why the UI can treat "present" as "grounded".
 */
export type CompetitorProfile = {
  /** One or two plain sentences: who they are and what they do. */
  summary: string;
  products: string[];
  targetCustomers: string;
  /** Concrete, checkable facts (founded, headcount, markets, funding). */
  companyFacts: string[];
  positioning: string;
  strengths: string[];
  weaknesses: string[];
  pricingSignals: string;
  differentiators: string[];
  contentThemes: string[];
  /** Quoted or closely paraphrased claims, each with the page it came from. */
  evidence: CompetitorEvidence[];
  /** Pages actually read to build this profile. */
  pagesRead: string[];
  /** Off-site sources consulted (news, reviews, comparisons). */
  sources: CompetitorSourceLink[];
  /** How the page text was obtained — surfaced so a thin profile is explicable. */
  contentProvider: "firecrawl" | "tavily" | "none";
};

export type CompetitorView = {
  id: string;
  workspaceId: string;
  name: string;
  domain: string;
  url: string | null;
  source: CompetitorSource;
  status: CompetitorStatus;
  relationship: CompetitorRelationship;
  confidence: number;
  rationale: string | null;
  discoverySources: CompetitorSourceLink[];
  profile: CompetitorProfile | null;
  profileStatus: CompetitorProfileStatus;
  profileError: string | null;
  profileUpdatedAt: string | null;
  updatesCheckedAt: string | null;
  /** Unread meaningful changes, for the card badge. */
  unreadUpdates: number;
  lastUpdateAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CompetitorUpdateKind =
  "launch" | "pricing" | "positioning" | "funding" | "campaign" | "content" | "site_change";

export type CompetitorUpdateView = {
  id: string;
  competitorId: string;
  competitorName: string;
  competitorDomain: string;
  kind: CompetitorUpdateKind;
  title: string;
  summary: string | null;
  significance: "major" | "notable";
  sourceUrl: string | null;
  sourceTitle: string | null;
  publishedAt: string | null;
  detectedAt: string;
  readAt: string | null;
};

/** A competitor proposed by discovery but not yet saved. */
export type CompetitorSuggestion = {
  name: string;
  domain: string;
  url: string;
  relationship: CompetitorRelationship;
  confidence: number;
  rationale: string;
  whatTheyDo: string;
  sources: CompetitorSourceLink[];
};

export type CompetitorOverview = {
  competitors: CompetitorView[];
  suggestions: CompetitorView[];
  updates: CompetitorUpdateView[];
  unreadUpdates: number;
  /** False when no research provider is configured — the UI says so plainly. */
  researchAvailable: boolean;
  /** When discovery last ran for this workspace, if it ever has. */
  lastDiscoveryAt: string | null;
};

export const UPDATE_KIND_LABELS: Record<CompetitorUpdateKind, string> = {
  launch: "New product",
  pricing: "Pricing",
  positioning: "Positioning",
  funding: "Funding",
  campaign: "Campaign",
  content: "Content",
  site_change: "Website change",
};

export const RELATIONSHIP_LABELS: Record<CompetitorRelationship, string> = {
  direct: "Direct",
  indirect: "Indirect",
  alternative: "Alternative",
  unknown: "Unclear",
};
