import { describe, expect, it } from "vitest";
import type { EngageHome, EngageRule } from "./contracts";
import { healthSummary, inboxHealth, STALE_READ_MS } from "./health";

const NOW = Date.parse("2026-11-27T12:00:00Z");

function home(over: Partial<EngageHome> = {}): EngageHome {
  return {
    configured: true,
    connection: {
      status: "active",
      accountName: "Mellox AI",
      lastError: null,
      canMessage: { instagram: false, facebook: false },
    },
    pages: [
      {
        id: "p",
        pageName: "Mellox AI",
        igUsername: null,
        hasInstagram: false,
        syncedAt: new Date(NOW - 60_000).toISOString(),
        lastError: null,
      },
    ],
    comments: [],
    counts: { waiting: 0, replied: 0, autoReplied: 0 },
    automationsOn: true,
    autoReply: true,
    guidelines: "",
    questions: [],
    rules: [],
    answers: [],
    examples: [],
    ...over,
  };
}

const dmRule = { status: "live", dmEnabled: true, platforms: ["instagram"] } as EngageRule;

describe("inboxHealth", () => {
  it("says Instagram isn't read when Meta shared no Instagram account (the live case)", () => {
    const items = inboxHealth(home(), NOW);
    const ig = items.find((i) => i.id === "instagram")!;
    expect(ig.state).toBe("off");
    expect(ig.reconnect).toBe(true);
    expect(items.find((i) => i.id === "messages")!.state).toBe("off");
    expect(healthSummary(items)).toContain("Instagram isn't connected");
  });

  it("warns when a live quick reply wants a DM that Meta never allowed", () => {
    const items = inboxHealth(home({ rules: [dmRule] }), NOW);
    const dm = items.find((i) => i.id === "messages")!;
    expect(dm.state).toBe("warn");
    expect(dm.detail).toMatch(/DM is skipped/);
  });

  it("is all ok when Instagram and messages are there", () => {
    const items = inboxHealth(
      home({
        connection: {
          status: "active",
          accountName: "Chai",
          lastError: null,
          canMessage: { instagram: true, facebook: true },
        },
        pages: [
          {
            id: "p",
            pageName: "Chai",
            igUsername: "chai",
            hasInstagram: true,
            syncedAt: new Date(NOW).toISOString(),
            lastError: null,
          },
        ],
      }),
      NOW,
    );
    expect(items.every((i) => i.state === "ok")).toBe(true);
    expect(healthSummary(items)).toBeNull();
  });

  it("flags a read that stopped, and a read error", () => {
    const old = home({
      pages: [
        {
          id: "p",
          pageName: "M",
          igUsername: null,
          hasInstagram: false,
          syncedAt: new Date(NOW - STALE_READ_MS - 1).toISOString(),
          lastError: null,
        },
      ],
    });
    expect(inboxHealth(old, NOW).find((i) => i.id === "reading")?.title).toMatch(/lately/);
    const broken = home({
      pages: [{ ...old.pages[0], lastError: "Meta signed this account out." }],
    });
    expect(inboxHealth(broken, NOW).find((i) => i.id === "reading")?.detail).toMatch(/signed/);
  });

  it("returns nothing before a connection", () => {
    expect(inboxHealth(home({ connection: null }), NOW)).toEqual([]);
  });
});
