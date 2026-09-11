// events.ts — guardrail event log (proposal workstream D: "what was blocked,
// why, and for which workspace"). Written to public.guardrail_events through
// the service role; workspace/user/route come from the ambient request scope.
// `detail` must only ever hold short snippets and rule ids — never a whole
// prompt, a whole output, or unredacted personal data.
import "server-only";
import { getRequestScope } from "@/server/request-context";

export type GuardrailKind =
  | "injection_detected"
  | "untrusted_content_sanitized"
  | "pii_redacted"
  | "profanity"
  | "claim_flagged"
  | "brand_rule_violation"
  | "moderation_blocked"
  | "moderation_unverified"
  | "parse_failure"
  | "truncation"
  | "action_blocked"
  | "budget_degraded"
  | "budget_exceeded";

export type GuardrailSeverity = "info" | "warn" | "block";

export type GuardrailEvent = {
  kind: GuardrailKind;
  severity?: GuardrailSeverity;
  detail?: Record<string, unknown>;
  /** Overrides for work outside a request scope (cron, workers). */
  workspaceId?: string | null;
  userId?: string | null;
  route?: string;
};

const MAX_DETAIL_CHARS = 2_000;

function clampDetail(detail: Record<string, unknown> = {}): Record<string, unknown> {
  const raw = JSON.stringify(detail);
  if (raw.length <= MAX_DETAIL_CHARS) return detail;
  return { truncated: true, preview: raw.slice(0, MAX_DETAIL_CHARS) };
}

export type GuardrailSink = (row: Record<string, unknown>) => Promise<void>;

let sink: GuardrailSink = async (row) => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("guardrail_events").insert(row as never);
  if (error) throw new Error(error.message);
};

/** Tests swap the sink to observe events without a database. */
export function setGuardrailSink(next: GuardrailSink): () => void {
  const previous = sink;
  sink = next;
  return () => {
    sink = previous;
  };
}

/** Record a guardrail event. Fire-and-forget: never throws, never blocks. */
export function logGuardrailEvent(event: GuardrailEvent): void {
  const scope = getRequestScope();
  const row = {
    kind: event.kind,
    severity: event.severity ?? "info",
    detail: clampDetail(event.detail),
    workspace_id: event.workspaceId !== undefined ? event.workspaceId : (scope.workspaceId ?? null),
    user_id: event.userId !== undefined ? event.userId : (scope.userId ?? null),
    route: event.route ?? scope.route ?? "unknown",
    run_id: scope.runId ?? null,
    request_id: scope.requestId ?? null,
  };
  const level = row.severity === "info" ? "log" : "warn";
  console[level](`[guardrail] ${row.kind} (${row.severity}) route=${row.route}`);
  void sink(row).catch((error) => {
    console.error("[guardrail] event not recorded", error instanceof Error ? error.message : error);
  });
}
