import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ generate: vi.fn(), feature: vi.fn(), wallet: vi.fn() }));
vi.mock("@/server/route", () => ({
  defineRoute: (config: { handler: unknown }) => config.handler,
}));
vi.mock("@/server/studio/ideas.server", () => ({ generateStudioIdeas: mocks.generate }));
vi.mock("@/server/billing/feature.server", () => ({ requireBillingFeature: mocks.feature }));
vi.mock("@/server/billing/metered.server", () => ({
  runMetered: mocks.wallet,
  beginDeferredMetered: mocks.wallet,
}));
import { POST } from "./route";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.generate.mockResolvedValue({ ideas: [], generated: "model", cached: false });
});
describe("included Studio suggestions", () => {
  it.each([false, true])(
    "never touches the wallet for automatic or refreshed ideas (refresh=%s)",
    async (refresh) => {
      const handle = POST as unknown as (context: unknown) => Promise<unknown>;
      await expect(
        handle({
          workspaceId: "workspace",
          userId: "user",
          role: "editor",
          supabase: {},
          body: { refresh },
        }),
      ).resolves.toEqual({ ideas: [], generated: "model", cached: false });
      expect(mocks.wallet).not.toHaveBeenCalled();
      expect(mocks.feature).toHaveBeenCalledWith(
        expect.objectContaining({ feature: "studio", spending: true }),
      );
    },
  );
});
