// T062 — feature-flag + degraded mode (spec FR-017/SC-007): when the flag is
// OFF, publish/schedule degrade to today's mock (server-side status flip) so the
// platform never regresses and content is never lost.
import { describe, it, expect } from "vitest";
import { isSdrEnabled, isSdrEnabledForWorkspace } from "@/lib/feature-flags";
import { handleSdrDisabled } from "@/lib/sdr.handlers";

describe("isSdrEnabled", () => {
  it("defaults to false when unset", () => {
    delete process.env.FEATURE_FLAG_SDR_ENABLED;
    expect(isSdrEnabled()).toBe(false);
  });
  it("is true for 'true' / '1' / 'yes'", () => {
    for (const v of ["true", "1", "yes"]) {
      process.env.FEATURE_FLAG_SDR_ENABLED = v;
      expect(isSdrEnabled()).toBe(true);
    }
  });
  it("is false for '0' / 'false'", () => {
    for (const v of ["0", "false"]) {
      process.env.FEATURE_FLAG_SDR_ENABLED = v;
      expect(isSdrEnabled()).toBe(false);
    }
  });
});

describe("handleSdrDisabled (distribution off — US5)", () => {
  it("publish is refused with DISTRIBUTION_DISABLED and nothing is marked published", async () => {
    const out = await handleSdrDisabled({
      workspaceId: "ws-1",
      contentItemIds: ["item-1"],
      kind: "publish",
    });
    expect(out.status).toBe(503);
    expect(out.body.error.code).toBe("DISTRIBUTION_DISABLED");
    expect(out.body.results[0]).toEqual({ contentItemId: "item-1", status: "not_sent" });
  });

  it("schedule is refused the same way — no fake scheduled state", async () => {
    const out = await handleSdrDisabled({
      workspaceId: "ws-1",
      contentItemIds: ["item-1", "item-2"],
      kind: "schedule",
    });
    expect(out.status).toBe(503);
    expect(out.body.results.map((r: { status: string }) => r.status)).toEqual([
      "not_sent",
      "not_sent",
    ]);
  });
});

describe("isSdrEnabledForWorkspace", () => {
  it("lets one workspace be enabled while the global flag is off", () => {
    process.env.FEATURE_FLAG_SDR_ENABLED = "";
    process.env.FEATURE_FLAG_SDR_ENABLED_WS_ws9 = "true";
    try {
      expect(isSdrEnabledForWorkspace("ws9")).toBe(true);
      expect(isSdrEnabledForWorkspace("other")).toBe(false);
    } finally {
      delete process.env.FEATURE_FLAG_SDR_ENABLED_WS_ws9;
    }
  });
});
