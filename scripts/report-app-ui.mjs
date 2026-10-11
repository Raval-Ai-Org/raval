import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(".tmp-run/ui-audit");
const results = JSON.parse(await readFile(path.join(root, "screens/results.json"), "utf8"));
const workspace = (await readdir(path.join(root, "workspace"))).filter((file) =>
  file.endsWith(".png"),
);
const studio = JSON.parse(
  await readFile(path.join(root, "studio/results.json"), "utf8").catch(() => "[]"),
);
const all = [
  ...studio.map((r) => ({ ...r, src: `studio/${r.file}` })),
  ...results.filter((r) => r.file).map((r) => ({ ...r, src: `screens/${r.file}` })),
  ...workspace.map((file) => ({
    file,
    src: `workspace/${file}`,
    name: file.split("-").slice(0, -2).join("-"),
    theme: file.includes("-dark-") ? "dark" : "light",
    width: Number(file.match(/-(\d+)\.png$/)?.[1]),
    height: file.startsWith("workspace-")
      ? ({ 320: 568, 390: 844, 667: 375, 768: 1024, 1024: 768, 1440: 900, 1920: 1080 }[
          Number(file.match(/-(\d+)\.png$/)?.[1])
        ] ?? 900)
      : 900,
  })),
];
const issues = [...results, ...studio].filter(
  (r) => r.error || r.overflow > 1 || r.errors?.length || r.accessibility?.length,
);
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
await writeFile(
  path.join(root, "index.html"),
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mellox app UI audit</title>
<style>body{margin:0;background:#f4f5f7;color:#172022;font:15px system-ui}header,main{padding:24px;max-width:1440px;margin:auto}h1{font-size:28px;margin:0 0 10px}p{line-height:1.6}nav{display:flex;gap:12px;flex-wrap:wrap;margin:24px 0;position:sticky;top:0;padding:14px;background:#f4f5f7;z-index:1}select{padding:10px;border:1px solid #aab3b9;border-radius:8px;background:white}section{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:20px}article{background:white;border:1px solid #d6dcdf;border-radius:12px;padding:12px}h2{font-size:15px;margin:0 0 4px}small{color:#48575f}img{width:100%;height:300px;object-fit:contain;object-position:top;background:#ebedef;margin-top:12px;border-radius:8px}a{color:inherit}details{background:white;padding:16px;border-radius:12px;margin:16px 0}[hidden]{display:none!important}</style>
<header><h1>Mellox app UI audit · 11 October 2026</h1><p>${all.length} screenshots · Light and dark themes · Phone, landscape, tablet and desktop.<br>App UI uses deterministic fixtures. Landing page excluded. Live provider generation, OAuth, payments and publishing are outside this offline UI run.</p><p>Automated surface checks: ${results.length + studio.length} captures, ${issues.length} captures with reported issues. General app accessibility checks run at 390px and 1440px; Studio checks run at all three tested sizes. Other sizes check layout and rendering.</p>
<details><summary>Fixes included</summary><ul><li>Account auth listener no longer re-enters Supabase auth while its session lock is held.</li><li>Chat greeting remains visible during startup and fits short landscape screens.</li><li>Strategy frequency indicators have valid accessible labels.</li><li>Strategy draft badges and project approval text use readable semantic colours.</li><li>Calendar view switches use valid button semantics; date selection, adding and opening posts are separate controls.</li><li>Connection loading states announce their status accessibly.</li><li>Studio platform controls have accessible names; progress text, Story chrome and carousel thumbnails have improved contrast.</li><li>Library cards and downloads are independent keyboard controls, with downloads visible on touch devices.</li><li>Studio chips retain their intended 44px touch targets on small screens.</li><li>Clarity initializes its command queue before its remote tag runs.</li><li>Browser tests wait for hydration and use the current cookie-based session fixtures.</li></ul></details></header>
<main><nav><label>Theme <select id="theme"><option value="">Both</option><option>light</option><option>dark</option></select></label><label>Screen <select id="screen"><option value="">All screens</option>${[
    ...new Set(all.map((r) => r.name)),
  ]
    .sort()
    .map((n) => `<option>${escape(n)}</option>`)
    .join(
      "",
    )}</select></label><label>Width <select id="width"><option value="">All sizes</option>${[
    ...new Set(all.map((r) => r.width)),
  ]
    .sort((a, b) => a - b)
    .map((w) => `<option>${w}</option>`)
    .join(
      "",
    )}</select></label><span id="count"></span></nav><section>${all.map((r) => `<article data-theme="${r.theme}" data-screen="${escape(r.name)}" data-width="${r.width}"><h2>${escape(r.name)}</h2><small>${r.theme} · ${r.width} × ${r.height} viewport</small><a href="${escape(r.src)}" target="_blank"><img src="${escape(r.src)}" alt="${escape(r.name)} ${r.theme} at ${r.width}px" loading="lazy"></a></article>`).join("")}</section></main><script>const filters=['theme','screen','width'];function filter(){let n=0;document.querySelectorAll('article').forEach(el=>{el.hidden=filters.some(key=>document.getElementById(key).value&&el.dataset[key]!==document.getElementById(key).value);if(!el.hidden)n++});document.getElementById('count').textContent=n+' screenshots'}filters.forEach(key=>document.getElementById(key).addEventListener('change',filter));filter();</script></html>`,
);
console.log(path.join(root, "index.html"));
