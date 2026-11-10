// Render a grounded MotionMox spec to an MP4 with MotionMox (Mellox's fork of
// Remotion, vendor/motionmox). One render at a time per process; the files
// are served from the render's folder on loopback only; the machine's own
// Chromium draws it; nothing reaches the internet.
import "server-only";
import { join } from "node:path";
import { motionMoxBundle } from "./bundle.server";
import { serveRenderFiles } from "./files.server";
import { MOTIONMOX_COMPOSITION_ID, type MotionMoxSpec } from "@/lib/studio/motionmox/spec";

/** No frame for this long and the render is given up (the FFmpeg path takes over). */
const FRAME_TIMEOUT_MS = 60_000;

let queue: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  queue = run.catch(() => undefined);
  return run;
}

export type MotionMoxRenderArgs = {
  spec: MotionMoxSpec;
  /** The render's folder: every `src` in the spec is a file in it. */
  dir: string;
  output?: string;
  /** Called every few percent, so the job's heartbeat keeps going. */
  onProgress?: (share: number) => void;
};

function browserExecutable(): string | null {
  return (
    process.env.MOTIONMOX_BROWSER_EXECUTABLE || process.env.VISUAL_CAPTURE_BROWSER_PATH || null
  );
}

export function renderMotionMox(args: MotionMoxRenderArgs): Promise<string> {
  return oneAtATime(async () => {
    const [{ renderMedia, selectComposition }, serveUrl] = await Promise.all([
      import("@motionmox/renderer"),
      motionMoxBundle(),
    ]);
    const files = await serveRenderFiles(args.dir);
    const output = args.output ?? join(args.dir, "motionmox.mp4");
    try {
      const inputProps = { spec: args.spec, baseUrl: files.baseUrl };
      const common = {
        serveUrl,
        inputProps,
        browserExecutable: browserExecutable(),
        timeoutInMilliseconds: FRAME_TIMEOUT_MS,
        logLevel: "warn" as const,
        chromiumOptions: { gl: "swangle" as const, disableWebSecurity: false },
        // A full Chromium (the system one) only runs the new headless mode.
        chromeMode: "chrome-for-testing" as const,
      };
      const composition = await selectComposition({ ...common, id: MOTIONMOX_COMPOSITION_ID });
      let last = 0;
      await renderMedia({
        ...common,
        composition,
        codec: "h264",
        pixelFormat: "yuv420p",
        crf: 18,
        audioCodec: "aac",
        concurrency: Number(process.env.MOTIONMOX_CONCURRENCY) || 1,
        outputLocation: output,
        overwrite: true,
        onProgress: ({ progress }) => {
          if (progress - last >= 0.05) {
            last = progress;
            args.onProgress?.(progress);
          }
        },
      });
      return output;
    } finally {
      await files.close();
    }
  });
}
