// contracts.ts — what Engage (comments, automations and Train Mox for the
// brand's own Instagram and Facebook posts) sends to the browser. Pure and
// browser-safe.
import type { EngageRule } from "./rules";
import type { EngageAnswer, EngageExample } from "./training";

export type { EngageRule, RuleInput } from "./rules";
export type { EngageAnswer, EngageExample } from "./training";

export type EngagePlatform = "instagram" | "facebook";

export type EngageStatus = "new" | "drafted" | "sending" | "replied" | "dismissed" | "unknown";

export type EngageDmStatus = "none" | "pending" | "sent" | "failed" | "skipped" | "unknown";

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
  /** A comment on a post, or a private message (DM) someone sent the brand. */
  kind: "comment" | "dm";
  platform: EngagePlatform;
  pageName: string;
  igUsername: string | null;
  authorName: string | null;
  body: string;
  commentedAt: string;
  postId: string;
  postCaption: string | null;
  postPermalink: string | null;
  status: EngageStatus;
  draft: string | null;
  replyText: string | null;
  repliedAt: string | null;
  lastError: string | null;
  /** The automation this comment matched, if any. */
  ruleId: string | null;
  ruleName: string | null;
  matchedKeyword: string | null;
  autoSent: boolean;
  dmStatus: EngageDmStatus;
  dmText: string | null;
  dmError: string | null;
  /** What auto-reply did: answered, waits for a team answer, needs a person, skipped. */
  moxState: EngageMoxState;
  moxNote: string | null;
  questionId: string | null;
};

export type EngageMoxState = "none" | "replied" | "waiting_info" | "needs_person" | "skipped";

/** Something Mox needed to know and didn't, asked once for every comment like it. */
export type EngageQuestion = {
  id: string;
  question: string;
  askedCount: number;
  exampleComment: string | null;
  createdAt: string;
};

export type EngageHome = {
  /** Meta keys are set on this server. */
  configured: boolean;
  connection: {
    status: "active" | "error" | "suspended";
    accountName: string;
    lastError: string | null;
    /** The person allowed private messages (Instagram and/or Facebook). */
    canMessage: { instagram: boolean; facebook: boolean };
  } | null;
  pages: EngagePage[];
  comments: EngageComment[];
  counts: { waiting: number; replied: number; autoReplied: number };
  automationsOn: boolean;
  /** Mox answers new comments by itself. */
  autoReply: boolean;
  /** The team's own rules for every reply. */
  guidelines: string;
  /** What Mox is waiting to learn from the team. */
  questions: EngageQuestion[];
  rules: EngageRule[];
  answers: EngageAnswer[];
  examples: EngageExample[];
};

/** A recent post, for choosing which posts an automation listens to. */
export type EngagePost = {
  id: string;
  platform: EngagePlatform;
  caption: string | null;
  permalink: string | null;
  thumbnail: string | null;
  postedAt: string | null;
};

export type EngageDraft = { text: string; removed: number };

export type EngageSyncResult = {
  pages: number;
  added: number;
  errors: number;
  /** Replies sent by themselves this read (quick replies and Mox). */
  automated: number;
  /** New questions Mox asked the team. */
  asked: number;
};

export const PLATFORM_LABEL: Record<EngagePlatform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
};
