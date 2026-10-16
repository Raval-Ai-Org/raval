import { describe, expect, it } from "vitest";
import { actionLabel, ago, fmtDate, fmtDateTime, pageCount } from "./format";

const NOW = new Date("2026-10-18T12:00:00Z").getTime();

describe("ago", () => {
  it("says never for no date and a dash for a bad one", () => {
    expect(ago(null)).toBe("never");
    expect(ago("not a date")).toBe("—");
  });

  it("uses the smallest sensible unit", () => {
    expect(ago("2026-10-18T11:59:30Z", NOW)).toBe("just now");
    expect(ago("2026-10-18T11:15:00Z", NOW)).toBe("45 min ago");
    expect(ago("2026-10-18T07:00:00Z", NOW)).toBe("5 h ago");
    expect(ago("2026-10-16T12:00:00Z", NOW)).toBe("2 days ago");
    expect(ago("2026-10-17T13:00:00Z", NOW)).toBe("23 h ago");
    expect(ago("2026-10-17T12:00:00Z", NOW)).toBe("1 day ago");
  });

  it("falls back to a date for old events", () => {
    expect(ago("2026-01-01T00:00:00Z", NOW)).toBe(fmtDate("2026-01-01T00:00:00Z"));
  });

  it("never reports a negative age for a clock a little ahead", () => {
    expect(ago("2026-10-18T12:00:05Z", NOW)).toBe("just now");
  });
});

describe("dates", () => {
  it("show a dash for missing or invalid values", () => {
    expect(fmtDate(null)).toBe("—");
    expect(fmtDateTime(undefined)).toBe("—");
    expect(fmtDate("nope")).toBe("—");
  });
});

describe("labels and paging", () => {
  it("turns an action key into words", () => {
    expect(actionLabel("user.sessions_revoked")).toBe("User sessions revoked");
    expect(actionLabel("admin.permission_denied")).toBe("Admin permission denied");
  });

  it("always has at least one page", () => {
    expect(pageCount(0, 25)).toBe(1);
    expect(pageCount(25, 25)).toBe(1);
    expect(pageCount(26, 25)).toBe(2);
  });
});
