import { afterEach, describe, expect, it, vi } from "vitest";
import { setTriggerCaller, triggerTask } from "./client.server";

afterEach(() => {
  delete process.env.TRIGGER_API_URL;
  delete process.env.TRIGGER_SECRET_KEY;
  setTriggerCaller(null);
});

function enable() {
  process.env.TRIGGER_API_URL = "http://localhost:8030";
  process.env.TRIGGER_SECRET_KEY = "tr_dev_test";
}

describe("triggerTask", () => {
  it("throws a 503 TriggerGatewayError when not configured, without calling the caller", async () => {
    const caller = vi.fn();
    setTriggerCaller(caller);

    await expect(triggerTask("some-task", { a: 1 }, "key-1")).rejects.toMatchObject({
      status: 503,
      code: "missing_config",
    });
    expect(caller).not.toHaveBeenCalled();
  });

  it("passes the task id, payload and idempotency key through to the caller", async () => {
    enable();
    const caller = vi.fn().mockResolvedValue({ id: "run_123" });
    setTriggerCaller(caller);

    const handle = await triggerTask(
      "competitor-intel-run",
      { runId: "r1" },
      "competitor-intel-run:r1",
    );

    expect(handle).toEqual({ id: "run_123" });
    expect(caller).toHaveBeenCalledWith(
      "competitor-intel-run",
      { runId: "r1" },
      "competitor-intel-run:r1",
    );
  });

  it("wraps a caller failure as a TriggerGatewayError", async () => {
    enable();
    setTriggerCaller(vi.fn().mockRejectedValue(new Error("connection refused")));

    const error = await triggerTask("some-task", {}, "key-1").catch((e) => e);
    expect(error.status).toBe(502);
    expect(error.message).toContain("connection refused");
  });
});
