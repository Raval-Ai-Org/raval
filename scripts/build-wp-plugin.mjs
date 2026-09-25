// build-wp-plugin.mjs — packages integrations/wordpress/mellox-geo into
// public/downloads/mellox-geo.zip, the file the WordPress connector card offers.
// A plain "stored" zip (no compression) so it needs no dependency; the plugin
// is a few kilobytes. `--check` exits 1 when the committed zip is out of date.
//
//   node scripts/build-wp-plugin.mjs [--check]
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const pluginDir = path.join(root, "integrations", "wordpress", "mellox-geo");
const out = path.join(root, "public", "downloads", "mellox-geo.zip");

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function files(dir, prefix) {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const full = path.join(dir, name);
      return statSync(full).isDirectory()
        ? files(full, `${prefix}${name}/`)
        : [{ name: `${prefix}${name}`, data: readFileSync(full) }];
    });
}

export function buildZip() {
  const entries = files(pluginDir, "mellox-geo/");
  const locals = [];
  const centrals = [];
  let offset = 0;
  // Fixed DOS timestamp (2026-01-01 00:00) so the output is reproducible.
  const dosTime = 0;
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

const zip = buildZip();
if (process.argv.includes("--check")) {
  const current = existsSync(out) ? readFileSync(out) : Buffer.alloc(0);
  if (!current.equals(zip)) {
    console.error(
      "public/downloads/mellox-geo.zip is out of date: run node scripts/build-wp-plugin.mjs",
    );
    process.exit(1);
  }
  console.log("mellox-geo.zip is up to date");
} else {
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, zip);
  console.log(`wrote ${path.relative(root, out)} (${zip.length} bytes)`);
}
