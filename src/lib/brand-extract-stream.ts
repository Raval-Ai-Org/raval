// brand-extract-stream.ts — reads the NDJSON stream from /api/brand-extract.
import type {
  BrandExtractDiscovery,
  BrandExtractProgress,
  BrandExtractResult,
} from "@/lib/brand-extract-events";

const DISCOVERY_KINDS = new Set(["site", "pages", "identity", "market"]);

export type BrandExtractHandlers = {
  onProgress?: (event: BrandExtractProgress) => void;
  onDiscovery?: (event: BrandExtractDiscovery) => void;
};

export type BrandExtractOutcome = {
  result: BrandExtractResult | null;
  error: string | null;
  /** Lines that were not valid JSON objects — a sign of a truncated stream. */
  malformed: number;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/**
 * Consume the whole stream, dispatching progress and discovery events as they
 * arrive. The final record may be unterminated, so the decoder is flushed and
 * the remaining buffer processed when the stream ends. Unknown event types are
 * ignored so the server can add new ones without breaking this reader.
 */
export async function readBrandExtractStream(
  body: ReadableStream<Uint8Array>,
  handlers: BrandExtractHandlers = {},
): Promise<BrandExtractOutcome> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: BrandExtractResult | null = null;
  let error: string | null = null;
  let malformed = 0;

  const processLine = (line: string) => {
    const text = line.trim();
    if (!text) return;
    let event: unknown;
    try {
      event = JSON.parse(text);
    } catch {
      malformed += 1;
      return;
    }
    if (!isObject(event)) {
      malformed += 1;
      return;
    }
    if (event.type === "progress") {
      handlers.onProgress?.({
        type: "progress",
        stage: typeof event.stage === "string" && event.stage ? event.stage : "working",
        message: typeof event.message === "string" ? event.message : "",
        pct: typeof event.pct === "number" && Number.isFinite(event.pct) ? event.pct : 0,
      });
    } else if (event.type === "discovery") {
      if (typeof event.kind === "string" && DISCOVERY_KINDS.has(event.kind) && isObject(event.data))
        handlers.onDiscovery?.(event as unknown as BrandExtractDiscovery);
    } else if (event.type === "result") {
      result = isObject(event.data) ? (event.data as BrandExtractResult) : null;
    } else if (event.type === "error") {
      error =
        typeof event.error === "string" && event.error
          ? event.error
          : "We couldn't complete the scan.";
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      buffer += decoder.decode();
      processLine(buffer);
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) processLine(line);
  }

  return { result, error, malformed };
}
