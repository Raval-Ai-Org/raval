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
// THE APPROVAL BOUNDARY: tags are parsed out of model output, and model output
// can be steered by text the model read (scraped pages, competitor copy, files).
// So only NAVIGATION tags run automatically. Anything that changes data or
// spends money — `save-memory` (persists into every later prompt), `schedule`
// (creates content), `audit` (a billable crawl) — is shown as a suggestion the
// user approves or dismisses, one action at a time. An approved `schedule`
// creates a `pending` draft in the approval queue; it never schedules or
// publishes anything by itself.

import { emitAppEvent } from "@/lib/app-events";
import type { CanvasType } from "@/lib/studio";
import { supabase } from "@/integrations/supabase/client";

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
  "save-memory",
  "schedule",
]);

/** Actions that change data or spend money: shown for approval, never auto-run. */
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

const CANVAS_ALIASES: Record<string, CanvasType> = {
  "social-post": "social-post",
  social: "social-post",
  linkedin: "social-post",
  instagram: "social-post",
  tweet: "social-post",
  x: "social-post",
  "seo-brief": "seo-brief",
  brief: "seo-brief",
  seo: "seo-brief",
  "landing-page": "landing-page",
  landing: "landing-page",
  email: "email",
  newsletter: "email",
  article: "article",
  blog: "article",
  post: "article",
  "design-asset": "design-asset",
  design: "design-asset",
  creative: "design-asset",
};

function resolveCanvas(v?: string): CanvasType | null {
  if (!v) return null;
  return CANVAS_ALIASES[v.toLowerCase().trim()] ?? null;
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
      const canvas = resolveCanvas(call.params.canvas) ?? "article";
      const brief = call.params.brief || call.params.prompt || "";
      emitAppEvent("open:canvas", { type: canvas, brief });
      if (brief) {
        // Stash for the modal — it reads this on mount when the canvas matches.
        try {
          sessionStorage.setItem(`studio:prefill:${canvas}`, brief.slice(0, 2000));
        } catch {
          /* noop */
        }
      }
      return {
        kind: call.kind,
        ok: true,
        label: `Opening ${canvas.replace("-", " ")} studio`,
        detail: brief ? "brief prefilled" : undefined,
      };
    }
    case "open-memory": {
      emitAppEvent("open:brand-dna");
      return { kind: call.kind, ok: true, label: "Opening Memory" };
    }
    case "open-calendar": {
      emitAppEvent("open:analytics", { tab: "calendar" });
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
      emitAppEvent("open:competitor-watch");
      return { kind: call.kind, ok: true, label: "Opening Competitor Watch" };
    }
    case "open-coach": {
      emitAppEvent("open:marketing-coach");
      return { kind: call.kind, ok: true, label: "Opening Marketing Coach" };
    }
    case "open-operations": {
      emitAppEvent("open:operations");
      return { kind: call.kind, ok: true, label: "Opening Operations inbox" };
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
      const canvas = resolveCanvas(call.params.canvas) ?? "social-post";
      const channel =
        call.params.channel ||
        (canvas === "email"
          ? "email"
          : canvas === "article"
            ? "blog"
            : canvas === "landing-page"
              ? "web"
              : "linkedin");
      const kind =
        canvas === "email"
          ? "email"
          : canvas === "article"
            ? "blog"
            : canvas === "landing-page"
              ? "landing"
              : canvas === "seo-brief"
                ? "brief"
                : "post";
      const proposedAt = parseWhen(call.params.when || call.params.at || "");
      // A draft for the approval queue — the proposed time is kept as a hint.
      // (The old code inserted status "scheduled" directly, skipping approval.)
      const { error } = await supabase.from("content_items").insert({
        workspace_id: ctx.workspaceId,
        agent: canvas === "seo-brief" ? "scout" : canvas === "social-post" ? "echo" : "spark",
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
