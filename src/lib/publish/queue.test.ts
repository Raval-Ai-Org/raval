import { describe, expect, it } from "vitest";
import { buildPublishQueue, contentTitle, publishQueueCount, type ContentRow } from "./queue";

const post = (patch: Partial<ContentRow>): ContentRow => ({
  id: "c1",
  title: "Spring sale",
  body: "Body",
  kind: "post",
  channel: "instagram",
  status: "approved",
  scheduled_at: null,
  updated_at: "2026-10-01T10:00:00Z",
  ...patch,
});

describe("publish queue", () => {
  it("puts each post where its status says, and leaves drafts and published out", () => {
    const queue = buildPublishQueue({
      content: [
        post({ id: "a", status: "approved" }),
        post({ id: "b", status: "scheduled", scheduled_at: "2026-10-05T09:00:00Z" }),
        post({ id: "c", status: "failed" }),
        post({ id: "d", status: "draft" }),
        post({ id: "e", status: "published" }),
        post({ id: "f", status: "partial_failed" }),
      ],
      publications: [],
      pullRequests: [],
    });
    expect(queue.ready.map((e) => e.contentItemId)).toEqual(["a"]);
    expect(queue.scheduled.map((e) => e.contentItemId)).toEqual(["b"]);
    expect(queue.problems.map((e) => e.contentItemId).sort()).toEqual(["c", "f"]);
    expect(publishQueueCount(queue)).toBe(4);
  });

  it("lists scheduled posts next first", () => {
    const queue = buildPublishQueue({
      content: [
        post({ id: "late", status: "scheduled", scheduled_at: "2026-10-09T09:00:00Z" }),
        post({ id: "soon", status: "scheduled", scheduled_at: "2026-10-03T09:00:00Z" }),
      ],
      publications: [],
      pullRequests: [],
    });
    expect(queue.scheduled.map((e) => e.contentItemId)).toEqual(["soon", "late"]);
  });

  it("shows articles on their way to the site and hides finished ones", () => {
    const base = {
      content_item_id: "c9",
      title: "How to pick a fabric",
      host: "example.com",
      status_detail: null,
      url: null,
      pr_url: null,
      updated_at: "2026-10-01T10:00:00Z",
    };
    const queue = buildPublishQueue({
      content: [],
      publications: [
        { ...base, id: "p1", status: "pr_open", pr_url: "https://github.com/a/b/pull/4" },
        { ...base, id: "p2", status: "verified" },
        {
          ...base,
          id: "p3",
          status: "needs_attention",
          status_detail: "The page shows no article",
        },
        { ...base, id: "p4", status: "cancelled" },
      ],
      pullRequests: [],
    });
    expect(queue.website).toHaveLength(1);
    expect(queue.website[0].href).toBe("https://github.com/a/b/pull/4");
    expect(queue.problems[0].detail).toContain("The page shows no article");
  });

  it("only lists a pull request that has a link", () => {
    const queue = buildPublishQueue({
      content: [],
      publications: [],
      pullRequests: [
        {
          id: "1",
          source: "fix_batch",
          label: null,
          pr_url: "https://github.com/a/b/pull/7",
          pr_number: 7,
          updated_at: null,
        },
        { id: "2", source: "fix", label: null, pr_url: null, pr_number: null, updated_at: null },
      ],
    });
    expect(queue.website).toHaveLength(1);
    expect(queue.website[0].title).toBe("Website fixes");
    expect(queue.website[0].detail).toContain("#7");
    expect(queue.website[0].place).toBe("visibility");
  });

  it("names an untitled post from its text", () => {
    expect(contentTitle({ title: " ", body: "Hello   there" })).toBe("Hello there");
    expect(contentTitle({ title: null, body: null })).toBe("Untitled");
    expect(contentTitle({ title: null, body: "x".repeat(200) }).length).toBe(70);
  });
});
