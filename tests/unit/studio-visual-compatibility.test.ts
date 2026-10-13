import { expect, it } from "vitest";
import { studioDefaultControls } from "@/lib/studio/session-store";
import { studioChargeFor } from "@/lib/studio/billing";
import { ControlsSchema } from "@/lib/studio/jobs";
it("new video sessions retain direct video generation and its original allowance", () => {
  const controls = studioDefaultControls("video");
  expect(controls).toMatchObject({ durationSec: 6, videoResolution: "720P", audio: true });
  expect(controls.videoPreview).toBeUndefined();
  expect(studioChargeFor({ type: "video", ...controls })).toBe("studio_video");
  expect(ControlsSchema.parse({ durationSec: 6 }).videoPreview).toBeUndefined();
});
