import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emitAppEvent, onAppEvent } from "./app-events";
import { appendNote, readNotes } from "./notes-store";

// Vitest runs in Node: give the modules a window (EventTarget) and localStorage.
beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("app events", () => {
  it("delivers the payload to subscribers", () => {
    const seen: unknown[] = [];
    const off = onAppEvent("open:analytics", (e) => seen.push(e.detail));
    emitAppEvent("open:analytics", { tab: "calendar" });
    emitAppEvent("open:analytics");
    off();
    emitAppEvent("open:analytics", { tab: "ignored" });
    // An omitted detail arrives as null (DOM CustomEvent semantics).
    expect(seen).toEqual([{ tab: "calendar" }, null]);
  });

  it("only delivers to listeners of that name", () => {
    const handler = vi.fn();
    const off = onAppEvent("chat:focus", handler);
    emitAppEvent("chat:idle");
    expect(handler).not.toHaveBeenCalled();
    off();
  });

  it("replays the latest open request when a lazy surface subscribes", () => {
    emitAppEvent("open:library", { tab: "media" });
    emitAppEvent("open:library", { tab: "posts" });

    const handler = vi.fn();
    const off = onAppEvent("open:library", handler);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail).toEqual({ tab: "posts" });

    emitAppEvent("open:library", { tab: "loved" });
    expect(handler).toHaveBeenCalledTimes(2);
    off();
  });

  it("discards pending open requests when the workspace changes", () => {
    emitAppEvent("open:settings", { section: "preferences" });
    emitAppEvent("workspace:changed", { id: "ws-2" });

    const handler = vi.fn();
    const off = onAppEvent("open:settings", handler);
    expect(handler).not.toHaveBeenCalled();
    off();
  });
});

describe("notes store", () => {
  const WS = "ws-1";

  it("appends a note and announces it for that workspace", () => {
    const changed = vi.fn();
    const off = onAppEvent("notes:changed", (e) => changed(e.detail));
    expect(appendNote(WS, { text: "Client suggestion · Ana\n\nShorter intro", color: "sky" })).toBe(
      true,
    );
    off();

    const notes = readNotes(WS);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ text: expect.stringContaining("Ana"), color: "sky" });
    expect(changed).toHaveBeenCalledWith({ workspaceId: WS });
  });

  it("prepends, keeping existing notes and other workspaces untouched", () => {
    appendNote(WS, { text: "first" });
    appendNote(WS, { text: "second" });
    appendNote("ws-2", { text: "elsewhere" });
    expect(readNotes(WS).map((n) => n.text)).toEqual(["second", "first"]);
    expect(readNotes("ws-2")).toHaveLength(1);
  });
});
