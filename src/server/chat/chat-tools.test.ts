import { beforeEach, describe, expect, it, vi } from "vitest";

const callFn = vi.hoisted(() => vi.fn());
const callRoute = vi.hoisted(() => vi.fn());
const offerChatAction = vi.hoisted(() => vi.fn());
const applyOps = vi.hoisted(() => vi.fn());

vi.mock("@/server/mcp/bridge.server", () => ({ callFn, callRoute }));
vi.mock("@/server/mcp/settings.server", () => ({
  getMcpSettings: vi.fn(),
  getMcpSettingsFor: vi.fn(),
  recordToolCall: vi.fn(),
}));
vi.mock("@/server/audit.server", () => ({
  recordAudit: vi.fn(),
  scrubAuditPayload: (p: unknown) => p,
}));
vi.mock("@/app/api/sdr/schedule/route", () => ({ POST: vi.fn() }));
vi.mock("@/app/api/sdr/publish/route", () => ({ POST: vi.fn() }));
vi.mock("./actions.server", () => ({ offerChatAction }));
vi.mock("@/server/memory/service.server", () => ({ applyOps }));

import { PLACE_IDS } from "@/lib/chat/places";
import { MCP_TOOLS } from "@/server/mcp/registry.server";
import {
  CHAT_ACTION_TOOLS,
  CHAT_ONLY_READ_TOOLS,
  CHAT_READ_TOOLS,
  activityLabel,
  chatActionTool,
  chatActionTools,
  chatReadTools,
  chatToolSpecs,
  createChatTools,
  describeAction,
  isQuietTool,
  type ChatToolCaller,
} from "./tools.server";

const WS = "22222222-2222-4222-8222-222222222222";
const ITEM = "33333333-3333-4333-8333-333333333333";

const caller = (role: ChatToolCaller["role"] = "editor"): ChatToolCaller => ({
  userId: "user-1",
  workspaceId: WS,
  role,
  supabase: {} as never,
  token: "a.b.c",
  conversationId: null,
});

const names = (role: ChatToolCaller["role"], memory = true) =>
  chatToolSpecs(role, { memory }).map((spec) => spec.function.name);

beforeEach(() => {
  vi.clearAllMocks();
  offerChatAction.mockImplementation(async (_caller, tool, args) => ({
    id: ITEM,
    title: tool.title,
    detail: describeAction(args),
    destructive: tool.destructive === true,
    state: "offered",
  }));
  applyOps.mockResolvedValue([{ op: "added", id: ITEM, text: "Never use red" }]);
});

describe("what chat may do", () => {
  it("only reads by itself with tools that change and spend nothing", () => {
    const all = new Map(MCP_TOOLS.map((t) => [t.name, t]));
    for (const name of CHAT_READ_TOOLS) {
      const tool = all.get(name);
      expect(tool, name).toBeDefined();
      expect(tool!.write, name).toBe(false);
      expect(tool!.scope, name).toBe("workspace");
      expect(name).toMatch(/^(list|get)_/);
    }
    for (const tool of CHAT_ONLY_READ_TOOLS) {
      expect(tool.write).toBe(false);
      expect(tool.name).toMatch(/^(list|get)_/);
    }
    expect(chatReadTools()).toHaveLength(CHAT_READ_TOOLS.length + CHAT_ONLY_READ_TOOLS.length);
    // A model call hides behind this one, so it is never a silent read.
    expect(chatReadTools().map((t) => t.name)).not.toContain("suggest_marketing_plan");
  });

  it("offers changes only from the allow-list, and every one is a real write", () => {
    const all = new Map(MCP_TOOLS.map((t) => [t.name, t]));
    for (const name of CHAT_ACTION_TOOLS) {
      expect(all.get(name)?.write, name).toBe(true);
    }
    expect(chatActionTools()).toHaveLength(CHAT_ACTION_TOOLS.length);
    const overlap = CHAT_ACTION_TOOLS.filter((n) =>
      (CHAT_READ_TOOLS as readonly string[]).includes(n),
    );
    expect(overlap).toEqual([]);
  });

  it("keeps the risky things out of chat", () => {
    const offered = CHAT_ACTION_TOOLS.join(" ");
    expect(offered).not.toMatch(
      /workspace|brand_dna|geo_fix|stop_autopilot|save_marketing_plan|billing|credit|member|invite/,
    );
    expect(chatActionTool("create_workspace")).toBeUndefined();
    expect(chatActionTool("update_brand_dna")).toBeUndefined();
    expect(chatActionTool("schedule_content")?.name).toBe("schedule_content");
  });

  it("shows a viewer only reads", () => {
    const viewer = names("viewer");
    expect(viewer).toContain("list_content");
    expect(viewer).toContain("open_in_mellox");
    expect(viewer).not.toContain("schedule_content");
    expect(viewer).not.toContain("remember");
    // The briefing spends, so even though a viewer may read it, it is a button.
    expect(names("editor")).toContain("get_marketing_briefing");
  });

  it("drops the memory tools when memory is off", () => {
    expect(names("editor", true)).toEqual(expect.arrayContaining(["remember", "forget"]));
    expect(names("editor", false)).not.toContain("remember");
  });

  it("never asks the model for a workspace id", () => {
    for (const spec of chatToolSpecs("owner", { memory: true })) {
      const props = (spec.function.parameters as { properties: Record<string, unknown> })
        .properties;
      expect(Object.keys(props), spec.function.name).not.toContain("workspaceId");
      expect(spec.function.name).toMatch(/^[a-z][a-z0-9_]{2,63}$/);
    }
    const open = chatToolSpecs("viewer", { memory: false }).find(
      (s) => s.function.name === "open_in_mellox",
    );
    expect(
      (open!.function.parameters as { properties: { place: { enum: string[] } } }).properties.place
        .enum,
    ).toEqual(PLACE_IDS);
  });

  it("labels reads for the activity line and keeps the rest quiet", () => {
    for (const tool of chatReadTools()) {
      expect(activityLabel(tool.name), tool.name).toBeTruthy();
      expect(isQuietTool(tool.name)).toBe(false);
    }
    expect(activityLabel("remember")).toBe("Updating memory");
    expect(isQuietTool("remember")).toBe(true);
    expect(isQuietTool("schedule_content")).toBe(true);
    expect(activityLabel("schedule_content")).toBeNull();
  });
});

describe("a reply's tools", () => {
  it("runs a read for the verified workspace and fences the result", async () => {
    callFn.mockResolvedValue([{ id: ITEM, title: "Spring sale", status: "pending" }]);
    const tools = createChatTools(caller("viewer"), { memory: true });
    const out = await tools.run("list_content", { status: "pending", workspaceId: "someone-else" });
    expect(callFn).toHaveBeenCalledWith(
      expect.objectContaining({ token: "a.b.c", userId: "user-1" }),
      "content",
      "listContentItems",
      expect.objectContaining({ workspaceId: WS, status: "pending" }),
    );
    expect(out.content).toContain("<untrusted_data");
    expect(out.content).toContain("Spring sale");
    expect(out.label).toBe("Looking at your posts");
  });

  it("answers the same lookup from the first result", async () => {
    callFn.mockResolvedValue([]);
    const tools = createChatTools(caller(), { memory: true });
    await tools.run("list_content", {});
    await tools.run("list_content", {});
    expect(callFn).toHaveBeenCalledTimes(1);
  });

  it("never runs a change: it stores a button and says so", async () => {
    const tools = createChatTools(caller(), { memory: true });
    const out = await tools.run("schedule_content", {
      items: [{ contentItemId: ITEM, scheduledAt: "2026-10-20T09:00:00.000Z" }],
    });
    expect(callFn).not.toHaveBeenCalled();
    expect(callRoute).not.toHaveBeenCalled();
    expect(tools.state.actions).toHaveLength(1);
    expect(out.content).toMatch(/NOT happened/);
  });

  it("refuses a change the person's role can't make", async () => {
    const tools = createChatTools(caller("viewer"), { memory: true });
    const out = await tools.run("delete_content", { contentItemId: ITEM });
    expect(offerChatAction).not.toHaveBeenCalled();
    expect(tools.state.actions).toEqual([]);
    expect(out.content).toMatch(/role can't do that/);
  });

  it("offers at most three buttons in one reply", async () => {
    const tools = createChatTools(caller(), { memory: true });
    for (let i = 0; i < 5; i++) await tools.run("discover_competitors", {});
    expect(tools.state.actions).toHaveLength(3);
  });

  it("saves a memory through the rules and reports what changed", async () => {
    const tools = createChatTools(caller(), { memory: true });
    const out = await tools.run("remember", {
      text: "Never use red",
      kind: "rule",
      topic: "visual",
    });
    expect(applyOps).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: WS, role: "editor" }),
      [{ op: "add", text: "Never use red", kind: "rule", topic: "visual" }],
      { source: "chat", conversationId: null },
    );
    expect(tools.state.memory).toEqual([{ op: "added", id: ITEM, text: "Never use red" }]);
    expect(out.label).toBe("Updating memory");
  });

  it("does not claim a save that didn't happen", async () => {
    applyOps.mockResolvedValue([]);
    const tools = createChatTools(caller(), { memory: true });
    const out = await tools.run("remember", {
      text: "Never use red",
      kind: "rule",
      topic: "visual",
    });
    expect(tools.state.memory).toEqual([]);
    expect(out.content).toMatch(/Nothing changed/);
  });

  it("saves nothing for a viewer or when memory is off", async () => {
    const args = { text: "Never use red", kind: "rule", topic: "visual" };
    await createChatTools(caller("viewer"), { memory: true }).run("remember", args);
    await createChatTools(caller(), { memory: false }).run("remember", args);
    expect(applyOps).not.toHaveBeenCalled();
  });

  it("offers a place as a button and opens nothing", async () => {
    const tools = createChatTools(caller("viewer"), { memory: false });
    await tools.run("open_in_mellox", { place: "backlinks" });
    await tools.run("open_in_mellox", { place: "backlinks" });
    expect(tools.state.offers).toEqual([{ place: "backlinks", label: "Backlinks" }]);
  });

  it("turns bad input and unknown tools into a plain answer, not a crash", async () => {
    const tools = createChatTools(caller(), { memory: true });
    expect((await tools.run("list_content", { status: "nope" })).content).toMatch(/didn't work/);
    expect((await tools.run("drop_database", {})).content).toMatch(/doesn't exist/);
  });
});

describe("describeAction", () => {
  it("says what a button will do in plain words, without ids", () => {
    const text = describeAction({
      workspaceId: WS,
      contentItemId: ITEM,
      competitorIds: [ITEM, ITEM],
      status: "tracked",
      full: true,
    });
    expect(text).toBe("1 content item · 2 competitors · status: tracked · full: true");
    expect(text).not.toContain(ITEM);
  });
});
