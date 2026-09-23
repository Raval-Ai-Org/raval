import { describe, expect, it } from "vitest";
import {
  activityStats,
  buildAttention,
  buildDigest,
  buildFailedQueue,
  buildReadyQueue,
  buildReviewQueue,
  clientHealth,
  csvCell,
  digestToCsv,
  groupSchedule,
  transitionPath,
  undoTarget,
  type CcClient,
  type CcContentRow,
} from "./command-center";

const NOW = new Date("2026-09-24T12:00:00").getTime();
const DAY = 86_400_000;

function client(over: Partial<CcClient> = {}): CcClient {
  return {
    id: "a",
    name: "Acme",
    websiteUrl: "https://acme.test",
    domain: "acme.test",
    logoUrl: null,
    industry: null,
    clientStatus: "active",
    role: "owner",
    onboarded: true,
    pendingApprovals: 0,
    draftCount: 0,
    scheduledCount: 3,
    publishedCount: 5,
    failedCount: 0,
    connectedSocialAccounts: 2,
    geoScore: 80,
    geoScannedAt: "2026-09-01T00:00:00Z",
    lastActivityAt: "2026-09-20T00:00:00Z",
    ...over,
  };
}

function row(over: Partial<CcContentRow> = {}): CcContentRow {
  return {
    id: "r1",
    workspace_id: "a",
    agent: "spark",
    kind: "post",
    channel: "instagram",
    title: "Hello",
    body: "Body",
    hashtags: null,
    media_url: null,
    status: "pending",
    scheduled_at: null,
    created_at: new Date(NOW - DAY).toISOString(),
    ...over,
  };
}

const map = (...cs: CcClient[]) => new Map(cs.map((c) => [c.id, c]));

describe("review queue", () => {
  it("includes pending and draft rows of known clients, newest first", () => {
    const q = buildReviewQueue(
      [
        row({ id: "old", created_at: new Date(NOW - 3 * DAY).toISOString() }),
        row({ id: "new", status: "draft" }),
        row({ id: "done", status: "published" }),
        row({ id: "stranger", workspace_id: "zzz" }),
      ],
      [],
      map(client()),
    );
    expect(q.map((i) => i.id)).toEqual(["new", "old"]);
  });

  it("only lets editors and above decide", () => {
    const q = buildReviewQueue([row()], [], map(client({ role: "viewer" })));
    expect(q[0].canDecide).toBe(false);
    const q2 = buildReviewQueue([row()], [], map(client({ role: "editor" })));
    expect(q2[0].canDecide).toBe(true);
  });

  it("falls back to the body when a row has no title", () => {
    const q = buildReviewQueue(
      [row({ title: null, body: "  A   spaced body " })],
      [],
      map(client()),
    );
    expect(q[0].title).toBe("A spaced body");
  });

  it("maps legacy approvals", () => {
    const q = buildReviewQueue(
      [],
      [
        {
          id: "ap",
          workspace_id: "a",
          action: "Publish launch post",
          status: "pending",
          created_at: new Date(NOW).toISOString(),
          payload: { channel: "linkedin", caption: "Hi" },
        },
      ],
      map(client()),
    );
    expect(q[0]).toMatchObject({ source: "approval", channel: "linkedin", body: "Hi" });
  });

  it("builds ready and failed queues", () => {
    const rows = [
      row({ id: "ok", status: "approved" }),
      row({ id: "bad", status: "failed" }),
      row({ id: "half", status: "partial_failed" }),
    ];
    expect(buildReadyQueue(rows, map(client())).map((i) => i.id)).toEqual(["ok"]);
    expect(buildFailedQueue(rows, map(client())).map((i) => i.id)).toEqual(["bad", "half"]);
  });
});

describe("lifecycle helpers", () => {
  it("routes a rejected draft through pending", () => {
    expect(transitionPath("draft", "rejected")).toEqual(["pending", "rejected"]);
    expect(transitionPath("pending", "rejected")).toEqual(["rejected"]);
    expect(transitionPath("draft", "approved")).toEqual(["approved"]);
  });

  it("undoes to a legal status", () => {
    expect(undoTarget("pending", "approved")).toBe("draft");
    expect(undoTarget("pending", "rejected")).toBe("pending");
    expect(undoTarget("draft", "rejected")).toBe("draft");
  });
});

describe("client health", () => {
  it("is on track when nothing is wrong", () => {
    expect(clientHealth(client())).toMatchObject({ tone: "good", score: 100 });
  });

  it("flags setup, paused and failures", () => {
    expect(clientHealth(client({ onboarded: false })).label).toBe("Setup");
    expect(clientHealth(client({ clientStatus: "paused" })).tone).toBe("idle");
    const h = clientHealth(
      client({ failedCount: 2, scheduledCount: 0, connectedSocialAccounts: 0 }),
    );
    expect(h.tone).toBe("risk");
    expect(h.reasons).toContain("2 failed");
  });
});

describe("attention feed", () => {
  it("ranks failures first and skips paused clients", () => {
    const failed = buildFailedQueue([row({ status: "failed" })], map(client()));
    const review = buildReviewQueue([row({ id: "p" })], [], map(client()));
    const items = buildAttention(
      [
        client(),
        client({ id: "b", name: "Beta", connectedSocialAccounts: 0 }),
        client({ id: "c", name: "Paused", clientStatus: "paused", connectedSocialAccounts: 0 }),
      ],
      { review, ready: [], failed },
    );
    expect(items[0].action).toBe("failed");
    expect(items[1].action).toBe("review");
    expect(items.some((i) => i.workspaceId === "b" && i.action === "accounts")).toBe(true);
    expect(items.some((i) => i.workspaceId === "c")).toBe(false);
  });

  it("asks for setup instead of other nudges on an unfinished client", () => {
    const items = buildAttention([client({ onboarded: false, scheduledCount: 0 })], {
      review: [],
      ready: [],
      failed: [],
    });
    expect(items.map((i) => i.action)).toEqual(["setup"]);
  });
});

describe("schedule", () => {
  it("groups upcoming posts by day and drops the past", () => {
    const days = groupSchedule(
      [
        row({
          id: "t",
          status: "scheduled",
          scheduled_at: new Date(NOW + 2 * 3600e3).toISOString(),
        }),
        row({ id: "m", status: "scheduled", scheduled_at: new Date(NOW + DAY).toISOString() }),
        row({
          id: "past",
          status: "scheduled",
          scheduled_at: new Date(NOW - 3 * DAY).toISOString(),
        }),
        row({
          id: "far",
          status: "scheduled",
          scheduled_at: new Date(NOW + 30 * DAY).toISOString(),
        }),
      ],
      map(client()),
      NOW,
    );
    expect(days.map((d) => d.items.map((i) => i.id))).toEqual([["t"], ["m"]]);
  });
});

describe("activity", () => {
  it("counts only real published rows in the window", () => {
    const s = activityStats(
      [
        row({ id: "1", status: "published", created_at: new Date(NOW - DAY).toISOString() }),
        row({
          id: "2",
          status: "published",
          channel: "linkedin",
          created_at: new Date(NOW - 2 * DAY).toISOString(),
        }),
        row({ id: "3", status: "published", created_at: new Date(NOW - 20 * DAY).toISOString() }),
        row({ id: "4", status: "pending" }),
      ],
      map(client()),
      NOW,
    );
    expect(s.published14).toBe(2);
    expect(s.publishedPrev14).toBe(1);
    expect(s.trend).toHaveLength(14);
    expect(s.trend.reduce((a, d) => a + d.posts, 0)).toBe(2);
    expect(s.byChannel).toEqual([
      { channel: "instagram", posts: 1 },
      { channel: "linkedin", posts: 1 },
    ]);
  });
});

describe("report", () => {
  it("neutralises spreadsheet formulas", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe(`"'=HYPERLINK(1)"`);
    expect(csvCell('say "hi"')).toBe(`"say ""hi"""`);
  });

  it("writes one CSV row per client", () => {
    const d = buildDigest({
      clients: [client(), client({ id: "b", name: "Beta" })],
      review: [],
      ready: [],
      failed: [],
      scheduled: 0,
      published14: 0,
      now: NOW,
    });
    expect(digestToCsv(d).split("\n")).toHaveLength(3);
  });
});
