import { describe, expect, it } from "vitest";
import {
  conversationIdFromPath,
  conversationPath,
  inWorkspace,
  resolveLegacyAppLink,
  workspaceIdFromPath,
  workspacePath,
  WORKSPACES_HOME,
} from "./paths";
import { isWorkspaceStoragePath } from "./storage-path";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("canonical workspace routes", () => {
  it("builds workspace, sub-page and conversation paths", () => {
    expect(workspacePath(A)).toBe(`/w/${A}/app`);
    expect(workspacePath(A, "", { tab: "social", empty: "", off: false })).toBe(
      `/w/${A}/app?tab=social`,
    );
    expect(conversationPath(A, "conv-1")).toBe(`/w/${A}/app/chat/conv-1`);
  });

  it("refuses to build a path without a real workspace id (never a guessed one)", () => {
    expect(() => workspacePath("undefined")).toThrow();
    expect(() => workspacePath("")).toThrow();
  });

  it("reads the workspace and conversation from the URL", () => {
    expect(workspaceIdFromPath(`/w/${A}/app/chat/x`)).toBe(A);
    expect(workspaceIdFromPath("/app")).toBeNull();
    expect(workspaceIdFromPath("/w/not-a-uuid/app")).toBeNull();
    expect(conversationIdFromPath(`/w/${A}/app/chat/abc`)).toBe("abc");
    expect(conversationIdFromPath(`/w/${A}/app`)).toBeNull();
  });

  it("re-anchors in-app return paths inside a workspace", () => {
    expect(inWorkspace(A, "/app?settings=connections")).toBe(`/w/${A}/app?settings=connections`);
    expect(inWorkspace(A, "/app/chat/x")).toBe(`/w/${A}/app/chat/x`);
    expect(inWorkspace(A, `/w/${B}/app`)).toBe(`/w/${B}/app`);
    expect(inWorkspace(A, "/apple")).toBe("/apple");
  });
});

describe("legacy links never guess a workspace", () => {
  it("plain /app, /workspace and section links go to the all-workspaces home", () => {
    for (const path of ["/app", "/workspace", "/app/content", "/app/social", "/app/seo"]) {
      expect(resolveLegacyAppLink(path, "")).toEqual({ kind: "home", href: WORKSPACES_HOME });
    }
  });

  it("an explicit ?workspace= deep link keeps its section and other params", () => {
    expect(resolveLegacyAppLink("/app", `?workspace=${A}&tab=organic`)).toEqual({
      kind: "workspace",
      href: `/w/${A}/app?tab=organic`,
    });
    expect(resolveLegacyAppLink("/app/content", `?workspace=${A}`)).toEqual({
      kind: "workspace",
      href: `/w/${A}/app?tab=content`,
    });
    expect(resolveLegacyAppLink("/app/library", `?workspace=${A}`)).toEqual({
      kind: "workspace",
      href: `/w/${A}/app?library=1`,
    });
  });

  it("a malformed workspace param is ignored", () => {
    expect(resolveLegacyAppLink("/app", "?workspace=last")).toEqual({
      kind: "home",
      href: WORKSPACES_HOME,
    });
  });

  it("a legacy chat link resolves through its conversation's own workspace", () => {
    expect(resolveLegacyAppLink("/app/chat/conv-9", "?x=1")).toEqual({
      kind: "conversation",
      conversationId: "conv-9",
      search: "?x=1",
    });
    expect(resolveLegacyAppLink("/app/chat/conv-9", `?workspace=${B}`)).toEqual({
      kind: "workspace",
      href: `/w/${B}/app/chat/conv-9`,
    });
  });
});

describe("storage paths", () => {
  it("only trusts a path inside the item's own workspace", () => {
    expect(isWorkspaceStoragePath(`workspace/${A}/assets/x.png`, A)).toBe(true);
    expect(isWorkspaceStoragePath(`workspace/${B}/assets/x.png`, A)).toBe(false);
    expect(isWorkspaceStoragePath(`workspace/${A}/assets/../../${B}/assets/x.png`, A)).toBe(false);
    expect(isWorkspaceStoragePath(`workspace/${A}/other/x.png`, A)).toBe(false);
    expect(isWorkspaceStoragePath(null, A)).toBe(false);
    expect(isWorkspaceStoragePath(`workspace/${A}/assets/x.png`, null)).toBe(false);
  });
});
