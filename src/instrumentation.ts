// instrumentation.ts — runs once when the Next.js server starts.
// Validates configuration (src/server/env.ts): in production a missing
// required variable stops the process with a clear list instead of failing on
// the first request that needs it. Values are never printed — names only.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { checkEnv } = await import("./server/env");
  const report = checkEnv(process.env);
  for (const w of report.warnings) console.warn(`[env] ${w}`);
  if (!report.ok) {
    for (const e of report.errors) console.error(`[env] ${e}`);
    if (process.env.NODE_ENV === "production" && process.env.ENV_VALIDATION !== "warn") {
      throw new Error(
        `Server configuration is invalid (${report.errors.length} problem(s)); see the [env] lines above. Set ENV_VALIDATION=warn to boot anyway.`,
      );
    }
  }
}

// Server-side render/route errors → the error tracker.
export async function onRequestError(error: unknown, request: { path: string; method: string }) {
  const { reportError } = await import("./server/observability/errors");
  reportError(error, { source: "server", extra: { path: request.path, method: request.method } });
}
