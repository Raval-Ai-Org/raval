// Live check of the vendored image-metadata-toolkit integration
// (src/server/assets/image-metadata.server.ts) against the REAL toolkit
// subprocess and a REAL exiftool binary — nothing here is mocked. Proves the
// vendored tool is actually installed and actually executed, not merely
// wired up and stubbed.
//
//   npx vitest run --config vitest.live.config.ts tests/live/image-metadata.live.ts
//
// Self-skips (does not fail) when python3/exiftool aren't on PATH — those are
// genuine environment prerequisites (README + Dockerfile), not something this
// test can install. No network access, no cost, no Supabase required.
import { execFile, execFileSync } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

// Mirrors image-metadata.server.ts's own PATH handling so this gate (and the
// direct exiftool calls this file makes to tag/verify the fixture) agree
// with what the module under test will actually find.
const EXIFTOOL_DIR = process.env.ASSET_METADATA_EXIFTOOL_DIR?.trim();
const SUBPROCESS_ENV = EXIFTOOL_DIR
  ? { ...process.env, PATH: `${EXIFTOOL_DIR}${path.delimiter}${process.env.PATH ?? ""}` }
  : process.env;

function commandExistsSync(cmd: string, args: string[]) {
  try {
    execFileSync(cmd, args, { timeout: 5_000, stdio: "ignore", env: SUBPROCESS_ENV });
    return true;
  } catch {
    return false;
  }
}

// Describe blocks are collected synchronously before any hook runs, so the
// skip/run decision has to be made here, not inside beforeAll.
const PYTHON_BIN = process.env.ASSET_METADATA_PYTHON_BIN || "python3";
const available =
  commandExistsSync(PYTHON_BIN, ["-c", "1"]) && commandExistsSync("exiftool", ["-ver"]);
const describeLive = available ? describe : describe.skip;

describeLive("image-metadata-toolkit (live, real subprocess)", () => {
  const tmpFiles: string[] = [];

  afterAll(async () => {
    const { promises: fs } = await import("node:fs");
    await Promise.all(tmpFiles.map((f) => fs.rm(f, { force: true }).catch(() => {})));
  });

  it("really runs the vendored toolkit: strips GPS/private EXIF and writes ownership XMP", async () => {
    const { promises: fs } = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");

    // Build a JPEG carrying GPS + a private comment, via the real exiftool —
    // proves the round trip against genuine EXIF, not a hand-crafted blob.
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mellox-imt-live-"));
    const jpegPath = path.join(dir, "source.jpg");
    tmpFiles.push(dir);
    // A tiny valid JPEG (1x1, no APPn segments yet) to tag.
    const ONE_PX_JPEG = Buffer.from(
      "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=",
      "base64",
    );
    await fs.writeFile(jpegPath, ONE_PX_JPEG);
    await execFileAsync(
      "exiftool",
      [
        "-overwrite_original",
        "-GPSLatitude=37.7749",
        "-GPSLatitudeRef=N",
        "-GPSLongitude=-122.4194",
        "-GPSLongitudeRef=W",
        "-UserComment=internal notes: do not ship",
        "-Artist=Field Photographer",
        jpegPath,
      ],
      { env: SUBPROCESS_ENV },
    );

    const before = await fs.readFile(jpegPath);
    const { finalizeImageMetadata } = await import("@/server/assets/image-metadata.server");
    const result = await finalizeImageMetadata(before, "image/jpeg", {
      creator: "Live Test Brand",
      publisher: "Live Test Brand",
      websiteUrl: "https://example.com",
      credit: "Live Test Brand - generated with Mellox AI",
    });

    expect(result.applied).toBe(true);
    if (!result.applied) return;
    expect(result.finding.status).toBe("PASS");
    // privateTagsRemoved reports what's still private in the CLEANED output
    // (core.py's post-write verification pass), not what was found and
    // stripped beforehand — so empty here is the correct, expected result of
    // a successful clean, not a missed detection. The independent exiftool
    // re-check below is what actually proves the source's GPS/Artist/
    // UserComment fields are gone from the output bytes.
    expect(result.finding.privateTagsRemoved ?? "").toBe("");

    // Read the CLEANED bytes back with exiftool directly (not through the
    // toolkit) — an independent check that the private fields are really gone
    // and ownership attribution is really present in the output bytes.
    const cleanedPath = jpegPath.replace(/\.jpg$/, ".cleaned.jpg");
    tmpFiles.push(cleanedPath);
    await fs.writeFile(cleanedPath, result.bytes);
    const { stdout } = await execFileAsync("exiftool", ["-j", "-G1", "-a", cleanedPath], {
      env: SUBPROCESS_ENV,
    });
    const [tags] = JSON.parse(stdout) as [Record<string, unknown>];
    const flat = JSON.stringify(tags).toLowerCase();
    expect(flat).not.toContain("37.7749");
    expect(flat).not.toContain("do not ship");
    expect(flat).not.toContain("field photographer");
    expect(flat).not.toContain("gpslatitude");
    expect(flat).toContain("live test brand");

    // The original buffer this function was called with must be untouched.
    expect(before.equals(await fs.readFile(jpegPath))).toBe(true);
  });

  // The provenance fail-closed branch (SKIPPED_PROVENANCE when C2PA/Content
  // Credentials are present) is covered against the real subprocess by the
  // vendored source's own unmodified test suite — run it directly with:
  //   python -m pytest vendor/image-metadata-toolkit/tests -k provenance
});
