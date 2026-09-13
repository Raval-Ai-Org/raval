import { describe, expect, it } from "vitest";
import { readBrandExtractStream } from "@/lib/brand-extract-stream";
import type { BrandExtractDiscovery, BrandExtractProgress } from "@/lib/brand-extract-events";

function streamOf(chunks: string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe("readBrandExtractStream", () => {
  it("dispatches events split across chunks and flushes an unterminated final record", async () => {
    const progress: BrandExtractProgress[] = [];
    const discoveries: BrandExtractDiscovery[] = [];
    const lines = [
      JSON.stringify({ type: "progress", stage: "fetch_home", message: "Fetching", pct: 5 }),
      JSON.stringify({
        type: "discovery",
        kind: "identity",
        data: {
          colors: ["#112233"],
          fonts: ["Inter"],
          structuredData: 1,
          headings: 4,
          socialPlatforms: [],
        },
      }),
      JSON.stringify({ type: "result", data: { brandName: "Acme" } }),
    ].join("\n");
    const cut = Math.floor(lines.length / 2);

    const outcome = await readBrandExtractStream(
      streamOf([lines.slice(0, cut), lines.slice(cut)]),
      {
        onProgress: (event) => progress.push(event),
        onDiscovery: (event) => discoveries.push(event),
      },
    );

    expect(progress).toEqual([
      { type: "progress", stage: "fetch_home", message: "Fetching", pct: 5 },
    ]);
    expect(discoveries).toHaveLength(1);
    expect(discoveries[0].kind).toBe("identity");
    expect(outcome).toEqual({ result: { brandName: "Acme" }, error: null, malformed: 0 });
  });

  it("ignores unknown event types and invalid discoveries", async () => {
    const discoveries: BrandExtractDiscovery[] = [];
    const outcome = await readBrandExtractStream(
      streamOf([
        `${JSON.stringify({ type: "telemetry", value: 1 })}\n`,
        `${JSON.stringify({ type: "discovery", kind: "unknown", data: {} })}\n`,
        `${JSON.stringify({ type: "discovery", kind: "site", data: null })}\n`,
      ]),
      { onDiscovery: (event) => discoveries.push(event) },
    );
    expect(discoveries).toHaveLength(0);
    expect(outcome).toEqual({ result: null, error: null, malformed: 0 });
  });

  it("reports errors and counts malformed lines", async () => {
    const outcome = await readBrandExtractStream(
      streamOf([
        `{"type":"progress"\n`,
        `${JSON.stringify({ type: "error", error: "Blocked" })}\n`,
      ]),
    );
    expect(outcome).toEqual({ result: null, error: "Blocked", malformed: 1 });
  });
});
