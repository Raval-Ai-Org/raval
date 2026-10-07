import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const clarityId = process.env.NEXT_PUBLIC_CLARITY_ID?.trim();
if (!clarityId) {
  throw new Error("NEXT_PUBLIC_CLARITY_ID must be set during the production build.");
}

const distDir = resolve(process.cwd(), process.env.NEXT_DIST_DIR || ".next");
const chunksDir = join(distDir, "static", "chunks");
const routesManifestPath = join(distDir, "routes-manifest.json");

async function findChunkWithClarityId(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      const match = await findChunkWithClarityId(path);
      if (match) return match;
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      const contents = await readFile(path, "utf8");
      if (contents.includes(clarityId) && contents.includes("https://www.clarity.ms/tag/")) {
        return path;
      }
    }
  }
  return undefined;
}

const clientChunk = await findChunkWithClarityId(chunksDir);
if (!clientChunk) {
  throw new Error(
    "The production client bundle does not contain the configured Clarity ID and loader URL.",
  );
}

const routesManifest = JSON.parse(await readFile(routesManifestPath, "utf8"));
const cspHeaders = routesManifest.headers
  .flatMap((rule) => rule.headers)
  .filter((header) => header.key.toLowerCase() === "content-security-policy")
  .map((header) => header.value);
if (cspHeaders.length === 0) {
  throw new Error("The production routes manifest does not contain a CSP header.");
}

const clarityHosts = [
  "https://www.clarity.ms",
  ...Array.from(
    { length: 26 },
    (_, index) => `https://${String.fromCharCode(97 + index)}.clarity.ms`,
  ),
];

for (const csp of cspHeaders) {
  const directives = new Map(
    csp.split(";").map((directive) => {
      const [name, ...sources] = directive.trim().split(/\s+/);
      return [name, sources];
    }),
  );
  const scriptSources = directives.get("script-src") || [];
  const connectSources = directives.get("connect-src") || [];
  const scriptClarityHosts = scriptSources.filter((source) => source.includes("clarity.ms"));
  const connectClarityHosts = connectSources.filter((source) => source.includes("clarity.ms"));

  if (
    clarityHosts.some((host) => !scriptSources.includes(host)) ||
    clarityHosts.some((host) => !connectSources.includes(host)) ||
    scriptClarityHosts.length !== clarityHosts.length ||
    connectClarityHosts.length !== clarityHosts.length ||
    !connectSources.includes("https://c.bing.com")
  ) {
    throw new Error(
      "The production CSP is missing required Clarity hosts or allows a different Clarity host set.",
    );
  }
}

console.log("Verified Microsoft Clarity ID in production client bundle and required CSP hosts.");
