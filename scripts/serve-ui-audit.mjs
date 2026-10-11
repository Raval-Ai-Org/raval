import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(".tmp-run/ui-audit");
const types = {
  ".html": "text/html; charset=utf-8",
  ".png": "image/png",
  ".json": "application/json",
};
http
  .createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      const file = path.resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
      if (!file.startsWith(root + path.sep)) {
        response.writeHead(403).end();
        return;
      }
      const body = await readFile(file);
      response.writeHead(200, {
        "Content-Type": types[path.extname(file)] || "application/octet-stream",
      });
      response.end(body);
    } catch {
      response.writeHead(404).end("Not found");
    }
  })
  .listen(8090, "127.0.0.1", () => console.log("Mellox screenshot gallery: http://localhost:8090"));
