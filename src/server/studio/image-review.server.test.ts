import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai-gateway.server", () => ({ chatCompletion: vi.fn() }));

import { reviewGeneratedImage } from "./image-review.server";

const image = "data:image/png;base64,aGVsbG8=";

describe("finished image review", () => {
  it("returns a concrete visible defect for review", async () => {
    const result = await reviewGeneratedImage(image, "A branded product image", async () =>
      JSON.stringify({ status: "warn", issues: ["The prominent headline is unreadable."] }),
    );
    expect(result).toEqual({ status: "warn", issues: ["The prominent headline is unreadable."] });
  });

  it("does not block an image when review is unavailable or malformed", async () => {
    expect(await reviewGeneratedImage(image, "brief", async () => "not json")).toBeNull();
    expect(
      await reviewGeneratedImage("https://example.com/image.png", "brief", async () => "{}"),
    ).toBeNull();
  });

  it("treats a warning without a specific issue as a pass", async () => {
    expect(
      await reviewGeneratedImage(image, "brief", async () =>
        JSON.stringify({ status: "warn", issues: [] }),
      ),
    ).toEqual({ status: "pass", issues: [] });
  });
});
