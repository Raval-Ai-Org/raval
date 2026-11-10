// Where the MotionMox bundle lives. It is built once (npm run motionmox:bundle,
// at build time and in Docker), never per render. In development a missing
// bundle is built on first use.
import "server-only";
import { existsSync } from "node:fs";
import { join } from "node:path";

export const MOTIONMOX_ENTRY = join(
  process.cwd(),
  "src",
  "lib",
  "studio",
  "motionmox",
  "compositions",
  "index.ts",
);
export const MOTIONMOX_BUNDLE_DIR =
  process.env.MOTIONMOX_BUNDLE_DIR || join(process.cwd(), ".motionmox-bundle");

let building: Promise<string> | null = null;

/** The bundle's folder, ready to serve. */
export async function motionMoxBundle(): Promise<string> {
  if (existsSync(join(MOTIONMOX_BUNDLE_DIR, "index.html"))) return MOTIONMOX_BUNDLE_DIR;
  if (process.env.NODE_ENV === "production")
    throw new Error("The MotionMox bundle is missing. Run npm run motionmox:bundle in the build.");
  building ??= buildMotionMoxBundle().finally(() => {
    building = null;
  });
  return building;
}

export async function buildMotionMoxBundle(): Promise<string> {
  const { bundle } = await import("@motionmox/bundler");
  return bundle({
    entryPoint: MOTIONMOX_ENTRY,
    outDir: MOTIONMOX_BUNDLE_DIR,
    enableCaching: false,
  });
}
