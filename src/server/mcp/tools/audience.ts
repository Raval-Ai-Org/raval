// Audience: who a workspace's content is for, and how a piece is likely to land.
import "server-only";
import type { AudienceView, PredictionView } from "@/lib/audience/contracts";
import type { McpCaller } from "../access.server";
import { callFn } from "../bridge.server";
import { uuid, type McpTool } from "../tool";

const view = (caller: McpCaller, workspaceId: string) =>
  callFn<AudienceView>(caller, "audience", "getAudience", { workspaceId });

function presentPrediction(p: PredictionView) {
  return {
    contentItemId: p.contentItemId,
    title: p.title,
    platform: p.platform,
    score: p.overall,
    parts: p.dimensions,
    kind: p.depth === "pulse" ? "simulated panel" : "quick score",
    confidence: p.confidence,
    adjustedUsingRealPosts: p.measuredPosts,
    why: p.why,
    whatToChange: p.fixes,
    scoredAt: p.createdAt,
  };
}

export const audienceTools: McpTool[] = [
  {
    name: "get_audience",
    title: "Audience",
    description:
      "Who this brand's content is for: its audience groups (each statement labelled with where it came from, including guesses), what real results have shown, and how close past scores were to real results.",
    input: {},
    scope: "workspace",
    minRole: "viewer",
    write: false,
    run: async ({ workspaceId }, { caller }) => {
      const v = await view(caller, workspaceId);
      return {
        groups: v.twins.map((t) => ({
          name: t.name,
          who: t.segment,
          summary: t.summary,
          shareOfAudience: t.weight,
          statements: t.traits.map((trait) => ({
            kind: trait.kind,
            text: trait.text,
            source: trait.source,
          })),
        })),
        measuredFromRealPosts: v.overall?.traits.map((t) => t.text) ?? [],
        accuracy: {
          postsMeasured: v.accuracy.measured,
          averageGapInPoints: v.accuracy.averageGap,
        },
      };
    },
  },
  {
    name: "list_predictions",
    title: "Recent audience scores",
    description:
      "The latest Mellox Scores for this workspace's content: a 0-100 estimate of how the audience is likely to react, with the reason and what to change. Scores are estimates, not measurements.",
    input: {},
    scope: "workspace",
    minRole: "viewer",
    write: false,
    run: async ({ workspaceId }, { caller }) => ({
      predictions: (
        await callFn<PredictionView[]>(caller, "audience", "listAudiencePredictions", {
          workspaceId,
          limit: 20,
        })
      ).map(presentPrediction),
    }),
  },
  {
    name: "predict_content",
    title: "Score a piece of content",
    description:
      "Get the Mellox Score for one saved piece of content before it is posted: a quick estimate of how the audience is likely to react, why, and what to change. Included in the plan. It never changes or approves the piece.",
    input: { contentItemId: uuid },
    scope: "workspace",
    minRole: "editor",
    write: true,
    run: async ({ workspaceId, contentItemId }, { caller }) =>
      presentPrediction(
        await callFn<PredictionView>(caller, "audience", "predictContent", {
          workspaceId,
          contentItemId,
        }),
      ),
  },
];
