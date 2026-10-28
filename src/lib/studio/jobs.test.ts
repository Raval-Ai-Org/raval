import { describe, expect, it } from "vitest";
import { StartRenderBody } from "@/lib/ugc/schemas";
import { CreateJobSchema } from "./jobs";

const base = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  type: "video" as const,
  idempotencyKey: "video-duration-test",
  intent: { brief: "Create a launch video" },
  controls: { platforms: ["instagram" as const] },
};

describe("Studio video duration validation", () => {
  it("accepts the existing 60-second maximum", () => {
    expect(
      CreateJobSchema.safeParse({
        ...base,
        controls: { ...base.controls, durationSec: 60 },
      }).success,
    ).toBe(true);
  });

  it("explains an unsupported video duration before a render starts", () => {
    const result = CreateJobSchema.safeParse({
      ...base,
      controls: { ...base.controls, durationSec: 61 },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["controls", "durationSec"],
            message: "Videos can be up to 60 seconds long.",
          }),
        ]),
      );
    }
  });

  it("gives the same clear limit before a UGC render starts", () => {
    const result = StartRenderBody.safeParse({
      workspaceId: base.workspaceId,
      projectId: "00000000-0000-4000-8000-000000000002",
      idempotencyKey: base.idempotencyKey,
      durationSec: 61,
      aspectRatio: "9:16",
      resolution: "720p",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("Videos can be up to 60 seconds long.");
    }
  });
});
