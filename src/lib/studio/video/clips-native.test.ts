import { describe, expect, it } from "vitest";
import { durationsFor, resolveUgcModel } from "@/lib/ugc/models";
import { CLIP_SECONDS } from "./lengths";

// A clip is planned at one length (lengths.ts) and made whole: the
// composition refuses a provider that would cut it (minimumDurationSec).
describe("clip lengths", () => {
  it.each(["standard", "draft", "premium", "long", "cinematic", "animation"] as const)(
    "%s makes its clip length natively on KIE, from a prompt and from a picture",
    (key) => {
      const model = resolveUgcModel(key, "kie");
      expect(model.durations).toContain(CLIP_SECONDS[key]);
      expect(durationsFor(model, true)).toContain(CLIP_SECONDS[key]);
    },
  );

  // Economy and Standard keep the same plan when KIE falls back to OpenRouter.
  it.each(["standard", "draft"] as const)("%s keeps its clip length on OpenRouter", (key) => {
    expect(resolveUgcModel(key, "openrouter").durations).toContain(CLIP_SECONDS[key]);
  });
});
