// The render's own file server: 127.0.0.1 on a random port, one random token
// per render, serving only plain file names inside that render's folder.
// MotionMox's Chromium can reach nothing else (MOTIONMOX-PATCH offline).
import "server-only";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { extname, join } from "node:path";
import type { AddressInfo } from "node:net";

const NAME = /^[A-Za-z0-9_.-]{1,80}$/;
const TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

export type RenderFiles = { baseUrl: string; close: () => Promise<void> };

/** Serve `dir` until `close()`. Pure request rules are in `resolveRequest` (tested). */
export async function serveRenderFiles(dir: string): Promise<RenderFiles> {
  const token = randomBytes(18).toString("hex");
  const server: Server = createServer(async (req, res) => {
    const name = resolveRequest(req.method ?? "GET", req.url ?? "/", token);
    if (!name) {
      res.writeHead(404).end();
      return;
    }
    const file = join(dir, name);
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) {
      res.writeHead(404).end();
      return;
    }
    const type = TYPES[extname(name).toLowerCase()] ?? "application/octet-stream";
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
    if (range) {
      const start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(info.size - 1, Number(range[2])) : info.size - 1;
      if (start > end || start >= info.size) {
        res.writeHead(416, { "Content-Range": `bytes */${info.size}` }).end();
        return;
      }
      res.writeHead(206, {
        "Content-Type": type,
        "Content-Length": end - start + 1,
        "Content-Range": `bytes ${start}-${end}/${info.size}`,
        "Accept-Ranges": "bytes",
      });
      if (req.method === "HEAD") return void res.end();
      createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": info.size,
      "Accept-Ranges": "bytes",
    });
    if (req.method === "HEAD") return void res.end();
    createReadStream(file).pipe(res);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}/${token}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** The file name a request may read, or null. Only GET/HEAD, the right token, one plain name. */
export function resolveRequest(method: string, url: string, token: string): string | null {
  if (method !== "GET" && method !== "HEAD") return null;
  const path = url.split("?")[0];
  const parts = path.split("/").filter(Boolean);
  if (parts.length !== 2 || parts[0] !== token) return null;
  let name: string;
  try {
    name = decodeURIComponent(parts[1]);
  } catch {
    return null;
  }
  return NAME.test(name) && name !== "." && name !== ".." ? name : null;
}
