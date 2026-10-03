// Workspaces (one brand or client each) and the cross-client view.
import "server-only";
import { z } from "zod";
import { isAutopilotEnabled, isMcpEnabled } from "@/lib/feature-flags";
import {
  buildAutopilotAttention,
  needsYou,
  rowState,
  sortAgencyRows,
} from "@/lib/autopilot/status";
import type { AgencyAutopilotRow, AutopilotView } from "@/lib/autopilot/contracts";
import type { WorkspaceSummary } from "@/server/workspaces/service.server";
import type { McpCaller } from "../access.server";
import { callFn, callRoute } from "../bridge.server";
import { McpError } from "../errors.server";
import { getMcpSettingsFor } from "../settings.server";
import { record, soft, type McpTool } from "../tool";

type Access = "off" | "read" | "read_and_change";

/** The caller's workspaces, each with what an assistant may do there. */
export async function workspacesWithAccess(
  caller: McpCaller,
): Promise<{ workspace: WorkspaceSummary; access: Access }[]> {
  const all = await callFn<WorkspaceSummary[]>(caller, "workspaces", "listWorkspaces");
  const settings = await getMcpSettingsFor(all.map((w) => w.id));
  return all.map((workspace) => {
    const s = settings.get(workspace.id);
    const access: Access =
      !isMcpEnabled(workspace.id) || !s?.enabled
        ? "off"
        : s.allowWrites
          ? "read_and_change"
          : "read";
    return { workspace, access };
  });
}

function presentWorkspace(w: WorkspaceSummary, access: Access) {
  // A workspace that hasn't turned assistants on shares its name and nothing else.
  if (access === "off")
    return { id: w.id, name: w.name, yourRole: w.role, assistantAccess: access };
  return {
    id: w.id,
    name: w.name,
    website: w.websiteUrl,
    industry: w.industry,
    plan: w.plan,
    yourRole: w.role,
    assistantAccess: access,
    health: w.health,
    waitingForApproval: w.pendingApprovals,
    drafts: w.draftCount,
    scheduled: w.scheduledCount,
    published: w.publishedCount,
    failed: w.failedCount,
    connectedSocialAccounts: w.connectedSocialAccounts,
    aiVisibilityScore: w.geoScore,
    lastActivityAt: w.lastActivityAt,
  };
}

export const workspaceTools: McpTool[] = [
  {
    name: "list_workspaces",
    title: "List workspaces",
    description:
      'Every workspace (brand or client) the person belongs to, with their role, health and counts. Call this first to get a workspaceId. A workspace with assistantAccess "off" can\'t be used until an admin turns it on in Mellox under Settings, AI assistants.',
    input: {},
    scope: "account",
    minRole: "viewer",
    write: false,
    run: async (_args, { caller }) => {
      const rows = await workspacesWithAccess(caller);
      return { workspaces: rows.map((r) => presentWorkspace(r.workspace, r.access)) };
    },
  },
  {
    name: "get_workspace_details",
    title: "Workspace details",
    description: "Name, website, plan, your role and team size for one workspace.",
    input: {},
    scope: "workspace",
    minRole: "viewer",
    write: false,
    run: ({ workspaceId }, { caller }) =>
      callFn(caller, "workspaces", "getWorkspaceDetails", { workspaceId }),
  },
  {
    name: "get_workspace_summary",
    title: "Marketing summary",
    description:
      "One overview of a workspace's marketing: content counts, what is waiting for approval, Autopilot state, top opportunities, the latest market summary, competitor updates and the AI visibility score. Reads stored data only; it costs nothing.",
    input: {},
    scope: "workspace",
    minRole: "viewer",
    write: false,
    run: async ({ workspaceId }, { caller }) => {
      const [rows, autopilot, market, competitors] = await Promise.all([
        workspacesWithAccess(caller),
        isAutopilotEnabled(workspaceId)
          ? soft(() => callFn<AutopilotView>(caller, "autopilot", "getAutopilot", { workspaceId }))
          : Promise.resolve(null),
        soft(async () => {
          const { GET } = await import("@/app/api/market/latest/route");
          return callRoute(caller, GET, "/api/market/latest", {
            method: "GET",
            query: { workspaceId },
          });
        }),
        soft(() => callFn(caller, "competitors", "getCompetitorOverview", { workspaceId })),
      ]);
      const mine = rows.find((r) => r.workspace.id === workspaceId);
      const intelligence = record(record(market).intelligence);
      const comp = record(competitors);
      return {
        workspace: mine ? presentWorkspace(mine.workspace, mine.access) : null,
        autopilot: autopilot
          ? {
              status: autopilot.program?.status ?? "off",
              mode: autopilot.program?.mode ?? null,
              goal: autopilot.program?.goal ?? null,
              week: autopilot.program
                ? `${autopilot.program.week} of ${autopilot.program.totalWeeks}`
                : null,
              planWaitingForApproval: autopilot.proposed.length,
              piecesWaitingForApproval: autopilot.approvals.length,
              upcoming: autopilot.upcoming.length,
              failed: autopilot.failed.length,
              notReady: autopilot.readiness.filter((r) => !r.ok).map((r) => r.detail),
              learnings: autopilot.learnings,
            }
          : null,
        topOpportunities: (autopilot?.opportunities ?? []).slice(0, 5).map((o) => ({
          id: o.id,
          kind: o.kind,
          title: o.title,
          why: o.why,
          suggestedAction: o.suggestedAction,
          score: o.score,
        })),
        market: market
          ? {
              summary: intelligence.summary ?? null,
              recommendations: intelligence.recommendations ?? [],
              generatedAt: intelligence.generatedAt ?? null,
            }
          : null,
        competitors: competitors
          ? {
              tracked: Array.isArray(comp.competitors) ? comp.competitors.length : 0,
              unreadUpdates: comp.unreadUpdates ?? 0,
              latestUpdates: (Array.isArray(comp.updates) ? comp.updates : [])
                .slice(0, 5)
                .map((u) => {
                  const update = record(u);
                  return {
                    competitor: update.competitorName,
                    title: update.title,
                    significance: update.significance,
                    sourceUrl: update.sourceUrl,
                  };
                }),
            }
          : null,
      };
    },
  },
  {
    name: "get_agency_summary",
    title: "All clients summary",
    description:
      'Across every workspace the person belongs to (with assistant access on): which clients need attention, what is waiting for approval, failures and Autopilot state. Use for "which clients need me?".',
    input: {},
    scope: "account",
    minRole: "viewer",
    write: false,
    run: async (_args, { caller }) => {
      const rows = (await workspacesWithAccess(caller)).filter((r) => r.access !== "off");
      const open = new Set(rows.map((r) => r.workspace.id));
      const names = new Map(rows.map((r) => [r.workspace.id, r.workspace.name]));
      const autopilot = sortAgencyRows(
        (
          (await soft(() =>
            callFn<AgencyAutopilotRow[]>(caller, "autopilot", "getAgencyAutopilot"),
          )) ?? []
        ).filter((row) => open.has(row.workspaceId)),
      );
      const byWorkspace = new Map(autopilot.map((row) => [row.workspaceId, row]));
      const clients = rows.map(({ workspace: w, access }) => {
        const row = byWorkspace.get(w.id);
        return {
          ...presentWorkspace(w, access),
          autopilot: row
            ? {
                state: rowState(row).label,
                pauseReason: row.pauseReason,
                needsYou: needsYou(row),
                piecesWaitingForApproval: row.needsApproval,
                planWaiting: row.planWaiting > 0,
                failures: row.failures,
                newOpportunities: row.newOpportunities,
                nextAt: row.nextActionAt,
                next: row.nextActionTitle,
              }
            : null,
        };
      });
      return {
        totals: {
          clients: clients.length,
          needingAttention: rows.filter((r) => r.workspace.health === "attention").length,
          waitingForApproval: rows.reduce((n, r) => n + r.workspace.pendingApprovals, 0),
          failed: rows.reduce((n, r) => n + r.workspace.failedCount, 0),
        },
        attention: buildAutopilotAttention(autopilot, (id) => names.get(id) ?? "A client").map(
          (a) => ({ title: a.title, detail: a.detail, workspaceId: a.workspaceId ?? null }),
        ),
        clients,
      };
    },
  },
  {
    name: "create_workspace",
    title: "Create a workspace",
    description:
      "Create a new workspace for a brand or client. The same website is never created twice: the existing one is returned. AI assistant access starts off for a new workspace; an admin turns it on in Mellox.",
    input: {
      name: z.string().trim().min(1).max(120),
      websiteUrl: z
        .string()
        .trim()
        .url()
        .max(2048)
        .optional()
        .describe("The brand's public website."),
      requestId: z
        .string()
        .min(8)
        .max(100)
        .optional()
        .describe(
          "Any unique text for this request, so a retry doesn't create a second workspace.",
        ),
    },
    scope: "account",
    minRole: "viewer",
    write: true,
    run: async (args, { caller }) => {
      // This account-level write has no target workspace yet. Require an
      // existing workspace where the person has enabled assistant changes.
      const workspaces = await workspacesWithAccess(caller);
      if (!workspaces.some(({ access }) => access === "read_and_change")) {
        throw new McpError(
          "read_only",
          "Allow AI assistants to make changes in a workspace first.",
        );
      }
      return callFn(caller, "workspaces", "createWorkspace", {
        name: args.name,
        websiteUrl: args.websiteUrl ?? null,
        idempotencyKey: args.requestId ?? null,
      });
    },
  },
  {
    name: "rename_workspace",
    title: "Rename a workspace",
    description: "Change a workspace's name. Admins and owners only.",
    input: { name: z.string().trim().min(1).max(120) },
    scope: "workspace",
    minRole: "admin",
    write: true,
    run: ({ workspaceId, name }, { caller }) =>
      callFn(caller, "workspaces", "renameWorkspace", { workspaceId, name }),
  },
  {
    name: "list_social_accounts",
    title: "Connected social accounts",
    description:
      "The social accounts connected to this workspace, so you know where a post can go.",
    input: {},
    scope: "workspace",
    minRole: "viewer",
    write: false,
    run: async ({ workspaceId }, { caller }) => {
      const { GET } = await import("@/app/api/sdr/accounts/route");
      return callRoute(caller, GET, "/api/sdr/accounts", { method: "GET", query: { workspaceId } });
    },
  },
];
