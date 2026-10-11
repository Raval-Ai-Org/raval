import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertSafePublishingItems } from "./publishing-safety.server";
vi.mock("./media-safety.server", async (original) => ({
  ...(await original<typeof import("./media-safety.server")>()),
  assertSafeMediaImages: vi.fn(),
  assertSafeMediaPrompt: vi.fn(),
}));
vi.mock("./video-safety.server", () => ({ assertSafeVideo: vi.fn() }));
import { assertSafeMediaImages, assertSafeMediaPrompt } from "./media-safety.server";
import { assertSafeVideo } from "./video-safety.server";
const workspace = "11111111-1111-4111-8111-111111111111";
function db(rows: unknown[], error: unknown = null) {
  const query: any = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    in: vi.fn(async () => ({ data: rows, error })),
  };
  return {
    from: vi.fn(() => query),
    storage: {
      from: vi.fn(() => ({
        createSignedUrl: vi.fn(async () => ({
          data: { signedUrl: "https://storage.example.com/signed" },
          error: null,
        })),
      })),
    },
  } as any;
}
const row = {
  id: "post",
  title: "Product",
  body: "Marketing",
  kind: "image",
  media_url: "https://cdn.example.com/image.png",
  meta: {},
};
beforeEach(() => vi.clearAllMocks());
describe("stored media cannot bypass safety", () => {
  it("reviews caption and image before publication", async () => {
    const client = db([row]);
    await assertSafePublishingItems(client, workspace, ["post"]);
    expect(client.from).toHaveBeenCalledWith("content_items");
    expect(assertSafeMediaPrompt).toHaveBeenCalledWith("Product\nMarketing");
    expect(assertSafeMediaImages).toHaveBeenCalledWith([row.media_url]);
  });
  it("reviews video bytes even when editable kind claims image", async () => {
    await assertSafePublishingItems(
      db([{ ...row, media_url: "https://cdn.example.com/clip.mp4" }]),
      workspace,
      ["post"],
    );
    expect(assertSafeVideo).toHaveBeenCalledWith("https://cdn.example.com/clip.mp4");
    expect(assertSafeMediaImages).not.toHaveBeenCalled();
  });
  it("refuses media storage paths from another workspace", async () => {
    await expect(
      assertSafePublishingItems(
        db([{ ...row, meta: { asset_storage_path: "other-workspace/private.png" } }]),
        workspace,
        ["post"],
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("fails closed on failed reads or missing workspace content", async () => {
    await expect(
      assertSafePublishingItems(db([], { message: "offline" }), workspace, ["post"]),
    ).rejects.toMatchObject({ code: "safety_unavailable" });
    await expect(assertSafePublishingItems(db([]), workspace, ["post"])).rejects.toMatchObject({
      status: 403,
    });
  });
  it("does not send a text-only post to media moderation", async () => {
    await assertSafePublishingItems(db([{ ...row, media_url: null }]), workspace, ["post"]);
    expect(assertSafeMediaPrompt).not.toHaveBeenCalled();
  });
});
