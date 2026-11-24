// Round 9 example-brief library (evals/creative/briefs, ADR-0053): every brief
// keeps the writing rules, and the shipped table matches the files.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { SECTOR_KINDS } from "@/lib/studio/sectors/kinds.generated";
import { briefIssues } from "@/lib/studio/prompt-writer";
import { MECHANISMS } from "./example-briefs.generated";
import type { ExampleBrief } from "../../../evals/creative/briefs/types";

const dir = path.resolve("evals/creative/briefs");
const files = readdirSync(dir).filter((f) => /^g\d+\.json$/.test(f));
const briefs: ExampleBrief[] = files.flatMap((f) =>
  JSON.parse(readFileSync(path.join(dir, f), "utf8")),
);
const TYPE = {
  post: "image",
  carousel: "carousel",
  ad: "ad",
  story: "story",
  video: "video",
} as const;
const BANNED =
  /\b(elevate|unlock|game-?changer|seamless|next level|look no further|in today's world|one-stop shop|we've got you covered|high-quality|state-of-the-art|trusted by thousands|best in town|#1)\b/i;
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const tokens = (s: string) => new Set(s.toLowerCase().match(/[a-z]{4,}/g) ?? []);
const jaccard = (a: Set<string>, b: Set<string>) => {
  const inter = [...a].filter((x) => b.has(x)).length;
  return inter / (a.size + b.size - inter || 1);
};

describe.skipIf(!briefs.length)("example-brief library", () => {
  it("uses unique ids and known sectors", () => {
    const ids = briefs.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    const known = new Set(SECTOR_KINDS.map((s) => s.id));
    for (const b of briefs) {
      expect(known.has(b.sector), b.id).toBe(true);
      expect(b.id.startsWith(`${b.sector}-`), b.id).toBe(true);
    }
  });

  it("gives each sector at least six briefs over three goals and three formats", () => {
    const by = new Map<string, ExampleBrief[]>();
    for (const b of briefs) by.set(b.sector, [...(by.get(b.sector) ?? []), b]);
    for (const [sector, list] of by) {
      expect(list.length, sector).toBeGreaterThanOrEqual(6);
      expect(new Set(list.map((b) => b.goal)).size, sector).toBeGreaterThanOrEqual(3);
      expect(new Set(list.map((b) => b.format)).size, sector).toBeGreaterThanOrEqual(3);
    }
  });

  it("keeps every brief inside the writing rules", () => {
    const bad: string[] = [];
    for (const b of briefs) {
      const n = words(b.brief);
      if (n < 55 || n > 170) bad.push(`${b.id}: ${n} words`);
      if (b.mechanism.length > 140) bad.push(`${b.id}: mechanism too long`);
      if (BANNED.test(b.brief) || BANNED.test(b.mechanism)) bad.push(`${b.id}: banned phrase`);
      if (/\d{2,}|%|[$€£₹]/.test(b.brief)) bad.push(`${b.id}: a figure`);
      for (const p of b.brief.match(/\{[a-z_]+\}/g) ?? [])
        if (!b.placeholders.includes(p)) bad.push(`${b.id}: ${p} not listed`);
      const issues = briefIssues({
        prompt: b.brief,
        type: TYPE[b.format],
        known: b.placeholders.join(" "),
        slideCount: 6,
      });
      if (issues.length) bad.push(`${b.id}: ${issues.join(" ")}`);
    }
    expect(bad).toEqual([]);
  });

  it("never repeats a brief within a sector", () => {
    const close: string[] = [];
    for (let i = 0; i < briefs.length; i++)
      for (let j = i + 1; j < briefs.length; j++)
        if (
          briefs[i].sector === briefs[j].sector &&
          jaccard(tokens(briefs[i].brief), tokens(briefs[j].brief)) >= 0.5
        )
          close.push(`${briefs[i].id} ~ ${briefs[j].id}`);
    expect(close).toEqual([]);
  });

  it("ships exactly the files' mechanism lines (run scripts/briefs/build-briefs.mjs)", () => {
    expect(MECHANISMS.map((m) => m.id).sort()).toEqual(briefs.map((b) => b.id).sort());
  });
});
