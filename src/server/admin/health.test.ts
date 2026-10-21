import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

import { cronState } from "./health.server";

const NOW = Date.parse("2026-10-18T12:00:00Z");
const base = {
  job: "j",
  expected_interval_seconds: 300,
  last_started_at: null,
  last_succeeded_at: null,
  last_failed_at: null,
  failure_count: 0,
  run_count: 0,
  last_duration_ms: null,
  last_error: null,
};

describe("cronState", () => {
  it("never ran", () => expect(cronState(base, NOW)).toBe("never"));

  it("healthy within two intervals", () => {
    expect(cronState({ ...base, last_succeeded_at: "2026-10-18T11:55:00Z" }, NOW)).toBe("healthy");
  });

  it("late after two missed intervals", () => {
    expect(cronState({ ...base, last_succeeded_at: "2026-10-18T11:40:00Z" }, NOW)).toBe("late");
  });

  it("failing when the last result was a failure", () => {
    expect(
      cronState(
        {
          ...base,
          last_succeeded_at: "2026-10-18T11:50:00Z",
          last_failed_at: "2026-10-18T11:58:00Z",
        },
        NOW,
      ),
    ).toBe("failing");
  });

  it("recovers once a success follows the failure", () => {
    expect(
      cronState(
        {
          ...base,
          last_succeeded_at: "2026-10-18T11:59:00Z",
          last_failed_at: "2026-10-18T11:50:00Z",
        },
        NOW,
      ),
    ).toBe("healthy");
  });
});
