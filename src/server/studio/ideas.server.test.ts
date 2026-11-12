import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ model: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/ai", () => ({ runStructuredPrompt: mocks.model }));
vi.mock("./context.server", () => ({
  loadStudioContext: async () => ({
    brand: {},
    brandName: "Acme",
    brandText: `Acme makes kettles ${Math.random()}`,
    recent: [],
    socialTrends: null,
  }),
}));
vi.mock("@/lib/studio/ideas", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/studio/ideas")>()),
  collectSignals: () => [
    { source: "pillar", headline: "Kettle care", detail: "How to descale a kettle" },
  ],
}));

import { generateStudioIdeas } from "./ideas.server";

beforeEach(() => mocks.model.mockReset());

describe("generateStudioIdeas cachedOnly", () => {
  it("answers an empty list on a cache miss and never calls the model", async () => {
    const result = await generateStudioIdeas({
      client: {},
      workspaceId: "11111111-1111-4111-8111-111111111111",
      brand: null,
      cachedOnly: true,
      refresh: true,
    });
    expect(result).toEqual({ ideas: [], generated: "fallback", cached: false });
    expect(mocks.model).not.toHaveBeenCalled();
  });
});
