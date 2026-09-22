// Shared backlink types. No server imports — the UI reads these too.

/**
 * The honest lifecycle. Each value means exactly one thing, and the UI must
 * never blur them: an opportunity is not a link, and a publisher saying
 * "published" is not proof.
 */
export type OpportunityStatus =
  | "opportunity"
  | "planned"
  | "in_progress"
  | "submitted"
  | "pending"
  | "published"
  | "live"
  | "failed"
  | "removed";

export type OpportunityKind =
  "competitor_gap" | "reclaim" | "broken" | "resource_page" | "directory";

export type AcquisitionMethod =
  | "outreach"
  | "resource_submission"
  | "broken_link_replacement"
  | "guest_contribution"
  | "self_publish";

export type CampaignGoal = "authority" | "referral" | "ai_visibility" | "discovery" | "brand";

/** What our own fetch of the published page found. */
export type VerificationResult =
  "pending" | "live" | "nofollow" | "missing" | "unreachable" | "blocked";

export type EventType =
  | "discovered"
  | "selected"
  | "method_chosen"
  | "draft_created"
  | "draft_edited"
  | "submitted"
  | "publisher_responded"
  | "published"
  | "verified"
  | "verification_failed"
  | "status_changed"
  | "skipped"
  | "reopened";

export type OutreachDraft = {
  subject: string | null;
  body: string | null;
  updatedAt: string;
};

/** Claude's grounding for a single opportunity. Never used for ordering. */
export type OpportunityAi = {
  why: string;
  angle: string;
  suggestedAnchor: string;
  confidence: "high" | "medium" | "low";
};

export type OpportunityEvidence = {
  competitors?: string[];
  anchors?: string[];
  samplePages?: string[];
  brokenUrl?: string;
  lostAt?: string | null;
};
