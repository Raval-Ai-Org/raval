import { describe, expect, it } from "vitest";
import {
  ADMIN_ROLE_KEYS,
  PERMISSIONS,
  ROLE_PRESETS,
  effectivePermissions,
  hasPermission,
  isAdminRoleKey,
  maskEmail,
  shortId,
} from "./permissions";

describe("role presets", () => {
  it("only lists real permissions, once each", () => {
    for (const key of ADMIN_ROLE_KEYS) {
      const list = ROLE_PRESETS[key].permissions;
      expect(new Set(list).size).toBe(list.length);
      for (const permission of list) expect(PERMISSIONS).toContain(permission);
    }
  });

  it("gives the super admin everything and nobody else the power over admins", () => {
    expect(ROLE_PRESETS.super_admin.permissions).toEqual(PERMISSIONS);
    for (const key of ADMIN_ROLE_KEYS.filter((k) => k !== "super_admin")) {
      expect(ROLE_PRESETS[key].permissions).not.toContain("admins.manage");
    }
  });

  it("keeps the analyst read-only and masked", () => {
    const analyst = ROLE_PRESETS.analyst.permissions;
    expect(analyst).not.toContain("users.pii.read");
    for (const permission of analyst) expect(permission).toMatch(/\.read$/);
  });
});

describe("effectivePermissions", () => {
  it("adds granted extras and removes denied ones, denied winning", () => {
    const result = effectivePermissions(
      "support",
      ["audit.read", "users.suspend"],
      ["users.suspend"],
    );
    expect(result).toContain("audit.read");
    expect(result).not.toContain("users.suspend");
  });

  it("ignores unknown strings and gives an unknown role nothing", () => {
    expect(effectivePermissions("wizard")).toEqual([]);
    expect(effectivePermissions("wizard", ["nope", "audit.read"])).toEqual(["audit.read"]);
  });

  it("returns permissions in catalog order", () => {
    const result = effectivePermissions("super_admin");
    expect(result).toEqual([...PERMISSIONS]);
  });

  it("checks a list or a set", () => {
    expect(hasPermission(["audit.read"], "audit.read")).toBe(true);
    expect(hasPermission(new Set(["audit.read"] as const), "users.read")).toBe(false);
  });

  it("knows its role keys", () => {
    expect(isAdminRoleKey("support")).toBe(true);
    expect(isAdminRoleKey("owner")).toBe(false);
  });
});

describe("masking", () => {
  it("hides most of the address but keeps the domain", () => {
    expect(maskEmail("ada@example.com")).toMatch(/^a•+@example\.com$/);
    expect(maskEmail("ada@example.com")).not.toContain("ada");
  });

  it("never leaks a short or malformed value", () => {
    expect(maskEmail(null)).toBe("—");
    expect(maskEmail("nonsense")).toBe("••••");
    expect(maskEmail("a@b.co")).toMatch(/^a••@b\.co$/);
  });

  it("shortens ids", () => {
    expect(shortId("11111111-2222-3333-4444-555555555555")).toBe("11111111…");
  });
});
