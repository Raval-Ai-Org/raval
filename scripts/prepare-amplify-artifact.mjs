import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextDirectory = path.join(projectRoot, ".next");

for (const requiredPath of ["server", "static", "routes-manifest.json"]) {
  await stat(path.join(nextDirectory, requiredPath));
}

// Amplify deploys the standard .next SSR output. These are build-only files:
// the cache is regenerated, and standalone duplicates the standard server.
await rm(path.join(nextDirectory, "cache"), { recursive: true, force: true });
await rm(path.join(nextDirectory, "standalone"), { recursive: true, force: true });

async function directorySize(directory) {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    total += entry.isDirectory() ? await directorySize(entryPath) : (await stat(entryPath)).size;
  }
  return total;
}

const bytes = await directorySize(nextDirectory);
console.log(`Amplify artifact: ${(bytes / 1024 / 1024).toFixed(2)} MiB (${bytes} bytes)`);