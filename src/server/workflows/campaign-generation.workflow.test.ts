import { afterEach, describe, expect, it, vi } from "vitest";

const readBrandDna = vi.hoisted(() => vi.fn());
vi.mock("@/server/workspaces/brand-dna.server", () => ({ readBrandDna }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

import { campaignGenerationWorkflow } from "./campaign-generation.workflow";

afterEach(() => {
  readBrandDna.mockReset();
  delete process.env.ANTHROPIC_API_KEY;
  vi.unstubAllGlobals();
});

describe("campaignGenerationWorkflow", () => {
  it("gathers brand context, then grounds the generated brief in it", async () => {
    readBrandDna.mockResolvedValue({
      dna: {
        brandName: "Mellox",
        oneLiner: "AI marketing intelligence",
        about: "Helps small teams market like agencies",
        audience: "Solo founders",
        voice: "Confident, direct",
        values: "Speed, clarity",
        products: "Brand DNA, GEO audits, Studio",
      },
      version: 1,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    process.env.ANTHROPIC_API_KEY = "test-key";
    const brief = {
      theme: "Launch week",
      keyMessage: "Market like an agency, without one",
      targetAudience: "Solo founders",
      callToAction: "Start free",
      contentIdeas: [{ channel: "email", idea: "Founder story", hook: "We built this because..." }],
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          stop_reason: "end_turn",
          content: [{ type: "text", text: JSON.stringify(brief) }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const run = await campaignGenerationWorkflow.createRun();
    const result = await run.start({
      inputData: { workspaceId: "ws-1", goal: "Launch week signups", channels: ["email"] },
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.result).toEqual(brief);

    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(request.messages[0].content).toContain("<untrusted_data");
    expect(request.messages[0].content).toContain("Mellox");
    expect(request.messages[0].content).toContain("Launch week signups");
  });

  it("falls back to empty brand fields when no Brand DNA is stored yet", async () => {
    readBrandDna.mockResolvedValue(null);
    process.env.ANTHROPIC_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          stop_reason: "end_turn",
          content: [
            {
              type: "text",
              text: JSON.stringify({
                theme: "",
                keyMessage: "",
                targetAudience: "",
                callToAction: "",
                contentIdeas: [],
              }),
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const run = await campaignGenerationWorkflow.createRun();
    const result = await run.start({
      inputData: { workspaceId: "ws-1", goal: "Awareness", channels: ["social"] },
    });

    expect(result.status).toBe("success");
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(request.messages[0].content).toContain("(unknown)");
  });
});
