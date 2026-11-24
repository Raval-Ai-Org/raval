// score.mjs — turns a blind run (.live-out/blind/<run>) into report.md.
// A pair counts for an arm only when the judge picked it in both orders;
// votes.json (from gallery.html) is scored the same way when present.
// Ship gate (ADR-0053): at least 64 non-tie pairs, win rate >= 60% with the
// Wilson lower bound above 50%, no dimension 0.3 worse, services not worse.
//   node scripts/creative-benchmark/score.mjs .live-out/blind/<run>
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const dir = process.argv[2];
if (!dir) throw new Error("usage: score.mjs <run dir>");
const read = (f) => JSON.parse(readFileSync(path.join(dir, f), "utf8"));
const { arms, key } = read("key.json");
const judged = read("judge.json");
const DIMS = ["relevance", "words", "clarity", "type", "craft", "brand", "accuracy"];

export function wilson(wins, n, z = 1.96) {
  if (!n) return [0, 0];
  const p = wins / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - m) / d, (c + m) / d];
}

function tally(rows) {
  const t = { [arms[0]]: 0, [arms[1]]: 0, tie: 0, controlsSplit: 0, controls: 0 };
  const dims = { [arms[0]]: {}, [arms[1]]: {} };
  const typeCats = { [arms[0]]: new Set(), [arms[1]]: new Set() };
  for (const row of rows) {
    const k = key[row.id];
    if (!k) continue;
    const [first, second] = row.verdicts;
    // Order 1 shows left as A; order 2 shows right as A.
    const w1 = first?.better === "A" ? k.left : first?.better === "B" ? k.right : "tie";
    const w2 = second?.better === "A" ? k.right : second?.better === "B" ? k.left : "tie";
    if (k.control) {
      t.controls++;
      if (w1 === "tie" || w2 === "tie" || w1 !== w2) t.controlsSplit++;
      continue;
    }
    const winner = w1 === w2 ? w1 : "tie";
    t[winner] = (t[winner] ?? 0) + 1;
    for (const [v, leftIsA] of [
      [first, true],
      [second, false],
    ]) {
      if (!v?.a || !v?.b) continue;
      const leftScores = leftIsA ? v.a : v.b;
      const rightScores = leftIsA ? v.b : v.a;
      for (const [arm, s] of [
        [k.left, leftScores],
        [k.right, rightScores],
      ]) {
        for (const d of DIMS) (dims[arm][d] ??= []).push(Number(s[d]) || 0);
        if (s.typeCategory) typeCats[arm].add(String(s.typeCategory).toLowerCase());
      }
    }
  }
  return { t, dims, typeCats };
}

const avg = (xs) => (xs?.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function section(title, rows) {
  const { t, dims, typeCats } = tally(rows);
  const n = t[arms[0]] + t[arms[1]];
  const [lo, hi] = wilson(t[arms[1]], n);
  const worse = DIMS.filter((d) => avg(dims[arms[1]][d]) - avg(dims[arms[0]][d]) <= -0.3);
  const lines = [
    `## ${title}`,
    "",
    `Non-tie pairs: ${n} (ties ${t.tie}). ${arms[1]} wins ${t[arms[1]]}, ${arms[0]} wins ${t[arms[0]]}.`,
    `Win rate for ${arms[1]}: ${n ? ((100 * t[arms[1]]) / n).toFixed(1) : "-"}% (95% Wilson ${(100 * lo).toFixed(1)} to ${(100 * hi).toFixed(1)}%).`,
    t.controls ? `A-vs-A controls called a tie or split: ${t.controlsSplit} of ${t.controls}.` : "",
    "",
    `| dimension | ${arms[0]} | ${arms[1]} | change |`,
    "|---|---|---|---|",
    ...DIMS.map((d) => {
      const a = avg(dims[arms[0]][d]);
      const b = avg(dims[arms[1]][d]);
      const diff = b - a;
      return `| ${d} | ${a.toFixed(2)} | ${b.toFixed(2)} | ${diff >= 0 ? "+" : ""}${diff.toFixed(2)} |`;
    }),
    "",
    `Type categories seen: ${arms[0]} ${typeCats[arms[0]].size}, ${arms[1]} ${typeCats[arms[1]].size}.`,
    "",
  ];
  const pass = n >= 64 && t[arms[1]] / n >= 0.6 && lo > 0.5 && !worse.length;
  return { text: lines.join("\n"), pass, worse, n };
}

const all = section("All cases", judged);
const services = section(
  "Service businesses",
  judged.filter((r) => r.id.startsWith("svc-")),
);
let votes = "";
if (existsSync(path.join(dir, "votes.json"))) {
  const v = read("votes.json");
  const count = { [arms[0]]: 0, [arms[1]]: 0, tie: 0 };
  for (const [id, side] of Object.entries(v)) {
    const k = key[id];
    if (!k || k.control) continue;
    count[side === "left" ? k.left : side === "right" ? k.right : "tie"]++;
  }
  const n = count[arms[0]] + count[arms[1]];
  const [lo] = wilson(count[arms[1]], n);
  votes = `## Owner's blind votes\n\n${arms[1]} ${count[arms[1]]}, ${arms[0]} ${count[arms[0]]}, ties ${count.tie} (Wilson lower bound ${(100 * lo).toFixed(1)}%).\n`;
}
const reasons = [
  all.n < 64 ? "too few pairs" : "",
  all.worse.length ? `worse on ${all.worse.join(", ")}` : "",
  services.worse.length ? `services worse on ${services.worse.join(", ")}` : "",
]
  .filter(Boolean)
  .join("; ");
const gate =
  all.pass && !services.worse.length
    ? `PASS: ${arms[1]} may be switched on.`
    : `NOT YET: keep ${arms[1]} off${reasons ? ` (${reasons})` : ""}; it needs a 60% win with the lower bound above 50%.`;
const report = [
  `# Blind benchmark: ${arms[0]} vs ${arms[1]}`,
  "",
  `**Gate:** ${gate}`,
  "",
  all.text,
  services.text,
  votes,
].join("\n");
writeFileSync(path.join(dir, "report.md"), report);
console.log(report);
