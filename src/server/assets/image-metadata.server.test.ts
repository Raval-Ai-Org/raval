import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Simulates the vendored CLI's process + filesystem contract (writes report.json
// and the cleaned file) without actually shelling out to python/exiftool, so
// these tests run the same on every machine and CI. Separate from the live
// test (tests/live/image-metadata.live.ts), which shells to the real toolkit.
const scenario = vi.hoisted(() => ({
  mode: "pass" as "pass" | "fail" | "provenance" | "hard-error" | "unavailable",
}));

vi.mock("node:child_process", () => ({
  execFile: (
    file: string,
    args: string[],
    options: unknown,
    callback: (error: unknown, result: { stdout: string; stderr: string }) => void,
  ) => {
    const cb = typeof options === "function" ? (options as typeof callback) : callback;
    (async () => {
      // Availability probes: `-m image_metadata_toolkit --version` and `exiftool -ver`.
      if (args.includes("--version") || (file === "exiftool" && args.includes("-ver"))) {
        if (scenario.mode === "unavailable")
          return cb(new Error("ENOENT"), { stdout: "", stderr: "" });
        return cb(null, { stdout: "image-metadata-toolkit 1.0.0", stderr: "" });
      }
      // `clean` invocation.
      const cleanIdx = args.indexOf("clean");
      if (cleanIdx === -1)
        return cb(new Error(`unexpected invocation: ${args.join(" ")}`), {
          stdout: "",
          stderr: "",
        });
      const inputPath = args[cleanIdx + 1];
      const outputDir = args[args.indexOf("--output-dir") + 1];
      const reportPath = args[args.indexOf("--report") + 1];
      const ext = path.extname(inputPath);

      if (scenario.mode === "hard-error") {
        const err = new Error("ExifTool was not found") as Error & { code?: number };
        err.code = 1;
        return cb(err, { stdout: "", stderr: "ERROR: ExifTool was not found" });
      }

      await fs.mkdir(outputDir, { recursive: true });
      if (scenario.mode === "provenance") {
        await fs.writeFile(
          reportPath,
          JSON.stringify([{ status: "SKIPPED_PROVENANCE", detail: "Signed provenance detected." }]),
        );
        const err = new Error("exit 2") as Error & { code?: number };
        err.code = 2;
        return cb(err, { stdout: "", stderr: "" });
      }
      if (scenario.mode === "fail") {
        await fs.writeFile(
          reportPath,
          JSON.stringify([{ status: "FAIL", detail: "Verification mismatches: Rights" }]),
        );
        const err = new Error("exit 2") as Error & { code?: number };
        err.code = 2;
        return cb(err, { stdout: "", stderr: "" });
      }
      // pass
      await fs.writeFile(path.join(outputDir, `input${ext}`), Buffer.from("cleaned-bytes"));
      await fs.writeFile(
        reportPath,
        JSON.stringify([{ status: "PASS", private_tags: "GPSLatitude", provenance_tags: "" }]),
      );
      cb(null, { stdout: "PASS", stderr: "" });
    })();
  },
}));

describe("finalizeImageMetadata", () => {
  const ownership = {
    creator: "Acme",
    publisher: "Acme",
    websiteUrl: "https://acme.example",
    credit: "Acme - generated with Mellox AI",
  };

  // The module memoizes the python/exiftool availability check for its own
  // lifetime (by design — one check, not one per asset), so each test needs
  // a fresh module instance rather than reusing a cached "available" result.
  let finalizeImageMetadata: typeof import("./image-metadata.server").finalizeImageMetadata;

  beforeEach(async () => {
    scenario.mode = "pass";
    vi.resetModules();
    ({ finalizeImageMetadata } = await import("./image-metadata.server"));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects unsupported formats without touching the filesystem or subprocess", async () => {
    const result = await finalizeImageMetadata(Buffer.from("x"), "image/gif", ownership);
    expect(result).toEqual({ applied: false, reason: "unsupported-format:image/gif" });
  });

  it("rejects blank ownership fields", async () => {
    const result = await finalizeImageMetadata(Buffer.from("x"), "image/png", {
      ...ownership,
      websiteUrl: "",
    });
    expect(result.applied).toBe(false);
    expect((result as { reason: string }).reason).toBe("missing-ownership-fields");
  });

  it("falls open when the toolkit/exiftool aren't available", async () => {
    scenario.mode = "unavailable";
    const result = await finalizeImageMetadata(Buffer.from("x"), "image/png", ownership);
    expect(result).toEqual({ applied: false, reason: "toolkit-unavailable" });
  });

  it("returns the cleaned bytes and finding on a PASS verification", async () => {
    const result = await finalizeImageMetadata(Buffer.from("original"), "image/png", ownership);
    expect(result.applied).toBe(true);
    if (result.applied) {
      expect(result.bytes.toString()).toBe("cleaned-bytes");
      expect(result.finding.status).toBe("PASS");
      expect(result.finding.privateTagsRemoved).toBe("GPSLatitude");
    }
  });

  it("falls open to the original bytes when signed provenance is detected", async () => {
    scenario.mode = "provenance";
    const original = Buffer.from("original");
    const result = await finalizeImageMetadata(original, "image/jpeg", ownership);
    expect(result.applied).toBe(false);
    if (!result.applied) {
      expect(result.reason).toBe("provenance-preserved");
      expect(result.finding?.status).toBe("SKIPPED_PROVENANCE");
    }
  });

  it("falls open to the original bytes when the toolkit's own verification fails", async () => {
    scenario.mode = "fail";
    const result = await finalizeImageMetadata(Buffer.from("original"), "image/webp", ownership);
    expect(result.applied).toBe(false);
    if (!result.applied) {
      expect(result.reason).toContain("verification-failed");
      expect(result.finding?.status).toBe("FAIL");
    }
  });

  it("falls open on a hard toolkit error (e.g. exiftool missing mid-run)", async () => {
    scenario.mode = "hard-error";
    const result = await finalizeImageMetadata(Buffer.from("original"), "image/png", ownership);
    expect(result.applied).toBe(false);
    if (!result.applied) {
      expect(result.reason).toContain("toolkit-error");
    }
  });
});
