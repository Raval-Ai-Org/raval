// rules.ts — Engage automations (ManyChat-style): "when someone comments
// on these posts with these words → reply publicly and/or send a private
// message". Pure and browser-safe; the Inbox's "Test a comment" uses the
// same `pickRule` the server does.
//
// What code decides, never a model:
//   * which automation a comment belongs to (first live one, in order);
//   * that a rule only acts on comments written after it went live;
//   * which fixed reply is used (rotates by comment, so neighbours differ);
//   * what may send by itself: only fixed replies and fixed messages. A reply
//     Mox writes always waits for a person;
//   * the hourly cap on automatic sends.
import type { EngagePlatform } from "./contracts";
import { matchKeywords } from "./keywords";

export type RuleReplyMode = "fixed" | "mox" | "none";
export type RuleSendMode = "auto" | "approve";

export type EngageRule = {
  id: string;
  name: string;
  status: "live" | "paused";
  platforms: EngagePlatform[];
  postScope: "any" | "posts";
  postIds: string[];
  match: "keywords" | "any";
  keywords: string[];
  wholeWord: boolean;
  replyMode: RuleReplyMode;
  replies: string[];
  moxGuidance: string | null;
  dmEnabled: boolean;
  dmMessage: string | null;
  dmLink: string | null;
  sendMode: RuleSendMode;
  position: number;
  liveSince: string;
  matchedCount: number;
  sentCount: number;
  dmCount: number;
  lastMatchedAt: string | null;
};

/** What a person may change. */
export type RuleInput = Pick<
  EngageRule,
  | "name"
  | "platforms"
  | "postScope"
  | "postIds"
  | "match"
  | "keywords"
  | "wholeWord"
  | "replyMode"
  | "replies"
  | "moxGuidance"
  | "dmEnabled"
  | "dmMessage"
  | "dmLink"
  | "sendMode"
>;

/** Automatic sends per brand per hour, well under Meta's own limits. */
export const AUTO_SENDS_PER_HOUR = 60;
export const MAX_RULES = 30;
export const MAX_KEYWORDS = 30;
export const MAX_REPLIES = 10;

const ID_RE = /^[0-9_]{1,80}$/;

function clean(s: unknown, max: number): string {
  return typeof s === "string" ? s.replace(/\r/g, "").trim().slice(0, max) : "";
}

function uniq(list: string[]): string[] {
  const seen = new Set<string>();
  return list.filter((v) => {
    const k = v.toLowerCase();
    if (!v || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function httpsLink(v: unknown): string | null {
  const s = clean(v, 2000);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" && !u.username && !u.password ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Tidy what a person typed into a rule, or say what is missing. The same
 * function runs in the builder (to show the problem) and on the server.
 */
export function tidyRule(
  input: Partial<RuleInput>,
): { ok: true; rule: RuleInput } | { ok: false; reason: string } {
  const platforms = uniq(
    (input.platforms ?? []).filter((p) => p === "instagram" || p === "facebook"),
  ) as EngagePlatform[];
  const postIds = uniq(
    (input.postIds ?? []).map((p) => clean(p, 80)).filter((p) => ID_RE.test(p)),
  ).slice(0, 30);
  const keywords = uniq((input.keywords ?? []).map((k) => clean(k, 60))).slice(0, MAX_KEYWORDS);
  const replies = uniq((input.replies ?? []).map((r) => clean(r, 2200))).slice(0, MAX_REPLIES);
  const rule: RuleInput = {
    name: clean(input.name, 80) || "New automation",
    platforms,
    postScope: input.postScope === "posts" ? "posts" : "any",
    postIds,
    match: input.match === "any" ? "any" : "keywords",
    keywords,
    wholeWord: input.wholeWord !== false,
    replyMode: input.replyMode === "mox" || input.replyMode === "none" ? input.replyMode : "fixed",
    replies,
    moxGuidance: clean(input.moxGuidance, 1000) || null,
    dmEnabled: !!input.dmEnabled,
    dmMessage: clean(input.dmMessage, 1000) || null,
    dmLink: httpsLink(input.dmLink),
    sendMode: input.sendMode === "auto" ? "auto" : "approve",
  };
  if (!rule.platforms.length) return { ok: false, reason: "Pick Instagram, Facebook or both." };
  if (rule.postScope === "posts" && !rule.postIds.length)
    return { ok: false, reason: "Pick at least one post, or choose any post." };
  if (rule.match === "keywords" && !rule.keywords.length)
    return { ok: false, reason: "Add at least one word to listen for." };
  if (rule.replyMode === "fixed" && !rule.replies.length)
    return { ok: false, reason: "Write at least one reply." };
  if (clean(input.dmLink, 2000) && !rule.dmLink)
    return { ok: false, reason: "The link must start with https://." };
  if (rule.dmEnabled && !rule.dmMessage)
    return { ok: false, reason: "Write the private message, or turn it off." };
  if (rule.replyMode === "none" && !rule.dmEnabled)
    return { ok: false, reason: "Choose a public reply, a private message, or both." };
  if (rule.match === "any" && rule.postScope === "any" && rule.sendMode === "auto")
    return {
      ok: false,
      reason:
        "Replying to every comment on every post by itself is too broad. Pick posts, add words, or ask first.",
    };
  return { ok: true, rule };
}

export type RuleComment = {
  id: string;
  platform: EngagePlatform;
  postId: string;
  body: string;
  commentedAt: string;
};

/** The first live automation this comment belongs to, in the person's order. */
export function pickRule(
  comment: RuleComment,
  rules: readonly EngageRule[],
): { rule: EngageRule; keyword: string | null } | null {
  const ordered = [...rules].sort((a, b) => a.position - b.position);
  for (const rule of ordered) {
    if (rule.status !== "live") continue;
    if (!rule.platforms.includes(comment.platform)) continue;
    if (Date.parse(comment.commentedAt) < Date.parse(rule.liveSince)) continue;
    if (rule.postScope === "posts" && !rule.postIds.includes(comment.postId)) continue;
    if (rule.match === "any") return { rule, keyword: null };
    const m = matchKeywords(comment.body, rule.keywords, rule.wholeWord);
    if (m.matched) return { rule, keyword: m.keyword };
  }
  return null;
}

/** Which fixed reply this comment gets: rotates by comment id, so it is stable on retry. */
export function pickReply(replies: readonly string[], commentId: string): string | null {
  if (!replies.length) return null;
  let h = 0;
  for (const ch of commentId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return replies[h % replies.length];
}

/** Fill {name} with the commenter's first name, or drop it cleanly. */
export function personalize(text: string, authorName: string | null): string {
  const first =
    (authorName ?? "")
      .replace(/^@/, "")
      .split(/[\s._]+/)[0]
      ?.slice(0, 40) ?? "";
  return text
    .replace(/\{name\}/gi, first)
    .replace(/\s+([,!.?])/g, "$1")
    .replace(/^[,\s]+/, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** The private message as it is sent: the message, then the link on its own line. */
export function dmText(
  rule: Pick<EngageRule, "dmMessage" | "dmLink">,
  authorName: string | null,
): string | null {
  if (!rule.dmMessage) return null;
  const body = personalize(rule.dmMessage, authorName);
  return rule.dmLink && !body.includes(rule.dmLink) ? `${body}\n\n${rule.dmLink}` : body;
}

/** May this rule send without a person? Only fixed words do; Mox's never. */
export function sendsByItself(rule: Pick<EngageRule, "sendMode" | "replyMode">): boolean {
  return rule.sendMode === "auto" && rule.replyMode !== "mox";
}

/** Ready-made starting points, ManyChat style. */
export const RULE_TEMPLATES: {
  id: string;
  title: string;
  blurb: string;
  rule: Partial<RuleInput>;
}[] = [
  {
    id: "link-in-dm",
    title: "Send a link by DM",
    blurb: "Someone comments a word, they get your link in a private message.",
    rule: {
      name: "Link by DM",
      platforms: ["instagram", "facebook"],
      postScope: "any",
      match: "keywords",
      keywords: ["link", "info"],
      replyMode: "fixed",
      replies: ["Sent it to your messages, {name}!", "Check your DMs {name}, it's there!"],
      dmEnabled: true,
      dmMessage: "Hi {name}! Here's the link you asked for:",
      sendMode: "auto",
    },
  },
  {
    id: "price",
    title: "Answer price questions",
    blurb: "Mox answers price and cost questions from what you taught it.",
    rule: {
      name: "Price questions",
      platforms: ["instagram", "facebook"],
      postScope: "any",
      match: "keywords",
      keywords: ["price", "cost", "how much", "rate", "qeemat"],
      wholeWord: true,
      replyMode: "mox",
      moxGuidance:
        "Answer the price question from what you know. If you don't know, invite them to send a message.",
      sendMode: "approve",
    },
  },
  {
    id: "thanks",
    title: "Thank every commenter",
    blurb: "A warm thank-you on chosen posts, from a few versions you write.",
    rule: {
      name: "Thank you",
      platforms: ["instagram", "facebook"],
      postScope: "posts",
      match: "any",
      replyMode: "fixed",
      replies: ["Thank you {name}!", "So glad you like it, {name}!", "Thanks for the love {name}!"],
      sendMode: "auto",
    },
  },
];
