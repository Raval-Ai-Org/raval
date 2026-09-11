// errors.ts — error tracking without a vendor SDK in the bundle
// (proposal workstream G: "Error tracking"). When SENTRY_DSN is set, errors
// are sent to Sentry's envelope endpoint with the request id, route and
// workspace as tags; otherwise they are only logged. Reporting never throws
// and is rate-limited per error fingerprint so a hot loop cannot flood it.
import "server-only";
import { getRequestScope } from "@/server/request-context";
import { log, redact } from "./logger";

type Dsn = { endpoint: string; publicKey: string; projectId: string };

export function parseDsn(dsn: string | undefined): Dsn | null {
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace(/^\/+/, "");
    if (!u.username || !projectId) return null;
    return {
      endpoint: `${u.protocol}//${u.host}/api/${projectId}/envelope/`,
      publicKey: u.username,
      projectId,
    };
  } catch {
    return null;
  }
}

const recent = new Map<string, number>();
const DEDUPE_MS = 60_000;

export type ErrorContext = { source?: "server" | "client" | "cron" | "agent"; extra?: Record<string, unknown> };

export function reportError(error: unknown, ctx: ErrorContext = {}): void {
  const err = error instanceof Error ? error : new Error(String(error));
  const scope = getRequestScope();
  log.error(err.message, { error: err, source: ctx.source ?? "server", extra: ctx.extra });

  const dsn = parseDsn(process.env.SENTRY_DSN);
  if (!dsn) return;
  const fingerprint = `${err.name}:${err.message}`.slice(0, 200);
  const last = recent.get(fingerprint) ?? 0;
  if (Date.now() - last < DEDUPE_MS) return;
  recent.set(fingerprint, Date.now());
  if (recent.size > 500) recent.clear();

  const eventId = crypto.randomUUID().replace(/-/g, "");
  const event = {
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: "node",
    level: "error",
    environment: process.env.NODE_ENV ?? "development",
    tags: {
      source: ctx.source ?? "server",
      route: scope.route ?? "unknown",
      request_id: scope.requestId ?? "none",
    },
    user: scope.userId ? { id: scope.userId } : undefined,
    extra: redact({ workspaceId: scope.workspaceId, runId: scope.runId, ...(ctx.extra ?? {}) }),
    exception: {
      values: [{ type: err.name, value: err.message.slice(0, 2000), stacktrace: undefined }],
    },
    message: err.stack?.split("\n").slice(0, 12).join("\n"),
  };
  const envelope = [
    JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString(), dsn: process.env.SENTRY_DSN }),
    JSON.stringify({ type: "event" }),
    JSON.stringify(event),
  ].join("\n");
  void fetch(dsn.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-sentry-envelope",
      "X-Sentry-Auth": `Sentry sentry_version=7, sentry_client=mellox/1.0, sentry_key=${dsn.publicKey}`,
    },
    body: envelope,
    signal: AbortSignal.timeout(5000),
  }).catch(() => undefined);
}
