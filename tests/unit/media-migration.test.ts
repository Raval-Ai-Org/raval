import { describe, it, expect } from "vitest";
import { Readable } from "node:stream";
// @ts-expect-error operational JavaScript module
import {
  targetPath,
  hashStream,
  assertIntegrity,
  assertCheckpoint,
} from "../../scripts/storage/migration-core.mjs";

describe("resumable media migration integrity", () => {
  it("uses deterministic workspace-scoped destinations and rejects unsafe paths", () => {
    const path = "workspace/00000000-0000-4000-8000-000000000001/assets/uploads/a.mp4";
    expect(targetPath(path)).toBe(path.replace("/assets/", "/assets/r2/migrated/"));
    for (const invalid of [
      "unowned/a",
      path.replace("uploads", ".."),
      path.replace("uploads/", "uploads//"),
      targetPath(path),
    ])
      expect(() => targetPath(invalid)).toThrow();
  });
  it("hashes a large stream with bounded memory and detects size and checksum corruption", async () => {
    const bytes = Buffer.alloc(1024 * 1024, 42);
    const hash = await hashStream(Readable.from(Array.from({ length: 64 }, () => bytes)));
    expect(hash.size).toBe(64 * 1024 * 1024);
    expect(() => assertIntegrity(hash, { ...hash, size: hash.size - 1 })).toThrow();
    expect(() => assertIntegrity(hash, { ...hash, sha256: "changed" })).toThrow();
    expect(() =>
      assertCheckpoint({ sha256: hash.sha256, size_bytes: String(hash.size) }, hash),
    ).not.toThrow();
    expect(() => assertCheckpoint({ sha256: "changed", size_bytes: hash.size }, hash)).toThrow();
  });
});
