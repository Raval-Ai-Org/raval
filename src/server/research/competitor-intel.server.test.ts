import { afterEach, describe, expect, it, vi } from "vitest";
import { setFirecrawlClient } from "@/lib/firecrawl-gateway.server";
import { setUsageSink } from "@/server/ai/metering";

const state = vi.hoisted(() => ({ rows: new Map<string, Record<string, unknown>>(), nextId: 1 }));

function builder(table: string) {
  if (table !== "competitor_intelligence_runs") throw new Error(`unexpected table ${table}`);
  let filterId: string | undefined;
  let insertedRow: Record<string, unknown> | null = null;
  const chain = {
    insert(value: Record<string, unknown>) {
      const id = `run-${state.nextId++}`;
      insertedRow = {
        id,
        pages_crawled: [],
        result: null,
        error: null,
        completed_at: null,
        created_at: new Date().toISOString(),
        ...value,
      };
      state.rows.set(id, insertedRow);
      return chain;
    },
    update(value: Record<string, unknown>) {
      if (filterId) state.rows.set(filterId, { ...state.rows.get(filterId), ...value });
      return chain;
    },
    eq(_column: string, value: string) {
      filterId = value;
      return chain;
    },
    select() {
      return chain;
    },
    async single() {
      const row = insertedRow ?? (filterId ? state.rows.get(filterId) : undefined);
      return row ? { data: row, error: null } : { data: null, error: { message: "not found" } };
    },
  };
  return chain;
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: vi.fn((table: string) => builder(table)) },
}));

const triggerEnabled = vi.hoisted(() => vi.fn(() => false));
const triggerTask = vi.hoisted(() => vi.fn());
vi.mock("@/server/trigger/flags.server", () => ({ triggerEnabled }));
vi.mock("@/server/trigger/client.server", () => ({ triggerTask }));

import { runCompetitorIntel, startCompetitorIntelRun } from "./competitor-intel.server";

afterEach(() => {
  delete process.env.FIRECRAWL_BASE_URL;
  delete process.env.ANTHROPIC_API_KEY;
  setFirecrawlClient(null);
  setUsageSink(async () => {});
  vi.unstubAllGlobals();
  state.rows.clear();
  triggerEnabled.mockReturnValue(false);
  triggerTask.mockReset();
});

describe("runCompetitorIntel", () => {
  it("throws a FirecrawlGatewayError when Firecrawl is not configured", async () => {
    await expect(runCompetitorIntel("https://competitor.com")).rejects.toMatchObject({
      status: 503,
      code: "missing_config",
    });
  });

  it("crawls the competitor site and synthesizes a grounded profile", async () => {
    process.env.FIRECRAWL_BASE_URL = "http://localhost:3002";
    process.env.ANTHROPIC_API_KEY = "test-key";

    setFirecrawlClient({
      scrape: vi.fn(),
      crawl: vi.fn().mockResolvedValue({
        data: [
          {
            markdown: "We help solo founders ship faster. Pricing starts at $29/mo.",
            links: [],
            metadata: { sourceURL: "https://competitor.com" },
          },
        ],
      }),
      map: vi.fn(),
      search: vi.fn(),
    });

    const claudeResponse = {
      positioning: "Positioned for solo founders",
      strengths: ["Fast onboarding"],
      weaknesses: [],
      targetAudience: "Solo founders",
      pricingSignals: "$29/mo starting price",
      differentiators: ["Speed"],
      contentThemes: ["Productivity"],
      evidence: [{ claim: "$29/mo", source: "https://competitor.com" }],
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          stop_reason: "end_turn",
          content: [{ type: "text", text: JSON.stringify(claudeResponse) }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await runCompetitorIntel("https://competitor.com");

    expect(result.positioning).toBe("Positioned for solo founders");
    expect(result.pagesCrawled).toEqual(["https://competitor.com"]);
    expect(result.evidence).toEqual([{ claim: "$29/mo", source: "https://competitor.com" }]);

    // The crawled text reached Claude wrapped as untrusted data, not raw.
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(request.messages[0].content).toContain("<untrusted_data");
    expect(request.messages[0].content).toContain("solo founders");
  });
});

describe("startCompetitorIntelRun", () => {
  const opts = { workspaceId: "ws-1", competitorUrl: "https://competitor.com", userId: "user-1" };

  it("enqueues a Trigger.dev task and returns immediately, without crawling inline", async () => {
    triggerEnabled.mockReturnValue(true);
    triggerTask.mockResolvedValue({ id: "run-handle-1" });
    const crawl = vi.fn();
    setFirecrawlClient({ scrape: vi.fn(), crawl, map: vi.fn(), search: vi.fn() });

    const row = await startCompetitorIntelRun(opts);

    expect(row.status).toBe("running");
    expect(triggerTask).toHaveBeenCalledWith(
      "competitor-intel-run",
        { runId: row.id, workspaceId: opts.workspaceId, competitorUrl: opts.competitorUrl },
      `competitor-intel-run:${row.id}`,
    );
    expect(crawl).not.toHaveBeenCalled();
  });

  it("runs inline when Trigger.dev is not configured", async () => {
    process.env.FIRECRAWL_BASE_URL = "http://localhost:3002";
    process.env.ANTHROPIC_API_KEY = "test-key";
    setFirecrawlClient({
      scrape: vi.fn(),
      crawl: vi.fn().mockResolvedValue({
        data: [
          { markdown: "positioning text", links: [], metadata: { sourceURL: opts.competitorUrl } },
        ],
      }),
      map: vi.fn(),
      search: vi.fn(),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: "{}" }] }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      ),
    );

    const row = await startCompetitorIntelRun(opts);

    expect(row.status).toBe("succeeded");
    expect(triggerTask).not.toHaveBeenCalled();
  });

  it("falls back to running inline when the Trigger.dev enqueue itself fails", async () => {
    triggerEnabled.mockReturnValue(true);
    triggerTask.mockRejectedValue(new Error("unreachable"));
    process.env.FIRECRAWL_BASE_URL = "http://localhost:3002";
    process.env.ANTHROPIC_API_KEY = "test-key";
    setFirecrawlClient({
      scrape: vi.fn(),
      crawl: vi.fn().mockResolvedValue({
        data: [
          { markdown: "positioning text", links: [], metadata: { sourceURL: opts.competitorUrl } },
        ],
      }),
      map: vi.fn(),
      search: vi.fn(),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: "{}" }] }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      ),
    );

    const row = await startCompetitorIntelRun(opts);

    expect(row.status).toBe("succeeded");
  });
});
