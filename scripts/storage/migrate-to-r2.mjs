// Defaults to read-only inventory. Originals are never removed by this tool.
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, basename } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import { createHash } from "node:crypto";
import { Client } from "pg";
import { createClient } from "@supabase/supabase-js";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { targetPath, hashStream, assertIntegrity, assertCheckpoint } from "./migration-core.mjs";

try {
  process.loadEnvFile(".env");
} catch {
  /* configured environment is also supported */
}
const args = new Set(process.argv.slice(2));
const modes = [
  "--copy",
  "--verify",
  "--activate",
  "--rollback",
  "--install-schema",
  "--check-references",
].filter((x) => args.has(x));
if (modes.length > 1 || [...args].some((x) => ![...modes, "--dry-run"].includes(x)))
  throw new Error("Choose one migration mode");
const mode = args.has("--dry-run") ? "--dry-run" : (modes[0] ?? "--dry-run");
const db = new Client({ connectionString: process.env.SUPABASE_DB_URL, statement_timeout: 120000 });
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
if (process.env.R2_BUCKET_NAME !== "mellox-media")
  throw new Error("Migration requires the private mellox-media bucket");
const endpoint =
  process.env.R2_ENDPOINT || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
if (endpoint.replace(/\/$/, "") !== `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`)
  throw new Error("Invalid Cloudflare endpoint");
const r2 = new S3Client({
  region: "auto",
  endpoint,
  forcePathStyle: true,
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const Bucket = process.env.R2_BUCKET_NAME;
let failed = 0;

async function sourceUrl(row) {
  const { data, error } = await sb.storage
    .from(row.source_bucket)
    .createSignedUrl(row.source_path, 3600);
  if (error || !data?.signedUrl) throw new Error("Could not read source object");
  return data.signedUrl;
}
async function sourceHash(row) {
  const res = await fetch(await sourceUrl(row), { signal: AbortSignal.timeout(120000) });
  if (!res.ok || !res.body) throw new Error("Source download failed");
  return hashStream(Readable.fromWeb(res.body));
}
async function targetHash(row) {
  const res = await r2.send(new GetObjectCommand({ Bucket, Key: row.target_path }));
  if (!res.Body) throw new Error("Target download failed");
  return hashStream(res.Body);
}
async function verify(row) {
  // Independently re-read both backends rather than trusting ETag or upload metadata.
  const source = await sourceHash(row);
  const target = await targetHash(row);
  assertIntegrity(source, target);
  assertCheckpoint(row, source);
  const signed = await getSignedUrl(r2, new GetObjectCommand({ Bucket, Key: row.target_path }), {
    expiresIn: 60,
  });
  const range = await fetch(signed, {
    headers: { Range: "bytes=0-0" },
    signal: AbortSignal.timeout(30000),
  });
  if (source.size > 0 && (range.status !== 206 || (await range.arrayBuffer()).byteLength !== 1))
    throw new Error("Signed range download failed");
  const unsigned = new URL(signed);
  unsigned.search = "";
  const privateCheck = await fetch(unsigned, {
    method: "HEAD",
    signal: AbortSignal.timeout(30000),
  });
  if (privateCheck.ok) throw new Error("R2 object is publicly accessible");
  return source;
}

async function copy(row) {
  const dir = await mkdtemp(join(tmpdir(), "mellox-r2-"));
  try {
    const file = join(dir, "object");
    const res = await fetch(await sourceUrl(row), { signal: AbortSignal.timeout(300000) });
    if (!res.ok || !res.body) throw new Error("Source download failed");
    const hash = createHash("sha256");
    let size = 0;
    await pipeline(
      Readable.fromWeb(res.body),
      new Transform({
        transform(chunk, enc, cb) {
          hash.update(chunk);
          size += chunk.length;
          cb(null, chunk);
        },
      }),
      createWriteStream(file, { mode: 0o600 }),
    );
    const source = { sha256: hash.digest("hex"), size };
    assertCheckpoint(row, source);
    let exists = false;
    try {
      await r2.send(new HeadObjectCommand({ Bucket, Key: row.target_path }));
      exists = true;
    } catch (e) {
      if (e.$metadata?.httpStatusCode !== 404) throw e;
    }
    if (exists) assertIntegrity(source, await targetHash(row));
    else
      await r2.send(
        new PutObjectCommand({
          Bucket,
          Key: row.target_path,
          Body: createReadStream(file),
          ContentLength: size,
          ContentType: res.headers.get("content-type")?.split(";")[0] || "application/octet-stream",
          Metadata: { sha256: source.sha256 },
          IfNoneMatch: "*",
        }),
      );
    const verified = await verify({ ...row, sha256: source.sha256, size_bytes: size });
    const checkpoint = await db.query(
      "update private.media_storage_migrations set sha256=$1,size_bytes=$2,status=case when exists(select 1 from public.workspaces w where w.id=workspace_id) then 'verified' else 'deleted' end,verified_at=now(),updated_at=now() where source_bucket=$3 and source_path=$4 and status in ('pending','rolled_back') returning status",
      [verified.sha256, verified.size, row.source_bucket, row.source_path],
    );
    const status =
      checkpoint.rows[0]?.status ??
      (
        await db.query(
          "select status from private.media_storage_migrations where source_bucket=$1 and source_path=$2",
          [row.source_bucket, row.source_path],
        )
      ).rows[0]?.status;
    // A concurrent user/workspace deletion must not leave a readable copied object.
    if (status === "deleted")
      await r2.send(new DeleteObjectCommand({ Bucket, Key: row.target_path }));
  } finally {
    const absoluteDir = resolve(dir);
    if (
      !absoluteDir.startsWith(resolve(tmpdir()) + (process.platform === "win32" ? "\\" : "/")) ||
      !basename(absoluteDir).startsWith("mellox-r2-")
    )
      throw new Error("Unexpected temporary directory");
    await rm(absoluteDir, { recursive: true, force: true });
  }
}

try {
  await db.connect();
  if (mode === "--install-schema") {
    await db.query("begin");
    await db.query(
      await readFile(
        new URL(
          "../../supabase/migrations/20261012190000_r2_storage_migration.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.query("commit");
    console.log(JSON.stringify({ mode, schemaInstalled: true }));
  } else {
    if (mode !== "--dry-run") {
      const lock = await db.query(
        "select pg_try_advisory_lock(hashtext('mellox-r2-storage-migration')) as locked",
      );
      if (!lock.rows[0].locked) throw new Error("Another migration is running");
    }
    const { rows: objects } = await db.query(
      "select o.bucket_id as source_bucket,o.name as source_path,split_part(o.name,'/',2) as workspace_id from storage.objects o order by o.bucket_id,o.name",
    );
    const { rows: workspaces } = await db.query("select id::text from public.workspaces");
    const owners = new Set(workspaces.map((x) => x.id));
    const eligible = [];
    let ineligible = 0;
    for (const row of objects) {
      try {
        if (row.source_bucket !== "generated-assets" || !owners.has(row.workspace_id))
          throw new Error("Unowned");
        row.target_path = targetPath(row.source_path);
        eligible.push(row);
      } catch {
        ineligible++;
      }
    }
    console.log(
      JSON.stringify({
        mode,
        sourceObjects: objects.length,
        eligible: eligible.length,
        ineligible,
      }),
    );
    if (mode !== "--dry-run") {
      if (mode === "--copy")
        for (const row of eligible) {
          await db.query(
            "insert into private.media_storage_migrations(source_bucket,source_path,target_path,workspace_id) values($1,$2,$3,$4) on conflict(source_bucket,source_path) do nothing",
            [row.source_bucket, row.source_path, row.target_path, row.workspace_id],
          );
        }
      const { rows } = await db.query(
        "select * from private.media_storage_migrations order by source_bucket,source_path",
      );
      let completed = 0;
      const processRow = async (row) => {
        if (row.status === "deleted") return;
        if (!owners.has(row.workspace_id)) {
          await db.query(
            "update private.media_storage_migrations set status='deleted',updated_at=now() where source_bucket=$1 and source_path=$2",
            [row.source_bucket, row.source_path],
          );
          return;
        }
        try {
          if (mode === "--copy" && ["pending", "rolled_back"].includes(row.status)) await copy(row);
          if (mode === "--verify") await verify(row);
          if (mode === "--activate" && row.status !== "active") {
            if (row.status !== "verified") throw new Error("Object is not verified");
            const verified = await verify(row);
            assertCheckpoint(row, verified);
            await db.query("begin");
            const current = await db.query(
              "select status from private.media_storage_migrations where source_bucket=$1 and source_path=$2 for update",
              [row.source_bucket, row.source_path],
            );
            const owner = await db.query(
              "select id from public.workspaces where id=$1 for key share",
              [row.workspace_id],
            );
            if (current.rows[0]?.status !== "verified" || !owner.rowCount) {
              await db.query("rollback");
              return;
            }
            await db.query("select private.switch_media_references($1,$2)", [
              row.source_path,
              row.target_path,
            ]);
            await db.query(
              "update private.media_storage_migrations set status='active',updated_at=now() where source_bucket=$1 and source_path=$2",
              [row.source_bucket, row.source_path],
            );
            await db.query("commit");
          }
          if (mode === "--check-references") {
            await db.query("begin");
            await db.query("select private.switch_media_references($1,$2)", [
              row.source_path,
              row.target_path,
            ]);
            await db.query("rollback");
          }
          if (mode === "--rollback" && row.status === "active") {
            assertCheckpoint(row, await sourceHash(row));
            await db.query("begin");
            const current = await db.query(
              "select status from private.media_storage_migrations where source_bucket=$1 and source_path=$2 for update",
              [row.source_bucket, row.source_path],
            );
            if (current.rows[0]?.status !== "active") {
              await db.query("rollback");
              return;
            }
            await db.query("select private.switch_media_references($1,$2)", [
              row.target_path,
              row.source_path,
            ]);
            await db.query(
              "update private.media_storage_migrations set status='rolled_back',updated_at=now() where source_bucket=$1 and source_path=$2",
              [row.source_bucket, row.source_path],
            );
            await db.query("commit");
          }
          completed++;
          console.log(JSON.stringify({ completed, total: rows.length, mode }));
        } catch (e) {
          await db.query("rollback");
          failed++;
          // Only fixed messages; provider errors may contain signed URLs/credentials.
          console.error(
            JSON.stringify({
              failed,
              mode,
              error: "Object operation failed; references and originals retained",
              checkpoint: rows.indexOf(row) + 1,
              code: /^[A-Z0-9_]{1,24}$/.test(e.code ?? "") ? e.code : undefined,
              httpStatus: e.$metadata?.httpStatusCode,
              reason:
                /^(Object|Signed|R2|Source|Target)/.test(e.message) && !e.message.includes("http")
                  ? e.message
                  : undefined,
            }),
          );
        }
      };
      // Copy/verification stream at most four files concurrently. Reference transactions stay serial.
      if (["--copy", "--verify"].includes(mode)) {
        let index = 0;
        await Promise.all(
          Array.from({ length: 4 }, async () => {
            while (index < rows.length) await processRow(rows[index++]);
          }),
        );
      } else {
        for (const row of rows) await processRow(row);
      }
      console.log(
        JSON.stringify({
          mode,
          completed,
          failed,
          states: (
            await db.query(
              "select status,count(*)::int as objects,sum(size_bytes)::text as bytes from private.media_storage_migrations group by status",
            )
          ).rows,
          originalsDeleted: 0,
        }),
      );
    }
  }
} catch {
  failed++;
  console.error(
    JSON.stringify({
      mode,
      error: "Migration stopped safely; check configuration or database access",
    }),
  );
} finally {
  await db.end();
  r2.destroy();
}
if (failed) process.exitCode = 1;
