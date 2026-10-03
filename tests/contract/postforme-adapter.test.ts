import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listAccounts: vi.fn(),
  createAuthURL: vi.fn(),
  createPost: vi.fn(),
  listPosts: vi.fn(),
  listResults: vi.fn(),
}));

vi.mock("post-for-me", () => ({
  default: class {
    socialAccounts = { list: mocks.listAccounts, createAuthURL: mocks.createAuthURL };
    socialPosts = { create: mocks.createPost, list: mocks.listPosts };
    socialPostResults = { list: mocks.listResults };
  },
}));

import { createPostForMeAdapter } from "@/lib/postforme/client.server";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listAccounts.mockResolvedValue({ data: [], meta: { next: null } });
  mocks.createAuthURL.mockResolvedValue({ url: "https://app.postforme.dev/authorize/test" });
  mocks.createPost.mockResolvedValue({
    id: "sp_1",
    status: "processing",
    caption: "Hello",
    scheduled_at: null,
    social_accounts: [{ id: "sa_1", platform: "x" }],
  });
  mocks.listPosts.mockResolvedValue({ data: [], meta: { next: null } });
});

describe("Post for Me adapter", () => {
  it("scopes account listing to the workspace and maps X and status", async () => {
    mocks.listAccounts.mockResolvedValue({
      data: [
        {
          id: "sa_1",
          platform: "x",
          username: "example",
          status: "connected",
          external_id: "ws_1",
        },
      ],
      meta: { next: null },
    });
    const call = createPostForMeAdapter("ws_1", "pfm_test_key");
    const result = await call({ path: "/accounts" });
    expect(mocks.listAccounts).toHaveBeenCalledWith(
      expect.objectContaining({ external_id: ["ws_1"], status: ["connected"] }),
      expect.anything(),
    );
    expect(result.data.data[0]).toMatchObject({
      platform: "twitter",
      status: "active",
      brand_id: "ws_1",
    });
  });

  it("requests a fresh authorization URL with workspace ownership and feed permission", async () => {
    const call = createPostForMeAdapter("ws_1", "pfm_test_key");
    const result = await call({
      method: "POST",
      path: "/accounts/connect",
      body: { platform: "twitter" },
    });
    expect(mocks.createAuthURL).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "x",
        external_id: "ws_1",
        permissions: ["posts", "feeds"],
      }),
      expect.anything(),
    );
    expect(result.data.auth_url).toBe("https://app.postforme.dev/authorize/test");
  });

  it("maps publishing fields without retrying a create", async () => {
    const call = createPostForMeAdapter("ws_1", "pfm_test_key");
    const result = await call({
      method: "POST",
      path: "/posts",
      body: {
        text: "Hello",
        targets: [{ account_id: "sa_1" }],
        media: [{ source_type: "url", source: "https://example.com/photo.jpg" }],
        scheduled_at: "2030-01-01T00:00:00Z",
        external_id: "ws_1:item_1:123",
      },
    });
    expect(mocks.createPost).toHaveBeenCalledWith(
      expect.objectContaining({
        caption: "Hello",
        social_accounts: ["sa_1"],
        media: [{ url: "https://example.com/photo.jpg" }],
        scheduled_at: "2030-01-01T00:00:00Z",
        external_id: "ws_1:item_1:123",
      }),
      { maxRetries: 0 },
    );
    expect(result).toMatchObject({
      status: 201,
      data: { id: "sp_1", targets: [{ account_id: "sa_1" }] },
    });
  });

  it("keeps a Story publishing until every account and frame has a result", async () => {
    mocks.createPost.mockResolvedValue({
      id: "sp_story",
      status: "processed",
      caption: "Story",
      social_accounts: [
        { id: "sa_ig", platform: "instagram" },
        { id: "sa_fb", platform: "facebook" },
      ],
      platform_configurations: {
        instagram: { placement: "stories" },
        facebook: { placement: "stories" },
      },
      media: [{ url: "https://example.com/one.jpg" }, { url: "https://example.com/two.jpg" }],
    });
    mocks.listResults.mockResolvedValue({
      data: [
        {
          social_account_id: "sa_ig",
          success: true,
          media: [{ url: "https://example.com/one.jpg" }],
          platform_data: { id: "ig_1" },
        },
      ],
      meta: { next: null },
    });
    const call = createPostForMeAdapter("ws_1", "pfm_test_key");
    const result = await call({
      method: "POST",
      path: "/posts",
      body: { text: "Story", targets: [{ account_id: "sa_ig" }, { account_id: "sa_fb" }] },
    });
    expect(result.data.status).toBe("publishing");
    expect(result.data.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ account_id: "sa_ig", frame: 0, status: "published" }),
        expect.objectContaining({ account_id: "sa_fb", status: "publishing" }),
      ]),
    );
  });

  it("finds a timed-out create by its exact external ID", async () => {
    mocks.listPosts.mockResolvedValue({
      data: [
        {
          id: "sp_1",
          external_id: "ws_1:item_1:123",
          status: "processing",
          caption: "Hello",
          social_accounts: [],
        },
        {
          id: "sp_2",
          external_id: "ws_1:item_2:123",
          status: "processing",
          caption: "Hello",
          social_accounts: [],
        },
      ],
      meta: { next: null },
    });
    const call = createPostForMeAdapter("ws_1", "pfm_test_key");
    const result = await call({
      path: "/posts",
      query: { external_id: "ws_1:item_1:123", account_ids: "sa_1" },
    });
    expect(mocks.listPosts).toHaveBeenCalledWith(
      expect.objectContaining({ external_id: ["ws_1:item_1:123"] }),
      expect.anything(),
    );
    expect(result.data.data.map((post: { id: string }) => post.id)).toEqual(["sp_1"]);
  });

  it("returns provider failures for the distribution error mapper", async () => {
    mocks.createAuthURL.mockRejectedValue({
      status: 401,
      name: "AuthenticationError",
      message: "Invalid API key",
    });
    const call = createPostForMeAdapter("ws_1", "pfm_test_key");
    const result = await call({
      method: "POST",
      path: "/accounts/connect",
      body: { platform: "linkedin" },
    });
    expect(result.status).toBe(401);
    expect(result.data.error.message).toBe("Invalid API key");
  });
});
