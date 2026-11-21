import { describe, expect, it } from "vitest";
import { renderHookCue } from "./finish.server";
import { hookCues, HOOK_TEXT_PRESET_IDS } from "@/lib/ugc/hook-text";

describe("renderHookCue", () => {
  it("draws every preset as a transparent PNG the size of the video", async () => {
    for (const id of HOOK_TEXT_PRESET_IDS) {
      const text = id === "split-label" ? "me / my bank account" : "she ended him in 9 seconds";
      const cues = hookCues(text, id, 10, { replyTo: "Replying to @prove_it_pls" });
      expect(cues.length).toBeGreaterThan(0);
      const png = await renderHookCue(cues[0], { width: 288, height: 512 }, { font: "Montserrat" });
      // PNG signature and the IHDR size.
      expect(png.subarray(1, 4).toString()).toBe("PNG");
      expect(png.readUInt32BE(16)).toBe(288);
      expect(png.readUInt32BE(20)).toBe(512);
    }
  }, 120_000);
});
