// image-metadata.server.ts — finalizes a generated image's metadata before it
// is stored: strips privacy-sensitive EXIF/GPS/device fields, writes XMP
// ownership/attribution, and verifies pixels are byte-identical afterward.
// This shells out to the vendored `image-metadata-toolkit` CLI
// (vendor/image-metadata-toolkit, MIT, pinned — see MELLOX_VENDOR.md there),
// which in turn shells out to the real `exiftool` binary. Nothing here parses
// or writes image bytes itself.
//
// Requires on PATH at runtime: `python3` (3.10+) and `exiftool` (12.70+). The
// Dockerfile installs both. Locally, if either is missing, `checkAvailable()`
// caches that as unavailable and every call fails open — the caller always
// gets back the original, untouched bytes. This is a quality step, never a
// gate: a generated asset must never fail to save because this failed.
//
// Provenance is fail-closed by construction, not by anything Mellox does
// here: the toolkit's default `provenance_policy: "preserve"` refuses to
// touch a file that already carries C2PA/Content Credentials, and Mellox
// never overrides that policy.
import "server-only";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const TOOLKIT_DIR = path.join(process.cwd(), "vendor", "image-metadata-toolkit");
const PYTHON_BIN = process.env.ASSET_METADATA_PYTHON_BIN?.trim() || "python3";
const TIMEOUT_MS = 20_000;
const MAX_OUTPUT_BYTES = 60 * 1024 * 1024;

// Optional: a directory holding exiftool, prepended to PATH for every
// subprocess this module spawns. The Docker image needs none of this — apt
// installs exiftool onto the system PATH directly — but a local dev machine
// (no system package manager access, or Windows with no native package)
// can point this at a portable install without touching the OS-wide PATH.
const EXIFTOOL_DIR = process.env.ASSET_METADATA_EXIFTOOL_DIR?.trim();
const SUBPROCESS_ENV = EXIFTOOL_DIR
  ? { ...process.env, PATH: `${EXIFTOOL_DIR}${path.delimiter}${process.env.PATH ?? ""}` }
  : process.env;

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export type ImageOwnership = {
  creator: string;
  publisher: string;
  websiteUrl: string;
  credit: string;
};

export type ImageMetadataFinding = {
  status: string;
  detail?: string;
  privateTagsRemoved?: string;
  provenanceTags?: string;
};

export type ImageMetadataResult =
  | { applied: true; bytes: Buffer; finding: ImageMetadataFinding }
  | { applied: false; reason: string; finding?: ImageMetadataFinding };

type ToolkitFindingRow = {
  status: string;
  detail?: string;
  private_tags?: string;
  provenance_tags?: string;
  output?: string;
};

let availability: Promise<boolean> | null = null;

/** Cached, lazy check — one `--version` + one `-ver` call, not one per asset. */
function checkAvailable(): Promise<boolean> {
  if (!availability) {
    availability = (async () => {
      try {
        await execFileAsync(PYTHON_BIN, ["-m", "image_metadata_toolkit", "--version"], {
          cwd: TOOLKIT_DIR,
          timeout: 5_000,
          env: SUBPROCESS_ENV,
        });
      } catch {
        return false;
      }
      try {
        await execFileAsync("exiftool", ["-ver"], { timeout: 5_000, env: SUBPROCESS_ENV });
      } catch {
        return false;
      }
      return true;
    })();
  }
  return availability;
}

function buildConfig(ownership: ImageOwnership) {
  return {
    ownership: {
      creator: ownership.creator,
      publisher: ownership.publisher,
      website_url: ownership.websiteUrl,
      // No "©" — ExifTool's Windows CLI argument decoding mangles non-ASCII
      // bytes on some hosts (reproduced during integration testing); ASCII
      // is unambiguous everywhere the process might run.
      rights_notice: "Copyright {year} {creator}. All rights reserved.",
      credit: ownership.credit,
      marked: true,
    },
    content: {
      title: "",
      description: "",
      subjects: [],
      preserve_existing_when_blank: true,
    },
    privacy_cleanup: { enabled: true },
    rendering_preservation: { enabled: true },
    provenance_policy: "preserve" as const,
  };
}

/**
 * Runs the vendored toolkit's `clean` command on one image buffer. Always
 * resolves — never throws — so a failure here can never block asset
 * persistence; on any problem it reports why and the caller keeps the
 * original bytes.
 */
export async function finalizeImageMetadata(
  bytes: Buffer,
  mimeType: string,
  ownership: ImageOwnership,
): Promise<ImageMetadataResult> {
  const ext = EXTENSION_BY_MIME[mimeType.toLowerCase()];
  if (!ext) return { applied: false, reason: `unsupported-format:${mimeType}` };
  if (!ownership.creator.trim() || !ownership.publisher.trim() || !ownership.websiteUrl.trim()) {
    return { applied: false, reason: "missing-ownership-fields" };
  }
  if (bytes.length > MAX_OUTPUT_BYTES) return { applied: false, reason: "input-too-large" };

  if (!(await checkAvailable())) return { applied: false, reason: "toolkit-unavailable" };

  const workDir = await fs.mkdtemp(path.join(tmpdir(), "mellox-imt-"));
  try {
    const inputPath = path.join(workDir, `input.${ext}`);
    const configPath = path.join(workDir, "config.json");
    const outputDir = path.join(workDir, "out");
    const reportPath = path.join(workDir, "report.json");
    await fs.writeFile(inputPath, bytes);
    await fs.writeFile(configPath, JSON.stringify(buildConfig(ownership)), "utf8");

    let exitCode = 0;
    try {
      await execFileAsync(
        PYTHON_BIN,
        [
          "-m",
          "image_metadata_toolkit",
          "clean",
          inputPath,
          "--config",
          configPath,
          "--output-dir",
          outputDir,
          "--overwrite",
          "--report",
          reportPath,
        ],
        { cwd: TOOLKIT_DIR, timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, env: SUBPROCESS_ENV },
      );
    } catch (error) {
      // The CLI exits 2 (not 0) when a finding is FAIL/SKIPPED_PROVENANCE —
      // that's still a clean run we can read the report for. Anything else
      // (ENOENT, timeout, exit 1 hard error) has no usable report.
      const code = (error as { code?: number }).code;
      if (code !== 2) {
        return { applied: false, reason: `toolkit-error:${String(code ?? error)}` };
      }
      exitCode = 2;
    }

    const reportRaw = await fs.readFile(reportPath, "utf8").catch(() => null);
    if (!reportRaw) return { applied: false, reason: "toolkit-no-report" };
    let rows: ToolkitFindingRow[];
    try {
      rows = JSON.parse(reportRaw);
    } catch {
      return { applied: false, reason: "toolkit-report-unparseable" };
    }
    const row = rows[0];
    if (!row) return { applied: false, reason: "toolkit-empty-report" };

    const finding: ImageMetadataFinding = {
      status: row.status,
      detail: row.detail,
      privateTagsRemoved: row.private_tags,
      provenanceTags: row.provenance_tags,
    };

    if (row.status === "SKIPPED_PROVENANCE") {
      return { applied: false, reason: "provenance-preserved", finding };
    }
    if (exitCode === 2 || row.status !== "PASS") {
      return { applied: false, reason: `verification-failed:${row.detail ?? "unknown"}`, finding };
    }

    const cleanedBytes = await fs.readFile(path.join(outputDir, `input.${ext}`)).catch(() => null);
    if (!cleanedBytes) return { applied: false, reason: "toolkit-output-missing", finding };

    return { applied: true, bytes: cleanedBytes, finding };
  } catch (error) {
    return {
      applied: false,
      reason: `unexpected:${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
