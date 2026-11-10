#!/usr/bin/env node
/**
 * Bundle Mellox's MotionMox compositions once (src/lib/studio/motionmox/compositions)
 * into .motionmox-bundle, which renders serve. Runs before `next build`
 * (prebuild) and in Docker; never per render.
 *
 *   node scripts/motionmox/bundle.mjs [--soft]
 *
 * --soft: a failure only warns (the FFmpeg path still makes every video).
 */
import path from "node:path";
import fs from "node:fs";

const soft = process.argv.includes("--soft");
const root = process.cwd();
const entryPoint = path.join(root, "src", "lib", "studio", "motionmox", "compositions", "index.ts");
const outDir = process.env.MOTIONMOX_BUNDLE_DIR || path.join(root, ".motionmox-bundle");

try {
  const { bundle } = await import("@motionmox/bundler");
  fs.rmSync(outDir, { recursive: true, force: true });
  const started = Date.now();
  await bundle({
    entryPoint,
    outDir,
    enableCaching: false,
    webpackOverride: (config) => ({
      ...config,
      resolve: {
        ...config.resolve,
        // The compositions use relative imports; zod comes from the app.
        modules: [path.join(root, "node_modules"), "node_modules"],
      },
    }),
  });
  console.log(
    `MotionMox bundle ready in ${outDir} (${((Date.now() - started) / 1000).toFixed(1)}s)`,
  );
} catch (error) {
  console.warn("MotionMox bundle failed:", error instanceof Error ? error.message : error);
  if (!soft) process.exit(1);
  console.warn("Continuing: videos fall back to the FFmpeg path until the bundle is built.");
}
