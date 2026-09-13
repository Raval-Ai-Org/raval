import { describe, expect, it } from "vitest";
import {
  groupRows,
  sourceOf,
  stageCounts,
  stageOf,
  type ContentRow,
} from "@/lib/studio/content-groups";

let n = 0;
function row(patch: Partial<ContentRow>): ContentRow {
  n += 1;
  return {
    id: `row-${n}`,
    title: null,
    body: null,
    kind: "post",
    channel: null,
    status: "pending",
    meta: null,
    created_at: new Date(Date.now() - n * 60_000).toISOString(),
    updated_at: new Date().toISOString(),
    scheduled_at: null,
    ...patch,
  };
}

describe("stageOf", () => {
  it.each([
    ["draft", "review"],
    ["pending", "review"],
    ["failed", "review"],
    ["partial_failed", "review"],
    ["approved", "ready"],
    ["scheduled", "scheduled"],
    ["publishing", "published"],
    ["published", "published"],
  ])("%s → %s", (status, stage) => {
    expect(stageOf(status)).toBe(stage);
  });
});

describe("sourceOf", () => {
  it("recognises where drafts came from", () => {
    expect(sourceOf({ source: "studio", group_id: "g" })).toBe("studio");
    expect(sourceOf({ job_id: "j" })).toBe("studio");
    expect(sourceOf({ source: "chat" })).toBe("chat");
    expect(sourceOf({ source: "agent" })).toBe("agent");
    expect(sourceOf({ source: "next-post" })).toBe("agent");
    expect(sourceOf({ prompt: "write posts" })).toBe("agent");
    expect(sourceOf({ source: "calendar-generator" })).toBe("calendar");
    expect(sourceOf(null)).toBe("other");
  });
});

describe("groupRows", () => {
  it("makes one item per piece of work, titled by the job, with platforms merged", () => {
    const meta = { source: "studio", group_id: "g1", job_id: "j1", job_title: "Pay the farmer" };
    const groups = groupRows([
      row({
        title: "Sourcing",
        body: "We pay 30% above fair trade. #coffee",
        meta: { ...meta, platform: "linkedin" },
      }),
      row({
        title: "Instagram post",
        body: "Ripe cherries only 🍒",
        meta: { ...meta, platform: "instagram" },
      }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe("Pay the farmer");
    expect(groups[0].platforms).toEqual(["linkedin", "instagram"]);
    expect(groups[0].source).toBe("studio");
    expect(groups[0].excerpt).not.toContain("#coffee");
  });

  it("falls back from a generic title to the body's first sentence", () => {
    const [g] = groupRows([
      row({
        title: "Untitled post",
        body: "Cold brew tips for summer. Steep longer.",
        meta: { source: "chat" },
      }),
    ]);
    expect(g.title).toBe("Cold brew tips for summer.");
    expect(g.excerpt).toBe("");
    expect(g.source).toBe("chat");
  });

  it("skips empty placeholders and rows still generating", () => {
    const groups = groupRows([
      row({ title: "Untitled post", body: null, status: "draft", meta: { source: "calendar" } }),
      row({ title: "Real", body: "Body", meta: { studio_state: "generating" } }),
    ]);
    expect(groups).toHaveLength(0);
  });

  it("takes the least-advanced status, flags problems, and keeps the earliest schedule", () => {
    const meta = { group_id: "g2", source: "studio" };
    const soon = new Date(Date.now() + 3_600_000).toISOString();
    const later = new Date(Date.now() + 7_200_000).toISOString();
    const [scheduled] = groupRows([
      row({ title: "A", body: "x", status: "scheduled", scheduled_at: later, meta }),
      row({ title: "A", body: "x", status: "scheduled", scheduled_at: soon, meta }),
    ]);
    expect(scheduled.stage).toBe("scheduled");
    expect(scheduled.scheduledAt).toBe(soon);

    const [mixed] = groupRows([
      row({ title: "B", body: "x", status: "approved", meta: { ...meta, group_id: "g3" } }),
      row({ title: "B", body: "x", status: "partial_failed", meta: { ...meta, group_id: "g3" } }),
    ]);
    expect(mixed.stage).toBe("review");
    expect(mixed.problem).toBe(true);
  });

  it("counts stages", () => {
    const counts = stageCounts(
      groupRows([
        row({ title: "One", body: "a", status: "pending" }),
        row({ title: "Two", body: "b", status: "approved" }),
        row({ title: "Three", body: "c", status: "scheduled" }),
        row({ title: "Four", body: "d", status: "draft" }),
      ]),
    );
    expect(counts).toEqual({ review: 2, ready: 1, scheduled: 1, published: 0 });
  });
});
