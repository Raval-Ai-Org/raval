// contracts.ts — what the browser sees about publishing an article to the
// workspace's own website. No tokens, no raw provider responses.

import type { SiteBindingView, SiteProviderId } from "@/lib/geo/fix-contracts";
import type { GateCheck } from "./render";

export type BlogStatus =
  "missing" | "detected" | "creating" | "created" | "needs_design" | "failed";

export type BlogView = {
  provider: SiteProviderId;
  status: BlogStatus;
  detail: string | null;
  blogUrl: string | null;
  /** Mellox can set a blog up here in one click (Webflow: a blog collection). */
  canCreate: boolean;
  /** Where posts go, in words ("WordPress posts", "the Blog Posts collection", "src/content/blog"). */
  destination: string | null;
};

export type PublicationStatus =
  | "approved"
  | "publishing"
  | "pr_open"
  | "published"
  | "verifying"
  | "verified"
  | "needs_attention"
  | "failed"
  | "cancelled";

export type PublicationView = {
  id: string;
  host: string;
  provider: SiteProviderId;
  slug: string;
  title: string;
  status: PublicationStatus;
  statusDetail: string | null;
  url: string | null;
  pr: { number: number; url: string } | null;
  scheduledFor: string | null;
  publishedAt: string | null;
  verifiedAt: string | null;
  checks: { label: string; ok: boolean; detail: string }[];
  lastError: string | null;
  createdAt: string;
};

export type PublishPreview = {
  host: string | null;
  /** Every website this workspace can publish to (its domain and connected sites). */
  targets: string[];
  site: SiteBindingView | null;
  blog: BlogView | null;
  article: {
    title: string;
    slug: string;
    url: string | null;
    metaDescription: string;
    words: number;
    faq: number;
  };
  gate: { ok: boolean; checks: GateCheck[] };
  /** Whether Mellox writes the article's structured data, or the site's theme/template does. */
  structuredData: "mellox" | "site";
  canPublish: boolean;
  reason: string | null;
  publication: PublicationView | null;
};

export const PUBLICATION_ACTIVE: PublicationStatus[] = [
  "approved",
  "publishing",
  "pr_open",
  "published",
  "verifying",
];
