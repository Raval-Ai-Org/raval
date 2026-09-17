// client.server.ts — the one file that imports @trigger.dev/sdk. Wraps
// tasks.trigger() with this codebase's own idempotency-key and error-handling
// conventions so callers never touch the SDK directly.
//
// Trigger.dev is additive-only (ADR-0018): it powers new workflows
// (Competitor Intelligence and later additions) that have no existing
// pg_cron/lease-based job to migrate. It never touches, and must never be
// made to touch, GEO scans, KIE/UGC video polling, scheduled posts, or the
// GEO coding agent — those keep running exactly as they do today.
import "server-only";
import { tasks, idempotencyKeys } from "@trigger.dev/sdk";
import { UpstreamError } from "@/server/upstream";
import { triggerEnabled } from "@/server/trigger/flags.server";

export class TriggerGatewayError extends UpstreamError {
  constructor(status: number, message: string, code?: string) {
    super(status, message, { provider: "trigger.dev", code });
    this.name = "TriggerGatewayError";
  }
}

export type TriggerHandle = { id: string };

/** The narrow slice of the SDK this client actually calls — tests inject a fake. */
export type TriggerCaller = (
  taskId: string,
  payload: unknown,
  idempotencyKey: string,
) => Promise<TriggerHandle>;

async function defaultCaller(
  taskId: string,
  payload: unknown,
  idempotencyKey: string,
): Promise<TriggerHandle> {
  // v4.3.1+: a raw string key defaults to "run" scope, not "global" — this
  // client always wants a stable, caller-chosen key that survives retries
  // and de-dupes a second click on the same action, so scope is explicit.
  const key = await idempotencyKeys.create(idempotencyKey, { scope: "global" });
  const handle = await tasks.trigger(taskId, payload, { idempotencyKey: key });
  return { id: handle.id };
}

let caller: TriggerCaller = defaultCaller;

/** Tests inject a fake caller instead of hitting a real Trigger.dev instance. Pass null to reset. */
export function setTriggerCaller(next: TriggerCaller | null): void {
  caller = next ?? defaultCaller;
}

/**
 * Enqueue a durable Trigger.dev task run. Throws TriggerGatewayError when
 * Trigger.dev isn't configured or the enqueue itself fails — callers decide
 * whether to fall back to running the work inline.
 */
export async function triggerTask(
  taskId: string,
  payload: unknown,
  idempotencyKey: string,
): Promise<TriggerHandle> {
  if (!triggerEnabled()) {
    throw new TriggerGatewayError(
      503,
      "Trigger.dev is not configured on the server. Set TRIGGER_API_URL and TRIGGER_SECRET_KEY.",
      "missing_config",
    );
  }
  try {
    return await caller(taskId, payload, idempotencyKey);
  } catch (error) {
    if (error instanceof TriggerGatewayError) throw error;
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 300);
    throw new TriggerGatewayError(502, `Trigger.dev enqueue failed: ${message}`, "provider_error");
  }
}
