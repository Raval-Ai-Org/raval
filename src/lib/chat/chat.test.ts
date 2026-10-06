import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CHAT_COMMANDS, commandQuery, matchCommands } from "./commands";
import { hasExtras, parseReplyExtras } from "./events";
import { findPlace, PLACES, PLACE_IDS } from "./places";
import { shapeToJsonSchema } from "./tool-schema";

describe("places", () => {
  it("has unique ids and plain labels", () => {
    expect(new Set(PLACE_IDS).size).toBe(PLACE_IDS.length);
    for (const place of PLACES) {
      expect(place.id).toMatch(/^[a-z][a-z-]+$/);
      expect(place.label.length).toBeGreaterThan(2);
      expect(place.hint.length).toBeGreaterThan(8);
      expect(place.event).toMatch(/^open:/);
    }
    expect(findPlace("memory")?.detail).toEqual({ section: "memory" });
    expect(findPlace("nowhere")).toBeUndefined();
  });
});

describe('the "/" menu', () => {
  it("only opens for a short line that starts with /", () => {
    expect(commandQuery("/")).toBe("");
    expect(commandQuery("/Back")).toBe("back");
    expect(commandQuery("hello /")).toBeNull();
    expect(commandQuery("/a\nb")).toBeNull();
    expect(matchCommands("write a post")).toEqual([]);
  });

  it("lists something for a bare / and finds places by name or by what they are for", () => {
    expect(matchCommands("/")).toHaveLength(8);
    expect(matchCommands("/back")[0].id).toBe("open-backlinks");
    expect(matchCommands("/mem").map((c) => c.id)).toContain("open-memory");
    expect(matchCommands("/seo").map((c) => c.id)).toEqual(
      expect.arrayContaining(["open-visibility", "open-backlinks"]),
    );
    expect(matchCommands("/zzzz")).toEqual([]);
  });

  it("reaches every place", () => {
    const opened = CHAT_COMMANDS.flatMap((c) => (c.run.type === "open" ? [c.run.place] : []));
    expect(opened.sort()).toEqual([...PLACE_IDS].sort());
  });
});

describe("reply extras", () => {
  it("reads back what a reply carried and drops anything malformed", () => {
    const extras = parseReplyExtras({
      memory: [
        { op: "added", id: "m1", text: "Never use red", temporary: true },
        { op: "exploded", id: "m2", text: "x" },
        "nonsense",
      ],
      actions: [
        {
          id: "a1",
          title: "Schedule approved posts",
          detail: "2 items",
          state: "done",
          note: "Done",
        },
        { id: "a2", title: "Delete a post", destructive: true, state: "weird" },
        { title: "no id" },
      ],
      offers: [{ place: "backlinks" }, { place: "nowhere" }],
    });
    expect(extras.memory).toEqual([
      { op: "added", id: "m1", text: "Never use red", temporary: true },
    ]);
    expect(extras.actions?.map((a) => [a.id, a.state, a.destructive])).toEqual([
      ["a1", "done", false],
      ["a2", "offered", true],
    ]);
    expect(extras.offers).toEqual([{ place: "backlinks", label: "Backlinks" }]);
    expect(hasExtras(extras)).toBe(true);
  });

  it("is empty for a plain reply", () => {
    expect(parseReplyExtras(null)).toEqual({});
    expect(parseReplyExtras({ memory: [] })).toEqual({});
    expect(hasExtras({})).toBe(false);
  });
});

describe("shapeToJsonSchema", () => {
  it("describes a tool's input for a model", () => {
    const schema = shapeToJsonSchema(
      {
        workspaceId: z.string().uuid(),
        status: z.enum(["draft", "approved"]).optional().describe("Which posts"),
        limit: z.number().int().min(1).max(200).default(50),
        ids: z.array(z.string().uuid()).min(1).max(20),
        note: z.string().max(100).nullable(),
        items: z.array(z.object({ id: z.string(), when: z.string().optional() })),
        meta: z.record(z.string(), z.unknown()).optional(),
        flag: z.boolean(),
      },
      ["workspaceId"],
    );
    expect(schema).toEqual({
      type: "object",
      additionalProperties: false,
      required: ["ids", "note", "items", "flag"],
      properties: {
        status: { type: "string", enum: ["draft", "approved"], description: "Which posts" },
        limit: { type: "integer", minimum: 1, maximum: 200 },
        ids: {
          type: "array",
          items: { type: "string", format: "uuid" },
          minItems: 1,
          maxItems: 20,
        },
        note: { anyOf: [{ type: "string", maxLength: 100 }, { type: "null" }] },
        items: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id"],
            properties: { id: { type: "string" }, when: { type: "string" } },
          },
        },
        meta: { type: "object", additionalProperties: {} },
        flag: { type: "boolean" },
      },
    });
  });

  it("leaves `required` out when everything is optional", () => {
    expect(shapeToJsonSchema({ a: z.string().optional() })).toEqual({
      type: "object",
      additionalProperties: false,
      properties: { a: { type: "string" } },
    });
  });
});
