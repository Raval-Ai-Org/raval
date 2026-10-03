// Market updates, competitors, Brand DNA and analytics.
import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { callFn, callRoute } from "../bridge.server";
import { uuid, type McpTool } from "../tool";

export const intelligenceTools: McpTool[] = [
  {
    name: "get_market_updates",
    title: "Market updates",
    description:
      "The latest stored market read for this brand: summary, trend signals, opportunities, recommendations and the dated web sources behind them. Costs nothing.",
    input: {},
    scope: "workspace",
    minRole: "viewer",
    write: false,
    run: async ({ workspaceId }, { caller }) => {
      const { GET } = await import("@/app/api/market/latest/route");
      return callRoute(caller, GET, "/api/market/latest", {
        method: "GET",
        query: { workspaceId },
      });
    },
  },
  {
    name: "get_marketing_briefing",
    title: "Marketing Coach briefing",
    description:
      "A fresh Marketing Coach briefing: what to do next for this brand and why. Served from a 6-hour cache when there is one; otherwise it uses credits.",
    input: {
      refresh: z.boolean().optional().describe("Ignore the cache and write a new one."),
      deep: z.boolean().optional().describe("The longer strategy briefing (costs more)."),
    },
    scope: "workspace",
    minRole: "viewer",
    write: true,
    run: ({ workspaceId, refresh, deep }, { caller }) =>
      callFn(caller, "coach", "getCoachBriefing", {
        workspaceId,
        force: refresh,
        deepStrategy: deep,
        idempotencyKey: randomUUID(),
      }),
  },
  {
    name: "get_competitors",
    title: "Competitors",
    description:
      "Tracked competitors with their profiles, suggested competitors waiting for a decision, and recent competitor updates with their source links.",
    input: {},
    scope: "workspace",
    minRole: "viewer",
    write: false,
    run: ({ workspaceId }, { caller }) =>
      callFn(caller, "competitors", "getCompetitorOverview", { workspaceId }),
  },
  {
    name: "discover_competitors",
    title: "Find competitors",
    description:
      "Search the web for this brand's competitors. Results arrive as suggestions; nobody is tracked until track_competitors. May use credits.",
    input: {},
    scope: "workspace",
    minRole: "editor",
    write: true,
    run: ({ workspaceId }, { caller }) =>
      callFn(caller, "competitors", "discoverCompetitors", {
        workspaceId,
        idempotencyKey: randomUUID(),
      }),
  },
  {
    name: "add_competitor",
    title: "Add a competitor",
    description: "Add a competitor by its website and start tracking it.",
    input: { url: z.string().min(3).max(2048), name: z.string().max(200).optional() },
    scope: "workspace",
    minRole: "editor",
    write: true,
    run: (args, { caller }) => callFn(caller, "competitors", "addCompetitor", args),
  },
  {
    name: "track_competitors",
    title: "Track suggested competitors",
    description:
      "Start tracking suggested competitors. Tracked competitors are checked for news regularly.",
    input: { competitorIds: z.array(uuid).min(1).max(20) },
    scope: "workspace",
    minRole: "editor",
    write: true,
    run: (args, { caller }) => callFn(caller, "competitors", "trackCompetitors", args),
  },
  {
    name: "set_competitor_status",
    title: "Track or ignore a competitor",
    description: "Set a competitor to tracked, ignored or back to suggested.",
    input: { competitorId: uuid, status: z.enum(["tracked", "ignored", "suggested"]) },
    scope: "workspace",
    minRole: "editor",
    write: true,
    run: (args, { caller }) => callFn(caller, "competitors", "setCompetitorStatus", args),
  },
  {
    name: "refresh_competitor",
    title: "Re-check a competitor",
    description: "Look for new updates from one competitor now.",
    input: {
      competitorId: uuid,
      full: z.boolean().optional().describe("Also rebuild its profile."),
    },
    scope: "workspace",
    minRole: "editor",
    write: true,
    run: (args, { caller }) => callFn(caller, "competitors", "refreshCompetitor", args),
  },
  {
    name: "remove_competitor",
    title: "Remove a competitor",
    description:
      "Remove a competitor and its updates from this workspace. Confirm with the person first.",
    input: { competitorId: uuid },
    scope: "workspace",
    minRole: "editor",
    write: true,
    destructive: true,
    run: (args, { caller }) => callFn(caller, "competitors", "removeCompetitor", args),
  },
  {
    name: "get_brand_dna",
    title: "Brand DNA",
    description:
      "The brand's saved facts: what it sells, who it serves, positioning, voice, colours and rules. Everything Mellox writes is grounded in this.",
    input: {},
    scope: "workspace",
    minRole: "viewer",
    write: false,
    run: async ({ workspaceId }, { caller }) => ({
      brandDna: await callFn(caller, "brand-dna", "getBrandDna", { workspaceId }),
    }),
  },
  {
    name: "update_brand_dna",
    title: "Update Brand DNA",
    description:
      "Save the brand's facts. Send the whole Brand DNA object: read it with get_brand_dna, change only what the person asked for, and send it all back. Only save facts the person gave you; never invent any.",
    input: { dna: z.record(z.string(), z.unknown()) },
    scope: "workspace",
    minRole: "editor",
    write: true,
    run: (args, { caller }) => callFn(caller, "brand-dna", "saveBrandDna", args),
  },
  {
    name: "get_analytics_summary",
    title: "Analytics summary",
    description:
      "How the workspace's content and website are doing over the last days (7 to 90): totals, changes, top content and what is coming up.",
    input: { days: z.number().int().min(7).max(90).optional() },
    scope: "workspace",
    minRole: "viewer",
    write: false,
    run: (args, { caller }) => callFn(caller, "analytics", "getAnalyticsSummary", args),
  },
];
