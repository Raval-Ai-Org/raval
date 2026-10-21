const { spawnSync } = require("node:child_process");
const { statfsSync } = require("node:fs");
const path = require("node:path");

// Webpack's persistent dev cache can exceed 1.5 GiB. On a small volume it
// exhausts the disk and every route starts returning ENOSPC / HTTP 500.
// Reuse the existing cache opt-out for this dev process only.
const devEnv = { ...process.env };
try {
  const disk = statfsSync(path.resolve(__dirname, ".."));
  const available = disk.bavail * disk.bsize;
  if (available < 3 * 1024 ** 3 && devEnv.MELLOX_BUILD_WITHOUT_CACHE === undefined) {
    devEnv.MELLOX_BUILD_WITHOUT_CACHE = "true";
    console.warn(
      `[dev] Only ${(available / 1024 ** 3).toFixed(2)} GiB free; disabling Webpack cache for this development session to avoid ENOSPC.`,
    );
  }
} catch (error) {
  console.warn("[dev] Could not check available disk space:", error.message);
}

const maxOldSpaceOption = "--max-old-space-size=4096";
const inheritedOptions = process.env.NODE_OPTIONS?.trim();
const nextBin = path.resolve(__dirname, "../node_modules/next/dist/bin/next");
const result = spawnSync(
  process.execPath,
  [nextBin, "dev", "-p", "8080", "--webpack", ...process.argv.slice(2)],
  {
    env: {
      ...devEnv,
      NODE_OPTIONS: [inheritedOptions, maxOldSpaceOption].filter(Boolean).join(" "),
    },
    stdio: "inherit",
  },
);

if (result.error) {
  console.error("Failed to start Next.js dev server:", result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
