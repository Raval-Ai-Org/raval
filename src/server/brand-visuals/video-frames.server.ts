import "server-only";
import { launchVisualBrowser } from "./browser.server";

/** Decode owned video bytes in an isolated offline browser, never an external page. */
export async function sampleVideoFrames(
  bytes: Buffer,
  mime: string,
): Promise<{ duration: number; frames: { time: number; bytes: Buffer }[] }> {
  const browser = await launchVisualBrowser();
  try {
    const context = await browser.newContext({ serviceWorkers: "block", acceptDownloads: false });
    const ownedUrl = "https://mellox-video.invalid/reference";
    await context.route("**/*", async (route) => {
      const request = route.request();
      if (request.url() !== ownedUrl || request.method() !== "GET") return route.abort();
      // The only allowed request is fulfilled from the already-owned buffer.
      // Handle byte ranges so the decoder can seek without external networking.
      const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers().range ?? "");
      const start = range ? Number(range[1]) : 0;
      const end = range?.[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
      if (!Number.isSafeInteger(start) || start > end || start >= bytes.length)
        return route.fulfill({
          status: 416,
          headers: { "content-range": `bytes */${bytes.length}` },
        });
      await route.fulfill({
        status: range ? 206 : 200,
        body: bytes.subarray(start, end + 1),
        headers: {
          "content-type": mime,
          "access-control-allow-origin": "*",
          "accept-ranges": "bytes",
          ...(range ? { "content-range": `bytes ${start}-${end}/${bytes.length}` } : {}),
        },
      });
    });
    await context.routeWebSocket(/.*/, (socket) => socket.close());
    const page = await context.newPage();
    const result = await page.evaluate(
      async ({ ownedUrl }) => {
        const video = document.createElement("video");
        video.muted = true;
        video.crossOrigin = "anonymous";
        video.preload = "auto";
        const waitFor = (event: string) =>
          new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("Video decoding timed out")), 8000);
            video.addEventListener(
              event,
              () => {
                clearTimeout(timeout);
                resolve();
              },
              { once: true },
            );
            video.addEventListener(
              "error",
              () => {
                clearTimeout(timeout);
                reject(
                  new Error(
                    "This video codec could not be decoded. Use an H.264 MP4 or VP9 WebM reference.",
                  ),
                );
              },
              { once: true },
            );
          });
        const metadata = waitFor("loadedmetadata");
        video.src = ownedUrl;
        await metadata;
        if (
          !Number.isFinite(video.duration) ||
          video.duration <= 0 ||
          video.duration > 30 ||
          video.videoWidth < 1 ||
          video.videoHeight < 1 ||
          video.videoWidth * video.videoHeight > 12_000_000
        )
          throw new Error("Use a video up to 30 seconds and 4K.");
        const canvas = document.createElement("canvas");
        canvas.width = Math.min(1280, video.videoWidth);
        canvas.height = Math.round((canvas.width * video.videoHeight) / video.videoWidth);
        const ctx = canvas.getContext("2d")!;
        const frames: { time: number; url: string }[] = [];
        for (const time of [
          Math.min(0.1, video.duration * 0.05),
          video.duration / 2,
          video.duration * 0.95,
        ]) {
          const ready = waitFor("seeked");
          video.currentTime = time;
          await ready;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          frames.push({ time, url: canvas.toDataURL("image/png") });
        }
        const duration = video.duration;
        video.src = "";
        return { duration, frames };
      },
      { ownedUrl },
    );
    return {
      duration: result.duration,
      frames: result.frames.map((f) => ({
        time: f.time,
        bytes: Buffer.from(f.url.split(",")[1], "base64"),
      })),
    };
  } finally {
    await browser.close();
  }
}
