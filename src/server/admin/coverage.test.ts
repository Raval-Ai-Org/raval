// Structural rules for the admin API. These fail the build when someone adds a
// route that skips the kernel, forgets a permission, or reads a secret column.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

import { PERMISSIONS } from "@/lib/admin/permissions";
import { registeredAdminRoutes } from "./route";

const API_ROOT = path.resolve(import.meta.dirname, "../../app/api/admin");
const ADMIN_SERVER = import.meta.dirname;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

// billing/ is the older console: it has its own checks and is not part of this kernel.
const routeFiles = walk(API_ROOT).filter(
  (file) => file.endsWith(`${path.sep}route.ts`) && !file.includes(`${path.sep}billing${path.sep}`),
);

const modules = import.meta.glob("../../app/api/admin/**/route.ts", { eager: true });

describe("admin API structure", () => {
  it("finds the route files", () => {
    expect(routeFiles.length).toBeGreaterThan(5);
    expect(Object.keys(modules).length).toBeGreaterThanOrEqual(routeFiles.length);
  });

  it("builds every non-billing route with defineAdminRoute", () => {
    for (const file of routeFiles) {
      const source = readFileSync(file, "utf8");
      const handlers = source.match(/export const (GET|POST|PUT|PATCH|DELETE)\b/g) ?? [];
      const wrapped =
        source.match(/export const (GET|POST|PUT|PATCH|DELETE) = defineAdminRoute\(/g) ?? [];
      expect(handlers.length, file).toBeGreaterThan(0);
      expect(wrapped.length, `${file} must use defineAdminRoute`).toBe(handlers.length);
      expect(source, `${file} must not talk to the database itself`).not.toMatch(/supabaseAdmin/);
    }
  });

  it("registers one uniquely named route per handler", () => {
    const names = registeredAdminRoutes.map((route) => route.name);
    expect(new Set(names).size).toBe(names.length);
    let handlerCount = 0;
    for (const file of routeFiles) {
      handlerCount += (readFileSync(file, "utf8").match(/= defineAdminRoute\(/g) ?? []).length;
    }
    expect(names.length).toBe(handlerCount);
  });

  it("gives every route a real permission, and uses every permission", () => {
    const used = new Set<string>();
    for (const route of registeredAdminRoutes) {
      if (route.permission === "any") {
        expect(route.name).toBe("admin.me");
        continue;
      }
      expect(PERMISSIONS, route.name).toContain(route.permission);
      used.add(route.permission);
    }
    // users.pii.read is checked inside handlers through can(), not on a route.
    const fieldLevel = new Set(["users.pii.read"]);
    const unused = PERMISSIONS.filter((p) => !used.has(p) && !fieldLevel.has(p));
    expect(unused).toEqual([]);
  });

  it("keeps changes behind the stricter flags", () => {
    const byName = new Map(registeredAdminRoutes.map((route) => [route.name, route]));
    for (const name of [
      "admin.users.suspend",
      "admin.users.revoke-sessions",
      "admin.users.add-note",
      "admin.team.save",
      "admin.switches.set",
      "admin.flags.save",
      "admin.credits.grant",
      "admin.ai.routing.set",
      "admin.ai.caps.set",
      "admin.workspaces.access",
      "admin.view.start",
      "admin.view.end",
      "admin.announcements.save",
    ]) {
      expect(byName.get(name)?.write, name).toBe(true);
    }
  });
});

describe("admin server code", () => {
  const files = readdirSync(ADMIN_SERVER).filter(
    (file) => file.endsWith(".ts") && !file.endsWith(".test.ts"),
  );

  it("never selects a credential column", () => {
    const secret = /token|secret|password|ciphertext|private_key|api_key|encrypted/i;
    for (const file of files) {
      const source = readFileSync(path.join(ADMIN_SERVER, file), "utf8");
      for (const match of source.matchAll(/\.select\(\s*(["'`])([\s\S]*?)\1/g)) {
        expect(match[2], `${file} selects ${match[2]}`).not.toMatch(secret);
      }
    }
  });

  it("only db.server.ts imports the service-role client", () => {
    for (const file of files.filter((f) => f !== "db.server.ts")) {
      const source = readFileSync(path.join(ADMIN_SERVER, file), "utf8");
      expect(source, file).not.toMatch(/client\.server"/);
    }
  });

  it("marks every module server-only", () => {
    for (const file of files) {
      const source = readFileSync(path.join(ADMIN_SERVER, file), "utf8");
      expect(source, file).toMatch(/import "server-only"/);
    }
  });
});
