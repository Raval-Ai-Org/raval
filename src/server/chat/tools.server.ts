// What chat can do in a workspace (ADR-0033). Three kinds of tool, and the
// difference between them is the whole design:
//
//   read     runs when the model asks. Reads the workspace's own data with the
//            person's own access. Never spends, never changes anything.
//   action   is NEVER run for the model. Asking for one only stores the exact
//            request (chat_actions) and shows it as a button; it happens when a
//            person clicks, as that person (src/server/chat/actions.server.ts).
//   memory   remember / update / forget. Runs by itself, but every change is
//            decided by src/lib/memory/decide.ts.
//
// Reads and actions are the SAME tools AI assistants use over MCP
// (src/server/mcp/tools): each calls the app's own server function or route
// in-process, which re-checks role, plan and limits. Chat does not go through
// the MCP wrapper (that is the workspace's switch for outside assistants).
import "server-only";
import { z } from "zod";
import type { JwtPayload } from "@supabase/supabase-js";
import type { UserSupabaseClient } from "@/integrations/supabase/client.user.server";
import type { ChatActionView, ChatPlaceOffer } from "@/lib/chat/events";
import { findPlace, PLACE_IDS } from "@/lib/chat/places";
import { shapeToJsonSchema } from "@/lib/chat/tool-schema";
import {
  MEMORY_KINDS,
  MEMORY_TOPICS,
  type MemoryChange,
  type MemoryOp,
} from "@/lib/memory/contracts";
import type { WorkspaceRole } from "@/server/api-auth";
import { wrapUntrusted } from "@/server/guardrails/untrusted";
import { callFn } from "@/server/mcp/bridge.server";
import { toMcpError } from "@/server/mcp/errors.server";
import type { McpCaller } from "@/server/mcp/access.server";
import { MCP_TOOLS } from "@/server/mcp/registry.server";
import { cleanOutput, type McpTool } from "@/server/mcp/tool";
import { runWithScope } from "@/server/request-context";

/** Read tools the model may run by itself. Every one must be `write: false`. */
export const CHAT_READ_TOOLS = [
  "get_workspace_summary",
  "list_content",
  "get_content_calendar",
  "get_pending_approvals",
  "get_content_job",
  "list_social_accounts",
  "get_autopilot_status",
  "get_opportunities",
  "get_audience",
  "list_predictions",
  "get_market_updates",
  "get_competitors",
  "get_analytics_summary",
  "list_geo_scans",
  "get_geo_scan",
  "get_geo_findings",
  "get_geo_trend",
  "get_tracked_prompts",
] as const;

/**
 * Changes chat may OFFER as a button. Left out on purpose: creating, renaming
 * or deleting workspaces, starting or stopping Autopilot, rewriting Brand DNA
 * wholesale, preparing or approving website fixes, billing, team and roles,
 * connecting accounts and buying backlinks. Those stay in their own screens.
 * Making content is offered with the open-studio tag instead, so the person
 * sees Studio's live progress card.
 */
export const CHAT_ACTION_TOOLS = [
  "write_content_draft",
  "update_content",
  "regenerate_content",
  "move_content_date",
  "delete_content",
  "review_content",
  "schedule_content",
  "publish_content_now",
  "cancel_scheduled_content",
  "plan_content_calendar",
  "generate_campaign_brief",
  "act_on_opportunity",
  "approve_weekly_plan",
  "review_autopilot_piece",
  "retry_autopilot_step",
  "set_autopilot_paused",
  "predict_content",
  "get_marketing_briefing",
  "discover_competitors",
  "add_competitor",
  "track_competitors",
  "set_competitor_status",
  "refresh_competitor",
  "remove_competitor",
  "start_geo_scan",
  "set_geo_finding_state",
  "request_geo_verification",
  "add_tracked_prompt",
  "set_tracked_prompt_paused",
  "delete_tracked_prompt",
  "check_tracked_prompt_now",
] as const;

/** Reads chat has that MCP doesn't expose yet. Same shape, same bridge. */
export const CHAT_ONLY_READ_TOOLS: McpTool[] = [
  {
    name: "get_strategy",
    title: "Marketing strategy",
    description:
      "The workspace's marketing strategy (positioning, goal, content pillars, 90-day roadmap) and whether a person has confirmed it. Only a confirmed strategy is followed.",
    input: {},
    scope: "workspace",
    minRole: "viewer",
    write: false,
    run: ({ workspaceId }, { caller }) =>
      callFn(caller, "strategy", "getStrategy", { workspaceId }),
  },
  {
    name: "get_backlinks",
    title: "Backlinks",
    description:
      "Backlink orders and placements for this workspace: what was bought, what is live and verified, what is still waiting, and the credit balance. Buying is done on the Backlinks screen, never from chat.",
    input: {},
    scope: "workspace",
    minRole: "viewer",
    write: false,
    run: async ({ workspaceId }, { caller }) => {
      const overview = (await callFn(caller, "links", "getOverview", { workspaceId })) as Record<
        string,
        unknown
      >;
      // The placement catalogue is long and is browsed on its own screen.
      const { catalog: _catalog, packs: _packs, ...rest } = overview ?? {};
      return rest;
    },
  },
  {
    name: "list_experiments",
    title: "Experiments",
    description:
      "Page experiments in this workspace: what is being tested, on which pages, and the verdicts so far. Empty when Experiments is not switched on.",
    input: {},
    scope: "workspace",
    minRole: "viewer",
    write: false,
    run: ({ workspaceId }, { caller }) =>
      callFn(caller, "experiments", "getExperimentsOverview", { workspaceId }),
  },
];

const ROLE_RANK: Record<WorkspaceRole, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };
export const roleAtLeast = (role: WorkspaceRole, min: WorkspaceRole) =>
  ROLE_RANK[role] >= ROLE_RANK[min];

const byName = new Map<string, McpTool>(
  [...MCP_TOOLS, ...CHAT_ONLY_READ_TOOLS].map((tool) => [tool.name, tool]),
);

export function chatReadTools(): McpTool[] {
  return [...CHAT_READ_TOOLS.map((name) => byName.get(name)), ...CHAT_ONLY_READ_TOOLS].filter(
    (tool): tool is McpTool => !!tool && !tool.write && tool.scope === "workspace",
  );
}

export function chatActionTools(): McpTool[] {
  return CHAT_ACTION_TOOLS.map((name) => byName.get(name)).filter(
    (tool): tool is McpTool => !!tool && tool.write && tool.scope === "workspace",
  );
}

/** The action a stored button names, or undefined if chat may not offer it. */
export function chatActionTool(name: string): McpTool | undefined {
  return chatActionTools().find((tool) => tool.name === name);
}

/* ─────────────────────────── chat's own tools ─────────────────────────── */

const MEMORY_TOOLS = {
  remember: {
    description:
      'Save something the person told you to remember for this brand: a rule ("never use red in our images"), a preference, or a fact about the business. Use it when they state a lasting preference or correct you, or say "remember", "from now on", "always", "never", "don\'t … again". Write one short, complete sentence in the person\'s own meaning. Set lasts to "hours" for things that are only true for now ("this week we\'re promoting the spring sale", "for today keep it playful"); those end by themselves. Never save passwords, card numbers or private personal details. Do not save what is already in Brand memory.',
    input: {
      text: z.string().min(3).max(500).describe("The memory, one short sentence."),
      kind: z
        .enum(MEMORY_KINDS)
        .describe(
          "rule = must or must not; preference = likes it this way; fact = true about the business; context = what they are working on right now",
        ),
      topic: z
        .enum(MEMORY_TOPICS)
        .describe(
          "visual = pictures, colours, video; voice = how it is written; content = what to make; audience = who it is for; business = the company; other",
        ),
      lasts: z.enum(["always", "hours"]).optional(),
      hours: z.number().min(1).max(168).optional().describe("With lasts: hours. Default 24."),
    },
  },
  update_memory: {
    description:
      "Change a memory that is listed in Brand memory, when the person corrects or refines it. Use its id in square brackets.",
    input: {
      id: z.string().min(8).max(40).describe("The id shown in [brackets] before the memory."),
      text: z.string().min(3).max(500),
    },
  },
  forget: {
    description:
      "Remove a memory listed in Brand memory, when the person says it no longer applies or asks you to forget it.",
    input: { id: z.string().min(8).max(40) },
  },
} as const;

const OPEN_TOOL = {
  description:
    "Offer a button that opens a place in Mellox. It only shows a button; nothing opens until the person clicks. Use it when the person asks where something is or would be better served on that screen.",
  input: { place: z.enum(PLACE_IDS as [string, ...string[]]) },
};

export type ChatToolSpec = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

const spec = (name: string, description: string, input: z.ZodRawShape): ChatToolSpec => ({
  type: "function",
  function: { name, description, parameters: shapeToJsonSchema(input, ["workspaceId"]) },
});

/** The tools a person with this role is shown. Viewers only read. */
export function chatToolSpecs(role: WorkspaceRole, opts: { memory: boolean }): ChatToolSpec[] {
  const editor = roleAtLeast(role, "editor");
  return [
    ...chatReadTools()
      .filter((tool) => roleAtLeast(role, tool.minRole))
      .map((tool) => spec(tool.name, tool.description, tool.input)),
    ...chatActionTools()
      .filter((tool) => roleAtLeast(role, tool.minRole))
      .map((tool) =>
        spec(
          tool.name,
          `${tool.description} In chat this only prepares a button; it happens when the person clicks it.`,
          tool.input,
        ),
      ),
    ...(editor && opts.memory
      ? Object.entries(MEMORY_TOOLS).map(([name, tool]) => spec(name, tool.description, tool.input))
      : []),
    spec("open_in_mellox", OPEN_TOOL.description, OPEN_TOOL.input),
  ];
}

/* ───────────────────────────── running a turn ───────────────────────────── */

export type ChatToolCaller = {
  userId: string;
  workspaceId: string;
  role: WorkspaceRole;
  supabase: UserSupabaseClient;
  /** The person's own access token, replayed in-process by the bridge. Never logged. */
  token: string;
  conversationId?: string | null;
};

export function toMcpCaller(caller: ChatToolCaller): McpCaller {
  return {
    userId: caller.userId,
    // Only the MCP access check reads claims, and chat never goes through it.
    claims: {} as JwtPayload,
    supabase: caller.supabase,
    clientId: null,
    token: caller.token,
  };
}

export type ChatToolOutcome = {
  /** What the model reads. */
  content: string;
  /** A few plain words for the activity line, or null to show nothing. */
  label: string | null;
};

export type ChatTurnState = {
  memory: MemoryChange[];
  actions: ChatActionView[];
  offers: ChatPlaceOffer[];
};

const MAX_ACTIONS_PER_TURN = 3;
const MAX_RESULT_CHARS = 6_000;

/** What the activity line says while a tool runs. null = say nothing. */
export function activityLabel(name: string): string | null {
  if (name === "remember" || name === "update_memory" || name === "forget") {
    return "Updating memory";
  }
  return ACTIVITY[name] ?? null;
}

/** Tools whose result the model doesn't need to read to finish its reply. */
export function isQuietTool(name: string): boolean {
  return !(name in ACTIVITY);
}

const ACTIVITY: Record<string, string> = {
  get_workspace_summary: "Looking at your workspace",
  list_content: "Looking at your posts",
  get_content_calendar: "Checking your calendar",
  get_pending_approvals: "Checking what's waiting for you",
  get_content_job: "Checking that piece",
  list_social_accounts: "Checking your connected accounts",
  get_autopilot_status: "Checking Autopilot",
  get_opportunities: "Looking at opportunities",
  get_audience: "Looking at your audience",
  list_predictions: "Looking at recent scores",
  get_market_updates: "Reading your market updates",
  get_competitors: "Looking at your competitors",
  get_analytics_summary: "Reading your numbers",
  list_geo_scans: "Looking at your website scans",
  get_geo_scan: "Checking that scan",
  get_geo_findings: "Reading the scan findings",
  get_geo_trend: "Looking at your AI visibility over time",
  get_tracked_prompts: "Checking your tracked prompts",
  get_strategy: "Reading your strategy",
  get_backlinks: "Looking at your backlinks",
  list_experiments: "Looking at your experiments",
};

/** One plain line saying what a button will do, from its stored request. */
export function describeAction(args: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    if (key === "workspaceId" || value == null || value === "") continue;
    if (/Ids?$/.test(key)) {
      const count = Array.isArray(value) ? value.length : 1;
      const noun = key
        .replace(/Ids?$/, "")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .toLowerCase();
      if (noun) parts.push(count === 1 ? `1 ${noun}` : `${count} ${noun}s`);
      continue;
    }
    const label = key.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
    if (typeof value === "string")
      parts.push(`${label}: ${value.replace(/\s+/g, " ").slice(0, 140)}`);
    else if (typeof value === "number" || typeof value === "boolean")
      parts.push(`${label}: ${value}`);
    else if (Array.isArray(value)) {
      parts.push(
        `${label}: ${value
          .slice(0, 6)
          .map((v) => (typeof v === "string" ? v : "…"))
          .join(", ")}`,
      );
    }
  }
  return parts.join(" · ").slice(0, 600);
}

/**
 * The tool runner for one chat reply. It keeps what the reply changed or
 * offered (`state`), so the route can send it to the browser.
 */
export function createChatTools(caller: ChatToolCaller, opts: { memory: boolean }) {
  const state: ChatTurnState = { memory: [], actions: [], offers: [] };
  const mcpCaller = toMcpCaller(caller);
  const reads = new Map(chatReadTools().map((tool) => [tool.name, tool]));
  const actions = new Map(chatActionTools().map((tool) => [tool.name, tool]));
  // The same lookup asked twice in one reply is answered from here.
  const seen = new Map<string, string>();

  const parse = (tool: { input: z.ZodRawShape }, input: unknown) =>
    z.object(tool.input).parse(input ?? {}) as Record<string, unknown>;

  async function runRead(tool: McpTool, input: unknown): Promise<ChatToolOutcome> {
    if (!roleAtLeast(caller.role, tool.minRole)) {
      return { content: "This person's role can't see that.", label: null };
    }
    const args = { ...parse(tool, input), workspaceId: caller.workspaceId };
    const key = `${tool.name}:${JSON.stringify(args)}`;
    const cached = seen.get(key);
    if (cached) return { content: cached, label: null };
    const data = await runWithScope(
      { userId: caller.userId, workspaceId: caller.workspaceId },
      () =>
        tool.run(args, { caller: mcpCaller, workspaceId: caller.workspaceId, role: caller.role }),
    );
    const content = wrapUntrusted(`mellox ${tool.name}`, JSON.stringify(cleanOutput(data)), {
      maxChars: MAX_RESULT_CHARS,
      route: "chat",
    });
    seen.set(key, content);
    return { content, label: ACTIVITY[tool.name] ?? tool.title };
  }

  async function offerAction(tool: McpTool, input: unknown): Promise<ChatToolOutcome> {
    if (!roleAtLeast(caller.role, tool.minRole)) {
      return {
        content: `This person's role can't do that (it needs ${tool.minRole}). Tell them plainly; don't offer it.`,
        label: null,
      };
    }
    if (state.actions.length >= MAX_ACTIONS_PER_TURN) {
      return {
        content: "Enough buttons for one reply. Offer the rest after they act on these.",
        label: null,
      };
    }
    const args = parse(tool, input);
    const { offerChatAction } = await import("./actions.server");
    const view = await offerChatAction(caller, tool, args);
    state.actions.push(view);
    return {
      content: `A button "${tool.title}" is now shown under your reply. It has NOT happened yet and only happens if the person clicks it. Say in one short sentence what the button will do. Never say it is done.`,
      label: null,
    };
  }

  async function runMemory(
    name: keyof typeof MEMORY_TOOLS,
    input: unknown,
  ): Promise<ChatToolOutcome> {
    if (!opts.memory || !roleAtLeast(caller.role, "editor")) {
      return { content: "Memory is off for this workspace. Nothing was saved.", label: null };
    }
    const args = parse(MEMORY_TOOLS[name], input);
    const op: MemoryOp =
      name === "remember"
        ? {
            op: "add",
            text: String(args.text),
            kind: String(args.kind),
            topic: String(args.topic),
            lasts: args.lasts ? String(args.lasts) : undefined,
            hours: typeof args.hours === "number" ? args.hours : undefined,
          }
        : name === "update_memory"
          ? { op: "update", id: String(args.id), text: String(args.text) }
          : { op: "remove", id: String(args.id) };
    const { applyOps } = await import("@/server/memory/service.server");
    const changes = await applyOps(caller, [op], {
      source: "chat",
      conversationId: caller.conversationId ?? null,
    });
    if (!changes.length) {
      return {
        content:
          "Nothing changed: it is already in memory, isn't something Mellox keeps, or that id isn't in the list. Don't say it was saved.",
        label: null,
      };
    }
    state.memory.push(...changes);
    return {
      content: `Done: memory ${changes[0].op}. The person sees a small "Memory updated" note under your reply, so mention it in a few words at most and carry on with their request.`,
      label: "Updating memory",
    };
  }

  function offerPlace(input: unknown): ChatToolOutcome {
    const { place } = parse(OPEN_TOOL, input);
    const found = findPlace(place);
    if (!found) return { content: "That place doesn't exist.", label: null };
    if (!state.offers.some((o) => o.place === found.id) && state.offers.length < 3) {
      state.offers.push({ place: found.id, label: found.label });
    }
    return {
      content: `A button "Open ${found.label}" is shown under your reply. Nothing has opened.`,
      label: null,
    };
  }

  async function run(name: string, input: unknown): Promise<ChatToolOutcome> {
    try {
      const read = reads.get(name);
      if (read) return await runRead(read, input);
      const action = actions.get(name);
      if (action) return await offerAction(action, input);
      if (name in MEMORY_TOOLS) return await runMemory(name as keyof typeof MEMORY_TOOLS, input);
      if (name === "open_in_mellox") return offerPlace(input);
      return { content: "That tool doesn't exist.", label: null };
    } catch (error) {
      const { message } = toMcpError(error);
      return { content: `That didn't work: ${message}`, label: null };
    }
  }

  return { state, run, specs: chatToolSpecs(caller.role, opts) };
}
