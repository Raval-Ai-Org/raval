// contracts.ts — what Engage (comment replies on the brand's own Instagram
// and Facebook posts) sends to the browser. Pure and browser-safe.

export type EngagePlatform = "instagram" | "facebook";

export type EngageStatus = "new" | "drafted" | "sending" | "replied" | "dismissed" | "unknown";

export type EngagePage = {
  id: string;
  pageName: string;
  igUsername: string | null;
  hasInstagram: boolean;
  syncedAt: string | null;
  lastError: string | null;
};

export type EngageComment = {
  id: string;
  platform: EngagePlatform;
  pageName: string;
  igUsername: string | null;
  authorName: string | null;
  body: string;
  commentedAt: string;
  postCaption: string | null;
  postPermalink: string | null;
  status: EngageStatus;
  draft: string | null;
  replyText: string | null;
  repliedAt: string | null;
  lastError: string | null;
};

export type EngageHome = {
  /** Meta keys are set on this server. */
  configured: boolean;
  connection: {
    status: "active" | "error" | "suspended";
    accountName: string;
    lastError: string | null;
  } | null;
  pages: EngagePage[];
  comments: EngageComment[];
  counts: { waiting: number; replied: number };
};

export type EngageDraft = { text: string; removed: number };

export type EngageSyncResult = { pages: number; added: number; errors: number };

export const PLATFORM_LABEL: Record<EngagePlatform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
};
