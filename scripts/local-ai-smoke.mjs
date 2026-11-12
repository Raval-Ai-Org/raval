#!/usr/bin/env node
// Smoke-test the local AI sidecar (docs/local-ai.md): health, then one call per
// endpoint on a generated test picture. Spends nothing.
//
//   LOCAL_AI_URL=http://127.0.0.1:8090 node scripts/local-ai-smoke.mjs
import sharp from "sharp";

const base = (process.env.LOCAL_AI_URL || "http://127.0.0.1:8090").replace(/\/+$/, "");
const headers = { "Content-Type": "application/json" };
if (process.env.LOCAL_AI_TOKEN) headers.Authorization = `Bearer ${process.env.LOCAL_AI_TOKEN}`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640">
  <rect width="640" height="640" fill="#f4efe6"/>
  <rect x="220" y="160" width="200" height="320" rx="24" fill="#2f6f4e"/>
  <text x="320" y="580" font-size="48" text-anchor="middle" font-family="sans-serif" fill="#111">SUMMER SALE</text>
</svg>`;
const image = (await sharp(Buffer.from(svg)).png().toBuffer()).toString("base64");

async function post(path, body) {
  const started = Date.now();
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const type = res.headers.get("content-type") || "";
  const out = type.includes("json")
    ? await res.json()
    : `${(await res.arrayBuffer()).byteLength} bytes`;
  console.log(path.padEnd(11), res.status, `${Date.now() - started} ms`, out);
  return res.ok;
}

let ok = true;
const health = await fetch(`${base}/health`).catch(() => null);
if (!health?.ok) {
  console.error(`Sidecar not reachable at ${base}`);
  process.exit(1);
}
console.log("/health    ", await health.json());
ok = (await post("/cutout", { image })) && ok;
ok = (await post("/ocr", { image })) && ok;
ok = (await post("/safety", { image })) && ok;
ok = (await post("/aesthetic", { image })) && ok;
ok = (await post("/tts", { text: "Summer sale starts today.", language: "en" })) && ok;
process.exit(ok ? 0 : 1);
