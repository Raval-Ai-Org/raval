// Chat-first control surface.
//
// The assistant emits inline action tags inside its reply, like:
//   [[action:audit]]
//   [[action:open-studio canvas="article" brief="Draft a post about ..."]]
//   [[action:open-memory]]
//   [[action:open-calendar]]
//   [[action:save-memory title="Brand uses 'workspace' not 'team'" body="..."]]
//   [[action:schedule title="Weekly newsletter" when="2026-07-02T09:00:00Z" canvas="email" channel="email"]]
//
// NOTHING RUNS BY ITSELF. Tags are parsed out of model output, and model output
// can be steered by text the model read (scraped pages, competitor copy, files).
// Opening a window over the conversation is also a poor experience. So:
//   - Navigation tags (`open-*`) become buttons under the reply; the user clicks
//     to open that part of the app.
//   - `open-studio` becomes a "Create in Studio" button that starts the work in
//     the Studio side panel (no composer pop-up). When the USER's own message
//     asked to make something, the chat starts it directly (chat-intent.ts).
//   - Anything that changes data or spends money — `save-memory` (persists into
//     every later prompt), `schedule` (creates content), `audit` (a billable
//     crawl) — is a suggestion the user approves or dismisses. An approved
//     `schedule` creates a `pending` draft in the approval queue; it never
//     schedules or publishes anything by itself.

import { emitAppEvent } from "@/lib/app-events";
import { normalizeStudioType, STUDIO_FORMATS, type StudioType } from "@/lib/studio/formats";
import { supabase } from "@/integrations/supabase/client";
import { detectStudioType } from "@/lib/studio/detect";

export type ChatToolKind =
  | "audit"
  | "open-studio"
  | "open-memory"
  | "open-calendar"
  | "open-clients"
  | "open-visibility"
  | "open-competitor"
  | "open-coach"
  | "open-operations"
  | "open-analytics"
  | "save-memory"
  | "schedule";

export interface ChatToolCall {
  kind: ChatToolKind;
  params: Record<string, string>;
  raw: string;
}

export interface ChatToolResult {
  kind: ChatToolKind;
  label: string;
  ok: boolean;
  detail?: string;
  /** Studio session started by this action (open-studio), for the chat's progress card. */
  sessionId?: string;
}

const KNOWN_KINDS = new Set<ChatToolKind>([
  "audit",
  "open-studio",
  "open-memory",
  "open-calendar",
  "open-clients",
  "open-visibility",
  "open-competitor",
  "open-coach",
  "open-operations",
  "open-analytics",
  "save-memory",
  "schedule",
]);

/** Actions that change data or spend money: shown for approval with an explanation. */
const GATED_KINDS = new Set<ChatToolKind>(["audit", "save-memory", "schedule"]);

export function requiresApproval(kind: ChatToolKind): boolean {
  return GATED_KINDS.has(kind);
}

/** Human-readable description of what approving a suggestion will do. */
export function describeSuggestion(call: ChatToolCall): { title: string; effect: string } {
  switch (call.kind) {
    case "audit":
      return {
        title: "Run AI visibility audit",
        effect: "Crawls your site (uses analysis quota).",
      };
    case "save-memory":
      return {
        title: `Save to Memory · ${(call.params.title || "Note").slice(0, 60)}`,
        effect: "Adds this note to Brand DNA — it will inform future answers.",
      };
    case "schedule":
      return {
        title: `Draft “${(call.params.title || "Untitled").slice(0, 60)}”`,
        effect: "Creates a draft in your approval queue. Nothing is published or scheduled.",
      };
    default:
      return { title: call.kind, effect: "" };
  }
}

/** Button text and short description for a navigation / create offer. */
export function describeOffer(call: ChatToolCall): { label: string; hint?: string } {
  switch (call.kind) {
    case "open-studio": {
      const canvas = resolveCanvas(call.params.canvas);
      return call.params.brief || call.params.prompt
        ? {
            label: canvas ? `Create ${STUDIO_FORMATS[canvas].noun} in Studio` : "Create in Studio",
            hint: (call.params.brief || call.params.prompt).slice(0, 140),
          }
        : { label: "Open Create" };
    }
    case "open-memory":
      return { label: "Open Brand DNA" };
    case "open-calendar":
      return { label: "Open content calendar" };
    case "open-clients":
      return { label: "Open client portal" };
    case "open-visibility":
      return { label: "Open AI Visibility" };
    case "open-competitor":
      return { label: "Open Competitors" };
    case "open-coach":
      return { label: "Open Marketing Coach" };
    case "open-operations":
      return { label: "Open Operations" };
    case "open-analytics": {
      const tab = analyticsTabParam(call.params.tab);
      return { label: tab ? `Open Analytics · ${ANALYTICS_TAB_LABELS[tab]}` : "Open Analytics" };
    }
    default:
      return { label: call.kind };
  }
}

const ANALYTICS_TAB_LABELS = {
  overview: "Overview",
  website: "Website",
  search: "Search",
  content: "Content",
  insights: "Insights",
} as const;

/** Only known analytics tabs; anything else opens the Overview. */
function analyticsTabParam(value: string | undefined): keyof typeof ANALYTICS_TAB_LABELS | null {
  return value && Object.prototype.hasOwnProperty.call(ANALYTICS_TAB_LABELS, value)
    ? (value as keyof typeof ANALYTICS_TAB_LABELS)
    : null;
}

const MAX_CALLS_PER_REPLY = 3;

// Match [[action:KIND  k1="v1"  k2="v2 with spaces" ]]
const TAG_RE = /\[\[action:([a-z][a-z0-9-]*)((?:\s+[a-zA-Z_][\w-]*="[^"]*")*)\s*\]\]/g;
const ATTR_RE = /([a-zA-Z_][\w-]*)="([^"]*)"/g;

/**
 * Parse tool tags out of a full assistant message. Returns calls + cleaned text.
 * Every tag is stripped from the visible text, but only known kinds are
 * returned, and at most MAX_CALLS_PER_REPLY of them.
 */
export function parseToolCalls(text: string): { calls: ChatToolCall[]; cleaned: string } {
  const calls: ChatToolCall[] = [];
  const cleaned = text
    .replace(TAG_RE, (raw, kind, attrs) => {
      if (!KNOWN_KINDS.has(kind as ChatToolKind) || calls.length >= MAX_CALLS_PER_REPLY) return "";
      const params: Record<string, string> = {};
      let m: RegExpExecArray | null;
      const re = new RegExp(ATTR_RE.source, "g");
      while ((m = re.exec(attrs)) !== null) params[m[1]] = m[2];
      calls.push({ kind: kind as ChatToolKind, params, raw });
      return ""; // strip the tag from the visible text
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { calls, cleaned };
}

// Platform names the assistant sometimes uses in place of a format.
const PLATFORM_ALIASES: Record<string, StudioType> = {
  linkedin: "social",
  instagram: "social",
  tweet: "social",
  x: "social",
  brief: "article",
};

function resolveCanvas(v?: string): StudioType | null {
  if (!v) return null;
  return normalizeStudioType(v) ?? PLATFORM_ALIASES[v.toLowerCase().trim()] ?? null;
}

export interface ExecuteCtx {
  workspaceId: string;
  saveMemory: (title: string, body: string) => Promise<void> | void;
}

/**
 * Run a single parsed tool call. For gated kinds the caller MUST only invoke
 * this after the user approved that specific suggestion.
 */
export async function executeToolCall(
  call: ChatToolCall,
  ctx: ExecuteCtx,
): Promise<ChatToolResult> {
  if (typeof window === "undefined") return { kind: call.kind, label: call.kind, ok: false };

  switch (call.kind) {
    case "audit": {
      emitAppEvent("geo:run-audit");
      return { kind: call.kind, ok: true, label: "Running AI visibility audit" };
    }
    case "open-studio": {
      const brief = (call.params.brief || call.params.prompt || "").trim().slice(0, 4000);
      const canvas =
        resolveCanvas(call.params.canvas) ?? (brief ? detectStudioType(brief) : null) ?? "social";
      if (brief.length < 3) {
        emitAppEvent("open:create-launcher");
        return { kind: call.kind, ok: true, label: "Opened Create" };
      }
      // Clicked by the user: start in the Studio side panel, no composer pop-up.
      const { startInBackground } = await import("@/lib/studio/session-store");
      const sessionId = startInBackground({
        workspaceId: ctx.workspaceId,
        type: canvas,
        brief,
        origin: "chat",
      });
      if (!sessionId) return { kind: call.kind, ok: false, label: "Couldn't start in Studio" };
      emitAppEvent("open:studio");
      return {
        kind: call.kind,
        ok: true,
        label: `Creating ${STUDIO_FORMATS[canvas].noun} in Studio`,
        sessionId,
      };
    }
    case "open-memory": {
      emitAppEvent("open:brand-dna");
      return { kind: call.kind, ok: true, label: "Opening Memory" };
    }
    case "open-calendar": {
      emitAppEvent("open:content-calendar");
      return { kind: call.kind, ok: true, label: "Opening Content Calendar" };
    }
    case "open-clients": {
      emitAppEvent("open:client-portal");
      return { kind: call.kind, ok: true, label: "Opening Client portal" };
    }
    case "open-visibility": {
      emitAppEvent("open:ai-visibility");
      return { kind: call.kind, ok: true, label: "Opening AI Visibility" };
    }
    case "open-competitor": {
      emitAppEvent("open:competitors");
      return { kind: call.kind, ok: true, label: "Opening Competitors" };
    }
    case "open-coach": {
      emitAppEvent("open:marketing-coach");
      return { kind: call.kind, ok: true, label: "Opening Marketing Coach" };
    }
    case "open-operations": {
      emitAppEvent("open:operations");
      return { kind: call.kind, ok: true, label: "Opening Operations inbox" };
    }
    case "open-analytics": {
      const tab = analyticsTabParam(call.params.tab);
      emitAppEvent("open:analytics", tab ? { tab } : undefined);
      return { kind: call.kind, ok: true, label: "Opening Analytics" };
    }
    case "save-memory": {
      const title = (call.params.title || "Note").slice(0, 120);
      const body = (call.params.body || "").slice(0, 1200);
      if (!body) return { kind: call.kind, ok: false, label: "Skipped empty memory" };
      try {
        await ctx.saveMemory(title, body);
      } catch {
        return { kind: call.kind, ok: false, label: "Couldn't save to Memory" };
      }
      return { kind: call.kind, ok: true, label: `Saved to Memory · ${title}` };
    }
    case "schedule": {
      const title = (call.params.title || "Untitled").slice(0, 200);
      const canvas = resolveCanvas(call.params.canvas) ?? "social";
      const channel = call.params.channel || (canvas === "article" ? "blog" : "linkedin");
      const kind = STUDIO_FORMATS[canvas].kind;
      const proposedAt = parseWhen(call.params.when || call.params.at || "");
      // A draft for the approval queue — the proposed time is kept as a hint.
      // (The old code inserted status "scheduled" directly, skipping approval.)
      const { error } = await supabase.from("content_items").insert({
        workspace_id: ctx.workspaceId,
        agent: STUDIO_FORMATS[canvas].agent,
        kind,
        channel,
        title,
        body: (call.params.body || "").slice(0, 8000),
        status: "pending",
        scheduled_at: null,
        meta: { source: "chat", canvas, proposed_at: proposedAt },
      });
      if (error)
        return {
          kind: call.kind,
          ok: false,
          label: `Couldn't create draft "${title}"`,
          detail: error.message,
        };
      return {
        kind: call.kind,
        ok: true,
        label: `Draft "${title}" added to approvals`,
        detail: proposedAt ? `Suggested time: ${formatWhen(proposedAt)}` : undefined,
      };
    }
  }
  return { kind: call.kind, ok: false, label: `Unknown action: ${call.kind}` };
}

function parseWhen(input: string): string | null {
  if (!input) return null;
  const direct = new Date(input);
  if (!Number.isNaN(direct.getTime())) return direct.toISOString();
  // Relative: "in 2 hours", "tomorrow 9am", "next monday"
  const now = new Date();
  const m1 = /^in\s+(\d+)\s+(minutes?|hours?|days?|weeks?)$/i.exec(input.trim());
  if (m1) {
    const n = Number(m1[1]);
    const unit = m1[2].toLowerCase();
    const ms = unit.startsWith("minute")
      ? n * 60_000
      : unit.startsWith("hour")
        ? n * 3_600_000
        : unit.startsWith("day")
          ? n * 86_400_000
          : n * 604_800_000;
    return new Date(now.getTime() + ms).toISOString();
  }
  if (/^tomorrow/i.test(input)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d.toISOString();
  }
  return null;
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}
