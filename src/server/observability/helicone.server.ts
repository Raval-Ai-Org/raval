// helicone.server.ts — fire-and-forget async logging sink for a self-hosted
// Helicone instance (LLM observability: tokens, cost, latency, errors, per
// provider/model/workspace).
//
// This does NOT proxy AI calls through Helicone. Every existing gateway
// (src/lib/ai-gateway.server.ts, anthropic-gateway.server.ts,
// kie-gateway.server.ts) keeps calling its provider directly; Helicone only
// ever receives a copy of the same usage event src/server/ai/metering.ts
// already records to Postgres, the same way that function has one sink
// today. A Helicone outage must never slow or fail a real AI request — this
// mirrors recordUsage()'s exact fire-and-forget shape: never awaited by the
// caller, every failure swallowed and logged, nothing ever thrown.
//
// Wire format is Helicone's "custom logging" contract (POST
// {base}/custom/v1/log, Bearer auth, {providerRequest, providerResponse,
// timing}) — the same one the official manual-logger clients use. Verify
// this against the pinned self-hosted Helicone version's docs before
// depending on it in production; this file uses raw fetch rather than
// @helicone/async or @helicone/helpers to match this codebase's convention
// of zero AI/observability SDK packages.
import "server-only";
import {
  heliconeEnabled,
  heliconeLogPromptsEnabled,
} from "@/server/observability/helicone-flags.server";

const LOG_TIMEOUT_MS = 5_000;

export type HeliconeTransport = (payload: Record<string, unknown>) => Promise<void>;

async function postLog(payload: Record<string, unknown>): Promise<void> {
  const baseUrl = process.env.HELICONE_BASE_URL?.trim();
  if (!baseUrl) return;
  const apiKey = process.env.HELICONE_API_KEY?.trim();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOG_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/custom/v1/log`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      await res.text().catch(() => "");
      throw new Error(`Helicone rejected the log with status ${res.status}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

let transport: HeliconeTransport = postLog;

/** Tests swap the transport to observe/short-circuit the HTTP call. Pass null to reset. */
export function setHeliconeTransport(next: HeliconeTransport | null): void {
  transport = next ?? postLog;
}

function toHeliconeTime(ms: number): { seconds: number; milliseconds: number } {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
  return { seconds: Math.floor(safe / 1000), milliseconds: Math.floor(safe % 1000) };
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function asNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Log one already-recorded usage row (the exact row src/server/ai/metering.ts
 * builds for public.record_ai_usage) to Helicone. Never throws, never awaited
 * by the caller — call it and move on.
 */
export function logToHelicone(row: Record<string, unknown>): void {
  if (!heliconeEnabled()) return;

  const model = asString(row.model) ?? "unknown";
  const inputTokens = Math.max(0, Math.round(asNumber(row.input_tokens)));
  const outputTokens = Math.max(0, Math.round(asNumber(row.output_tokens)));
  const latencyMs = asNumber(row.latency_ms);
  const now = Date.now();
  const started = now - Math.max(0, latencyMs);
  const includeBodies = heliconeLogPromptsEnabled();
  const requestBody = includeBodies ? row.request_body : undefined;
  const responseBody = includeBodies ? row.response_body : undefined;

  const payload = {
    providerRequest: {
      url: "custom-model-nopath",
      json: requestBody ?? { model },
      meta: {
        "Helicone-Property-Route": asString(row.route) ?? "unknown",
        "Helicone-Property-Provider": asString(row.provider) ?? "unknown",
        "Helicone-Property-Status": asString(row.status) ?? "ok",
        ...(row.workspace_id ? { "Helicone-Property-Workspace": String(row.workspace_id) } : {}),
        ...(row.user_id ? { "Helicone-User-Id": String(row.user_id) } : {}),
        ...(row.cached ? { "Helicone-Property-Cached": "true" } : {}),
        ...(row.truncated ? { "Helicone-Property-Truncated": "true" } : {}),
        ...(row.est_cost_usd != null
          ? { "Helicone-Property-Est-Cost-Usd": String(row.est_cost_usd) }
          : {}),
          "Helicone-Property-Input-Tokens": String(inputTokens),
          "Helicone-Property-Output-Tokens": String(outputTokens),
          "Helicone-Property-Total-Tokens": String(inputTokens + outputTokens),
          "Helicone-Property-Latency-Ms": String(Math.max(0, Math.round(latencyMs))),
      },
    },
    providerResponse: {
      status: row.status === "error" ? 500 : 200,
      headers: {},
      json: responseBody ?? {
        model,
        usage: {
          prompt_tokens: inputTokens,
          completion_tokens: outputTokens,
          total_tokens: inputTokens + outputTokens,
        },
      },
    },
    timing: {
      startTime: toHeliconeTime(started),
      endTime: toHeliconeTime(now),
    },
  };

  void transport(payload).catch((error) => {
    console.error("[helicone] log not delivered", error instanceof Error ? error.message : error);
  });
}
