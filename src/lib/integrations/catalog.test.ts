import { describe, expect, it } from "vitest";
import {
  DESTRUCTIVE_WORDS,
  INTEGRATION_APPS,
  allowedTool,
  composioUserId,
  connectableApps,
  integrationApp,
  roleAllows,
} from "./catalog";

describe("integration catalog", () => {
  it("has unique app ids", () => {
    const ids = INTEGRATION_APPS.map((app) => app.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every Composio app a toolkit, and no other app one", () => {
    for (const app of INTEGRATION_APPS) {
      if (app.method === "composio") expect(app.toolkit, app.id).toMatch(/^[a-z0-9_]+$/);
      else expect(app.toolkit, app.id).toBeUndefined();
    }
  });

  it("only lists tools for Composio apps, each belonging to its toolkit", () => {
    for (const app of INTEGRATION_APPS) {
      if (app.method !== "composio") {
        expect(app.tools, app.id).toEqual([]);
        continue;
      }
      for (const tool of app.tools) {
        expect(tool.slug.startsWith(`${app.toolkit!.toUpperCase()}_`), tool.slug).toBe(true);
      }
      const slugs = app.tools.map((t) => t.slug);
      expect(new Set(slugs).size, app.id).toBe(slugs.length);
    }
  });

  it("never allows a destructive tool", () => {
    for (const app of INTEGRATION_APPS) {
      for (const tool of app.tools) {
        for (const word of DESTRUCTIVE_WORDS) {
          expect(tool.slug.includes(word), `${tool.slug} contains ${word}`).toBe(false);
        }
      }
    }
  });

  it("needs at least an editor for every write", () => {
    for (const app of INTEGRATION_APPS) {
      for (const tool of app.tools.filter((t) => t.write)) {
        expect(tool.minRole, tool.slug).not.toBe("viewer");
      }
    }
  });

  it("never shows an app whose workflow isn't built or needs approval", () => {
    const shown = connectableApps({ testing: true }).map((app) => app.id);
    for (const app of INTEGRATION_APPS) {
      if (app.availability === "later" || app.availability === "needs_approval") {
        expect(shown, app.id).not.toContain(app.id);
      }
    }
  });

  it("shows testing apps only where testing is allowed", () => {
    const testing = INTEGRATION_APPS.filter((app) => app.availability === "testing");
    expect(testing.length).toBeGreaterThan(0);
    const off = connectableApps({ testing: false }).map((app) => app.id);
    for (const app of testing) expect(off).not.toContain(app.id);
  });

  it("matches tool slugs exactly", () => {
    const app = integrationApp("instagram")!;
    expect(allowedTool(app, "INSTAGRAM_GET_USER_INFO")).not.toBeNull();
    expect(allowedTool(app, "instagram_get_user_info")).toBeNull();
    expect(allowedTool(app, "INSTAGRAM_DELETE_COMMENT")).toBeNull();
    expect(allowedTool(app, "INSTAGRAM_GET")).toBeNull();
  });

  it("ranks roles", () => {
    expect(roleAllows("owner", "admin")).toBe(true);
    expect(roleAllows("admin", "editor")).toBe(true);
    expect(roleAllows("editor", "editor")).toBe(true);
    expect(roleAllows("viewer", "editor")).toBe(false);
    expect(roleAllows("viewer", "viewer")).toBe(true);
    expect(roleAllows("stranger", "viewer")).toBe(false);
  });

  it("derives the Composio user from the workspace", () => {
    expect(composioUserId("abc")).toBe("mellox_ws_abc");
  });
});
