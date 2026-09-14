import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("takePendingGeoRun", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("window", new EventTarget());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("records nothing until capture is installed", async () => {
    const { takePendingGeoRun } = await import("./pending-run");
    window.dispatchEvent(new Event("geo:run-audit"));
    expect(takePendingGeoRun()).toBe(false);
  });

  it("claims a run request fired before the dialog loaded, exactly once", async () => {
    const { ensureGeoRunCapture, takePendingGeoRun } = await import("./pending-run");
    ensureGeoRunCapture();
    ensureGeoRunCapture(); // idempotent
    expect(takePendingGeoRun()).toBe(false);
    window.dispatchEvent(new Event("geo:run-audit"));
    expect(takePendingGeoRun()).toBe(true);
    expect(takePendingGeoRun()).toBe(false);
  });

  it("ignores a stale request", async () => {
    const { ensureGeoRunCapture, takePendingGeoRun } = await import("./pending-run");
    ensureGeoRunCapture();
    window.dispatchEvent(new Event("geo:run-audit"));
    expect(takePendingGeoRun(Date.now() + 60_000)).toBe(false);
  });
});
