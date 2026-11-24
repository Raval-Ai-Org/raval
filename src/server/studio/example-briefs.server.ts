import "server-only";
import { createHash } from "node:crypto";
import { MECHANISMS, type MechanismRow } from "./example-briefs.generated";

/** Studio formats mapped onto the brief library's formats. */
const FORMAT_OF: Record<string, string> = {
  image: "post",
  social: "post",
  carousel: "carousel",
  ad: "ad",
  story: "story",
  video: "video",
};

/**
 * One "why it sells" line for a piece (Round 9, flag `sectors`): the sector's
 * mechanisms, the same goal and format first, skipping ids used recently, then
 * a stable pick by seed. Null when the sector has none.
 */
export function mechanismLineFor(args: {
  sector: string | null | undefined;
  goal?: string | null;
  format?: string | null;
  seed: string;
  recent?: readonly string[];
  rows?: readonly MechanismRow[];
}): { id: string; line: string } | null {
  if (!args.sector) return null;
  const rows = (args.rows ?? MECHANISMS).filter((r) => r.sector === args.sector);
  if (!rows.length) return null;
  const used = new Set(args.recent ?? []);
  const fresh = rows.filter((r) => !used.has(r.id));
  const pool = fresh.length ? fresh : rows;
  const format = args.format ? (FORMAT_OF[args.format] ?? args.format) : null;
  const score = (r: MechanismRow) => (r.goal === args.goal ? 2 : 0) + (r.format === format ? 1 : 0);
  const best = Math.max(...pool.map(score));
  const top = pool.filter((r) => score(r) === best);
  const n = parseInt(createHash("sha256").update(args.seed).digest("hex").slice(0, 8), 16);
  const pick = top[n % top.length];
  return { id: pick.id, line: `Why this kind of post sells here: ${pick.mechanism}` };
}
