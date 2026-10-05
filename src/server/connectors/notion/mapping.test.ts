import { describe, expect, it } from "vitest";
import {
  decideSync,
  fromMellox,
  fromNotion,
  notionBodyBlocks,
  notionProperties,
  syncHash,
} from "./mapping";
import type { ContentItem } from "@/server/fns/content";

const item: ContentItem = {
  id: "11111111-1111-4111-8111-111111111111",
  workspace_id: "22222222-2222-4222-8222-222222222222",
  agent: "spark",
  kind: "post",
  channel: "linkedin",
  title: "Launch",
  body: "Body",
  hashtags: [],
  media_url: null,
  status: "draft",
  scheduled_at: "2026-10-05T12:00:00.000Z",
  metrics: null,
  meta: {},
  created_by: null,
  created_at: "2026-10-05T11:00:00.000Z",
  updated_at: "2026-10-05T11:00:00.000Z",
};
describe("Notion calendar mapping", () => {
  it("round trips the Mellox fields and preserves the scheduled instant", () => {
    const record = fromMellox(item);
    const properties = notionProperties(record);
    const restored = fromNotion({
      properties: {
        Name: properties.Name,
        Content: properties.Content,
        Platform: properties.Platform,
        Status: properties.Status,
        "Publish Date": properties["Publish Date"],
        "Content Type": properties["Content Type"],
        "Mellox ID": properties["Mellox ID"],
        "Mellox Workspace ID": properties["Mellox Workspace ID"],
      },
    });
    expect(restored).toEqual({ ...record, mediaUrl: null });
    expect(syncHash(restored)).toBe(syncHash(record));
  });
  it("uses blocks for long body without losing content", () => {
    const body = "a".repeat(40000);
    expect(notionBodyBlocks(body)).toHaveLength(20);
    expect(
      notionBodyBlocks(body)
        .map((b) => b.paragraph.rich_text[0].text.content)
        .join(""),
    ).toBe(body);
  });
  it("detects one-sided edits and conflicts", () => {
    expect(decideSync("same", "same", "same", "same")).toBe("skip");
    expect(decideSync("new", "same", "same", "same")).toBe("export");
    expect(decideSync("same", "new", "same", "same")).toBe("import");
    expect(decideSync("new", "new", "same", "same")).toBe("conflict");
  });
  it("flags malformed Notion dates and supports status properties", () => {
    const record = fromNotion({
      properties: {
        Name: { title: [{ plain_text: "Plan" }] },
        Status: { status: { name: "draft" } },
        "Publish Date": { date: { start: "not-a-date" } },
      },
    });
    expect(record.malformedDate).toBe(true);
    expect(record.scheduledAt).toBeNull();
    expect(
      notionProperties(
        { ...fromMellox(item), status: "draft" },
        {
          Name: { type: "title" },
          Status: { type: "status" },
          Content: { type: "rich_text" },
        },
      ).Status,
    ).toEqual({ status: { name: "draft" } });
  });
});
