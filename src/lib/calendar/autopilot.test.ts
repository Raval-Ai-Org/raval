import { describe, expect, it } from "vitest";
import type { ActionView } from "@/lib/autopilot/contracts";
import { autopilotItemIds, autopilotSignature, plannedSlots, slotsByDate } from "./autopilot";
import { localInstant } from "./model";

function action(over: Partial<ActionView>): ActionView {
  return {
    id: "a1",
    kind: "content",
    status: "planned",
    plannedFor: localInstant("2026-10-12", "09:30"),
    platform: "linkedin",
    contentType: "social",
    title: "Why we pay growers more",
    brief: "",
    reason: "",
    opportunityId: null,
    contentItemIds: [],
    creditsCharged: 0,
    approvedVia: null,
    error: null,
    metrics: null,
    updatedAt: "2026-10-07T00:00:00.000Z",
    ...over,
  };
}

const lists = (over: Partial<Record<"proposed" | "upcoming" | "approvals", ActionView[]>>) => ({
  proposed: [],
  approvals: [],
  upcoming: [],
  finished: [],
  failed: [],
  ...over,
});

describe("plannedSlots", () => {
  it("draws a planned piece on its own day and time", () => {
    const [slot] = plannedSlots(lists({ upcoming: [action({})] }));
    expect(slot).toMatchObject({
      id: "a1",
      date: "2026-10-12",
      time: "09:30",
      channel: "linkedin",
      format: "Post",
      state: "planned",
    });
  });

  it("leaves out a piece that is already a post on the calendar", () => {
    const written = action({ id: "a2", status: "approved", contentItemIds: ["c1"] });
    expect(plannedSlots(lists({ upcoming: [written] }))).toEqual([]);
  });

  it("leaves out work that is not a post, and pieces with no usable date", () => {
    const view = lists({
      upcoming: [
        action({ id: "scan", kind: "task" }),
        action({ id: "undated", plannedFor: null }),
        action({ id: "broken", plannedFor: "not a date" }),
      ],
    });
    expect(plannedSlots(view)).toEqual([]);
  });

  it("says what state each piece is in, soonest first", () => {
    const view = lists({
      proposed: [
        action({ id: "p", status: "proposed", plannedFor: localInstant("2026-10-14", "09:00") }),
      ],
      upcoming: [action({ id: "g", status: "generating", platform: "twitter" })],
    });
    expect(plannedSlots(view).map((s) => [s.id, s.state, s.channel])).toEqual([
      ["g", "writing", "x"],
      ["p", "proposed", "linkedin"],
    ]);
  });

  it("puts an article with no platform on the blog", () => {
    const [slot] = plannedSlots(
      lists({ upcoming: [action({ contentType: "article", platform: null })] }),
    );
    expect(slot).toMatchObject({ channel: "blog", format: "Article" });
  });

  it("groups by day", () => {
    const slots = plannedSlots(lists({ upcoming: [action({ id: "a" }), action({ id: "b" })] }));
    expect(
      slotsByDate(slots)
        .get("2026-10-12")
        ?.map((s) => s.id),
    ).toEqual(["a", "b"]);
  });
});

describe("autopilotItemIds / autopilotSignature", () => {
  it("collects the posts Autopilot made", () => {
    const view = lists({
      approvals: [action({ id: "w", status: "needs_approval", contentItemIds: ["c1"] })],
      upcoming: [action({ id: "u", status: "scheduled", contentItemIds: ["c2", "c3"] })],
    });
    expect([...autopilotItemIds(view)].sort()).toEqual(["c1", "c2", "c3"]);
  });

  it("changes when a piece is written or moves on, and not otherwise", () => {
    const before = lists({ upcoming: [action({})] });
    const same = lists({ upcoming: [action({ updatedAt: "2026-10-08T00:00:00.000Z" })] });
    const written = lists({
      approvals: [action({ status: "needs_approval", contentItemIds: ["c1"] })],
    });
    expect(autopilotSignature(same)).toBe(autopilotSignature(before));
    expect(autopilotSignature(written)).not.toBe(autopilotSignature(before));
  });
});
