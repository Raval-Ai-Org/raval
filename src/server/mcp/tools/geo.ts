// AI Visibility (GEO): scans, findings, fix proposals and tracked prompts.
//
// What is deliberately NOT here: approving a fix. Approval binds the exact
// patch a person read in Mellox and then writes to their website or opens a
// pull request, so it stays a click in the app. An assistant can prepare the
// proposal and ask for a verification scan, and only a verification scan ever
// resolves a finding.
import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { callFn, callRoute } from "../bridge.server";
import { uuid, type McpTool } from "../tool";

export const geoTools: McpTool[] = [
  {
    name: "list_geo_scans",
    title: "AI visibility scans",
    description: "Recent AI visibility scans for this workspace, with their scores.",
    input: { limit: z.number().int().min(1).max(50).optional() },
    scope: "workspace",
    minRole: "viewer",
    write: false,
    run: async (args, { caller }) => ({ scans: await callFn(caller, "geo", "listScans", args) }),
  },
  {
    name: "start_geo_scan",
    title: "Start an AI visibility scan",
    description:
      'Scan a website for how well AI assistants and search can read and recommend it. "quick" checks the homepage and answers at once; "full" crawls the site in the background (check get_geo_scan) and counts toward the plan\'s monthly scans.',
    input: {
      url: z.string().trim().min(1).max(2000),
      mode: z.enum(["quick", "full"]).default("full"),
    },
    scope: "workspace",
    minRole: "editor",
    write: true,
    run: async ({ workspaceId, url, mode }, { caller }) => {
      const { POST } = await import("@/app/api/geo/scans/route");
      return callRoute(caller, POST, "/api/geo/scans", {
        body: { workspaceId, url, mode, trigger: "chat", idempotencyKey: randomUUID() },
      });
    },
  },
  {
    name: "get_geo_scan",
    title: "Check a scan",
    description: "Progress, score and summary of one AI visibility scan.",
    input: { scanId: uuid },
    scope: "workspace",
    minRole: "viewer",
    write: false,
    run: async ({ workspaceId, scanId }, { caller }) => {
      const { GET } = await import("@/app/api/geo/scans/[id]/route");
      return callRoute(caller, GET, `/api/geo/scans/${scanId}`, {
        method: "GET",
        query: { workspaceId },
      });
    },
  },
  {
    name: "get_geo_findings",
    title: "Scan findings",
    description:
      "What a scan found: each issue with its severity, the pages affected, how to fix it and its current state.",
    input: { scanId: uuid },
    scope: "workspace",
    minRole: "viewer",
    write: false,
    run: async (args, { caller }) => ({
      findings: await callFn(caller, "geo", "getScanFindings", args),
    }),
  },
  {
    name: "get_geo_trend",
    title: "AI visibility over time",
    description: "How the AI visibility score moved over the last days (7 to 180).",
    input: { days: z.number().int().min(7).max(180).optional() },
    scope: "workspace",
    minRole: "viewer",
    write: false,
    run: (args, { caller }) => callFn(caller, "insights", "getGeoTrend", args),
  },
  {
    name: "set_geo_finding_state",
    title: "Mark a finding",
    description:
      "Mark a finding as open, in progress or ignored (ignoring needs a reason). A finding is only ever resolved by a verification scan, never by hand.",
    input: {
      fingerprint: z
        .string()
        .min(3)
        .max(800)
        .describe("The finding's fingerprint from get_geo_findings."),
      state: z.enum(["open", "in_progress", "dismissed"]),
      note: z.string().max(1000).optional(),
      dismissReason: z
        .enum(["false_positive", "not_relevant", "wont_fix", "handled_elsewhere"])
        .optional(),
    },
    scope: "workspace",
    minRole: "editor",
    write: true,
    run: (args, { caller }) => callFn(caller, "geo", "setFindingState", args),
  },
  {
    name: "get_geo_fix_options",
    title: "How a finding can be fixed",
    description:
      "Whether Mellox can prepare a fix for a finding, and through which connected website source (repository and branch, or WordPress / Webflow).",
    input: { findingId: uuid },
    scope: "workspace",
    minRole: "viewer",
    write: false,
    run: (args, { caller }) => callFn(caller, "geo-fixes", "getFixAvailability", args),
  },
  {
    name: "propose_geo_fix",
    title: "Prepare a fix",
    description:
      "Have Mellox write a proposed fix for a finding against a connected repository. Uses credits. Nothing is changed on the website: the person reviews and approves the exact change in Mellox.",
    input: {
      findingId: uuid,
      sourceId: uuid.describe("From get_geo_fix_options."),
      baseBranch: z.string().min(1).max(200),
    },
    scope: "workspace",
    minRole: "editor",
    write: true,
    run: (args, { caller }) =>
      callFn(caller, "geo-fixes", "createFixProposal", { ...args, idempotencyKey: randomUUID() }),
  },
  {
    name: "get_geo_fix_proposal",
    title: "Read a proposed fix",
    description: "A proposed fix: its state, what it changes and where to approve it in Mellox.",
    input: { proposalId: uuid },
    scope: "workspace",
    minRole: "viewer",
    write: false,
    run: (args, { caller }) => callFn(caller, "geo-fixes", "getFixProposal", args),
  },
  {
    name: "request_geo_verification",
    title: "Verify fixes",
    description:
      "Re-scan the pages behind some findings to check whether they are really fixed. This is the only thing that resolves a finding.",
    input: { findingIds: z.array(uuid).min(1).max(20) },
    scope: "workspace",
    minRole: "editor",
    write: true,
    run: (args, { caller }) => callFn(caller, "geo-fixes", "requestVerification", args),
  },
  {
    name: "get_tracked_prompts",
    title: "Tracked AI prompts",
    description:
      "The questions this workspace tracks in AI assistants, and whether the brand shows up in the answers.",
    input: {},
    scope: "workspace",
    minRole: "viewer",
    write: false,
    run: (args, { caller }) => callFn(caller, "tracked-prompts", "getTrackedPrompts", args),
  },
  {
    name: "add_tracked_prompt",
    title: "Track an AI prompt",
    description:
      "Start tracking a question people ask AI assistants. Counts toward the plan's limit.",
    input: { text: z.string().trim().min(3).max(300) },
    scope: "workspace",
    minRole: "editor",
    write: true,
    run: (args, { caller }) => callFn(caller, "tracked-prompts", "addTrackedPrompt", args),
  },
  {
    name: "set_tracked_prompt_paused",
    title: "Pause or resume a tracked prompt",
    description: "Pause or resume the weekly check of a tracked prompt.",
    input: { promptId: uuid, paused: z.boolean() },
    scope: "workspace",
    minRole: "editor",
    write: true,
    run: (args, { caller }) => callFn(caller, "tracked-prompts", "setTrackedPromptPaused", args),
  },
  {
    name: "delete_tracked_prompt",
    title: "Stop tracking a prompt",
    description: "Remove a tracked prompt and its history. Confirm with the person first.",
    input: { promptId: uuid },
    scope: "workspace",
    minRole: "editor",
    write: true,
    destructive: true,
    run: (args, { caller }) => callFn(caller, "tracked-prompts", "deleteTrackedPrompt", args),
  },
  {
    name: "check_tracked_prompt_now",
    title: "Check a tracked prompt now",
    description:
      "Ask the AI assistants this prompt right now instead of waiting for the weekly check. Uses credits.",
    input: { promptId: uuid },
    scope: "workspace",
    minRole: "editor",
    write: true,
    run: (args, { caller }) =>
      callFn(caller, "tracked-prompts", "checkTrackedPromptNow", {
        ...args,
        idempotencyKey: randomUUID(),
      }),
  },
];
