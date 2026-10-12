import { createHash } from "node:crypto";

export function targetPath(path) {
  if (
    !/^workspace\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/assets\/[A-Za-z0-9._/-]+$/i.test(
      path,
    ) ||
    path.includes("..") ||
    path.includes("//") ||
    path.includes("/assets/r2/")
  )
    throw new Error("Ineligible workspace object path");
  return path.replace("/assets/", "/assets/r2/migrated/");
}

export async function hashStream(stream) {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of stream) {
    hash.update(chunk);
    size += chunk.byteLength;
  }
  return { sha256: hash.digest("hex"), size };
}

export function assertIntegrity(source, target) {
  if (source.sha256 !== target.sha256 || source.size !== target.size)
    throw new Error("Object integrity verification failed");
}

/** A checkpoint never grants permission to overwrite a changed source or target. */
export function assertCheckpoint(row, verified) {
  if (row.sha256 && (row.sha256 !== verified.sha256 || Number(row.size_bytes) !== verified.size))
    throw new Error("Object changed since its migration checkpoint");
}
