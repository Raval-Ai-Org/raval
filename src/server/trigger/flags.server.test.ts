import { afterEach, describe, expect, it } from "vitest";
import { triggerEnabled } from "./flags.server";

afterEach(() => {
  delete process.env.TRIGGER_API_URL;
  delete process.env.TRIGGER_SECRET_KEY;
});

describe("triggerEnabled", () => {
  it("is off by default", () => {
    expect(triggerEnabled()).toBe(false);
  });

  it("requires both an API URL and a secret key", () => {
    process.env.TRIGGER_API_URL = "http://localhost:8030";
    expect(triggerEnabled()).toBe(false);
    process.env.TRIGGER_SECRET_KEY = "tr_dev_test";
    expect(triggerEnabled()).toBe(true);
  });
});
