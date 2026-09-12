// logger.ts — structured JSON logs (proposal workstream G: log retention needs
// logs a machine can read). One line per event with level, message, request
// id, workspace and route from the ambient request scope. Values under keys
// that look secret are masked, and long strings are clipped, before writing.
import "server-only";
import { getRequestScope } from "@/server/request-context";

type Level = "debug" | "info" | "warn" | "error";
const SENSITIVE = /token|secret|password|authorization|api[-_]?key|cookie|signature/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[depth]";
  if (typeof value === "string") return value.length > 2000 ? `${value.slice(0, 2000)}…` : value;
  if (value instanceof Error)
    return {
      name: value.name,
      message: value.message,
      stack: value.stack?.split("\n").slice(0, 8).join("\n"),
    };
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE.test(k) ? "[redacted]" : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

function write(level: Level, message: string, fields: Record<string, unknown> = {}) {
  const scope = getRequestScope();
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg: message,
    requestId: scope.requestId,
    route: scope.route,
    workspaceId: scope.workspaceId,
    runId: scope.runId,
    ...(redact(fields) as Record<string, unknown>),
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => {
    if (process.env.LOG_LEVEL === "debug") write("debug", msg, fields);
  },
  info: (msg: string, fields?: Record<string, unknown>) => write("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => write("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => write("error", msg, fields),
};
