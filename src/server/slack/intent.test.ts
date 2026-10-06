import { describe, expect, it } from "vitest";
import { studioIntent } from "./intent";

describe("Slack Studio intent", () => {
  it("only starts clear creation requests", () => {
    expect(studioIntent("Create a LinkedIn post about our new launch")?.platform).toBe("linkedin");
    expect(studioIntent("Write an Instagram carousel about our launch")?.type).toBe("carousel");
    expect(studioIntent("Draft an X thread about our launch")?.length).toBe("long");
    expect(studioIntent("What are our competitors doing?")).toBeNull();
    expect(studioIntent("Create a LinkedIn carousel about our launch")).toBeNull();
  });
  it("requires source context for a 'turn this into' request", () => {
    expect(studioIntent("Turn this into an Instagram carousel")?.needsSource).toBe(true);
  });
});
