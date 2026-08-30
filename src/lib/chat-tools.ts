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
// We parse those out of the streamed text, run them, and render a small
// chip strip under the assistant message describing what we did.

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

// Match [[action:KIND  k1="v1"  k2="v2 with spaces" ]]
const TAG_RE = /\[\[action:([a-z][a-z0-9-]*)((?:\s+[a-zA-Z_][\w-]*="[^"]*")*)\s*\]\]/g;
const ATTR_RE = /([a-zA-Z_][\w-]*)="([^"]*)"/g;

/** Parse all tool tags out of a full assistant message. Returns calls + cleaned text. */
export function parseToolCalls(text: string): { calls: ChatToolCall[]; cleaned: string } {
  const calls: ChatToolCall[] = [];
  const cleaned = text
    .replace(TAG_RE, (raw, kind, attrs) => {
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

/** Run a single parsed tool call. */
export async function executeToolCall(
  call: ChatToolCall,
  ctx: ExecuteCtx,
): Promise<ChatToolResult> {
  if (typeof window === "undefined") return { kind: call.kind, label: call.kind, ok: false };

  switch (call.kind) {
    case "audit": {
      window.dispatchEvent(new CustomEvent("geo:run-audit"));
      return { kind: call.kind, ok: true, label: "Running AI visibility audit" };
    }
    case "open-studio": {
      const canvas = resolveCanvas(call.params.canvas) ?? "article";
      const brief = call.params.brief || call.params.prompt || "";
      window.dispatchEvent(new CustomEvent("open:canvas", { detail: { type: canvas, brief } }));
      if (brief) {
        // Stash for the modal — it reads this on mount when the canvas matches.
        try {
          sessionStorage.setItem(`studio:prefill:${canvas}`, brief);
        } catch {
          /* noop */
        }
        window.dispatchEvent(new CustomEvent("studio:prefill", { detail: { canvas, brief } }));
      }
      return {
        kind: call.kind,
        ok: true,
        label: `Opening ${canvas.replace("-", " ")} studio`,
        detail: brief ? "brief prefilled" : undefined,
      };
    }
    case "open-memory": {
      window.dispatchEvent(new CustomEvent("open:brand-dna"));
      return { kind: call.kind, ok: true, label: "Opening Memory" };
    }
    case "open-calendar": {
      window.dispatchEvent(new CustomEvent("open:analytics", { detail: { tab: "calendar" } }));
      return { kind: call.kind, ok: true, label: "Opening Content Calendar" };
    }
    case "open-clients": {
      window.dispatchEvent(new CustomEvent("open:client-portal"));
      return { kind: call.kind, ok: true, label: "Opening Client portal" };
    }
    case "open-visibility": {
      window.dispatchEvent(new CustomEvent("open:ai-visibility"));
      return { kind: call.kind, ok: true, label: "Opening AI Visibility" };
    }
    case "open-competitor": {
      window.dispatchEvent(new CustomEvent("open:competitor-watch"));
      return { kind: call.kind, ok: true, label: "Opening Competitor Watch" };
    }
    case "open-coach": {
      window.dispatchEvent(new CustomEvent("open:marketing-coach"));
      return { kind: call.kind, ok: true, label: "Opening Marketing Coach" };
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
      const whenRaw = call.params.when || call.params.at || "";
      const when = parseWhen(whenRaw);
      const { error } = await supabase.from("content_items").insert({
        workspace_id: ctx.workspaceId,
        agent: canvas === "seo-brief" ? "scout" : canvas === "social-post" ? "echo" : "spark",
        kind,
        channel,
        title,
        body: call.params.body || "",
        status: when ? "scheduled" : "draft",
        scheduled_at: when,
        meta: { source: "chat", canvas },
      });
      if (error)
        return {
          kind: call.kind,
          ok: false,
          label: `Couldn't schedule "${title}"`,
          detail: error.message,
        };
      return {
        kind: call.kind,
        ok: true,
        label: when ? `Scheduled "${title}" for ${formatWhen(when)}` : `Saved draft "${title}"`,
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
