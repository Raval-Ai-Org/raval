// Community Intelligence: real discussions on Reddit, Quora, Hacker News and
// Stack Exchange where people ask about the brand's problem, its field or its
// competitors. Read only: looking again, reply drafts and posting stay a
// person's click in the app (Mellox never posts a reply).
import "server-only";
import { z } from "zod";
import {
  MATCH_LABELS,
  SOURCE_LABELS,
  type CommunityHome,
  type CommunityThreadView,
} from "@/lib/community/contracts";
import { callFn } from "../bridge.server";
import { uuid, type McpTool } from "../tool";

function summary(t: CommunityThreadView) {
  return {
    threadId: t.id,
    url: t.url,
    where: `${SOURCE_LABELS[t.source]} · ${t.community}`,
    title: t.title,
    summary: t.summary || null,
    why: MATCH_LABELS[t.matchedOn],
    competitor: t.competitorName,
    status: t.status,
    postedAt: t.postedAt,
    foundAt: t.foundAt,
    hasReplyDraft: !!t.reply,
  };
}

export const communityTools: McpTool[] = [
  {
    name: "list_community_threads",
    title: "Community threads",
    description:
      "Real discussions Mellox found on Reddit, Quora, Hacker News and Stack Exchange where people ask about the brand's problem, its field or its tracked competitors, each with its link. Also counts: mentions per competitor, questions that keep coming back, busiest communities. Replies are drafted and posted by a person in the app.",
    input: {
      why: z.enum(["all", "problem", "competitor", "alternative", "category"]).optional(),
      source: z.enum(["all", "reddit", "quora", "hackernews", "stackexchange"]).optional(),
    },
    scope: "workspace",
    minRole: "viewer",
    write: false,
    run: async ({ workspaceId, why, source }, { caller }) => {
      const home = await callFn<CommunityHome>(caller, "community", "getCommunityHome", {
        workspaceId,
      });
      const threads = home.threads.filter(
        (t) =>
          (!why || why === "all" || t.matchedOn === why) &&
          (!source || source === "all" || t.source === source),
      );
      return {
        threads: threads.slice(0, 40).map(summary),
        counts: home.signals,
        lastLookedAt: home.job.lastRunAt,
      };
    },
  },
  {
    name: "get_community_thread",
    title: "One community thread",
    description:
      "One discussion in full: where it is, its link, what was said in the part Mellox read, why it was found, and the latest reply draft if the team made one. Use the threadId from list_community_threads.",
    input: { threadId: uuid },
    scope: "workspace",
    minRole: "viewer",
    write: false,
    run: async ({ workspaceId, threadId }, { caller }) => {
      const t = await callFn<CommunityThreadView>(caller, "community", "getCommunityThread", {
        workspaceId,
        threadId,
      });
      return {
        ...summary(t),
        text: t.snippet,
        foundFor: t.matchedTerm,
        replyDraft: t.reply?.text ?? null,
      };
    },
  },
];
