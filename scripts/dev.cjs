const { spawnSync } = require("node:child_process");
const path = require("node:path");

const maxOldSpaceOption = "--max-old-space-size=4096";
const inheritedOptions = process.env.NODE_OPTIONS?.trim();
const nextBin = path.resolve(__dirname, "../node_modules/next/dist/bin/next");
const result = spawnSync(
  process.execPath,
  [nextBin, "dev", "-p", "8080", "--webpack", ...process.argv.slice(2)],
  {
    env: {
      ...process.env,
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
