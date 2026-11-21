import { describe, expect, it } from "vitest";
import { activeMinutes, activityLabel, buildPulse, dayRange, errorText } from "./pulse";

const MIN = 60_000;

describe("activeMinutes", () => {
  it("is zero with no actions", () => {
    expect(activeMinutes([])).toBe(0);
  });
  it("counts one action as a short visit", () => {
    expect(activeMinutes([0])).toBe(2);
  });
  it("joins close actions into one visit and splits after a long gap", () => {
    // 0–10 min is one visit (10 + 2), then 60 min alone (2).
    expect(activeMinutes([0, 5 * MIN, 10 * MIN, 70 * MIN])).toBe(14);
  });
  it("does not depend on order", () => {
    expect(activeMinutes([10 * MIN, 0, 5 * MIN])).toBe(12);
  });
});

describe("activityLabel", () => {
  it("names common routes in plain words", () => {
    expect(activityLabel("studio.video.storyboard")).toBe("Making a video");
    expect(activityLabel("studio.carousel")).toBe("Making a carousel");
    expect(activityLabel("studio.image.brief")).toBe("Making a post");
    expect(activityLabel("chat.reply")).toBe("Chatting with Mox");
    expect(activityLabel("brand-extract")).toBe("Reading their brand");
    expect(activityLabel("geo.agent.implement")).toBe("AI visibility");
  });
  it("falls back to the route's own words", () => {
    expect(activityLabel("file-extract")).toBe("File extract");
    expect(activityLabel("")).toBe("Using Mellox");
  });
});

describe("errorText", () => {
  it("reads a message, else a category", () => {
    expect(errorText({ message: "Image model refused" })).toBe("Image model refused");
    expect(errorText({ category: "provider" })).toBe("provider");
    expect(errorText(null)).toBe("Failed without a reason");
  });
});

describe("dayRange", () => {
  it("ends today and is oldest first", () => {
    const days = dayRange(new Date("2026-11-18T10:00:00Z"), 3);
    expect(days).toEqual(["2026-11-16", "2026-11-17", "2026-11-18"]);
  });
});

describe("buildPulse", () => {
  const now = new Date("2026-11-18T12:00:00Z");
  const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * MIN).toISOString();
  const pulse = buildPulse({
    now,
    users: [
      { id: "u1", name: "Ayesha", email: "a@x.com", createdAt: at(60 * 24 * 30) },
      { id: "u2", name: "Bilal", email: "b@x.com", createdAt: at(60) },
    ],
    accounts: [
      {
        ownerUserId: "u1",
        planId: "starter",
        planLabel: "Starter",
        status: "active",
        creditsUnits: 900,
        allowanceUnits: 4500,
      },
    ],
    workspaces: [
      { id: "w1", name: "Bakery", ownerId: "u1", createdAt: at(60 * 24 * 20) },
      { id: "w2", name: "Gym", ownerId: "u2", createdAt: at(30) },
    ],
    calls: [
      { userId: "u1", workspaceId: "w1", route: "chat.reply", status: "ok", at: at(10) },
      { userId: "u1", workspaceId: "w1", route: "chat.reply", status: "ok", at: at(5) },
      { userId: "u2", workspaceId: "w2", route: "studio.image", status: "error", at: at(20) },
    ],
    jobs: [
      {
        id: "j1",
        userId: "u2",
        workspaceId: "w2",
        type: "video",
        title: "Promo reel",
        status: "failed",
        error: { message: "KIE refused" },
        at: at(15),
      },
      {
        id: "j2",
        userId: "u1",
        workspaceId: "w1",
        type: "image",
        title: null,
        status: "succeeded",
        error: null,
        at: at(8),
      },
    ],
    planOrder: ["starter", "growth", "free"],
    planLabels: { free: "No plan", starter: "Starter", growth: "Growth" },
  });

  it("puts people on their plan, with no account as No plan", () => {
    expect(pulse.plans).toEqual([
      { planId: "starter", label: "Starter", accounts: 1, creditsLeft: 900 },
      { planId: "free", label: "No plan", accounts: 1, creditsLeft: 0 },
    ]);
  });

  it("counts time, actions and errors per person", () => {
    const ayesha = pulse.customers.find((c) => c.userId === "u1")!;
    expect(ayesha.activeMinutes7d).toBe(7);
    expect(ayesha.actions7d).toBe(3);
    expect(ayesha.pieces7d).toBe(1);
    expect(ayesha.errors7d).toBe(0);
    expect(ayesha.workspaces).toBe(1);
    const bilal = pulse.customers.find((c) => c.userId === "u2")!;
    expect(bilal.errors7d).toBe(2);
    expect(bilal.lastDoing).toBe("Making a video");
  });

  it("lists errors newest first with what the person was doing", () => {
    expect(pulse.errors.map((e) => [e.what, e.message])).toEqual([
      ["Making a video", "KIE refused"],
      ["Making a post", "The AI provider returned an error"],
    ]);
    expect(pulse.errors[0].workspaceName).toBe("Gym");
  });

  it("totals only paying people's credits and finds new workspaces", () => {
    expect(pulse.totals.creditsLeft).toBe(900);
    expect(pulse.totals.payingCustomers).toBe(1);
    expect(pulse.totals.newWorkspaces7d).toBe(1);
    expect(pulse.newWorkspaces[0]).toMatchObject({ name: "Gym", ownerPlan: "No plan" });
    expect(pulse.days.at(-1)).toMatchObject({ signups: 1, workspaces: 1, errors: 2, pieces: 1 });
  });
});
