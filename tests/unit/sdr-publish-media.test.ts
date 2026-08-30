// T032 — media pre-flight (spec FR-012/FR-019/FR-020): Instagram requires
// exactly one image; media URLs are passed through durably to the SDR.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MockSDR } from "../fixtures/mock-sdr";
import { makeMockContentDb, type MockContentItem } from "../fixtures/mock-db";
import { publishContentItemsHandler, type PublishDeps } from "@/lib/sdr.handlers";

describe("publish media pre-flight (FR-019/FR-020)", () => {
  const sdr = new MockSDR();
  beforeAll(async () => {
    await sdr.start();
    sdr.addAccount({
      account_id: "ig-1",
      platform: "instagram",
      platform_username: "Brand IG",
      status: "active",
    });
  });
  afterAll(async () => await sdr.stop());

  const deps = (dbItems: MockContentItem[]): PublishDeps => ({
    sdrBaseUrl: sdr.baseUrl,
    token: "ws-key",
    db: makeMockContentDb(dbItems),
  });

  it("text-only Instagram publish is rejected 422 (requires exactly one image)", async () => {
    const out = await publishContentItemsHandler(
      { workspaceId: "ws-1", contentItemIds: ["ig-item"], selection: { type: "all" } },
      deps([
        {
          id: "ig-item",
          workspace_id: "ws-1",
          body: "caption",
          media_url: null,
          status: "approved",
          meta: { platform: "instagram" },
        },
      ]),
    );
    expect(out.status).toBe(422);
  });

  it("Instagram with one image publishes and passes the durable media URL to the SDR", async () => {
    sdr.reset();
    sdr.addAccount({
      account_id: "ig-1",
      platform: "instagram",
      platform_username: "Brand IG",
      status: "active",
    });
    const out = await publishContentItemsHandler(
      { workspaceId: "ws-1", contentItemIds: ["ig-item"], selection: { type: "all" } },
      deps([
        {
          id: "ig-item",
          workspace_id: "ws-1",
          body: "caption",
          media_url: "https://cdn.example.com/image.jpg",
          status: "approved",
          meta: { platform: "instagram" },
        },
      ]),
    );
    expect(out.status).toBe(200);
    expect(out.body.results[0].status).toBe("publishing");
    const req = sdr.getRequests().find((r) => r.path === "/api/v1/publish" && r.method === "POST");
    expect(req?.body.targets[0].content.media_urls).toEqual(["https://cdn.example.com/image.jpg"]);
  });
});
